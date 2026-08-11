import * as THREE from "three";
import Avatar from "./avatar.ts";
import { WebcamManager } from "./webcam.ts";
import { ScreenShareManager } from "./screen.ts";
import { AudioRecorder } from "./audio.ts";
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from "@tauri-apps/api/window";

// ========== CONFIG ==========
const DEFAULT_API_URL: string = "http://localhost:8000";
let API_URL: string = localStorage.getItem("api_url") || "";
const VRM_MODEL_PATH: string = "/models/Lyra.vrm";


// ========== UI ELEMENTS ==========
const micBtn: HTMLElement = document.getElementById("mic-btn");
const statusDiv: HTMLElement = document.getElementById("status");
const transcriptDiv: HTMLElement = document.getElementById("transcript");
const audioPlayer: HTMLAudioElement = document.getElementById("audio-player") as HTMLAudioElement;
const loadingDiv: HTMLElement = document.getElementById("loading");
const dropZone: HTMLElement = document.getElementById('vrm-canvas');
const imageElement: HTMLImageElement = document.getElementById("image-element") as HTMLImageElement;
const webcamBtn: HTMLElement = document.getElementById("webcam-btn");
const screenShareBtn: HTMLElement = document.getElementById("screen-share-btn");
const webcamVideo: HTMLVideoElement = document.getElementById("webcam") as HTMLVideoElement;
const screenShareVideo: HTMLVideoElement = document.getElementById("screen-share") as HTMLVideoElement;
const settingsBtn: HTMLElement = document.getElementById("settings-btn");
const settingsOverlay: HTMLElement = document.getElementById("settings-overlay");
const settingsSaveBtn: HTMLElement = document.getElementById("settings-save-btn");
const apiUrlInput: HTMLInputElement = document.getElementById("api-url-input") as HTMLInputElement;
const webcamSelect: HTMLSelectElement = document.getElementById("webcam-select") as HTMLSelectElement;
const micSelect: HTMLSelectElement = document.getElementById("mic-select") as HTMLSelectElement;

// ========== STATE ==========
let imageObject: File = null;
let latestRequestId = 0;
let activeStreamSession: { cancel: () => void } | null = null;
let suppressIdleOnAudioEvents = false;
let activeResponseBubble: HTMLDivElement | null = null;

const avatar = new Avatar("vrm-canvas", VRM_MODEL_PATH, loadingDiv);
const savedDeviceId = localStorage.getItem("webcam_device_id") || undefined;
const webcam = new WebcamManager(
  webcamVideo,
  document.getElementById("vrm-canvas"),
  savedDeviceId
);
const screenShare = new ScreenShareManager(
  screenShareVideo,
  document.getElementById("vrm-canvas"),
  {
    callbacks: {
      onStart: () => {
        screenShareBtn.classList.add("active");
      },
      onStop: () => {
        screenShareBtn.classList.remove("active");
      },
      onError: (error) => {
        console.error("Screen share error:", error);
        screenShareBtn.classList.remove("active");
      },
    },
  }
);
const recorder = new AudioRecorder({
  deviceId: localStorage.getItem("mic_device_id") || undefined,
  onStart: () => {
    avatar.setAnimationState("listening");
    micBtn.classList.add("recording");
    statusDiv.textContent = "Listen...";
  },
  onStop: async (audioBlob) => {
    micBtn.classList.remove("recording");
    statusDiv.textContent = "⏳";
    await sendAudioToBackend(audioBlob);
  },
  onError: (error) => {
    console.error("Error:", error);
    statusDiv.textContent = "❌ No Mic";
  },
});

avatar.animate();

// Window resize
window.addEventListener("resize", () => {
  avatar.camera.aspect = avatar.canvas.clientWidth / avatar.canvas.clientHeight;
  avatar.camera.updateProjectionMatrix();
  avatar.renderer.setSize(window.innerWidth, window.innerHeight);
});

async function toggleCamera() {
  if (!webcam.isActive && screenShare.isActive) {
    screenShare.stop();
  }

  await webcam.toggle();
  avatar.camera.aspect = avatar.canvas.clientWidth / avatar.canvas.clientHeight;
  avatar.camera.updateProjectionMatrix();
  avatar.renderer.setSize(avatar.canvas.clientWidth, avatar.canvas.clientHeight);
}

