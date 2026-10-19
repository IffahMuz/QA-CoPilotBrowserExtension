export class VideoBuffer {
  private recorder?: MediaRecorder;
  private chunks: { t: number; blob: Blob }[] = [];
  private windowMs = 180_000;

  async start(streamId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      } as any,
    });
    this.recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
    });
    this.recorder.ondataavailable = (e) => {
      const now = Date.now();
      this.chunks.push({ t: now, blob: e.data });
      const cutoff = now - this.windowMs;
      this.chunks = this.chunks.filter((c) => c.t >= cutoff);
    };
    this.recorder.start(1_000);
  }

  snapshot(): Blob {
    return new Blob(
      this.chunks.map((c) => c.blob),
      { type: "video/webm" }
    );
  }

  stop() {
    this.recorder?.stop();
  }
}

const buffer = new VideoBuffer();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START_BUFFER") void buffer.start(msg.streamId);
  if (msg.type === "STOP_BUFFER") buffer.stop();
});
