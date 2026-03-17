import * as THREE from "three";
import Avatar from "./avatar.ts";
import { WebcamManager } from "./webcam.ts";
import { AudioRecorder } from "./audio.ts";
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

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
const webcamVideo: HTMLVideoElement = document.getElementById("webcam") as HTMLVideoElement;
const settingsBtn: HTMLElement = document.getElementById("settings-btn");
const settingsOverlay: HTMLElement = document.getElementById("settings-overlay");
const settingsSaveBtn: HTMLElement = document.getElementById("settings-save-btn");
const apiUrlInput: HTMLInputElement = document.getElementById("api-url-input") as HTMLInputElement;
const webcamSelect: HTMLSelectElement = document.getElementById("webcam-select") as HTMLSelectElement;
const micSelect: HTMLSelectElement = document.getElementById("mic-select") as HTMLSelectElement;

// ========== STATE ==========
let imageObject: File = null;

const avatar = new Avatar("vrm-canvas", VRM_MODEL_PATH, loadingDiv);
const savedDeviceId = localStorage.getItem("webcam_device_id") || undefined;
const webcam = new WebcamManager(
  webcamVideo,
  document.getElementById("vrm-canvas"),
  savedDeviceId
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
  await webcam.toggle();
  avatar.camera.aspect = avatar.canvas.clientWidth / avatar.canvas.clientHeight;
  avatar.camera.updateProjectionMatrix();
  avatar.renderer.setSize(avatar.canvas.clientWidth, avatar.canvas.clientHeight);
}



// ========== AUDIO RECORDING ==========
async function startRecording() {
  audioPlayer.pause();
  avatar.doLipSync('', null);
  await recorder.start();  
}

function stopRecording() {
  recorder.stop();
}

async function sendAudioToBackend(audioBlob) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.wav");

  // If webcam is active, capture the last frame
  if (webcam.isActive && imageObject === null) {
    const frameBlob = await webcam.captureFrame();
    if (frameBlob) {
      formData.append("image", frameBlob, "webcam_frame.jpg");
    }
  } else if (imageObject) {
    formData.append("image", imageObject, imageObject.name);
  }

  try {
    // think
    avatar.setAnimationState("thinking");

    const response = await fetch(`${API_URL}/voice-chat`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Risposta backend:", data);

    statusDiv.classList.remove("processing");

    // Mostra trascrizione
 
    showTranscript(data.transcription, data.response);
    

    // Riproduci audio risposta e avvia lip sync
    if (data.audio_file) {
      avatar.setAnimationState("speaking");
      playAudio(`${API_URL}${data.audio_file}`);
      avatar.doLipSync(data.response, audioPlayer);
    }

    // Torna a idle dopo il parlato
    setTimeout(
      () => {
        avatar.setAnimationState("idle");
      },
      data.response.length * 60 + 500,
    );
  } catch (error) {
    console.error("Errore comunicazione backend:", error);
    statusDiv.classList.remove("processing");
    avatar.setAnimationState("idle");
    showTranscript('', "❌ Mmm, something went wrong...");
  }
}

function showTranscript(userText, aiText) {
  transcriptDiv.style.display = "block";
  addTranscriptEntry(userText, true);
  if (aiText) addTranscriptEntry(aiText, false);


}

function addTranscriptEntry(text, isUser = true) {
  if (!text) return;
  const entry = document.createElement("div");
  entry.className = `transcript-text tilt-in-fwd-tr ${isUser ? "user-text" : "ai-text"}`;
  entry.textContent = text;
  transcriptDiv.appendChild(entry);
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function playAudio(audioUrl) {
  audioPlayer.src = audioUrl;
  audioPlayer.play();
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

setupTauriShortcut();

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
    } catch {
     
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