async function toggleScreenShare() {
  if (!screenShare.isActive && webcam.isActive) {
    webcam.stop();
  }

  await screenShare.toggle();
  avatar.camera.aspect = avatar.canvas.clientWidth / avatar.canvas.clientHeight;
  avatar.camera.updateProjectionMatrix();
  avatar.renderer.setSize(avatar.canvas.clientWidth, avatar.canvas.clientHeight);
}



// ========== AUDIO RECORDING ==========
async function startRecording() {
  cancelActiveResponse();
  audioPlayer.pause();
  avatar.doLipSync('', null);
  await recorder.start();
}

function stopRecording() {
  recorder.stop();
}

async function sendAudioToBackend(audioBlob) {
  const requestId = ++latestRequestId;
  cancelActiveResponse();
  const audioData = new FormData();
  const formData = new FormData();
  audioData.append("audio", audioBlob, "recording.wav");
  let imageBase64: string | null = null;

  // Priority: screen share frame > webcam frame > dropped/pasted image
  if (screenShare.isActive && imageObject === null) {
    const frameBlob = await screenShare.captureFrame();
    if (frameBlob) {
      formData.append("image", frameBlob, "screen_frame.jpg");
      imageBase64 = await blobToBase64(frameBlob);
    }
  } else if (webcam.isActive && imageObject === null) {
    const frameBlob = await webcam.captureFrame();
    if (frameBlob) {
      formData.append("image", frameBlob, "webcam_frame.jpg");
      imageBase64 = await blobToBase64(frameBlob);
    }
  } else if (imageObject) {
    formData.append("image", imageObject, imageObject.name);
    imageBase64 = await blobToBase64(imageObject);
  }

  try {
    // think
    avatar.setAnimationState("thinking");

    const transcriptionResponse = await fetch(`${API_URL}/voice-transcribe`, {
      method: "POST",
      body: audioData,
    });

    if (!transcriptionResponse.ok) {
      throw new Error(`HTTP error! status: ${transcriptionResponse.status}`);
    }

    if (requestId !== latestRequestId) {
      return;
    }

    const dataTranscription = await transcriptionResponse.json();
    console.log("Risposta backend:", dataTranscription);

    if (requestId !== latestRequestId) {
      return;
    }

    statusDiv.classList.remove("processing");

    // Mostra trascrizione
    if (dataTranscription.transcription) {
      addTranscriptEntry(dataTranscription.transcription, true);
    }

    if (dataTranscription.transcription === "") {
      avatar.setAnimationState("idle");
      return;
    }

    formData.append("text", dataTranscription.transcription);
    try {
      let latestPartialText = "";
      const streamResult = await streamVoiceChat(
        dataTranscription.transcription,
        imageBase64,
        (partialText) => {
          latestPartialText = partialText || "";
          if (requestId !== latestRequestId) {
            return;
          }
          if (activeResponseBubble) {
            activeResponseBubble.textContent = partialText;
            transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
          }
        },
        () => {
          if (requestId !== latestRequestId) {
            return;
          }
          if (!activeResponseBubble) {
            activeResponseBubble = createStreamingResponseBubble();
            activeResponseBubble.textContent = latestPartialText;
            transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
          }
        }
      );
      if (requestId !== latestRequestId) {
        activeResponseBubble = null;
        return;
      }
      if (streamResult.response) {
        if (activeResponseBubble) {
          finalizeStreamingResponseBubble(activeResponseBubble, streamResult.response, streamResult.code);
          activeResponseBubble = null;
        } else {
          addTranscriptEntry(streamResult.response, false, streamResult.code);
        }
      }
    } catch (streamError) {
      if (streamError instanceof Error && streamError.message === "stream_cancelled") {
        activeResponseBubble = null;
        return;
      }
      if (requestId !== latestRequestId) {
        activeResponseBubble = null;
        return;
      }
      removeActiveResponseBubble();
      console.warn("Streaming failed, using /voice-chat fallback:", streamError);
      const LLMResponse = await fetch(`${API_URL}/voice-chat`, {
        method: "POST",
        body: formData,
      });
      if (!LLMResponse.ok) {
        throw new Error(`HTTP error! status: ${LLMResponse.status}`);
      }
      const data = await LLMResponse.json();
      if (requestId !== latestRequestId) {
        return;
      }
      if (data.audio_file) {
        avatar.setAnimationState("speaking");
        playAudio(`${API_URL}${data.audio_file}`);
        avatar.doLipSync(data.response, audioPlayer);
      }
      if (data.response) {
        addTranscriptEntry(data.response, false, data.code);
      }
    }


  } catch (error) {
    if (error instanceof Error && error.message === "stream_cancelled") {
      return;
    }
    if (requestId !== latestRequestId) {
      return;
    }
    console.error("Errore comunicazione backend:", error);
    statusDiv.classList.remove("processing");
    avatar.setAnimationState("idle");
    addTranscriptEntry("❌ Mmm, something went wrong...", false);
  }
}

