import os
import ollama
from typing import Dict, Any, List, Optional, Iterator
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import base64

_llm_pool = ThreadPoolExecutor(max_workers=1)


class LLM:
    def __init__(self, model="gemma3:12b"):
        self.model = model
        self.conversation_history = []
        self.available = True
        
        # Verify connection to Ollama
        try:
            ollama.list()
        except Exception as e:
            print(f"❌ Cannot connect to Ollama: {e}")
            print("   Make sure Ollama is running with: ollama serve")
            self.available = False
        
        prompt_path = Path(__file__).parent / "system_prompt.txt"
        self.system_prompt = prompt_path.read_text(encoding="utf-8").format(
            language=os.getenv("LLM_LANGUAGE", "English"),
            assistant_name=os.getenv("LLM_ASSISTANT_NAME", "OpenMate"),
            user_name=os.getenv("LLM_USER_NAME", "User"),
            os_context=os.getenv("LLM_OS_CONTEXT", "Unknown OS")
        )
    
    def chat(self, user_message: str, images: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Send message to LLM
        
        Args:
            user_message: user's message
            images: optional list of base64-encoded images for vision
        
        Returns:
            dict with 'response' (text)
        """
        # Add user message to history
        user_entry = {
            "role": "user",
            "content": user_message
        }
        if images:
            user_entry["images"] = images
        self.conversation_history.append(user_entry)
        
        # Prepare messages with system prompt
        messages = [
            {"role": "system", "content": self.system_prompt}
        ] + self.conversation_history
        
        if not self.available:
            return {"response": "LLM model is unavailable. Ollama is not running."}
        
        try:
            response = ollama.chat(
                model=self.model,
                messages=messages
            )
            
            assistant_message = response["message"]
            self.conversation_history.append(assistant_message)
            
            # Extract response
            result = {
                "response": assistant_message.get("content", "")
            }
            
            return result
            
        except ConnectionError:
            self.available = False
            print("❌ Connection to Ollama lost. Restart Ollama with: ollama serve")
            return {"response": "Lost connection to Ollama. Restart it and try again."}
        except Exception as e:
            print(f"❌ LLM Error: {e}")
            return {
                "response": "Sorry, I had a problem. Can you repeat?"
            }
    
    def reset_conversation(self):
        """Reset conversation"""
        self.conversation_history = []

    def chat_stream(self, user_message: str, images: Optional[List[str]] = None) -> Iterator[str]:
        """Stream model output chunk-by-chunk while preserving chat history."""
        user_entry = {
            "role": "user",
            "content": user_message
        }
        if images:
            user_entry["images"] = images
        self.conversation_history.append(user_entry)

        messages = [
            {"role": "system", "content": self.system_prompt}
        ] + self.conversation_history

        if not self.available:
            fallback = "LLM model is unavailable. Ollama is not running."
            self.conversation_history.append({"role": "assistant", "content": fallback})
            yield fallback
            return

        try:
            chunks: List[str] = []
            stream = ollama.chat(
                model=self.model,
                messages=messages,
                stream=True,
            )

            for part in stream:
                content = part.get("message", {}).get("content", "")
                if content:
                    chunks.append(content)
                    yield content

            assistant_text = "".join(chunks)
            self.conversation_history.append({"role": "assistant", "content": assistant_text})

        except ConnectionError:
            self.available = False
            print("❌ Connection to Ollama lost. Restart Ollama with: ollama serve")
            fallback = "Lost connection to Ollama. Restart it and try again."
            self.conversation_history.append({"role": "assistant", "content": fallback})
            yield fallback
        except Exception as e:
            print(f"❌ LLM Stream Error: {e}")
            fallback = "Sorry, I had a problem. Can you repeat?"
            self.conversation_history.append({"role": "assistant", "content": fallback})
            yield fallback
    

    async def chat_async(self, user_message: str, images: Optional[List[str]] = None) -> Dict[str, Any]:
        """Versione async di chat() — non blocca l'event loop di FastAPI."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_llm_pool, self.chat, user_message, images)

# Test
if __name__ == "__main__":
    llm = LLM()
    
    print("=== Test ===\n")
    
    response = llm.chat("What's your name?")
    print(f"AI: {response['response']}\n")
