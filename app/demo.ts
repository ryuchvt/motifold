// Replays use real recorded requests and replies. Unprepared edits never become a model call.
import { setTransport, type RecordedCall, type SparkReply, type Transport } from "./spark";

export interface DemoRecipe {
  intent: "arrange" | "expand" | "recompose";
  ensemble: string;
  mood?: string;
  moreBars: number;
  where: "inside" | "after" | "both";
  useMelodyOnly: false;
  freedom?: number;
  length?: number;
}
export interface DemoRun { key: string; mode: DemoRecipe["intent"]; ensemble?: string; mood: string; freedom?: number; length?: number; render?: string; renderPlan?: string; selfContained?: boolean }
/** Exact free-text harmony from the selected recorded plan, not an analysis of its notes. */
export interface DemoPlanHarmony { from: string; to: string; chords: string }
/** An outcome is addressable only after its real recording and exported files have been checked. */
export interface DemoOutcome {
  id: string;
  runKey: string;
  intent: DemoRecipe["intent"];
  ensemble: string;
  mood: string;
  option: 0 | 1;
  name: string;
  bars: number;
  sourceBars: number;
  freedom?: number;
  status: "unavailable" | "preview" | "complete";
  reason?: string;
  xml?: string;
  midi?: string;
  zip?: string;
  run?: string;
  render?: string;
  xmlSha256?: string;
  midiSha256?: string;
  /** The exact exported score used for this DAW render, not merely a similarly named plan. */
  renderXmlSha256?: string;
  renderCredit?: string;
  /** Bar-1-aligned DAW stems for the same exact exported score. */
  renderStems?: { label: string; url: string }[];
  /** Authenticated chosen-plan spans. Keep the full text and range without allocating individual chords to bars. */
  planHarmony?: DemoPlanHarmony[];
}
export interface DemoCatalog { version: 1; pieceId: string; recorded: string; outcomes: DemoOutcome[] }
export interface DemoPiece {
  id: string;
  name: string;
  words: string;
  midi: string;
  xml: string;
  mappedMidi?: string;
  acceptedMidi?: string;
  recipe: DemoRecipe;
  /** The exact choices made in the recording, including any answers and which option is complete. */
  guide: string[];
  runs: DemoRun[];
  catalog?: string;
  tutorial?: { runKey: string; acceptedLabel: string; rawNoteCount?: number; acceptedNoteCount?: number; completeOptions?: (0 | 1)[] };
}
export interface DemoIndex {
  recorded: string;
  pieces: DemoPiece[];
}

type Saved = RecordedCall & { version: string; model: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const fileKey = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
export const localDemoAsset = (value: unknown): value is string => typeof value === "string" && /^\/demo\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
const localAsset = localDemoAsset;
const intent = (value: unknown) => value === "arrange" || value === "expand" || value === "recompose";
const optionalFreedom = (value: unknown) => value === undefined || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5);
const validCount = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 1024;
const hash = (value: unknown) => value === undefined || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const harmonyText = (value: unknown, max: number) => text(value) && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const planHarmony = (value: unknown) => Array.isArray(value) && value.length <= 40 && value.every(span => object(span) && Object.keys(span).length === 3 && harmonyText(span.from, 12) && harmonyText(span.to, 12) && harmonyText(span.chords, 400));
const moodName = (value: unknown) => { const name = String(value ?? "").trim().toLowerCase(); return name === "neutral" ? "" : name; };

export function recordedDemoCatalog(value: unknown, pieceId: string): DemoCatalog | null {
  if (!object(value) || value.version !== 1 || value.pieceId !== pieceId || !text(value.recorded) || !Number.isFinite(Date.parse(value.recorded)) || !Array.isArray(value.outcomes)) return null;
  const ids = new Set<string>();
  for (const item of value.outcomes) {
    if (!object(item) || !fileKey(item.id) || ids.has(item.id) || !fileKey(item.runKey) || !intent(item.intent) || !text(item.ensemble) || typeof item.mood !== "string" || (item.option !== 0 && item.option !== 1) || !text(item.name) || !validCount(item.bars) || !validCount(item.sourceBars) || !optionalFreedom(item.freedom) || !["unavailable", "preview", "complete"].includes(String(item.status))) return null;
    if (item.intent !== "recompose" && moodName(item.mood) !== "") return null;
    if (!["xml", "midi", "zip", "run", "render"].every(key => item[key] === undefined || localAsset(item[key])) || !["xmlSha256", "midiSha256", "renderXmlSha256"].every(key => hash(item[key])) || (item.reason !== undefined && !text(item.reason)) || (item.renderCredit !== undefined && !text(item.renderCredit))) return null;
    if (item.status === "complete" && (!localAsset(item.xml) || !localAsset(item.midi) || !localAsset(item.zip))) return null;
    if (item.status === "preview" && !localAsset(item.xml)) return null;
    if (item.planHarmony !== undefined && (item.status !== "complete" || typeof item.xmlSha256 !== "string" || !planHarmony(item.planHarmony))) return null;
    if (item.renderStems !== undefined && (!Array.isArray(item.renderStems) || !item.render || !item.renderXmlSha256 || item.status !== 'complete' || item.renderStems.length > 64 || !item.renderStems.every(stem => object(stem) && text(stem.label) && localAsset(stem.url)) || new Set(item.renderStems.map(stem => stem.label)).size !== item.renderStems.length)) return null;
    ids.add(item.id);
  }
  return value as unknown as DemoCatalog;
}
export async function loadDemoCatalog(piece: Pick<DemoPiece, "id" | "catalog">): Promise<DemoCatalog | null> {
  if (!piece.catalog || !localAsset(piece.catalog)) return null;
  try { const response = await fetch(piece.catalog); return response.ok ? recordedDemoCatalog(await response.json(), piece.id) : null; } catch { return null; }
}

