"use client";
import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { AgentName, AgentState, PipelineRunResult } from "@/lib/types";
import { AGENT_ORDER } from "@/lib/constants";

const idleAgents = (): AgentState[] =>
  AGENT_ORDER.map((name) => ({ name, status: "idle" }));

export function useAgentRun(onComplete?: () => void) {
  const [agents, setAgents] = useState<AgentState[]>(idleAgents());
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<PipelineRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markAgent = (name: AgentName, status: AgentState["status"], duration_ms?: number) =>
    setAgents((prev) =>
      prev.map((a) => (a.name === name ? { ...a, status, duration_ms } : a))
    );

  const runAgent = useCallback(async (agent: AgentName | "all") => {
    setRunning(true);
    setError(null);
    // Optimistically mark target agents as running
    const targets: AgentName[] = agent === "all" ? [...AGENT_ORDER] : [agent];
    setAgents(idleAgents().map((a) =>
      targets.includes(a.name) ? { ...a, status: "running" } : a
    ));

    try {
      const result = await api.runAgent(agent);
      setLastRun(result);
      // Update each agent status from result
      result.agents.forEach((a) => markAgent(a.name, a.status, a.duration_ms));
      onComplete?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent run failed";
      setError(msg);
      // Mark running agents as errored
      setAgents((prev) =>
        prev.map((a) => (targets.includes(a.name) && a.status === "running"
          ? { ...a, status: "error", error: msg }
          : a))
      );
    } finally {
      setRunning(false);
    }
  }, [onComplete]);

  const resetAgents = useCallback(() => {
    setAgents(idleAgents());
    setLastRun(null);
    setError(null);
  }, []);

  return { agents, running, lastRun, error, runAgent, resetAgents };
}
