"use client";
import type { AgentState, AgentName } from "@/lib/types";
import { AGENT_LABELS, AGENT_DESCRIPTIONS, AGENT_ORDER } from "@/lib/constants";

interface Props {
  agents: AgentState[];
  running: boolean;
  onRun: (agent: AgentName | "all") => void;
  onReset: () => void;
}

export default function AgentControlBar({ agents, running, onRun, onReset }: Props) {
  const anyDone = agents.some((a) => a.status === "done" || a.status === "error");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "8px var(--space-md)",
        flexWrap: "wrap",
      }}
    >
      {/* Run All */}
      <button
        className="btn btn-primary btn-sm"
        onClick={() => onRun("all")}
        disabled={running}
        title="Run all 6 agents sequentially"
      >
        {running ? (
          <span className="animate-spin" style={{ display: "inline-block" }}>⬡</span>
        ) : "▶"}
        Run Full Pipeline
      </button>

      <div
        style={{
          width: 1, height: 20,
          background: "var(--border-default)",
          margin: "0 4px",
        }}
      />

      {/* Individual agents */}
      {AGENT_ORDER.map((name) => {
        const agentState = agents.find((a) => a.name === name);
        const status = agentState?.status ?? "idle";
        const isRunning = status === "running";
        const isDone = status === "done";
        const isError = status === "error";

        return (
          <button
            key={name}
            className="btn btn-ghost btn-sm"
            onClick={() => onRun(name)}
            disabled={running}
            title={AGENT_DESCRIPTIONS[name]}
            style={{
              borderColor: isDone
                ? "rgba(16,185,129,0.4)"
                : isError
                ? "rgba(239,68,68,0.4)"
                : isRunning
                ? "rgba(59,130,246,0.5)"
                : undefined,
              color: isDone
                ? "var(--accent-emerald)"
                : isError
                ? "var(--accent-red)"
                : isRunning
                ? "var(--accent-blue)"
                : undefined,
            }}
          >
            {isRunning && <span className="animate-spin" style={{ display: "inline-block", fontSize: "0.8rem" }}>⬡</span>}
            {isDone && <span style={{ fontSize: "0.8rem" }}>✓</span>}
            {isError && <span style={{ fontSize: "0.8rem" }}>✗</span>}
            {!isRunning && !isDone && !isError && <span style={{ fontSize: "0.8rem" }}>○</span>}
            {AGENT_LABELS[name]}
          </button>
        );
      })}

      {anyDone && (
        <>
          <div style={{ width: 1, height: 20, background: "var(--border-default)", margin: "0 4px" }} />
          <button className="btn btn-ghost btn-sm" onClick={onReset}>
            Reset
          </button>
        </>
      )}
    </div>
  );
}
