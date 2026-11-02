// Runs on the audio thread. Collects the microphone's first channel into 2048-sample chunks and
// stamps each with the audio context's frame number of its first sample, so take time maps to
// samples exactly.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.startFrame = 0;
    this.recording = false;
    this.port.onmessage = (event) => {
      if (event.data === "start") {
        this.filled = 0;
        this.recording = true;
      } else if (event.data === "stop") {
        this.flush();
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  flush() {
    if (this.filled > 0) {
      this.port.postMessage({ frame: this.startFrame, samples: this.buffer.slice(0, this.filled) });
      this.filled = 0;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.recording && channel) {
      if (this.filled + channel.length > this.size) this.flush();
      if (this.filled === 0) this.startFrame = currentFrame;
      this.buffer.set(channel, this.filled);
      this.filled += channel.length;
      if (this.filled === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor("phrasepath-capture", CaptureProcessor);