function cancelActiveResponse(): void {
  suppressIdleOnAudioEvents = false;
  if (activeStreamSession) {
    activeStreamSession.cancel();
    activeStreamSession = null;
  }
  activeResponseBubble = null;
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  avatar.setAnimationState("idle");
}

function createStreamingResponseBubble(): HTMLDivElement {
  const entry = document.createElement("div");
  entry.className = "transcript-text tilt-in-fwd-tr ai-text";
  transcriptDiv.appendChild(entry);
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
  return entry;
}

function finalizeStreamingResponseBubble(entry: HTMLDivElement, text: string, code: string | null = null): void {
  entry.textContent = text;
  if (code) {
    const showCodeBtn = document.createElement("button");
    showCodeBtn.textContent = "</>";
    showCodeBtn.className = "show-code-btn";
    showCodeBtn.addEventListener("click", () => {
      codeBlock.style.display = codeBlock.style.display === "block" ? "none" : "block";
    });
    entry.appendChild(showCodeBtn);
    const codeBlock = document.createElement("pre");
    codeBlock.className = "code-block";
    codeBlock.style.display = "none";
    codeBlock.textContent = code;
    entry.appendChild(codeBlock);
  }
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function removeActiveResponseBubble(): void {
  if (activeResponseBubble && activeResponseBubble.parentNode) {
    activeResponseBubble.parentNode.removeChild(activeResponseBubble);
  }
  activeResponseBubble = null;
}


function addTranscriptEntry(text, isUser = true, code = null) {
  if (!text) return;
  const entry = document.createElement("div");
  entry.className = `transcript-text tilt-in-fwd-tr ${isUser ? "user-text" : "ai-text"}`;
  entry.textContent = text;
  if (code) {
    const showCodeBtn = document.createElement("button");
    showCodeBtn.textContent = "</>";
    showCodeBtn.className = "show-code-btn";
    showCodeBtn.addEventListener("click", () => {
      codeBlock.style.display = codeBlock.style.display === "block" ? "none" : "block";
    });
    entry.appendChild(showCodeBtn);
    const codeBlock = document.createElement("pre");
    codeBlock.className = "code-block";
    codeBlock.style.display = "none";
    codeBlock.textContent = code;
    entry.appendChild(codeBlock);
  }
  transcriptDiv.appendChild(entry);
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function playAudio(audioUrl) {
  audioPlayer.src = audioUrl;
  audioPlayer.play();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToWavBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function buildWsUrl(path: string): string {
  const url = new URL(API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function streamVoiceChat(
  text: string,
  imageBase64: string | null,
  onTextChunk?: (partialText: string) => void,
  onFirstAudioChunk?: () => void
): Promise<{ response: string; code: string | null }> {
  const wsUrl = buildWsUrl("/ws/voice-stream");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const chunkQueue: Array<{ url: string; text: string }> = [];
    const createdUrls: string[] = [];
    let fullResponse = "";
    let finalCode: string | null = null;
    let doneReceived = false;
    let isPlaying = false;
    let settled = false;
    let canceled = false;
    let firstAudioChunkNotified = false;

    const session = {
      cancel: () => {
        canceled = true;
        cleanup();
        if (!settled) {
          settled = true;
          reject(new Error("stream_cancelled"));
        }
      },
    };
    activeStreamSession = session;

    const cleanup = () => {
      suppressIdleOnAudioEvents = false;
      audioPlayer.removeEventListener("ended", onChunkEnded);
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
      if (activeStreamSession === session) {
        activeStreamSession = null;
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const finalizeIfDone = () => {
      if (doneReceived && !isPlaying && chunkQueue.length === 0) {
        suppressIdleOnAudioEvents = false;
        cleanup();
        avatar.setAnimationState("idle");
        if (!settled) {
          settled = true;
          resolve({ response: fullResponse.trim(), code: finalCode });
        }
      }
    };

    const playNextChunk = () => {
      if (isPlaying || chunkQueue.length === 0) {
        finalizeIfDone();
        return;
      }

      const next = chunkQueue.shift();
      if (!next) {
        finalizeIfDone();
        return;
      }

      isPlaying = true;
      if (!suppressIdleOnAudioEvents) {
        avatar.setAnimationState("speaking");
      }
      suppressIdleOnAudioEvents = true;
      audioPlayer.src = next.url;
      avatar.doLipSync(next.text, audioPlayer);
      audioPlayer.play().catch((error) => {
        console.error("Audio chunk play error:", error);
        isPlaying = false;
        playNextChunk();
      });
    };

    const onChunkEnded = () => {
      isPlaying = false;
      playNextChunk();
    };

    audioPlayer.addEventListener("ended", onChunkEnded);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          text,
          image: imageBase64,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.error || "Streaming backend error"));
        return;
      }

      if (msg.type === "text_chunk") {
        fullResponse += msg.chunk || "";
        onTextChunk?.(fullResponse);
        return;
      }

      if (msg.type === "audio_chunk" && msg.audio_b64) {
        if (!firstAudioChunkNotified) {
          firstAudioChunkNotified = true;
          onFirstAudioChunk?.();
        }
        const blob = base64ToWavBlob(msg.audio_b64);
        const objectUrl = URL.createObjectURL(blob);
        createdUrls.push(objectUrl);
        chunkQueue.push({ url: objectUrl, text: msg.text || "" });
        playNextChunk();
        return;
      }

      if (msg.type === "done") {
        doneReceived = true;
        finalCode = msg.code || null;
        fullResponse = msg.response || fullResponse;
        onTextChunk?.(fullResponse);
        finalizeIfDone();
      }
    };

    ws.onerror = () => {
      cleanup();
      if (!settled && !canceled) {
        settled = true;
        reject(new Error("WebSocket connection error"));
      }
    };

    ws.onclose = () => {
      if (canceled) {
        return;
      }
      if (!doneReceived && !settled) {
        cleanup();
        settled = true;
        reject(new Error("WebSocket closed before response completed"));
      }
    };
  });
}

// ========== LIP SYNC (Advanced with visemes) ==========


// ========== EVENT LISTENERS ==========
// Mouse/Touch events per pulsante microfono
micBtn.addEventListener("mousedown", startRecording);
micBtn.addEventListener("mouseup", stopRecording);
micBtn.addEventListener("mouseleave", () => {
  if (recorder.isRecording) stopRecording();
});

// Touch events per mobile
micBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startRecording();
});
micBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  stopRecording();
});

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !recorder.isRecording) {
    e.preventDefault();
    startRecording();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && recorder.isRecording) {
    e.preventDefault();
    stopRecording();
  }
});

