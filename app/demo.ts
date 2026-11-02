// The prepared demo: real runs of the real app, recorded, and played back through the same screens at no cost and with no key. The screen always says it's a replay,
// when it was recorded and how long it really took, because a saved answer must never pass as a live one.
import { setTransport, type RecordedCall, type SparkReply, type Transport } from "./spark";

export interface DemoPiece {
  id: string;
  name: string;
  words: string;
  midi: string;
  xml: string;
  audio: string;
  /** What's prepared, by the key its run is saved under, like arrange-hopeful or recompose-action. */
  runs: { key: string; mode: "arrange" | "recompose"; mood: string; render?: string }[];
}
export interface DemoIndex {
  recorded: string;
  pieces: DemoPiece[];
}

export async function loadDemoIndex(): Promise<DemoIndex | null> {
  try {
    const res = await fetch("/demo/index.json");
    return res.ok ? ((await res.json()) as DemoIndex) : null;
  } catch {
    return null;
  }
}

/** What's on screen during a replay. */
export const replay = { active: false, realMs: 0, skip: false, recorded: "" };
export const skipReplay = () => {
  replay.skip = true;
};

type Saved = Pick<RecordedCall, "shape" | "input" | "reply" | "ms" | "thinking">;
type WriteLike = { ask?: string | null; window?: { from: string }; fix?: { ask: string } };

/** A mood's name from what's asked, which is how a call finds its recording. */
export const moodOf = (ask: string | null | undefined) => /The mood I want: (\w+)/.exec(ask ?? "")?.[1]?.toLowerCase() ?? "";
const callKey = (shape: string, input: unknown) => {
  const i = input as WriteLike;
  return [shape, i.window?.from ?? "", i.fix?.ask ?? ""].join("|");
};

/** At most this long on one call, so a run of many minutes can be watched. The screen says how long it really took. */
const LONGEST_REPLAY_MS = 7000;

async function load(url: string): Promise<Saved[]> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as Saved[]) : [];
  } catch {
    return [];
  }
}

/** Answers from the recordings of this piece. A call that wasn't prepared says so, and the page offers the live way. */
export function startDemo(piece: DemoPiece, recorded: string): void {
  const shared = load(`/demo/${piece.id}/shared.json`);
  const runs = new Map<string, Promise<Saved[]>>();
  const runOf = (key: string) => {
    if (!runs.has(key)) runs.set(key, load(`/demo/${piece.id}/${key}.json`));
    return runs.get(key)!;
  };
  const transport: Transport = async (shape, input, think) => {
    const ask = (input as WriteLike).ask;
    const mode = shape === "plan_recompose" || (input as { seed?: unknown }).seed ? "recompose" : "arrange";
    const sharedCalls = await shared;
    const moodCalls = moodOf(ask) ? await runOf(`${mode}-${moodOf(ask)}`) : [];
    const found = [...moodCalls, ...sharedCalls].find((c) => callKey(c.shape, c.input) === callKey(shape, input));
    if (!found) return { status: "fallback", reason: "not-prepared" } satisfies SparkReply;
    replay.active = true;
    replay.realMs = found.ms;
    replay.recorded = recorded;
    replay.skip = false;
    const scale = Math.min(1, LONGEST_REPLAY_MS / Math.max(found.ms, 1));
    let at = 0;
    for (const line of found.thinking) {
      const wait = line.at * scale - at;
      at = line.at * scale;
      await new Promise((done) => {
        const stop = setInterval(() => replay.skip && (clearInterval(stop), clearTimeout(timer), done(null)), 60);
        const timer = setTimeout(() => (clearInterval(stop), done(null)), replay.skip ? 0 : Math.max(0, wait));
      });
      think(line.text);
    }
    replay.active = false;
    return found.reply;
  };
  setTransport(transport);
}

export function stopDemo(): void {
  setTransport(null);
  replay.active = false;
}
