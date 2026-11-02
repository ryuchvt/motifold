// @vitest-environment jsdom
// The bars screen with no model call: a second read that fails leaves the composer the bars they had.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FreeBars } from "./FreeBars";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bytes = new Uint8Array(readFileSync("test-fixtures/sad-theme.mid"));
const saved = JSON.parse(readFileSync("test-fixtures/sad-theme-bars.json", "utf8"));
let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("keeps the bars it found when reading them again fails", async () => {
  let answers = 0;
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(answers++ === 0 ? { status: "ok", answer: saved.answer } : { status: "fallback", reason: "empty" })));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  unmount = () => root.unmount();
  act(() => root.render(<FreeBars fileName="theme.mid" bytes={bytes} title="Theme" savedFile={null} onUse={() => {}} onKeep={() => {}} />));
  const press = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!.click();
  const settled = () => vi.waitFor(() => expect(host.querySelector(".free-found")).not.toBeNull(), { timeout: 30_000 });
  await act(async () => press("Find the bars"));
  await settled();
  expect(host.querySelector(".free-found")!.textContent).toContain("3/4, 24 bars");
  const box = host.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "I hear two.");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => press("Read it again"));
  await settled();
  expect(host.querySelector(".free-found")!.textContent).toContain("3/4, 24 bars");
  expect(host.textContent).toContain("couldn't read it again");
}, 60_000);