audioPlayer.addEventListener("pause", () => {
  if (suppressIdleOnAudioEvents) return;
  avatar.setAnimationState("idle");
});


audioPlayer.addEventListener("ended", () => {
  if (suppressIdleOnAudioEvents) return;
  avatar.setAnimationState("idle");
});


setupTauriShortcut();
setupCtrlPointerWindowDrag();

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => e.preventDefault());
});

// drop zone + animation
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    avatar.setAnimationState('grabbing');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    avatar.setAnimationState('idle');
  });
});

// drop
dropZone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type.startsWith('image/')) {
    imageObject = files[0];
    imageElement.style.display = "block";
    imageElement.src = URL.createObjectURL(imageObject);

    avatar.customTexture = new THREE.TextureLoader();
    avatar.customTexture.load(URL.createObjectURL(imageObject), (texture) => {
      avatar.customTexture = texture;
    });
  } else {
    alert('Trascina un file immagine valido!');
  }
});

imageElement.addEventListener('click', () => {

  imageElement.style.display = "none";
  imageObject = null;
  avatar.customTexture = null;
});

document.addEventListener("paste", (event) => {
  const items = event.clipboardData.items;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      imageObject = file;
      imageElement.style.display = "block";
      imageElement.src = URL.createObjectURL(imageObject);
      avatar.customTexture = new THREE.TextureLoader();
      avatar.customTexture.load(URL.createObjectURL(imageObject), (texture) => {
        avatar.customTexture = texture;
      });
    }
  }
});

webcamBtn.addEventListener("click", () => {
  toggleCamera();
});

screenShareBtn.addEventListener("click", () => {
  toggleScreenShare();
});

// ========== SETTINGS ==========
async function populateWebcamSelect() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");
    webcamSelect.innerHTML = '<option value="">Default</option>';
    for (const device of videoDevices) {
      const opt = document.createElement("option");
      opt.value = device.deviceId;
      opt.textContent = device.label || `Camera ${webcamSelect.options.length}`;
      webcamSelect.appendChild(opt);
    }
    const saved = localStorage.getItem("webcam_device_id");
    if (saved) webcamSelect.value = saved;
  } catch (e) {
    console.error("Failed to enumerate webcams:", e);
  }
}