/** No index is published until the real recorded path and its exact directions are ready. */
export function recordedDemoIndex(value: unknown): DemoIndex | null {
  if (!object(value) || !text(value.recorded) || !Number.isFinite(Date.parse(value.recorded)) || !Array.isArray(value.pieces) || value.pieces.length !== 1) return null;
  const valid = value.pieces.every((piece: unknown) => {
    if (!object(piece) || !fileKey(piece.id) || !text(piece.name) || !text(piece.words) || !localAsset(piece.midi) || !localAsset(piece.xml)) return false;
    if (![piece.mappedMidi,piece.acceptedMidi].every(file=>file===undefined||localAsset(file))) return false;
    const recipe = piece.recipe;
    if (!object(recipe) || !intent(recipe.intent) || !text(recipe.ensemble) || !Number.isInteger(recipe.moreBars) || Number(recipe.moreBars) < 0 || !["inside", "after", "both"].includes(String(recipe.where)) || recipe.useMelodyOnly !== false || !optionalFreedom(recipe.freedom) || (recipe.length !== undefined && !validCount(recipe.length)) || (recipe.mood !== undefined && typeof recipe.mood !== "string")) return false;
    if (recipe.intent === "arrange" && (recipe.moreBars !== 0 || recipe.where !== "inside")) return false;
    if (recipe.intent !== "recompose" && moodName(recipe.mood) !== "") return false;
    if (piece.catalog !== undefined && !localAsset(piece.catalog)) return false;
    if (!Array.isArray(piece.guide) || piece.guide.length === 0 || !piece.guide.every(text) || !Array.isArray(piece.runs) || piece.runs.length === 0) return false;
    const keys = new Set<string>();
    if (!piece.runs.every((run: unknown) => { if (!object(run) || !fileKey(run.key) || keys.has(run.key) || !intent(run.mode) || typeof run.mood !== "string" || !optionalFreedom(run.freedom) || (run.ensemble !== undefined && !text(run.ensemble)) || (run.length !== undefined && !validCount(run.length)) || (run.render !== undefined && !localAsset(run.render)) || (run.renderPlan !== undefined && !text(run.renderPlan)) || (run.selfContained !== undefined && typeof run.selfContained !== "boolean")) return false; keys.add(run.key); return true; })) return false;
    const tutorial = piece.tutorial;
    if (tutorial !== undefined && !(object(tutorial) && fileKey(tutorial.runKey) && keys.has(tutorial.runKey) && text(tutorial.acceptedLabel) && (tutorial.rawNoteCount === undefined || validCount(tutorial.rawNoteCount)) && (tutorial.acceptedNoteCount === undefined || validCount(tutorial.acceptedNoteCount)))) return false;
    if (object(tutorial) && tutorial.completeOptions !== undefined && (!Array.isArray(tutorial.completeOptions) || tutorial.completeOptions.length < 1 || tutorial.completeOptions.length > 2 || new Set(tutorial.completeOptions).size !== tutorial.completeOptions.length || !tutorial.completeOptions.every(option => option === 0 || option === 1))) return false;
    const selected = piece.runs.find((run: unknown) => object(run) && run.key === (object(tutorial) ? tutorial.runKey : (piece.runs as Record<string, unknown>[])[0]?.key)) as Record<string, unknown> | undefined;
    return !!selected && selected.mode === recipe.intent && (selected.ensemble === undefined || selected.ensemble === recipe.ensemble) && moodName(selected.mood) === moodName(recipe.mood) && (selected.freedom === undefined || selected.freedom === recipe.freedom) && (selected.length === undefined || selected.length === recipe.length);
  });
  return valid ? value as unknown as DemoIndex : null;
}

