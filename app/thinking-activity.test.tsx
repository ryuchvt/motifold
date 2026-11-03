// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MuseChip, Thinking } from "./Thinking";
import { askSpark, setTransport, type SparkReply } from "./spark";
import { replay } from "./demo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  Element.prototype.scrollTo = () => {};
});
afterEach(async () => {
  await act(async () => { cleanup.splice(0).forEach(finish => finish()); });
  await act(async () => root?.unmount());
  root = null;
  setTransport(null);
  document.body.replaceChildren();
  Object.assign(replay, { enabled: false, active: false, recorded: "" });
  vi.useRealTimers();
});
const reply: SparkReply = { status: "ok", answer: {}, cached: false };
function setup(sample = false) {
  const jobs = new Map<string, { think: (text: string) => void; finish: (reply: SparkReply) => void }>();
  setTransport(async (_shape, input, think) => new Promise<SparkReply>(finish => {
    const name = (input as { chosen: { name: string } }).chosen.name;
    jobs.set(name, { think, finish });
    cleanup.push(() => finish(reply));
  }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(<><MuseChip /><Thinking sample={sample} /></>));
  const chip = host.querySelector<HTMLButtonElement>(".muse-chip")!;
  if (chip.getAttribute("aria-expanded") === "true") act(() => chip.click());
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
  expect(host.querySelector(".thinking-done")?.textContent).toContain(`${ended} · bars 1 to 8 · ${order === "first" ? "0:07" : "0:05"}`);
  expect(host.querySelector(".muse-chip")?.textContent).not.toContain("READY");
  advance(3000);
  await act(async () => { jobs.get(remaining)!.finish(reply); await (order === "first" ? second : first); });
  expect(host.querySelector(".muse-chip")?.textContent).toContain("READY");
  const chip = host.querySelector<HTMLButtonElement>(".muse-chip")!;
  if (chip.getAttribute("aria-expanded") !== "true") act(() => chip.click());
  expect(host.querySelector(".thinking-done")?.textContent).toContain(`${remaining} · bars 1 to 8 · ${order === "first" ? "0:08" : "0:10"}`);
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

it("keeps streamed work off the score actions until requested and respects closing it across later calls", async () => {
  const { host, jobs } = setup();
  let first!: Promise<SparkReply>, second!: Promise<SparkReply>;
  act(() => { first = askSpark("read_piece", { chosen: { name: "Reading" } }); });
  act(() => jobs.get("Reading")!.think("Reading the supplied notes."));
  expect(host.querySelector(".thinking")).toBeNull();
  expect(host.querySelector(".muse-chip")?.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector(".muse-chip")?.textContent).toContain("READING YOUR SCORE");
  const phoneControl = host.querySelector<HTMLButtonElement>(".muse-activity-mobile")!;
  act(() => phoneControl.click());
  expect(host.querySelector(".thinking-lines")?.textContent).toContain("Reading the supplied notes.");
  act(() => host.querySelector<HTMLButtonElement>(".thinking-hide")!.click());
  act(() => { second = askSpark("study_score", { chosen: { name: "Study" } }); });
  act(() => jobs.get("Study")!.think("Finding the written harmony."));
  expect(host.querySelector(".thinking")).toBeNull();
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
