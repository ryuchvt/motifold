// The pitch of a whole recording, off the page's thread, because YIN reads it every 10 ms.
import { yin } from "./audio/yin";
import { notesFromPitch } from "./listen";

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    self.postMessage({ ok: true, notes: notesFromPitch(yin(event.data.samples, event.data.sampleRate)) });
  } catch (e) {
    self.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
