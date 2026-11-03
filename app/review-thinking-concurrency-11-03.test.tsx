// @vitest-environment jsdom
// A concurrent optional study must keep its own live progress after reading finishes.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { Thinking, resetMuseActivity } from "./Thinking";
import { askSpark, setTransport, type SparkReply } from "./spark";

let root: Root | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom lacks the native scrolling method used by the live progress list.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => {} });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  setTransport(null);
  document.body.replaceChildren();
});
const reply: SparkReply = { status: "ok", answer: {}, cached: false };
async function setup() {
  resetMuseActivity();
  const finish = new Map<string, (reply: SparkReply) => void>();
  setTransport(shape => new Promise(resolve => finish.set(shape, resolve)));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Thinking />));
  return { host, finish };
}

it("the visible reading dock shows progress and clears its active status on completion", async () => {
  const { host, finish } = await setup();
  let work!: Promise<SparkReply>;
  await act(async () => { work = askSpark("read_piece", {}); });
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => { finish.get("read_piece")!(reply); await work; });
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("keeps dock progress visible for an unfinished study when the parallel reading completes", async () => {
  const { host, finish } = await setup();
  let study!: Promise<SparkReply>;
  let reading!: Promise<SparkReply>;
  await act(async () => {
    study = askSpark("study_score", {});
    reading = askSpark("read_piece", {});
  });
  await act(async () => { finish.get("read_piece")!(reply); await reading; });
  try {
    expect(host.querySelector('[role="status"]'), "the study is still running and streaming, so all live progress must not disappear").not.toBeNull();
  } finally {
    await act(async () => { finish.get("study_score")!(reply); await study; });
  }
});
