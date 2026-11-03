// The transport, shared by the top bar and the overview. The overview owns the sound, and registers how to play, pause and stop it here.
import { useSyncExternalStore } from "react";

export interface PlayheadState {
  playing: boolean;
  /** Where it is, as the composer reads it: "Bar 5, 0:12.4". */
  words: string;
}

let state: PlayheadState = { playing: false, words: "Bar 1, 0:00.0" };
const listeners = new Set<() => void>();
let controls: { play: () => void; pause: () => void; stop: () => void; seek?: (beat: number) => void; position?: () => number } | null = null;

export const playhead = {
  get: () => state,
  set(next: Partial<PlayheadState>) {
    if (next.playing === state.playing && (next.words === undefined || next.words === state.words)) return;
    state = { ...state, ...next };
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** Whichever piece is open. Returns how to let go, so an old overview can't keep the transport. */
  register(next: typeof controls) {
    controls = next;
    return () => {
      if (controls === next) controls = null;
    };
  },
  play: () => controls?.play(),
  pause: () => controls?.pause(),
  stop: () => controls?.stop(),
  seek: (beat: number) => controls?.seek?.(Math.max(0, beat)),
  get beat() { return controls?.position?.() ?? 0; },
  get ready() {
    return !!controls;
  },
};

export function usePlayhead(): PlayheadState {
  return useSyncExternalStore(playhead.subscribe, playhead.get, playhead.get);
}
