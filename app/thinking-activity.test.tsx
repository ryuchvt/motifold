// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MuseChip, Thinking, resetMuseActivity } from "./Thinking";
import { askSpark, setTransport, type RecordedTiming, type SparkReply } from "./spark";
import { replay } from "./demo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  Element.prototype.scrollTo = () => {};
  resetMuseActivity();
});
afterEach(async () => {
  await act(async () => { cleanup.splice(0).forEach(finish => finish()); });
  await act(async () => root?.unmount());
  root = null;
  setTransport(null);
  document.body.replaceChildren();
  Object.assign(replay, { enabled: false, active: false, recorded: "" });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const reply: SparkReply = { status: "ok", answer: {}, cached: false };
function setup(sample = false) {
  const jobs = new Map<string, { think: (text: string) => void; timing?: (value: RecordedTiming) => void; finish: (reply: SparkReply) => void }>();
  setTransport(async (_shape, input, think, timing) => new Promise<SparkReply>(finish => {
    const name = (input as { chosen: { name: string } }).chosen.name;
    jobs.set(name, { think, timing, finish });
    cleanup.push(() => finish(reply));
  }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(<><MuseChip /><Thinking sample={sample} /></>));
  return { host, jobs };
}
const openActivity = (host: Element) => {
  const chip = host.querySelector<HTMLButtonElement>(".muse-chip")!;
  if (chip.getAttribute("aria-expanded") !== "true") act(() => chip.click());
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it.each(["first", "second"] as const)("keeps parallel preview thinking, labels and elapsed times attached when %s finishes first", async (order) => {
  const { host, jobs } = setup();
  const firstName = `First preview, ${order} finishes first`;
  const secondName = `Second preview, ${order} finishes first`;
  let first!: Promise<SparkReply>;
  let second!: Promise<SparkReply>;
  act(() => { first = askSpark("arrange", { chosen: { name: firstName }, window: { from: "1", to: "8" } }); });
  advance(2000);
  act(() => { second = askSpark("arrange", { chosen: { name: secondName }, window: { from: "1", to: "8" } }); });
  act(() => {
    jobs.get(firstName)!.think("The first preview keeps the tune low.");
    jobs.get(secondName)!.think("The second preview answers above it.");
  });
  openActivity(host);
  expect(host.querySelector(".thinking-lines")?.textContent).toContain("The second preview answers above it.");
  expect(host.querySelector(".thinking-lines")?.textContent).not.toContain("The first preview keeps the tune low.");
  expect(host.querySelector(".thinking header strong")?.textContent).toContain(secondName);
  expect(host.querySelector(".thinking-also")?.textContent).toContain(firstName);
  advance(5000);
  const ended = order === "first" ? firstName : secondName;
  const remaining = order === "first" ? secondName : firstName;
  await act(async () => { jobs.get(ended)!.finish(reply); await (order === "first" ? first : second); });
  expect(host.querySelector(".thinking header strong")?.textContent).toContain(remaining);
  expect(host.querySelector(".thinking-lines")?.textContent).toContain(order === "first" ? "The second preview answers above it." : "The first preview keeps the tune low.");
  expect(host.querySelector(".thinking-done")?.textContent).toContain(`${ended} · bars 1 to 8 · Live ${order === "first" ? "0:07" : "0:05"}`);
  expect(host.querySelector(".muse-chip")?.textContent).not.toContain("READY");
  advance(3000);
  await act(async () => { jobs.get(remaining)!.finish(reply); await (order === "first" ? second : first); });
  expect(host.querySelector(".muse-chip")?.textContent).toContain("READY");
  const chip = host.querySelector<HTMLButtonElement>(".muse-chip")!;
  if (chip.getAttribute("aria-expanded") !== "true") act(() => chip.click());
  expect(host.querySelector(".thinking-done")?.textContent).toContain(`${remaining} · bars 1 to 8 · Live ${order === "first" ? "0:08" : "0:10"}`);
});

it("labels the local UI sample activity without claiming a live model call", async () => {
  const { host, jobs } = setup(true);
  let pending!: Promise<SparkReply>;
  act(() => { pending = askSpark("arrange", { chosen: { name: "Local sample" } }); });
  openActivity(host);
  expect(host.querySelector(".thinking footer")?.textContent).toBe("Local sample answers. No model call.");
  expect(host.textContent).not.toContain("Live on Muse Spark");
  await act(async () => { jobs.get("Local sample")!.finish(reply); await pending; });
});

it("starts visible, keeps its minimized dock across later calls, and restores the current reasoning", async () => {
  const { host, jobs } = setup();
  let first!: Promise<SparkReply>, second!: Promise<SparkReply>;
  act(() => { first = askSpark("read_piece", { chosen: { name: "Reading" } }); });
  act(() => jobs.get("Reading")!.think("Reading the supplied notes."));
  expect(host.querySelector(".thinking-lines")?.textContent).toContain("Reading the supplied notes.");
  expect(host.querySelector(".muse-chip")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector(".muse-chip")?.textContent).toContain("READING YOUR SCORE");
  act(() => host.querySelector<HTMLButtonElement>(".thinking-hide")!.click());
  expect(host.querySelector(".muse-dock.is-minimized")).not.toBeNull();
  expect(host.querySelector(".thinking-lines")).toBeNull();
  act(() => { second = askSpark("study_score", { chosen: { name: "Study" } }); });
  act(() => jobs.get("Study")!.think("Finding the written harmony."));
  expect(host.querySelector(".muse-dock.is-minimized")).not.toBeNull();
  openActivity(host);
  expect(host.querySelector(".thinking-lines")?.textContent).toContain("Finding the written harmony.");
  await act(async () => { jobs.get("Reading")!.finish(reply); jobs.get("Study")!.finish(reply); await Promise.all([first, second]); });
});

it("identifies a recorded-only session while its local files load and after an unprepared request", async () => {
  const { host, jobs } = setup();
  Object.assign(replay, { enabled: true, active: false, recorded: "2026-11-04" });
  let pending!: Promise<SparkReply>;
  act(() => { pending = askSpark("arrange", { chosen: { name: "Loading a recording" } }); });
  openActivity(host);
  expect(host.querySelector(".thinking footer")?.textContent).toContain("Recorded replay from 2026-11-04");
  expect(host.querySelector(".thinking footer")?.textContent).toContain("Loading a saved answer. No model call.");
  expect(host.querySelector(".thinking-skip")).toBeNull();
  await act(async () => { jobs.get("Loading a recording")!.finish({ status: "fallback", reason: "not-prepared" }); await pending; });
  expect(host.querySelector(".thinking footer")?.textContent).toContain("Recorded replay");
  expect(host.querySelector(".thinking footer")?.textContent).not.toContain("Live on Muse Spark");
});

it("keeps each parallel recording's original duration separate from its replay elapsed time", async () => {
  const { host, jobs } = setup();
  Object.assign(replay, { enabled: true, recorded: "2026-11-04" });
  let a!: Promise<SparkReply>, b!: Promise<SparkReply>;
  act(() => {
    a = askSpark("arrange", { chosen: { name: "Long recording" } });
    b = askSpark("arrange", { chosen: { name: "Short recording" } });
    jobs.get("Long recording")!.timing!({ source: "recorded", realMs: 134000, recorded: "2026-11-04", model: "muse-spark1.3", version: "arrange-test" });
    jobs.get("Short recording")!.timing!({ source: "recorded", realMs: 54000, recorded: "2026-11-04", model: "muse-spark1.3", version: "arrange-test" });
  });
  advance(2000);
  expect(host.querySelector(".thinking-clock")?.textContent).toBe("Replay 0:02 / recorded live 0:54");
  expect(host.querySelector(".thinking-also")?.textContent).toContain("recorded live 2:14");
  await act(async () => { jobs.get("Short recording")!.finish(reply); await b; });
  expect(host.querySelector(".thinking-clock")?.textContent).toContain("recorded live 2:14");
  advance(3000);
  await act(async () => { jobs.get("Long recording")!.finish(reply); await a; });
  expect(host.querySelector(".thinking-done")?.textContent).toContain("Short recording · Replay 0:02 / recorded live 0:54");
  expect(host.querySelector(".thinking-done")?.textContent).toContain("Long recording · Replay 0:05 / recorded live 2:14");
});

it("clears a previous piece and ignores its late thinking and completion without reopening history", async () => {
  const { host, jobs } = setup();
  let old!: Promise<SparkReply>, next!: Promise<SparkReply>;
  act(() => { old = askSpark("read_piece", { chosen: { name: "Old piece" } }); jobs.get("Old piece")!.think("Old score reasoning."); });
  act(() => { resetMuseActivity(); next = askSpark("study_score", { chosen: { name: "New piece" } }); jobs.get("New piece")!.think("New score reasoning."); });
  await act(async () => { jobs.get("Old piece")!.think("Late old reasoning."); jobs.get("Old piece")!.finish(reply); await old; });
  expect(host.textContent).not.toContain("Old score reasoning");
  expect(host.textContent).not.toContain("Late old reasoning");
  expect(host.querySelector(".thinking-done")).toBeNull();
  expect(host.querySelector(".thinking-lines")?.textContent).toContain("New score reasoning.");
  await act(async () => { jobs.get("New piece")!.finish(reply); await next; });
});

it("does not retry a late network fallback or attach it to the new piece's activity run", async () => {
  const { host } = setup();
  setTransport(null);
  let release!: (response: Response) => void;
  const attempts: { attemptId: string; input: { chosen: { name: string } } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    attempts.push(body);
    if (attempts.length === 1) return new Promise<Response>(finish => { release = finish; cleanup.push(() => finish(Response.json(reply))); });
    return Response.json(reply);
  }));
  let old!: Promise<SparkReply>;
  act(() => { old = askSpark("read_piece", { chosen: { name: "Old network piece" } }); });
  act(() => resetMuseActivity());
  await act(async () => { await askSpark("study_score", { chosen: { name: "New network piece" } }); });
  await act(async () => { release(Response.json({ status: "fallback", reason: "network" })); await old; });
  expect(attempts.map(x => x.input.chosen.name)).toEqual(["Old network piece", "New network piece"]);
  expect(new Set(attempts.map(x => x.attemptId)).size).toBe(2);
  expect(host.querySelector(".thinking-done")?.textContent).toContain("Studying the form");
  expect(host.querySelector(".thinking-done")?.textContent).not.toContain("Reading who has the tune");
  expect(host.querySelector('[role="status"]')).toBeNull();
});
