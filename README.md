<p align="center">
  <img src="images/main.png" alt="LyraMate" width="200"/>
</p>



A fully local, privacy-first AI desktop companion with a 3D VRM avatar, voice interaction, vision capabilities, and desktop automation — all running on your machine.

> ⚠️ **Alpha stage** — under active development

---

## Overview

LyraMate is a desktop AI assistant that lives as a small, always-on-top animated avatar on your screen. You talk to it via voice (or text...in future), it thinks using a local LLM, and responds with synthesized speech and lip-synced avatar animations. It can also see images (via webcam or drag-and-drop) and execute Python code to automate tasks on your desktop.

Everything runs locally — no cloud APIs, no data leaves your machine.

## Features

- **Voice conversation** — hold Shift+Space (or the mic button) to speak.
- **Vision / Multimodal** — drag-and-drop images, paste from clipboard, or use your webcam. (Works only with multimodal models Gemma 3, Qwen 2.5 VL, etc.)  
- **Desktop automation** — the LLM generates Python code to open browsers, create files, read clipboard, install packages, and more  
- **3D animated avatar** — VRM model with idle, listening, speaking, thinking, and grabbing animation states, smooth transitions, blink sync, and viseme-based lip-sync  
- **Fully offline** — LLM (Ollama), STT (faster-whisper), TTS (Piper) all run locally  
- **Multi-language** — configurable language for both STT and TTS

<p align="center">
  <img src="images/main.gif" alt="LyraMate Video" width="170"/>
   <img src="images/image.gif" alt="LyraMate Video" width="170"/>
</p>

## ⚠️ Currently Under Development
Installation for testing purposes is available on the `dev` branch.
