import os

import numpy as np
from faster_whisper import WhisperModel
import asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

_stt_pool = ThreadPoolExecutor(max_workers=1)

class SpeechToText:
    def __init__(self, model_size="medium", device="cuda"):
        """
        Init Whisper STT
        
        Args:
            model_size: tiny, base, small, medium, large
            device: cpu or cuda
        """
        try:
            self.model = WhisperModel(model_size, device=device, compute_type="int8")
        except Exception as e:
            print(f"❌ Cannot load Whisper model '{model_size}': {e}")
            print("   Valid models: tiny, base, small, medium, large")
            raise
    def transcribe(self, audio_data):
        """
        Transcribe audio to text
        
        Args:
            audio_data: numpy array of audio or file path
            
        Returns:
            str: transcribed text
        """
        segments, info = self.model.transcribe(
            audio_data, 
            language=os.getenv("WHISPER_LANGUAGE", "en"),
            beam_size=int(os.getenv("WHISPER_BEAM_SIZE", 1)),
            vad_filter=os.getenv("WHISPER_VAD_FILTER", "True") == "True",
            vad_parameters=dict(min_silence_duration_ms=300),
        )
        
        text = " ".join([segment.text for segment in segments])
        return text.strip()
    
    def transcribe_file(self, audio_path):
        """Transcribe audio file"""
        segments, info = self.model.transcribe(
            str(audio_path),
            language=os.getenv("WHISPER_LANGUAGE", "en"),
            beam_size=int(os.getenv("WHISPER_BEAM_SIZE", 1)),
            vad_filter=os.getenv("WHISPER_VAD_FILTER", "True") == "True",
            vad_parameters=dict(min_silence_duration_ms=300),
        )
        
        text = " ".join([segment.text for segment in segments])
        return text.strip()

    def transcribe_bytes(self, audio_bytes: bytes):
        """Transcribe from raw audio bytes in memory (no disk I/O)."""
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        return self.transcribe(audio_np)

    async def transcribe_file_async(self, audio_path):
        """Async version — runs STT in a thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_stt_pool, self.transcribe_file, audio_path)

    async def transcribe_bytes_async(self, audio_bytes: bytes):
        """Async version — transcribe bytes without blocking event loop."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_stt_pool, self.transcribe_bytes, audio_bytes)

# Test
if __name__ == "__main__":
    stt = SpeechToText(model_size="base")
    text = stt.transcribe_file("test.wav")
    print(f"Response: {text}")