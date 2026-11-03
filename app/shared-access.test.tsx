// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SharedAccess, type SharedAccessState } from "./SharedAccess";
import { FailureReason } from "./failureReason";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });
const status = (state: SharedAccessState, resetAt: number | null = null) => Response.json({ state, resetAt, capMicros: 100_000_000, visitor: "private-identity" });
async function mount(element: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(element)); return host;
}
const button = (host: Element, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;

it("rechecks availability before entering and never dispatches a model request or sends a key", async () => {
  const fetcher = vi.fn(async () => status("available")), enter = vi.fn(), explore = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const host = await mount(<SharedAccess onEnter={enter} onExplore={explore}/>);
  expect(host.querySelector(".door-card.shared-access strong")?.textContent).toBe("Try shared credit");
  expect(host.querySelector(".door-n")).toBeNull();
  fetcher.mockImplementationOnce(async () => status("busy"));
  await act(async () => button(host, "Open my piece").click());
  expect(enter).not.toHaveBeenCalled(); expect(host.textContent).toContain("busy");
  expect(button(host, "Open my piece").disabled).toBe(true);
  await act(async () => button(host, "Explore free recordings").click()); expect(explore).toHaveBeenCalledOnce();
  await act(async () => button(host, "Refresh").click());
  await act(async () => button(host, "Open my piece").click()); expect(enter).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(4);
  for (const args of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(args[0]).toBe("/api/access"); expect(args[1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(args[1].signal).toBeInstanceOf(AbortSignal); expect(args[1].headers).toBeUndefined(); expect(args[1].body).toBeUndefined();
  }
  expect(host.textContent).not.toContain("private-identity"); expect(host.textContent).not.toContain("100000000"); expect(host.textContent).not.toContain("%");
});

it.each(["busy", "daily", "userlimit", "totalunavailable", "serviceerror"] as SharedAccessState[])("keeps free recordings reachable when shared access is %s", async state => {
  const reset = state === "daily" || state === "userlimit" ? Date.UTC(2026, 10, 5) : null;
  vi.stubGlobal("fetch", vi.fn(async () => status(state, reset)));
  const explore = vi.fn(), enter = vi.fn();
  const host = await mount(<SharedAccess onEnter={enter} onExplore={explore}/>);
  expect(button(host, "Open my piece").disabled).toBe(true);
  expect(button(host, "Refresh").disabled).toBe(false);
  if (state === "userlimit") expect(host.textContent).toContain("This connection has reached");
  if (reset) expect(host.querySelector("time")?.dateTime).toBe(new Date(reset).toISOString());
  await act(async () => button(host, "Explore free recordings").click());
  expect(explore).toHaveBeenCalledOnce(); expect(enter).not.toHaveBeenCalled();
});

it("makes no access request in the disabled sample mode", async () => {
  const fetcher = vi.fn(() => { throw Error("No network in sample mode"); }); vi.stubGlobal("fetch", fetcher);
  const explore = vi.fn(), enter = vi.fn();
  const host = await mount(<SharedAccess disabled onEnter={enter} onExplore={explore}/>);
  expect(fetcher).not.toHaveBeenCalled(); expect(button(host, "Open my piece").disabled).toBe(true);
  await act(async () => button(host, "Explore free recordings").click()); expect(explore).toHaveBeenCalledOnce();
});

it("aborts a pending entry check on unmount and ignores a late available response", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(async () => status("available")); vi.stubGlobal("fetch", fetcher);
  const enter = vi.fn(), host = await mount(<SharedAccess onEnter={enter} onExplore={() => {}}/>);
  fetcher.mockImplementationOnce(() => new Promise<Response>(done => { finish = done; }));
  await act(async () => button(host, "Open my piece").click());
  const signal = (fetcher.mock.calls as unknown as [string, RequestInit][])[1]![1].signal!;
  act(() => root!.unmount()); root = null;
  expect(signal.aborted).toBe(true);
  await act(async () => finish(status("available")));
  expect(enter).not.toHaveBeenCalled(); expect(host.textContent).toBe("");
});

it("shows a coarse service error for malformed replies without echoing private details", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ state: "available", resetAt: "private secret details" })));
  const host = await mount(<SharedAccess onEnter={() => {}} onExplore={() => {}}/>);
  expect(host.textContent).toContain("couldn't check shared credit");
  expect(host.textContent).not.toContain("private secret"); expect(button(host, "Open my piece").disabled).toBe(true);
});

it("explains stage refusals without making calls or echoing unknown server details, and clears with the reason", async () => {
  const fetcher = vi.fn(() => { throw Error("A message must not make a request"); }); vi.stubGlobal("fetch", fetcher);
  const explore = vi.fn(); const host = await mount(<FailureReason reason="quota" onExplore={explore}/>);
  expect(host.textContent).toContain("today's allowance for this step");
  expect(host.textContent).toContain("This connection has reached");
  await act(async () => button(host, "Explore free recordings").click()); expect(explore).toHaveBeenCalledOnce();
  await act(async () => root!.render(<FailureReason reason="Bearer private-token"/>));
  expect(host.textContent).toContain("What is already written is still here"); expect(host.textContent).not.toContain("private-token");
  await act(async () => root!.render(<FailureReason reason={null}/>)); expect(host.textContent).toBe("");
  expect(fetcher).not.toHaveBeenCalled();
});
