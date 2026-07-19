"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Ledger, LedgerEntry } from "@/lib/types";

/**
 * Intervention Ledger.
 *
 * IMPORTANT — this page mirrors a deliberate honesty split in the backend
 * (intelligence/agents/ledger.py). It reports TWO different things and must never
 * blur them:
 *   1. RESPONSE TIME — real and measured (signal -> memo is automated, seconds vs
 *      the documented weeks of manual cross-agency correlation).
 *   2. EFFECTIVENESS — NOT measured. We never actually intervened, so "realized minus
 *      counterfactual" would credit us for pollution that changed on its own. The
 *      ledger freezes the counterfactual and leaves impact null until a real
 *      intervention (a real actioned_at from the inspector loop) sits between the
 *      frozen forecast and a later outcome.
 * An earlier version of this page rendered a green/red "impact µg/m³" badge and an
 * "Effective (down AQI)" tally — a number the backend explicitly refuses to produce.
 * Do not bring it back.
 */

function StatusPill({ status }: { status: LedgerEntry["status"] }) {
  const map: Record<string, { label: string; color: string }> = {
    actioned: { label: "Actioned", color: "var(--accent-emerald)" },
    dispatched: { label: "Dispatched", color: "var(--accent-amber, #f59e0b)" },
    awaiting_outcome: { label: "Awaiting outcome", color: "var(--text-tertiary)" },
  };
  const { label, color } = map[status] ?? map.awaiting_outcome;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: "var(--radius-full)",
      background: `${color}1f`, color, border: `1px solid ${color}40`,
      fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function ClaimCard({ title, tone, children }: {
  title: string; tone: "real" | "pending"; children: React.ReactNode;
}) {
  const color = tone === "real" ? "var(--accent-emerald)" : "var(--accent-amber, #f59e0b)";
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}` }}>
      <div style={{
        fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em",
        textTransform: "uppercase", color, marginBottom: 6,
      }}>
        {title} {tone === "real" ? "· measured" : "· not yet measured"}
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

function shortTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—"
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: 240, gap: "var(--space-md)",
        border: "1px dashed var(--border-default)", borderRadius: "var(--radius-md)",
        color: "var(--text-tertiary)", padding: "var(--space-2xl)", textAlign: "center",
      }}>
        <span style={{ fontSize: "2rem" }}>📋</span>
        <h3>No actions tracked yet</h3>
        <p style={{ maxWidth: 380, fontSize: "0.875rem" }}>
          Run the pipeline to generate an enforcement queue. Each action is logged here
          with its response chain and a frozen counterfactual.
        </p>
      </div>
    );
  }
  const cols = ["Action", "Ward", "Source", "Signal", "Memo drafted",
                "Counterfactual (+48h)", "Response", "Status"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
            {cols.map((h) => (
              <th key={h} style={{
                padding: "8px 12px", textAlign: "left", fontSize: "0.7rem",
                fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em",
                textTransform: "uppercase", whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.action_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.action_id} · {e.zone_id}
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.8rem" }}>{e.ward_name ?? e.ward_id}</td>
              <td style={{ padding: "10px 12px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {e.source ?? "—"}
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.78rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {shortTime(e.response?.signal_at)}
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.78rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {shortTime(e.response?.memo_drafted_at)}
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.counterfactual
                  ? `AQI ${e.counterfactual.aqi_counterfactual} (${e.counterfactual.band_counterfactual})`
                  : "—"}
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.response?.response_hours != null ? `${e.response.response_hours.toFixed(1)}h` : "auto"}
              </td>
              <td style={{ padding: "10px 12px" }}><StatusPill status={e.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LedgerPage() {
  const { data, isLoading } = useSWR<Ledger | null>("ledger", () => api.getLedger());
  const entries = data?.entries ?? [];
  const actioned = entries.filter((e) => e.status === "actioned").length;

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <h1 style={{ marginBottom: 8 }}>Intervention Ledger</h1>
        <p style={{ maxWidth: 720 }}>
          The ledger reports two things, and keeps them apart on purpose:
          <strong> how fast</strong> a signal becomes a cited, dispatchable memo, and
          <strong> whether the intervention worked</strong>. The first is measured today;
          the second is a mechanism that accrues evidence as real interventions occur.
        </p>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: "var(--space-md)", marginBottom: "var(--space-xl)",
      }}>
        <ClaimCard title="Response time" tone="real">
          Signal → attribution → cited memo → dispatch route is a single automated batch.
          The manual baseline — correlating a satellite signal to a served notice across
          agencies — is documented in <strong>weeks</strong> (CAG, 2024). That is the
          reduction: weeks → one automated run, no human correlation step.
        </ClaimCard>
        <ClaimCard title="Effectiveness" tone="pending">
          Intervention effectiveness requires a real intervention between the frozen
          counterfactual and a realized outcome. Nobody has acted on these yet, so we do
          not claim an impact number — attributing natural change to ourselves would be
          dishonest. {actioned}/{entries.length} actions actioned so far.
        </ClaimCard>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6 }} />)}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <LedgerTable entries={entries} />
        </div>
      )}
    </div>
  );
}
