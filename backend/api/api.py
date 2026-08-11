from ctypes import Array
from pydoc import text
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel
import uvicorn
from pathlib import Path
import os
import sys
import ast
import base64
import re
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


def _drain_tts_segments(buffer: str):
    """Return complete sentence-like segments and remainder."""
    first_chunk_target = int(os.getenv("STREAM_TTS_FIRST_CHUNK_CHARS", "70"))
    next_chunk_target = int(os.getenv("STREAM_TTS_CHUNK_CHARS", "120"))

    # Prefer early splits on strong punctuation and line breaks.
    parts = re.split(r"(?<=[.!?])\s+|\n+", buffer)
    if len(parts) <= 1:
        # If no strong punctuation yet, allow earlier chunking by softer separators.
        if len(buffer) >= first_chunk_target:
            soft_split = max(
                buffer.rfind(",", 0, first_chunk_target),
                buffer.rfind(";", 0, first_chunk_target),
                buffer.rfind(":", 0, first_chunk_target),
            )
            if soft_split > 20:
                return [buffer[: soft_split + 1].strip()], buffer[soft_split + 1 :]

        # Fallback: split by nearest whitespace around target lengths.
        if len(buffer) >= first_chunk_target and " " in buffer:
            split_target = first_chunk_target
            split_at = buffer.rfind(" ", 0, split_target)
            if split_at < 20 and len(buffer) >= next_chunk_target:
                split_target = next_chunk_target
                split_at = buffer.rfind(" ", 0, split_target)
            if split_at > 20:
                return [buffer[:split_at].strip()], buffer[split_at + 1 :]
        return [], buffer
    return [p.strip() for p in parts[:-1] if p.strip()], parts[-1]

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

@app.post("/voice-transcribe")
async def voice_transcribe(audio: UploadFile = File(...)):
    """
    Voice transcription endpoint
    Input: audio file
    Output: transcription (text)
    """
    if stt is None:
        return {"error": "STT unavailable. Whisper was not loaded.", "transcription": None}

    # Read audio into memory
    audio_bytes = await audio.read()

    # Save to temp file for Whisper (use safe random name, never client-supplied filename)
    temp_audio = TEMP_AUDIO_DIR / f"{uuid.uuid4().hex}.wav"
    temp_audio.parent.mkdir(exist_ok=True)
    with open(temp_audio, "wb") as f:
        f.write(audio_bytes)

    # STT: audio -> text
    try:
        transcription = await stt.transcribe_file_async(temp_audio)
    except Exception as e:
        print(f"❌ STT Error: {e}")
        temp_audio.unlink(missing_ok=True)
        return {"error": f"Audio transcription error: {e}", "transcription": None}

    temp_audio.unlink(missing_ok=True)
    return {"transcription": transcription}

@app.post("/voice-chat")
async def voice_chat(
    text: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
):
    """
    Voice chat endpoint (with optional vision)
    Input: text + optional image
    Output: text response + audio
    """
    if llm is None:
        return {"error": "LLM unavailable. Make sure Ollama is running.", "transcription": None, "response": None, "audio_file": None}

    # If image provided, encode to base64
    image_b64 = None
    if image is not None:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    user_message = text or ""
    
    print(f"👤 User{' (vision+voice)' if image_b64 else ''}: {user_message}")

    extracted_code = None
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
        response_text = llm_response["response"]
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
        # Delete temp response audio once the response is sent.
        return FileResponse(
            file_path,
            media_type="audio/wav",
            background=BackgroundTask(lambda: file_path.unlink(missing_ok=True)),
        )
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


@app.websocket("/ws/voice-stream")
async def websocket_voice_stream(websocket: WebSocket):
    """Stream LLM text and TTS audio chunks with low latency."""
    await websocket.accept()

    if llm is None:
        await websocket.send_json({"type": "error", "error": "LLM unavailable. Make sure Ollama is running."})
        await websocket.close()
        return

    if tts is None:
        await websocket.send_json({"type": "error", "error": "TTS unavailable. Piper could not be loaded."})
        await websocket.close()
        return

    try:
        while True:
            payload = await websocket.receive_json()
            user_message = payload.get("text", "") or ""
            image_b64 = payload.get("image")

            if "reset" in user_message.lower():
                llm.reset_conversation()
                await websocket.send_json({"type": "done", "response": "Conversation reset!", "code": None})
                continue

            stream_kwargs = {}
            if image_b64:
                stream_kwargs["images"] = [image_b64]

            full_response_parts = []
            sequence = 0

            for chunk in llm.chat_stream(user_message, **stream_kwargs):
                full_response_parts.append(chunk)
                await websocket.send_json({"type": "text_chunk", "chunk": chunk})

            response_text = "".join(full_response_parts)
            extracted_code = extract_code(response_text)

            if isinstance(extracted_code, list) and extracted_code:
                stdout, stderr = await run_ai_code_async(extracted_code[0])
                message_result = stdout.replace("\n", "") if stdout else ""
                message_result += f" (Error: {stderr.strip()})" if stderr else ""
                execution_text = f"Ok {message_result}".strip()

                await websocket.send_json({"type": "text_chunk", "chunk": execution_text})

                try:
                    audio_bytes = await tts.synthesize_bytes_async(execution_text)
                    await websocket.send_json(
                        {
                            "type": "audio_chunk",
                            "seq": sequence,
                            "text": execution_text,
                            "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
                        }
                    )
                    sequence += 1
                except Exception as e:
                    print(f"TTS Execution Chunk Error: {e}")

                response_text = execution_text

            # Speak only the final response (mirrors /voice-chat behavior, no hardcoded intent heuristics)
            tts_pending = response_text
            ready_segments, tts_pending = _drain_tts_segments(tts_pending)
            for segment in ready_segments:
                if not segment:
                    continue
                try:
                    audio_bytes = await tts.synthesize_bytes_async(segment)
                    await websocket.send_json(
                        {
                            "type": "audio_chunk",
                            "seq": sequence,
                            "text": segment,
                            "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
                        }
                    )
                    sequence += 1
                except Exception as e:
                    print(f"TTS Stream Final Error: {e}")

            if tts_pending.strip():
                try:
                    audio_bytes = await tts.synthesize_bytes_async(tts_pending.strip())
                    await websocket.send_json(
                        {
                            "type": "audio_chunk",
                            "seq": sequence,
                            "text": tts_pending.strip(),
                            "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
                        }
                    )
                except Exception as e:
                    print(f"TTS Stream Final Tail Error: {e}")

            await websocket.send_json(
                {
                    "type": "done",
                    "response": response_text,
                    "code": extracted_code[0] if isinstance(extracted_code, list) and extracted_code else None,
                }
            )
    except WebSocketDisconnect:
        print("Voice stream client disconnected")
    except Exception as e:
        print(f"Voice stream websocket error: {e}")

# Run server
if __name__ == "__main__":
    uvicorn.run(
        "api.api:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", 8000)),
        reload=True
    )