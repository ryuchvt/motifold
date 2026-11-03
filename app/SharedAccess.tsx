import { useCallback, useEffect, useRef, useState } from "react";
import "./access-cards.css";

export type SharedAccessState = "available" | "busy" | "daily" | "userlimit" | "totalunavailable" | "serviceerror";
export interface SharedAccessStatus { state: SharedAccessState; resetAt: number | null }
const states: SharedAccessState[] = ["available", "busy", "daily", "userlimit", "totalunavailable", "serviceerror"];
const unavailable: SharedAccessStatus = { state: "serviceerror", resetAt: null };
const messages: Record<SharedAccessState, string> = {
  available: "Shared credit is available for a new call.",
  busy: "Shared credit is busy. Try again in a moment.",
  daily: "Shared credit has reached today's limit.",
  userlimit: "This connection has reached today's limit for starting a piece.",
  totalunavailable: "Shared credit is unavailable. The free recordings are still here.",
  serviceerror: "I couldn't check shared credit just now.",
};
function checked(value: unknown): SharedAccessStatus {
  if (!value || typeof value !== "object") return unavailable;
  const { state, resetAt } = value as Record<string, unknown>;
  if (!states.includes(state as SharedAccessState) || !(resetAt === null || typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt >= 0 && resetAt <= 8.64e15)) return unavailable;
  return { state: state as SharedAccessState, resetAt: resetAt as number | null };
}

/** A shared-credit door. Checking it never starts a model call or sends an own key. */
export function SharedAccess({ onEnter, onExplore, disabled = false }: { onEnter: () => void; onExplore: () => void; disabled?: boolean }) {
  const [access, setAccess] = useState<SharedAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false), revision = useRef(0), pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<SharedAccessStatus | null> => {
    if (disabled || !mounted.current) return null;
    const turn = ++revision.current;
    pending.current?.abort();
    const abort = new AbortController(); pending.current = abort;
    setLoading(true);
    let next = unavailable;
    try {
      const response = await fetch("/api/access", { method: "GET", cache: "no-store", signal: abort.signal });
      next = response.ok ? checked(await response.json()) : unavailable;
    } catch { /* A failed check leaves the free recordings available. */ }
    if (!mounted.current || revision.current !== turn || abort.signal.aborted) return null;
    pending.current = null;
    setAccess(next); setLoading(false);
    return next;
  }, [disabled]);
  useEffect(() => {
    mounted.current = true;
    if (disabled) { setAccess(null); setLoading(false); }
    else void refresh();
    return () => { mounted.current = false; revision.current++; pending.current?.abort(); pending.current = null; };
  }, [disabled, refresh]);
  const enter = async () => { const latest = await refresh(); if (latest?.state === "available") onEnter(); };
  const resetAt = access?.resetAt;
  return <div className="door-card shared-access">
    <strong>Try shared credit</strong>
    <span>Use my shared credit for your own sketch while it is available.</span>
    <p className="shared-access-status" role="status" aria-live="polite">
      {disabled ? "Shared credit is not used in this sample." : loading ? "Checking shared credit…" : access ? messages[access.state] : "Checking shared credit…"}
    </p>
    {!disabled && resetAt != null && <p className="shared-access-reset">Check again after <time dateTime={new Date(resetAt).toISOString()}>{new Date(resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>.</p>}
    <div className="shared-access-actions">
      <button type="button" className="button primary" disabled={disabled || loading || access?.state !== "available"} onClick={() => void enter()}>{loading ? "Checking…" : "Open my piece"}</button>
      <button type="button" className="door-link" disabled={disabled || loading} onClick={() => void refresh()}>Refresh</button>
    </div>
    <button type="button" className="door-link shared-access-explore" onClick={onExplore}>Explore free recordings</button>
  </div>;
}
