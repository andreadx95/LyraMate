export class WebcamManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLElement;
  private deviceId?: string;

  constructor(videoElement: HTMLVideoElement, canvasElement: HTMLElement, deviceId?: string) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.deviceId = deviceId;
  }

  get isActive(): boolean {
    return this.stream !== null;
  }

  setDeviceId(deviceId?: string): void {
    this.deviceId = deviceId;
    if (this.stream) {
      this.stop();
      this.start();
    }
  }

  async toggle(): Promise<void> {
    if (this.stream) {
      this.stop();
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    const constraints: MediaStreamConstraints = {
      video: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      this.canvasElement.classList.add("webcam-active");
      this.videoElement.classList.remove("hidden");
    } catch (err) {
      console.error("Camera error:", err);
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.videoElement.srcObject = null;
    this.canvasElement.classList.remove("webcam-active");
    this.videoElement.classList.add("hidden");
  }

  async captureFrame(): Promise<Blob | null> {
    if (!this.stream || this.videoElement.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    canvas.getContext("2d")!.drawImage(this.videoElement, 0, 0);
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85)
    );
  }
}
