"use client";
/**
 * AgentPipelinePanel — the 9-agent LangGraph pipeline as a proper vertical flow,
 * in a slide-in drawer. This is where the "it's genuinely agentic" story is told:
 * each agent is a row with an icon, name, one-line description and live status,
 * connected top-to-bottom as a pipeline. Kept OUT of the map so neither clutters
 * the other.
 *
 * "Run Full Pipeline" triggers the batch chain via the backend (POST /run/agent),
 * streaming per-agent status. With no backend (static deploy) the drawer is still
 * the architecture explainer — the flow, in order, with what each agent does.
 */
import type { AgentState, AgentName } from "@/lib/types";
import { AGENT_LABELS, AGENT_DESCRIPTIONS, AGENT_ORDER } from "@/lib/constants";

const AGENT_ICON: Record<AgentName, string> = {
  detection:      "🛰️",
  attribution:    "🔍",
  forecast:       "📈",
  prioritisation: "🎯",
  memo:           "📄",
  advisory:       "📢",
  voice:          "🔊",
  ledger:         "📒",
  audit:          "🩺",
};

const STATUS = {
  idle:    { color: "var(--border-strong)", ring: "var(--border-strong)", label: "" },
  running: { color: "var(--accent-blue)",   ring: "var(--accent-blue)",   label: "running" },
  done:    { color: "var(--accent-emerald)",ring: "var(--accent-emerald)",label: "done" },
  error:   { color: "var(--accent-red)",    ring: "var(--accent-red)",    label: "failed" },
} as const;

export default function AgentPipelinePanel({
  open, onClose, agents, running, onRun, onReset,
}: {
  open: boolean;
  onClose: () => void;
  agents: AgentState[];
  running: boolean;
  onRun: (agent: AgentName | "all") => void;
  onReset: () => void;
}) {
  const stateOf = (n: AgentName) => agents.find((a) => a.name === n)?.status ?? "idle";
  const durOf = (n: AgentName) => agents.find((a) => a.name === n)?.duration_ms;
  const doneCount = agents.filter((a) => a.status === "done").length;
  const anyDone = agents.some((a) => a.status === "done" || a.status === "error");

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: "var(--z-modal)",
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity var(--transition-normal)",
        }}
      />
      {/* Drawer */}
      <aside
        className="glass"
        style={{
          position: "fixed", top: 0, bottom: 0, right: 0,
          width: "min(400px, 90vw)", zIndex: "calc(var(--z-modal) + 1)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform var(--transition-slow)",
          borderLeft: "1px solid var(--border-default)",
          display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "var(--space-lg)", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ margin: 0 }}>Agent Pipeline</h3>
              <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                9 agents · LangGraph · detect → dispatch
              </div>
            </div>
            <button onClick={onClose} className="btn btn-ghost btn-icon" title="Close">✕</button>
          </div>

          <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onRun("all")}
              disabled={running}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {running
                ? <><span className="animate-spin" style={{ display: "inline-block" }}>⬡</span> Running {doneCount}/{AGENT_ORDER.length}</>
                : <>▶ Run Full Pipeline</>}
            </button>
            {anyDone && !running && (
              <button className="btn btn-ghost btn-sm" onClick={onReset}>Reset</button>
            )}
          </div>
        </div>

        {/* The flow */}
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-md) var(--space-lg)" }}>
          {AGENT_ORDER.map((name, i) => {
            const st = stateOf(name);
            const s = STATUS[st];
            const dur = durOf(name);
            const last = i === AGENT_ORDER.length - 1;
            return (
              <div key={name} style={{ display: "flex", gap: "var(--space-md)" }}>
                {/* Rail: node + connector */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: "50%",
                      border: `2px solid ${s.ring}`,
                      background: st === "idle" ? "transparent" : `${s.color}1f`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "1rem",
                      animation: st === "running" ? "pulse 1.3s ease-in-out infinite" : undefined,
                      transition: "all 0.3s",
                    }}
                  >
                    {AGENT_ICON[name]}
                  </div>
                  {!last && (
                    <div style={{
                      width: 2, flex: 1, minHeight: 22, marginTop: 2, marginBottom: 2,
                      background: st === "done" ? "var(--accent-emerald)" : "var(--border-subtle)",
                      transition: "background 0.3s",
                    }} />
                  )}
                </div>

                {/* Content — tappable to run just this agent */}
                <button
                  onClick={() => onRun(name)}
                  disabled={running}
                  style={{
                    flex: 1, textAlign: "left", background: "transparent", border: "none",
                    cursor: running ? "default" : "pointer", padding: "2px 0 var(--space-md)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>
                      {AGENT_LABELS[name]}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: s.color, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {st === "done" && dur ? `✓ ${(dur / 1000).toFixed(1)}s` : s.label}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.76rem", color: "var(--text-tertiary)", lineHeight: 1.45, marginTop: 2 }}>
                    {AGENT_DESCRIPTIONS[name]}
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: "var(--space-md) var(--space-lg)", borderTop: "1px solid var(--border-subtle)",
          fontSize: "0.7rem", color: "var(--text-tertiary)", lineHeight: 1.5,
        }}>
          Deterministic agents rank; LLMs only explain. Heavy compute runs in batch —
          the map reads the precomputed result.
        </div>
      </aside>
    </>
  );
}
