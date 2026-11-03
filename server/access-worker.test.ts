import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("./call", async original => ({ ...(await original<typeof import("./call")>()), runCall: vi.fn() }));
const workerPath = "./worker";
const worker = (await import(workerPath)).default as { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
import { runCall } from "./call";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const ctx = { waitUntil: vi.fn() };
const request = (suffix = "", headers = {}) => new Request(`https://local-review.invalid/api/access${suffix}`, { headers: { "cf-connecting-ip": "192.0.2.12", ...headers } });
function setup() {
  const access = vi.fn(async (_request: unknown) => ({ state: "busy", resetAt: null, visitor: "private-hash", capMicros: 100_000_000, key: "not-for-the-browser" }));
  const env = { MODE: "hosted", META_API_KEY: "owner-local-fake", VISITOR_SALT: "local-salt", LEDGER: { idFromName: () => "global", get: () => ({ access }) } };
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No network request is allowed"); }));
  return { access, env };
}

it("returns only coarse shared-credit status without Meta calls, key data or ledger details", async () => {
  const x = setup();
  const response = await worker.fetch(request("", { "x-motifold-key": "visitor-local-fake" }), x.env, ctx);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ state: "busy", resetAt: null });
  expect(x.access).toHaveBeenCalledOnce();
  const r = x.access.mock.calls[0]![0] as Record<string, unknown>;
  expect(r).toMatchObject({ pool: "public", shape: "read_piece", slots: 3 });
  expect(r.visitor).toMatch(/^[a-f0-9]{32}$/);
  expect(JSON.stringify(r)).not.toContain("192.0.2.12");
  expect(JSON.stringify(r)).not.toContain("visitor-local-fake");
  expect(fetch).not.toHaveBeenCalled(); expect(runCall).not.toHaveBeenCalled(); expect(ctx.waitUntil).not.toHaveBeenCalled();
});

it("supports a stage quota check but never selects the dev pool on a hosted hostname", async () => {
  const x = setup();
  await worker.fetch(request("?shape=arrange"), { ...x.env, MODE: "dev" }, ctx);
  expect(x.access.mock.calls[0]![0]).toMatchObject({ pool: "public", shape: "arrange", reserveMicros: 1_480_720 });
  await worker.fetch(new Request("http://127.0.0.1/api/access"), { ...x.env, MODE: "dev" }, ctx);
  expect(x.access.mock.calls[1]![0]).toMatchObject({ pool: "dev", visitor: "local" });
});

it("fails closed on missing service configuration, unavailable ledger, invalid shape or method", async () => {
  const x = setup();
  for (const suffix of ["?shape=unknown", "?shape=constructor", "?shape=ping"]) {
    expect(await (await worker.fetch(request(suffix), x.env, ctx)).json()).toEqual({ state: "serviceerror", resetAt: null });
  }
  expect(await (await worker.fetch(request(), { ...x.env, META_API_KEY: "" }, ctx)).json()).toEqual({ state: "serviceerror", resetAt: null });
  expect(await (await worker.fetch(request(), { ...x.env, LEDGER: { idFromName() { throw Error("private error"); } } }, ctx)).json()).toEqual({ state: "serviceerror", resetAt: null });
  const response = await worker.fetch(new Request(request(), { method: "POST" }), x.env, ctx);
  expect(response.status).toBe(405); expect(response.headers.get("Allow")).toBe("GET");
  expect(x.access).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(runCall).not.toHaveBeenCalled();
});