async function populateMicSelect() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(d => d.kind === "audioinput");
    micSelect.innerHTML = '<option value="">Default</option>';
    for (const device of audioDevices) {
      const opt = document.createElement("option");
      opt.value = device.deviceId;
      opt.textContent = device.label || `Microphone ${micSelect.options.length}`;
      micSelect.appendChild(opt);
    }
    const saved = localStorage.getItem("mic_device_id");
    if (saved) micSelect.value = saved;
  } catch (e) {
    console.error("Failed to enumerate microphones:", e);
  }
}

async function openSettings() {
  apiUrlInput.value = API_URL || DEFAULT_API_URL;
  await Promise.all([populateWebcamSelect(), populateMicSelect()]);
  settingsOverlay.classList.remove("hidden");
}

function saveSettings() {
  const url = apiUrlInput.value.trim().replace(/\/+$/, "");
  if (!url) return;
  API_URL = url;
  localStorage.setItem("api_url", API_URL);
  const selectedDevice = webcamSelect.value;
  if (selectedDevice) {
    localStorage.setItem("webcam_device_id", selectedDevice);
  } else {
    localStorage.removeItem("webcam_device_id");
  }
  webcam.setDeviceId(selectedDevice || undefined);
  const selectedMic = micSelect.value;
  if (selectedMic) {
    localStorage.setItem("mic_device_id", selectedMic);
  } else {
    localStorage.removeItem("mic_device_id");
  }
  recorder.setDeviceId(selectedMic || undefined);
  settingsOverlay.classList.add("hidden");
}

settingsBtn.addEventListener("click", openSettings);
settingsSaveBtn.addEventListener("click", saveSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay && API_URL) settingsOverlay.classList.add("hidden");
});
apiUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveSettings();
});

// Show settings on first launch if no URL saved
if (!API_URL) openSettings();

// ========== EXPRESSIONS (bonus) ==========
setInterval(() => {
  if (!avatar.currentVrm || !avatar.currentVrm.expressionManager) return;

  const expressions = ["happy", "relaxed", "neutral"];
  const randomExp =
    expressions[Math.floor(Math.random() * expressions.length)];

  avatar.currentVrm.expressionManager.setValue(randomExp, 0.3);

  setTimeout(() => {
    avatar.currentVrm.expressionManager.setValue(randomExp, 0);
  }, 2000);
}, 10000);

async function setupTauriShortcut() {
  // Tauri global shortcut: Shift + Space to speak
  try {
    try {
      await unregister('Shift+Space');
    } catch (error) {
      console.warn('No previous shortcut to unregister:', error);
    }

    await register('Shift+Space', (event) => {
      if (event.state === 'Pressed' && !recorder.isRecording) {
        startRecording();
      }
      if (event.state === 'Released' && recorder.isRecording) {
        stopRecording();
      }
    });
  } catch (error) {
    console.error('Errore registrazione shortcut:', error);
  }
}

function setupCtrlPointerWindowDrag() {
  const appWindow = getCurrentWindow();
  const MOVE_THRESHOLD_PX = 8;
  const NO_DRAG_SELECTOR =
    "#controls, #settings-overlay, #settings-modal, #transcript, #webcam, #screen-share, button, input, select, textarea, a, [data-no-drag]";

  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragTriggered = false;

  const clearDragState = () => {
    activePointerId = null;
    dragTriggered = false;
  };

  const isDraggablePressTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !target.closest(NO_DRAG_SELECTOR);
  };

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (!isDraggablePressTarget(e.target)) return;

    clearDragState();
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener("pointermove", async (e) => {
    if (activePointerId !== e.pointerId) return;
    if (dragTriggered) return;
    if ((e.buttons & 1) !== 1) return;
    if (!e.ctrlKey) return;

    const movedEnough = Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESHOLD_PX;
    if (!movedEnough) return;

    dragTriggered = true;
    try {
      await appWindow.startDragging();
    } catch (error) {
      console.error("Unable to start window dragging:", error);
      clearDragState();
    }
  });

  document.addEventListener("pointerup", (e) => {
    if (activePointerId === e.pointerId) {
      clearDragState();
    }
  });

  document.addEventListener("pointercancel", (e) => {
    if (activePointerId === e.pointerId) {
      clearDragState();
    }
  });
}