"""Agent orchestrator — the LangGraph StateGraph over the six-agent chain.

WHAT THIS IS AND IS NOT
  It orchestrates the AGENT chain only:

      detection -> attribution -> forecast -> prioritisation -> memo
                -> advisory -> ledger

  Ingestion, the panel build and fusion/LOSO are deliberately OUTSIDE the graph.
  They are heavy batch data-engineering (LOSO retrains 12 LightGBM models), not
  agents, and they must never be reachable from a request handler — the agents
  read their precomputed artifacts. That split is what makes POST /run/agent
  safe to expose: the worst case is ~a minute of deterministic agent compute
  over data already on disk.

WHY A GRAPH AT ALL (it is a straight line)
  Three reasons, in honesty order:
  1. PER-NODE ERROR ISOLATION. Each node is wrapped so one failing agent records
     an error and the chain CONTINUES — a broken forecast must not take down the
     memo. run_pipeline.py used to be six bare calls where the first exception
     killed everything after it.
  2. ONE SOURCE OF TRUTH for chain order. The pipeline runner and the API both
     execute THIS graph, so the order cannot drift between them (we have already
     been bitten once by a patch that silently missed one of the two copies).
  3. The brief names "Multi-Agent AI Systems" and our architecture doc specifies
     a LangGraph StateGraph. Using the real library makes that claim true on the
     deck rather than decorative.

FALLBACK (principle 2): if langgraph is not importable, the same nodes run
sequentially with identical error isolation and an identical result schema.
The orchestration never fails because a dependency is missing.

The result schema matches the frontend's PipelineRunResult exactly
(useAgentRun.ts / AgentProgressStrip.tsx — built by Suyash against this shape):

    {"run_id", "started_at", "completed_at",
     "agents": [{"name", "status": "done"|"error", "duration_ms", "error"?}]}
"""
import time
import uuid
from datetime import datetime, timezone
from typing import TypedDict

# Frontend agent names (types.ts AgentName) -> the callable that runs the agent.
# Imports are inside the lambdas' bodies (resolved at call time) so importing this
# module never touches data/outputs — several agents read files at import-adjacent
# time on a cold checkout.
def _detection():
    from intelligence.agents.detect import detect
    detect()

def _attribution():
    from intelligence.agents.attribution import run
    run()

def _forecast():
    from intelligence.models.forecast import run
    run()

def _prioritisation():
    from intelligence.agents.prioritise import run
    run()

def _memo():
    from intelligence.agents.memo import run
    run()

def _advisory():
    from intelligence.agents.advisory import run
    run()

def _ledger():
    from intelligence.agents.ledger import run
    run()

# Order is THE definition of the chain. voice joins here when its branch merges.
AGENT_CHAIN: list[tuple[str, callable]] = [
    ("detection", _detection),
    ("attribution", _attribution),
    ("forecast", _forecast),
    ("prioritisation", _prioritisation),
    ("memo", _memo),
    ("advisory", _advisory),
    ("ledger", _ledger),
]
AGENT_NAMES = [n for n, _ in AGENT_CHAIN]


class AirQualityState(TypedDict):
    """Shared state threaded through the graph. Agents communicate through
    data/outputs artifacts (the existing contracts), so the graph state carries
    run bookkeeping, not payloads — payloads stay on disk where the API,
    frontend and evals already read them."""
    results: list[dict]


def _make_node(name: str, fn):
    """Wrap an agent so failure is RECORDED, not fatal. The chain continues:
    a broken forecast must not take down the memo (the memo does not read it)."""
    def node(state: AirQualityState) -> AirQualityState:
        t0 = time.perf_counter()
        entry = {"name": name, "status": "done",
                 "duration_ms": 0}
        try:
            fn()
        except Exception as e:                      # noqa: BLE001 — isolation is the point
            entry["status"] = "error"
            entry["error"] = f"{type(e).__name__}: {e}"
            print(f"[orchestrator] {name} FAILED ({entry['error']}) — chain continues")
        entry["duration_ms"] = int((time.perf_counter() - t0) * 1000)
        return {"results": state["results"] + [entry]}
    return node


def _build_langgraph(chain):
    from langgraph.graph import StateGraph, START, END
    g = StateGraph(AirQualityState)
    for name, fn in chain:
        g.add_node(name, _make_node(name, fn))
    g.add_edge(START, chain[0][0])
    for (a, _), (b, _) in zip(chain, chain[1:]):
        g.add_edge(a, b)
    g.add_edge(chain[-1][0], END)
    return g.compile()


def run_chain(only: str | None = None) -> dict:
    """Execute the agent chain (or one agent) and return the PipelineRunResult.

    `only` is a frontend AgentName; a single-agent run executes just that node
    against the artifacts already on disk (its upstream inputs are batch outputs,
    so this is exactly the "re-run one stage" workflow).
    """
    if only and only != "all":
        if only not in AGENT_NAMES:
            raise ValueError(f"unknown agent {only!r}; choose from {AGENT_NAMES} or 'all'")
        chain = [(n, f) for n, f in AGENT_CHAIN if n == only]
    else:
        chain = AGENT_CHAIN

    started = datetime.now(timezone.utc)
    state: AirQualityState = {"results": []}
    try:
        app = _build_langgraph(chain)
        state = app.invoke(state)
        engine = "langgraph"
    except ImportError:
        # principle 2: same nodes, same isolation, same schema — no dependency may
        # silently kill a feature.
        for name, fn in chain:
            state = _make_node(name, fn)(state)
        engine = "sequential-fallback"

    result = {
        "run_id": uuid.uuid4().hex[:12],
        "started_at": started.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "engine": engine,
        "agents": state["results"],
    }
    ok = sum(1 for a in result["agents"] if a["status"] == "done")
    print(f"[orchestrator] {engine}: {ok}/{len(result['agents'])} agents done "
          f"({', '.join(a['name'] for a in result['agents'] if a['status'] == 'error') or 'no errors'})")
    return result


if __name__ == "__main__":
    import json
    print(json.dumps(run_chain(), indent=2))
