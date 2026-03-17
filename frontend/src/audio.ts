export interface AudioRecorderCallbacks {
  deviceId?: string;
  onStart?: () => void;
  onStop?: (audioBlob: Blob) => void;
  onError?: (error: unknown) => void;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recording = false;
  private callbacks: AudioRecorderCallbacks;
  private deviceId?: string;

  constructor(callbacks: AudioRecorderCallbacks = {}) {
    this.callbacks = callbacks;
    this.deviceId = callbacks.deviceId;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  setDeviceId(deviceId?: string): void {
    this.deviceId = deviceId;
  }

  async start(): Promise<void> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
        stream.getTracks().forEach((track) => track.stop());
        this.callbacks.onStop?.(audioBlob);
      };

      this.mediaRecorder.start();
      this.recording = true;
      this.callbacks.onStart?.();
    } catch (error) {
      this.callbacks.onError?.(error);
    }
  }

  stop(): void {
    if (this.mediaRecorder && this.recording) {
      this.mediaRecorder.stop();
      this.recording = false;
    }
  }
}
