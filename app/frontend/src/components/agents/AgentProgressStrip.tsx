"use client";
import type { AgentState } from "@/lib/types";
import { AGENT_LABELS, AGENT_ORDER } from "@/lib/constants";

interface Props {
  agents: AgentState[];
}

const STATUS_COLORS = {
  idle:    "var(--border-strong)",
  running: "var(--accent-blue)",
  done:    "var(--accent-emerald)",
  error:   "var(--accent-red)",
};

const STATUS_ICONS = {
  idle:    "○",
  running: "●",
  done:    "✓",
  error:   "✗",
};

export default function AgentProgressStrip({ agents }: Props) {
  const anyActive = agents.some((a) => a.status !== "idle");
  if (!anyActive) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0 var(--space-md)",
        height: 28,
        borderTop: "1px solid var(--border-subtle)",
        overflowX: "auto",
      }}
    >
      {AGENT_ORDER.map((name, i) => {
        const agent = agents.find((a) => a.name === name);
        const status = agent?.status ?? "idle";
        const color = STATUS_COLORS[status];
        const isRunning = status === "running";
        const isDone = status === "done";

        return (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              flexShrink: 0,
            }}
          >
            {/* Connector line */}
            {i > 0 && (
              <div
                style={{
                  width: 24, height: 1,
                  background: isDone || status === "running"
                    ? "var(--accent-blue)"
                    : "var(--border-subtle)",
                  transition: "background 0.3s",
                }}
              />
            )}

            {/* Agent dot + label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "0 8px",
              }}
            >
              <span
                style={{
                  fontSize: "0.65rem",
                  color,
                  animation: isRunning ? "spin 1s linear infinite" : undefined,
                  display: "inline-block",
                  transition: "color 0.3s",
                }}
              >
                {STATUS_ICONS[status]}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  color: status === "idle" ? "var(--text-tertiary)" : "var(--text-primary)",
                  fontWeight: status !== "idle" ? 500 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {AGENT_LABELS[name]}
              </span>
              {agent?.duration_ms && (
                <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  {(agent.duration_ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