export async function loadDemoIndex(): Promise<DemoIndex | null> {
  try {
    const res = await fetch("/demo/index.json");
    return res.ok ? recordedDemoIndex(await res.json()) : null;
  } catch {
    return null;
  }
}

/** What's on screen during a replay. `enabled` also identifies the brief local-file loading phase. */
export const replay = { enabled: false, active: false, realMs: 0, skip: false, recorded: "", model: "", version: "" };
export const skipReplay = () => { replay.skip = true; };
let generation = 0;
const active = new Map<symbol, { ms: number; recorded: string; model: string; version: string }>();
function showActive() {
  const last = [...active.values()].at(-1);
  replay.active = !!last;
  if (last) Object.assign(replay, { realMs: last.ms, recorded: last.recorded, model: last.model, version: last.version });
}

/** Object property order is irrelevant. Every value sent over JSON remains part of the identity. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function recordedRequestKey(shape: string, input: unknown): string | null {
  try { return `${shape}|${stable(JSON.parse(JSON.stringify(input)))}`; } catch { return null; }
}

function savedCall(value: unknown): value is Saved {
  if (!object(value) || !text(value.shape) || !object(value.input) || !text(value.version) || !text(value.model) || typeof value.ms !== "number" || !Number.isFinite(value.ms) || value.ms < 0) return false;
  if (!object(value.reply) || value.reply.status !== "ok" || !("answer" in value.reply) || typeof value.reply.cached !== "boolean") return false;
  return Array.isArray(value.thinking) && value.thinking.every((line: unknown) => object(line) && typeof line.at === "number" && Number.isFinite(line.at) && line.at >= 0 && typeof line.text === "string");
}
async function load(url: string): Promise<Saved[]> {
  try {
    const res = await fetch(url);
    const calls: unknown = res.ok ? await res.json() : null;
    // Failed attempts belong in the audit. They cannot mask a later successful cold retry here.
    return Array.isArray(calls) ? calls.filter(savedCall) : [];
  } catch { return []; }
}

const LONGEST_REPLAY_MS = 7000;
function wait(ms: number, current: () => boolean): Promise<void> {
  if (ms <= 0 || replay.skip || !current()) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); clearInterval(check); resolve(); };
    const timer = setTimeout(finish, ms);
    const check = setInterval(() => { if (replay.skip || !current()) finish(); }, 60);
  });
}

/** Only this piece's declared files are read. No match is an explicit recorded-only failure. */
export function startDemo(piece: DemoPiece, recorded: string, runKey = piece.tutorial?.runKey ?? piece.runs[0]?.key): void {
  const session = ++generation;
  active.clear(); showActive();
  replay.enabled = true;
  replay.recorded = recorded;
  replay.skip = false;
  const current = () => session === generation;
  // A tutorial selects one exact recipe. Other takes cannot silently conflict with or answer it.
  const run = piece.runs.find(item => item.key === runKey);
  const files = [...(run?.selfContained ? [] : [`/demo/${piece.id}/shared.json`]), ...(run ? [`/demo/${piece.id}/${run.key}.json`] : [])];
  const calls = Promise.all(files.map(load)).then(groups => groups.flat());
  const transport: Transport = async (shape, input, think, timing) => {
    const key = recordedRequestKey(shape, input);
    const available = await calls;
    if (!current()) return { status: "fallback", reason: "stale" };
    const matches = key === null ? [] : available.filter(call => recordedRequestKey(call.shape, call.input) === key);
    // Conflicting receipts for one exact request are ambiguous. Packaging must choose the actual take.
    const first = matches[0];
    if (!first || matches.some(call => stable(call.reply) !== stable(first.reply) || call.model !== first.model || call.version !== first.version)) return { status: "fallback", reason: "not-prepared" };
    timing?.({ source: "recorded", realMs: first.ms, recorded, model: first.model, version: first.version });
    const id = Symbol();
    active.set(id, { ms: first.ms, recorded, model: first.model, version: first.version });
    replay.skip = false; showActive();
    const duration = Math.min(first.ms, LONGEST_REPLAY_MS);
    const scale = duration / Math.max(first.ms, 1);
    let at = 0;
    try {
      for (const line of first.thinking) {
        const target = Math.max(at, Math.min(duration, line.at * scale));
        await wait(target - at, current);
        if (!current()) return { status: "fallback", reason: "stale" };
        at = target;
        think(line.text);
      }
      await wait(duration - at, current);
      if (!current()) return { status: "fallback", reason: "stale" };
      return structuredClone(first.reply);
    } finally {
      active.delete(id); showActive();
    }
  };
  setTransport(transport);
}

export function stopDemo(): void {
  generation++;
  active.clear();
  replay.enabled = false;
  replay.skip = false;
  showActive();
  setTransport(null);
}
