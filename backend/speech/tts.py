import re
import subprocess
import os
import asyncio
from pathlib import Path
import tempfile
import wave
from concurrent.futures import ThreadPoolExecutor

_tts_pool = ThreadPoolExecutor(max_workers=1)

class TextToSpeech:
    def __init__(self, voice=os.getenv("PIPER_MODEL", "")):
        """
        Piper TTS
        """
        self.voice = voice
        self.models_dir = Path(__file__).parent.parent / "models" / "piper"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        
        # Model Paths
        self.model_path = self.models_dir / f"{voice}.onnx"
        self.config_path = self.models_dir / f"{voice}.onnx.json"
        
        # Check if model exists
        if not self.model_path.exists():
            print(f"⚠️ Model {voice} not found in {self.models_dir}")
            self.download_model()
        
        # Check that piper is installed
        try:
            result = subprocess.run(["piper", "--version"], capture_output=True, text=True)
        except FileNotFoundError:
            print("❌ Piper TTS not found in PATH!")
            print("   Install with: pip install piper-tts")
    
    def download_model(self):
        """Helper to download model (manual)"""
        print(f"""
To download model {self.voice}:

1. Go to: https://huggingface.co/rhasspy/piper-voices/tree/main
2. Download: {self.voice}.onnx
3. Download: {self.voice}.onnx.json
4. Place files in: {self.models_dir}
        """)
    
    def synthesize(self, text: str, output_file="output.wav", play=False):
        """
        Convert text to audio
        
        Args:
            text: text to synthesize
            output_file: output file path
            play: play audio automatically
            
        Returns:
            Path to generated audio file
        """
        if not self.model_path.exists():
            raise FileNotFoundError(f"Model not found: {self.model_path}")
        
        output_path = Path(output_file)
        # Piper command
        cmd = [
            "piper",
            "--model", str(self.model_path),
            "--output_file", str(output_path)
        ]

        try:
            # Run piper
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            text_clean = self.sanitize_text(text)
            
            stdout, stderr = process.communicate(input=text_clean)
            
            if process.returncode != 0:
                raise RuntimeError(f"Piper error: {stderr} {stdout}")
            
            print(f"✅ Audio generated: {output_path}")
            
            # Play if requested
            if play:
                self.play_audio(output_path)
            
            return output_path
            
        except FileNotFoundError:
            print("❌ Piper not found! Install with:")
            print("pip install piper-tts")
            raise
    
    async def synthesize_async(self, text: str, output_file="output.wav"):
        """Async version — runs TTS in a thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_tts_pool, self.synthesize, text, output_file)
    
    def sanitize_text(self, text):
        # Rimuove emoji e simboli non ASCII
         return re.sub(r'[^\x00-\x7F]+|\*', '', text)


    def play_audio(self, audio_path):
        """Play audio file"""
        try:
            if os.name == 'nt':  # Windows
                subprocess.run(['cmd', '/c', 'start', '', str(audio_path)], check=False)
            elif os.name == 'posix':  # Linux/Mac
                subprocess.run(['aplay', str(audio_path)], check=False)
        except Exception as e:
            print(f"Playback error: {e}")
    
    def synthesize_stream(self, text: str):
        """
        Generate streaming audio (for low latency)
        Returns audio chunks as they are generated
        """
        # TODO: implement streaming for reduced latency
        # For now use normal synthesize
        return self.synthesize(text)

# Test
if __name__ == "__main__":
    tts = TextToSpeech()
    
    # Check if model exists
    if not tts.model_path.exists():
        tts.download_model()
    else:
        # Test
        text = "Hello how i can help you today?"
        tts.synthesize(text, output_file="test_output.wav", play=True)