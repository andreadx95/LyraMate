export interface ScreenShareCallbacks {
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: unknown) => void;
}

export interface ScreenShareOptions {
  includeAudio?: boolean;
  callbacks?: ScreenShareCallbacks;
}

export class ScreenShareManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement;
  private canvasElement?: HTMLElement;
  private includeAudio: boolean;
  private callbacks: ScreenShareCallbacks;

  constructor(videoElement: HTMLVideoElement, canvasElement?: HTMLElement, options: ScreenShareOptions = {}) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.includeAudio = options.includeAudio ?? false;
    this.callbacks = options.callbacks ?? {};
  }

  get isActive(): boolean {
    return this.stream !== null;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  setIncludeAudio(includeAudio: boolean): void {
    this.includeAudio = includeAudio;
  }

  async toggle(): Promise<void> {
    if (this.stream) {
      this.stop();
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    if (this.stream) return;

    const constraints: DisplayMediaStreamOptions = {
      video: true,
      audio: this.includeAudio,
    };

    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      this.videoElement.srcObject = this.stream;
      this.canvasElement?.classList.add("screen-share-active");
      this.videoElement.classList.remove("hidden");

      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        // Fires when the user clicks "Stop sharing" from the browser UI.
        videoTrack.addEventListener("ended", () => this.stop());
      }

      this.callbacks.onStart?.();
    } catch (error) {
      this.stream = null;
      this.videoElement.srcObject = null;
      this.videoElement.classList.add("hidden");
      this.canvasElement?.classList.remove("screen-share-active");
      this.callbacks.onError?.(error);
    }
  }

  stop(): void {
    if (!this.stream) return;

    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.videoElement.srcObject = null;
    this.canvasElement?.classList.remove("screen-share-active");
    this.videoElement.classList.add("hidden");
    this.callbacks.onStop?.();
  }

  async captureFrame(): Promise<Blob | null> {
    if (!this.stream || this.videoElement.videoWidth === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    canvas.getContext("2d")?.drawImage(this.videoElement, 0, 0);

    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85)
    );
  }
}
