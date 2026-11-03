// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MuseChip, Thinking } from "./Thinking";
import { askSpark, setTransport, type SparkReply } from "./spark";

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
  return { host, jobs };
}
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
  expect(host.querySelector(".thinking footer")?.textContent).toBe("Local sample answers. No model call.");
  expect(host.textContent).not.toContain("Live on Muse Spark");
  await act(async () => { jobs.get("Local sample")!.finish(reply); await pending; });
});
