// @vitest-environment jsdom
// Real hook and DOM controls; all transport replies are local copies of genuine recorded replies.
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { ArrangePanel } from "./ArrangePanel";
import { placementRangeWords } from "./placementRepair";
import { setOwnKey, setTransport } from "./spark";
import { useArrange, type Arranged } from "./useArrange";
import { placeNotes } from "./arrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("public/demo/sample-sketch/sample-sketch.musicxml", "utf8");
const score = parseScore(xmlText), part = score.parts[0]!;
const loaded = { fileName: "sample-sketch.musicxml", xmlText, score }, range = { from: 0, to: 23 };
const a = JSON.parse(readFileSync("public/demo/sample-sketch/outcomes/arrange-neutral-brass-quintet-a/run.json", "utf8"));
const b = JSON.parse(readFileSync("public/demo/sample-sketch/outcomes/arrange-neutral-brass-quintet-b/run.json", "utf8"));
const takes = [...a, ...b];
const layouts = a.filter((call: any) => call.shape === "distribute");
const bad = layouts.find((call: any) => !call.input.ask), repaired = layouts.find((call: any) => !!call.input.ask);
let unmount = () => {};
afterEach(() => { act(unmount); setTransport(null); setOwnKey(null); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(safe: boolean | "missing" | "ignored" | "poly" = false) {
  setTransport(null); setOwnKey(null);
  vi.stubGlobal("crypto", webcrypto);
  const requests: { shape: string; input: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (!url.startsWith("/api/spark/")) throw Error("Only local fake transport is allowed");
    const shape = url.split("/").at(-1)!, input = JSON.parse(String(init.body)).input;
    requests.push({ shape, input });
    let call;
    if (shape === "distribute") call = safe || requests.filter(request => request.shape === shape).length > 1 ? repaired : bad;
    else if (shape === "arrange") call = takes.find((take: any) => take.shape === shape && take.input.chosen.name === input.chosen.name && take.input.window?.from === input.window?.from && take.input.window?.to === input.window?.to);
    else call = takes.find((take: any) => take.shape === shape);
    if (!call) throw Error(`No local ${shape} take`);
    const reply = structuredClone(call.reply);
    if (shape === "read_piece") reply.answer.questions = [];
    if (shape === "distribute" && requests.filter(request => request.shape === shape).length === 1) {
      if (safe === "missing") reply.answer.plan = reply.answer.plan.filter((entry: any) => !(entry.line === "Piano upper" && entry.from === "1"));
      if (safe === "ignored") reply.answer.plan.push({ ...reply.answer.plan[0], line: "Unknown source line" });
      if (safe === "poly") for (const entry of reply.answer.plan) if (entry.part === "Trumpet 2") entry.part = "Trumpet 1";
    }
    if (shape === "arrange" && safe === "poly") reply.answer = { adds: [], doubles: [] };
    return Response.json(reply);
  }));
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return <ArrangePanel arranged={current} busy={false} initialSetup={{ ensemble: "Brass quintet", intent: "arrange" }}/>; }
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  act(() => root.render(<Host/>)); unmount = () => root.unmount();
  return { host, requests, get now() { return current; } };
}
async function press(host: Element, text: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  if (!button) throw Error(`No button ${text}`);
  await act(async () => button.click());
}
async function input(host: Element, label: string, value: string) {
  const field = host.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function opened(screen: ReturnType<typeof setup>) {
  await act(async () => screen.now.askPiece());
  await press(screen.host, "Confirm tracks");
  await press(screen.host, "Next: Setup");
}
async function paused(screen: ReturnType<typeof setup>) {
  await vi.waitFor(() => expect(screen.host.querySelector('[role="alert"]')?.textContent).toContain("Check the instrument ranges"));
  await act(async () => {});
  expect(screen.now.options.status).toBe("none");
  expect(screen.requests.filter(request => request.shape === "plan_options" || request.shape === "arrange")).toEqual([]);
}

it("stops before paid planning/previews, then opens and focuses a reviewed repair without another call", async () => {
  const screen = setup(); await opened(screen);
  await press(screen.host, "Create"); await paused(screen);
  const warning = screen.host.querySelector('[role="alert"]')!;
  expect(warning.closest("details")).toBeNull();
  expect(warning.textContent).toContain("23 sit outside the comfortable range");
  const count = screen.requests.length;
  await press(screen.host, "Adjust instrument placement");
  await vi.waitFor(() => {
    const field = screen.host.querySelector<HTMLTextAreaElement>('[aria-label="How you want it laid out"]')!;
    expect(document.activeElement).toBe(field);
    expect(field.closest("details")!.open).toBe(true);
    expect(field.value).toBe(repaired.input.ask);
    expect(field.value.length).toBeLessThanOrEqual(400);
  });
  expect(screen.requests).toHaveLength(count);
  await press(screen.host, "Create");
  await vi.waitFor(() => {
    const options = screen.now.options;
    expect(options.status).toBe("ready");
    if (options.status === "ready") expect(options.plans.every((_, index) => options.notes[index]?.status === "ready")).toBe(true);
  });
  expect(screen.requests.filter(request => request.shape === "distribute")).toHaveLength(2);
  expect(screen.requests.filter(request => request.shape === "plan_options")).toHaveLength(1);
  expect(screen.requests.filter(request => request.shape === "arrange")).toHaveLength(2);
  expect(screen.requests.find(request => request.shape === "plan_options")!.input.ask).toBeNull();
  expect(screen.host.querySelector('[role="alert"]')).toBeNull();
});

it("keeps custom direction and placement wording while adding advice within the combined 400-character limit", async () => {
  const screen = setup(); await opened(screen);
  const direction = "Keep the soft character.", own = "Keep horns in reserve.";
  await input(screen.host, "What you want, or what inspired it", direction);
  await input(screen.host, "How you want it laid out", own);
  await press(screen.host, "Create"); await paused(screen);
  const count = screen.requests.length;
  await press(screen.host, "Adjust instrument placement");
  await vi.waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("How you want it laid out"));
  const field = screen.host.querySelector<HTMLTextAreaElement>('[aria-label="How you want it laid out"]')!;
  expect(field.value).toMatch(new RegExp(`^${own}`));
  expect(field.value).toContain("Register repair only");
  expect(screen.host.querySelector<HTMLTextAreaElement>('[aria-label="What you want, or what inspired it"]')!.value).toBe(direction);
  expect(`${direction} ${field.value}`.length).toBeLessThanOrEqual(400);
  expect(screen.requests).toHaveLength(count);
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.requests.some(request => request.shape === "plan_options")).toBe(true));
  const layouts = screen.requests.filter(request => request.shape === "distribute");
  expect(layouts[1]!.input.ask).toBe(`${direction} ${field.value}`);
  expect(layouts[1]!.input.written).toEqual(layouts[0]!.input.written);
  expect(screen.requests.find(request => request.shape === "plan_options")!.input.ask).toBe(direction);
});

