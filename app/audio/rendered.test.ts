import { afterEach, expect, it, vi } from 'vitest';
import { createRenderedPlayback } from './rendered';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const streams: FakeAudio[] = [], frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  class FakeAudio {
    currentTime = 0; paused = true; ended = false; muted = false; preload = ''; seeking = false;
    onseeked: (() => void) | null = null;
    onerror: (() => void) | null = null; onended: (() => void) | null = null;
    ready: Promise<void> = Promise.resolve();
    constructor(public url: string) { streams.push(this); }
    play() { this.paused = false; return this.ready; }
    pause() { this.paused = true; }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
  return { streams, frames, flush, FakeAudio };
}

it('loads only requested stems, waits for readiness, follows their clock and stops them together', async () => {
  const { streams, flush } = setup(), playback = createRenderedPlayback(), tick = vi.fn(), end = vi.fn(), fail = vi.fn();
  expect(streams).toHaveLength(0);
  playback.play(['/violin.mp3', '/cello.mp3'], 12, tick, end, fail);
  expect(streams.map(stream => stream.url)).toEqual(['/violin.mp3', '/cello.mp3']);
  expect(streams.every(stream => stream.muted)).toBe(true);
  await vi.waitFor(() => expect(streams.every(stream => !stream.muted && !stream.paused)).toBe(true));
  expect(streams.every(stream => !stream.muted && stream.currentTime === 12)).toBe(true);
  streams[0]!.currentTime = 14; streams[1]!.currentTime = 12.5; flush();
  expect(tick).toHaveBeenLastCalledWith(14); expect(streams[1]!.currentTime).toBe(14);
  playback.stop(); expect(streams.every(stream => stream.paused)).toBe(true);
  flush(); expect(tick).toHaveBeenCalledOnce(); expect(end).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
});

it('pauses an older group when it finishes loading after a new selection', async () => {
  const { streams } = setup(), playback = createRenderedPlayback();
  let release!: () => void;
  const pending = new Promise<void>(resolve => release = resolve);
  vi.spyOn(globalThis.Audio.prototype, 'play').mockImplementationOnce(function(this: HTMLAudioElement) { (this as unknown as { paused: boolean }).paused = false; return pending; });
  playback.play(['/old.mp3'], 0, vi.fn(), vi.fn(), vi.fn());
  playback.play(['/new.mp3'], 5, vi.fn(), vi.fn(), vi.fn());
  await vi.waitFor(() => expect(streams[1]!.muted).toBe(false)); release(); await Promise.resolve(); await Promise.resolve();
  expect(streams[0]!.paused).toBe(true); expect(streams[0]!.muted).toBe(true);
  expect(streams[1]!.paused).toBe(false); expect(streams[1]!.muted).toBe(false);
});

it('reports decoding/network failure once, pauses every stem and permits an explicit retry', async () => {
  const { streams, frames } = setup(), playback = createRenderedPlayback(), failed = vi.fn(), end = vi.fn();
  playback.play(['/one.mp3', '/two.mp3'], 0, vi.fn(), end, failed);
  await vi.waitFor(() => expect(frames.size).toBe(1));
  streams[1]!.onerror!(); streams[0]!.onerror!();
  expect(failed).toHaveBeenCalledOnce(); expect(streams.every(stream => stream.paused)).toBe(true); expect(frames.size).toBe(0);
  playback.play(['/one.mp3'], 0, vi.fn(), end, failed);
  await vi.waitFor(() => expect(streams[2]!.muted).toBe(false));
  streams[2]!.ended = true; streams[2]!.onended!();
  expect(end).toHaveBeenCalledOnce(); expect(failed).toHaveBeenCalledOnce();
});

it('keeps every stem silent until seeking finishes and cancels a pending seek on Stop', async () => {
  const { streams } = setup(), playback = createRenderedPlayback(), tick = vi.fn();
  playback.play(['/one.mp3', '/two.mp3'], 98, tick, vi.fn(), vi.fn());
  streams.forEach(stream => stream.seeking = true);
  await vi.waitFor(() => expect(streams[0]!.onseeked).toBeTypeOf('function'));
  streams[0]!.seeking = false; streams[0]!.onseeked!();
  await Promise.resolve();
  expect(streams.every(stream => stream.muted && stream.paused)).toBe(true);
  playback.stop(); streams[1]!.seeking = false; streams[1]!.onseeked!();
  await Promise.resolve(); await Promise.resolve();
  expect(streams.every(stream => stream.muted && stream.paused)).toBe(true); expect(tick).not.toHaveBeenCalled();
});
