// The hosted server. Cloudflare serves the app's files; this Worker answers one route, POST
// /api/spark/<shape>, and makes every Spark call through the one global ledger. The Meta key is a
// Worker secret and never reaches the browser.
import { DurableObject } from "cloudflare:workers";
import { runCall, sha256, type LedgerPort } from "./call";
import { Answers, type CacheClaim, Ledger, type ReserveRequest, type Sql } from "./ledger";
import { OWN_KEY, POOLS, SLOTS } from "./pools";
import { SHAPES } from "./shapes";
import { MODEL } from "./spark";

interface Env {
  LEDGER: DurableObjectNamespace<LedgerObject>;
  META_API_KEY: string;
  /** "dev" only when the local server script sets it. */
  MODE: string;
  VISITOR_SALT?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The ledger and the answer cache, in one SQLite database. Every Worker talks to the same instance. */
export class LedgerObject extends DurableObject<Env> {
  private readonly ledger: Ledger;
  private readonly answers: Answers;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Nothing here stores blobs, so every value is a string, a number or null.
    const sql = ctx.storage.sql as unknown as Sql;
    this.ledger = new Ledger(sql, (fn) => ctx.storage.transactionSync(fn));
    this.answers = new Answers(sql);
    void ctx.blockConcurrencyWhile(async () => {
      this.ledger.setup(POOLS);
      this.answers.setup();
    });
  }

  reserve(r: ReserveRequest) {
    return this.ledger.reserve(r);
  }
  claimCached(r: CacheClaim) {
    return this.ledger.claimCached(r);
  }
  dispatch(attemptId: string) {
    return this.ledger.dispatch(attemptId);
  }
  settle(attemptId: string, chargedMicros: number, detail: string) {
    return this.ledger.settle(attemptId, chargedMicros, detail);
  }
  uncertain(attemptId: string, detail: string) {
    return this.ledger.uncertain(attemptId, detail);
  }
  cached(hash: string) {
    return this.answers.get(hash);
  }
  remember(hash: string, shape: string, body: string) {
    this.answers.put(hash, shape, body);
  }
  balance(pool: string) {
    return this.ledger.balance(pool);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const dev = env.MODE === "dev" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    const stub = env.LEDGER.get(env.LEDGER.idFromName("global"));

    if (dev && url.pathname === "/api/ledger" && request.method === "GET") {
      return Response.json(await stub.balance("dev"));
    }
    const route = /^\/api\/spark\/([a-z_]+)$/.exec(url.pathname);
    const shape = route ? SHAPES[route[1]!] : undefined;
    if (!shape || (shape.devOnly && !dev)) return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

    const text = await readBounded(request, MAX_BODY_BYTES);
    if (text === null) return new Response("Too large", { status: 413 });
    let body: { attemptId?: unknown; input?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (typeof body.attemptId !== "string" || !ATTEMPT_ID.test(body.attemptId)) {
      return new Response("Bad request", { status: 400 });
    }

    // A visitor's own key spends their own money, so it isn't counted against any pool of ours and isn't kept anywhere.
    const own = request.headers.get("x-motifold-key");
    if (own !== null && !OWN_KEY.test(own)) return new Response("That isn't a Meta key", { status: 400 });
    const pool = own ? "own" : dev ? "dev" : "public";
    const context = {
      attemptId: body.attemptId,
      pool,
      visitor: await visitorKey(request, env, dev),
      key: own ?? env.META_API_KEY,
      ledger: ledgerPort(stub),
      slots: SLOTS[pool] ?? 1,
    };
    // Each piece as it arrives, then the checked result. A browser that leaves doesn't stop the settlement.
    if (request.headers.get("x-motifold-stream")) {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const send = (message: unknown) => void writer.write(encoder.encode(`data: ${JSON.stringify(message)}\n\n`)).catch(() => {});
      ctx.waitUntil(
        runCall(shape, body.input, { ...context, onEvent: send }).then(
          (result) => send({ kind: "result", result: { ...result, version: shape.version, model: MODEL } }),
          () => send({ kind: "result", result: { status: "fallback", reason: "failed" } }),
        ).finally(() => writer.close().catch(() => {})),
      );
      return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    const work = runCall(shape, body.input, context);
    // Settlement finishes even if the browser goes away mid-call.
    ctx.waitUntil(work);
    return Response.json(await work);
  },
} satisfies ExportedHandler<Env>;

function ledgerPort(stub: DurableObjectStub<LedgerObject>): LedgerPort {
  return {
    reserve: (r) => stub.reserve(r),
    claimCached: (r) => stub.claimCached(r),
    dispatch: (id) => stub.dispatch(id),
    settle: (id, charged, detail) => stub.settle(id, charged, detail),
    uncertain: (id, detail) => stub.uncertain(id, detail),
    cached: (hash) => stub.cached(hash),
    remember: (hash, shape, body) => stub.remember(hash, shape, body),
  };
}


/** A salted hash of the caller's address: enough to hold a daily allowance, never the address itself. */
async function visitorKey(request: Request, env: Env, dev: boolean): Promise<string> {
  if (dev) return "local";
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await sha256(`${env.VISITOR_SALT ?? ""}:${address}`)).slice(0, 32);
}

async function readBounded(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
