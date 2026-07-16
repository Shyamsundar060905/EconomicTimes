"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { LedgerEntry } from "@/lib/types";
import type { Metadata } from "next";

function ImpactBadge({ impact }: { impact: number }) {
  const improved = impact < 0;
  const color = improved ? "var(--accent-emerald)" : "#ef4444";
  const sign = improved ? "▼" : "▲";
  return (
    <span style={{
      padding: "2px 8px",
      borderRadius: "var(--radius-full)",
      background: improved ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
      color,
      border: `1px solid ${color}30`,
      fontFamily: "var(--font-mono)",
      fontSize: "0.75rem",
      fontWeight: 600,
    }}>
      {sign} {Math.abs(impact).toFixed(1)} µg/m³
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minHeight: 280, gap: "var(--space-md)",
        border: "1px dashed var(--border-default)",
        borderRadius: "var(--radius-md)",
        color: "var(--text-tertiary)",
        padding: "var(--space-2xl)",
        textAlign: "center",
      }}>
        <span style={{ fontSize: "2rem" }}>📋</span>
        <h3>No ledger entries yet</h3>
        <p style={{ maxWidth: 360, fontSize: "0.875rem" }}>
          The counterfactual ledger populates automatically as enforcement memos are actioned
          and 48–72h of realized AQI is collected. Run the enforcement pipeline to generate entries.
        </p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
            {["Memo ID", "Dispatched", "Actioned", "Response", "Counterfactual", "Realized", "Impact"].map((h) => (
              <th key={h} style={{
                padding: "8px 12px", textAlign: "left",
                fontSize: "0.7rem", fontWeight: 700,
                color: "var(--text-tertiary)",
                letterSpacing: "0.06em", textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.memo_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.memo_id}
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.8rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {formatDate(e.dispatched_at)}
              </td>
              <td style={{ padding: "10px 12px", fontSize: "0.8rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {formatDate(e.actioned_at)}
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.response_hours.toFixed(1)}h
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.counterfactual.toFixed(1)} µg/m³
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                {e.realized.toFixed(1)} µg/m³
              </td>
              <td style={{ padding: "10px 12px" }}>
                <ImpactBadge impact={e.impact} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Summary stats bar
function SummaryBar({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) return null;
  const improved = entries.filter((e) => e.impact < 0);
  const avgImpact = entries.reduce((s, e) => s + e.impact, 0) / entries.length;
  const avgResponse = entries.reduce((s, e) => s + e.response_hours, 0) / entries.length;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      gap: "var(--space-md)",
      marginBottom: "var(--space-xl)",
    }}>
      {[
        { label: "Total Interventions",   value: entries.length,                unit: "" },
        { label: "Effective (↓ AQI)",     value: improved.length,               unit: `/ ${entries.length}` },
        { label: "Avg Impact",            value: avgImpact.toFixed(1),          unit: "µg/m³" },
        { label: "Avg Response Time",     value: avgResponse.toFixed(1),        unit: "h" },
      ].map(({ label, value, unit }) => (
        <div key={label} className="card">
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginBottom: 4, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            {value}
            <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-tertiary)", marginLeft: 4 }}>{unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LedgerPage() {
  const { data: entries = [], isLoading } = useSWR<LedgerEntry[]>(
    "ledger",
    () => api.getLedger()
  );

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <h1 style={{ marginBottom: 8 }}>Intervention Ledger</h1>
        <p style={{ maxWidth: 680 }}>
          When a memo is actioned, the 72h forecast at dispatch time is frozen as the
          <strong> counterfactual</strong> — what AQI was expected without intervention.
          Realized minus counterfactual, accumulated over 48–72h, is the action&apos;s measured impact.
        </p>
      </div>

      <SummaryBar entries={entries} />

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6 }} />)}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <LedgerTable entries={entries} />
        </div>
      )}
    </div>
  );
}
