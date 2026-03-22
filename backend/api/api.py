from ctypes import Array
from pydoc import text
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
from pathlib import Path
import os
import sys
import ast
import base64
from typing import Optional
import uuid
from dotenv import load_dotenv

# FIX: Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from speech.stt import SpeechToText
from llm.llm import LLM
from speech.tts import TextToSpeech
from utils.executor import run_ai_code, run_ai_code_async, extract_code

# Base directory (backend/)
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

# Load environment variables from backend/.env regardless of cwd
load_dotenv(dotenv_path=ENV_FILE)

TEMP_AUDIO_DIR = BASE_DIR / "temp_audio"

# Initialize FastAPI
app = FastAPI(title="LyraMate API", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
stt = None
llm = None
tts = None

@app.on_event("startup")
async def startup_event():
    """Initialize components on startup"""
    global stt, llm, tts
    
    print("🚀 Initializing LyraMate...")
    # STT
    try:
        print("📝 Loading Whisper: " + os.getenv("WHISPER_MODEL", "base") + " on " + os.getenv("WHISPER_DEVICE", "cuda"))
        stt = SpeechToText(model_size=os.getenv("WHISPER_MODEL", "base"), device=os.getenv("WHISPER_DEVICE", "cuda"))
    except Exception as e:
        print(f"❌ STT unavailable: {e}")
        print("   Speech recognition will be disabled.")
        stt = None
    
    # LLM
    try:
        print("🧠 Loading LLM...")
        llm = LLM(model=os.getenv("OLLAMA_MODEL", "llama3.2:3b"))
    except Exception as e:
        print(f"❌ LLM unavailable: {e}")
        print("   Make sure Ollama is running (ollama serve).")
        llm = None
    
    # TTS
    try:
        print("🎙️ Loading Piper TTS...")
        tts = TextToSpeech(voice=os.getenv("PIPER_MODEL", "en_US-amy-medium"))
    except Exception as e:
        print(f"❌ TTS unavailable: {e}")
        print("   Text-to-speech will be disabled.")
        tts = None
    
    components_ok = sum(1 for c in [stt, llm, tts] if c is not None)
    print(f"\n{'✅' if components_ok == 3 else '⚠️'} LyraMate started ({components_ok}/3 components active)")

# Pydantic models
class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str
    audio_file: str = None

# === ENDPOINTS ===

@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "online",
        "message": "LyraMate API is running",
        "components": {
            "stt": stt is not None,
            "llm": llm is not None,
            "tts": tts is not None
        }
    }

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Text chat endpoint
    Input: text
    Output: response + audio
    """
    if llm is None:
        return ChatResponse(
            response="LLM model is unavailable. Make sure Ollama is running.",
            audio_file=None
        )
    
    user_message = request.message
    
    # Check if user requests reset
    if "reset" in user_message.lower():
        llm.reset_conversation()
        response_text = "Conversation reset!"
    else:
        # LLM generates response (async)
        llm_response = await llm.chat_async(user_message)
        response_text = llm_response["response"]
    
    # Generate response audio
    audio_file = None
    if response_text:
        audio_path = TEMP_AUDIO_DIR / f"response_{hash(response_text)}.wav"
        audio_path.parent.mkdir(exist_ok=True)
        
        try:
            await tts.synthesize_async(response_text, output_file=str(audio_path))
            audio_file = f"/audio/{audio_path.name}"
        except Exception as e:
            print(f"TTS Error: {e}")
    
    return ChatResponse(
        response=response_text,
        audio_file=audio_file
    )

@app.post("/voice-chat")
async def voice_chat(
    audio: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
):
    """
    Voice chat endpoint (with optional vision)
    Input: audio file + optional image
    Output: text response + audio
    """
    if stt is None:
        return {"error": "STT unavailable. Whisper was not loaded.", "transcription": None, "response": None, "audio_file": None}
    if llm is None:
        return {"error": "LLM unavailable. Make sure Ollama is running.", "transcription": None, "response": None, "audio_file": None}

    # If image provided, encode to base64
    image_b64 = None
    if image is not None:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    # Read audio into memory
    audio_bytes = await audio.read()

    # Save to temp file for Whisper (use safe random name, never client-supplied filename)
    temp_audio = TEMP_AUDIO_DIR / f"{uuid.uuid4().hex}.wav"
    temp_audio.parent.mkdir(exist_ok=True)
    with open(temp_audio, "wb") as f:
        f.write(audio_bytes)

    # STT: audio -> text
    try:
        user_message = await stt.transcribe_file_async(temp_audio)
    except Exception as e:
        print(f"❌ STT Error: {e}")
        temp_audio.unlink(missing_ok=True)
        return {"error": f"Audio transcription error: {e}", "transcription": None, "response": None, "audio_file": None}

    temp_audio.unlink(missing_ok=True)
    print(f"👤 User{' (vision+voice)' if image_b64 else ''}: {user_message}")

    # Check if user requests reset
    if "reset" in user_message.lower():
        llm.reset_conversation()
        response_text = "Conversation reset!"
    else:
        # LLM: generate response, with image if available
        kwargs = {}
        if image_b64:
            kwargs["images"] = [image_b64]
        llm_response = await llm.chat_async(user_message, **kwargs)
        response_text = llm_response["response"].replace("**", "")
        print(f"🤖 RAW AI: {response_text}")
        extracted_code = extract_code(response_text)
        if isinstance(extracted_code, list) and extracted_code:
            stdout, stderr = await run_ai_code_async(extracted_code[0])
            message_result = stdout.replace("\n", "") if stdout else ""
            message_result += f" (Error: {stderr.strip()})" if stderr else ""
            response_text = f"Ok {message_result}"


    # TTS: text -> audio
    audio_output = TEMP_AUDIO_DIR / f"response_{hash(response_text)}.wav"
    try:
        await tts.synthesize_async(response_text, output_file=str(audio_output))
    except Exception as e:
        print(f"TTS Error: {e}")
        audio_output = None

    return {
        "transcription": user_message,
        "response": response_text,
        "code": extracted_code[0] if isinstance(extracted_code, list) and extracted_code else None,
        "audio_file": f"/audio/{audio_output.name}" if audio_output else None
    }

@app.get("/audio/{filename}")
async def get_audio(filename: str):
    """Serve generated audio files"""
    file_path = (TEMP_AUDIO_DIR / filename).resolve()
    if not str(file_path).startswith(str(TEMP_AUDIO_DIR.resolve())):
        return {"error": "Invalid filename"}
    if file_path.exists():
        return FileResponse(file_path, media_type="audio/wav")
    return {"error": "File not found"}

@app.post("/reset")
async def reset_conversation():
    """Reset conversation"""
    if llm is None:
        return {"error": "LLM unavailable"}
    llm.reset_conversation()
    return {"message": "Conversation reset"}


# WebSocket for real-time streaming (test)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    if llm is None:
        await websocket.send_json({"error": "LLM unavailable. Make sure Ollama is running."})
        await websocket.close()
        return
    
    try:
        while True:
            data = await websocket.receive_text()
            
            # Check if user requests reset
            if "reset" in data.lower():
                llm.reset_conversation()
                await websocket.send_json({
                    "response": "Conversation reset!"
                })
            else:
                # Process message
                llm_response = llm.chat(data)
                
                await websocket.send_json({
                    "response": llm_response["response"]
                })
    except WebSocketDisconnect:
        print("Client disconnected")

# Run server
if __name__ == "__main__":
    uvicorn.run(
        "api.api:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", 8000)),
        reload=True
    )