it("preserves a full custom placement field and shows complete facts for manual review instead of truncating it", async () => {
  const screen = setup(); await opened(screen);
  const own = "x".repeat(400);
  await input(screen.host, "How you want it laid out", own);
  await press(screen.host, "Create"); await paused(screen);
  const count = screen.requests.length;
  await press(screen.host, "Adjust instrument placement");
  await vi.waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("How you want it laid out"));
  expect(screen.host.querySelector<HTMLTextAreaElement>('[aria-label="How you want it laid out"]')!.value).toBe(own);
  expect(screen.host.textContent).toContain(repaired.input.ask);
  expect(screen.requests).toHaveLength(count);
});

it("does not bypass an unsafe ready layout by asking to keep the current tracks", async () => {
  const screen = setup(); await opened(screen); await press(screen.host, "Create"); await paused(screen);
  await press(screen.host, "Setup");
  const keep = [...screen.host.querySelectorAll<HTMLInputElement>('.arrange-check input')].find(field => field.parentElement?.textContent?.includes("Keep my own tracks"))!;
  await act(async () => keep.click());
  const count = screen.requests.length;
  await press(screen.host, "Create");
  await paused(screen);
  expect(screen.requests).toHaveLength(count);
});

it("continues the ordinary clean layout flow and derives exactly the genuine recorded Brass repair guidance", async () => {
  const check = placeNotes(score, bad.input, bad.reply.answer, bad.input.instruments, false).check;
  expect(check.outOfRange).toHaveLength(23);
  expect(placementRangeWords(check.outOfRange)).toBe(repaired.input.ask);
  const screen = setup(true); await opened(screen); await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.requests.filter(request => request.shape === "arrange")).toHaveLength(2));
  expect(screen.requests.filter(request => request.shape === "distribute")).toHaveLength(1);
  expect(screen.host.querySelector('[role="alert"]')).toBeNull();
});

it.each(["missing", "ignored", "poly"] as const)("pauses %s source placement before planning and keeps manual adjustment without unsafe range advice", async failure => {
  const screen = setup(failure); await opened(screen); await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.host.querySelector('[role="alert"]')?.textContent).toContain("Check the instrument placement"));
  expect(screen.now.options.status).toBe("none");
  expect(screen.requests.some(request => request.shape === "plan_options" || request.shape === "arrange")).toBe(false);
  const count = screen.requests.length;
  await press(screen.host, "Adjust instrument placement");
  await vi.waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("How you want it laid out"));
  expect(screen.host.querySelector<HTMLTextAreaElement>('[aria-label="How you want it laid out"]')!.value).toBe("");
  expect(screen.host.textContent).toContain("Review these checks");
  expect(screen.requests).toHaveLength(count);
});

it("keeps the local single-line split repair and plans from those current parts only after explicit Create", async () => {
  const screen = setup("poly"); await opened(screen); await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.host.querySelector('[role="alert"]')?.textContent).toContain("need dividing"));
  const count = screen.requests.length;
  await press(screen.host, "Split those into single lines");
  await vi.waitFor(() => expect(screen.host.textContent).toContain("plan from these parts"));
  expect(screen.now.placed.status).toBe("ready");
  if (screen.now.placed.status === "ready") expect(screen.now.placed.check.together).toEqual([]);
  expect(screen.requests).toHaveLength(count);
  expect((screen.host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement).value).toBe("current");
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.requests.some(request => request.shape === "plan_options")).toBe(true));
  expect(screen.requests.filter(request => request.shape === "distribute")).toHaveLength(1);
  const plan = screen.requests.find(request => request.shape === "plan_options")!;
  expect(plan.input.instruments).toEqual(expect.arrayContaining(["Trumpet 1 1", "Trumpet 1 2"]));
});
