import "./access-cards.css";

/** Plain explanations of coarse refusal reasons. Never echo private server details. */
export function failureMessage(reason: string): string {
  if (["budget", "empty", "session-ceiling", "pool-ceiling"].includes(reason)) return "There isn't enough available credit for another call. What is already written is still here.";
  if (["today", "daily", "daily-ceiling"].includes(reason)) return "Today's shared credit limit has been reached. What is already written is still here.";
  if (["quota", "visitor", "userlimit"].includes(reason)) return "This connection has reached today's allowance for this step. You can still use what is already written.";
  if (reason === "busy") return "The shared service is busy. Try again in a moment.";
  if (reason === "not-prepared") return "That choice isn't in this recording. You can keep using the recorded score or explore another.";
  if (["network", "unreachable", "http-502", "http-503"].includes(reason)) return "The connection failed. What is already written is still here.";
  if (reason === "timeout") return "That call didn't finish in time. What is already written is still here.";
  if (["disabled", "closed", "stopped", "rehearsal-stopped", "capture-stopped"].includes(reason)) return "New AI calls are unavailable. You can still use the score and export it.";
  if (["failed", "rejected", "malformed"].includes(reason)) return "I couldn't use that answer. What is already written is still here.";
  return "That step couldn't finish. What is already written is still here.";
}

export function FailureReason({ reason, onExplore }: { reason?: string | null; onExplore?: () => void }) {
  if (!reason) return null;
  return <div className="failure-reason" role="status"><p>{failureMessage(reason)}</p>{onExplore && <button type="button" className="door-link" onClick={onExplore}>Explore free recordings</button>}</div>;
}
