#!/usr/bin/env python3
"""
OpenMateDesk
"""
import os
import sys
from pathlib import Path
import requests
from time import time
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_FILE)

def check_requirements():
    """Check dependencies"""
    print("🔍 Check dependencies...")
    
    try:
        import faster_whisper
        import ollama
        import fastapi
        import uvicorn
        print("✅ Dependencies Python OK")
    except ImportError as e:
        print(f"❌ Missing: {e}")
        print("Exec: pip install -r requirements.txt")
        return False
    
    # Check Ollama
    if not check_ollama():
        return False

    
        # Check .env
    if not ENV_FILE.exists():
        print("⚠️ .env file not found")
    
    return True

def check_ollama():
    try:
        r = requests.get(os.getenv("OLLAMA_HOST", "http://localhost:11434") + "/api/tags", timeout=2)
        if r.status_code == 200:
            print("✅ Ollama running")
            return True
    except requests.exceptions.RequestException:
        print("❌ Ollama not running")
    return False


def main():
    """Starting server"""
    print("""
    LyraMate - Server
    """)
    print("Version: 0.1.0")
    
    if not check_requirements():
        sys.exit(1)
    
    print("\n🚀 Starting server...")
    print("\n💡 Press CTRL+C to stop\n")
    print(f"📡 API Endpoint: http://{os.getenv('API_HOST', '127.0.0.1')}:{os.getenv('API_PORT', 8000)}")
    
    # Start FastAPI
    import uvicorn
    uvicorn.run(
        "api.api:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", 8000)),
        reload=True
    )

if __name__ == "__main__":
    main()