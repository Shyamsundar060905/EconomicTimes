"use client";
/**
 * Repeat Offender Registry — entities attributed repeatedly are escalated:
 * advisory → memo → chronic-offender flag.
 *
 * Data: derived client-side from attributions.json by clustering on primary_source
 * + ward. The backend registry endpoint (/registry) is not yet built.
 * Falls back to showing what we can compute from attribution data.
 */
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Attribution } from "@/lib/types";
import { SOURCE_LABELS } from "@/lib/constants";
import { SOURCE_COLORS } from "@/lib/colors";

// Cluster attribution rows by (ward_id + primary_source) as a stand-in for
// a proper entity registry (which needs the repeat-offender agent to be built).
interface OffenderCluster {
  key: string;
  ward_id: string;
  source: string;
  count: number;
  max_confidence: number;
  tier: "advisory" | "memo" | "chronic";
  last_seen: string;
}

function buildClusters(attributions: Attribution[]): OffenderCluster[] {
  const map = new Map<string, OffenderCluster>();
  for (const a of attributions) {
    const key = `${a.ward_id}__${a.primary_source}`;
    const ex = map.get(key);
    if (!ex) {
      map.set(key, {
        key, ward_id: a.ward_id,
        source: a.primary_source,
        count: 1,
        max_confidence: a.confidence,
        tier: "advisory",
        last_seen: a.ts,
      });
    } else {
      ex.count += 1;
      if (a.confidence > ex.max_confidence) ex.max_confidence = a.confidence;
      if (a.ts > ex.last_seen) ex.last_seen = a.ts;
      ex.tier = ex.count >= 5 ? "chronic" : ex.count >= 3 ? "memo" : "advisory";
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

const TIER_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  advisory: { label: "Advisory",        color: "#3b82f6", icon: "📋" },
  memo:     { label: "Enforcement Memo", color: "#f59e0b", icon: "⚠️" },
  chronic:  { label: "Chronic Offender", color: "#ef4444", icon: "🚨" },
};

function OffenderCard({ cluster }: { cluster: OffenderCluster }) {
  const tier = TIER_CONFIG[cluster.tier];
  const sourceColor = (SOURCE_COLORS as Record<string, string>)[cluster.source] ?? "#888";
  return (
    <div className="card" style={{
      display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: "var(--space-md)",
      borderLeft: `3px solid ${tier.color}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: "1rem" }}>{tier.icon}</span>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {SOURCE_LABELS[cluster.source as keyof typeof SOURCE_LABELS] ?? cluster.source}
          </span>
          <span style={{
            padding: "1px 8px", borderRadius: "var(--radius-full)",
            background: `${tier.color}18`, color: tier.color,
            border: `1px solid ${tier.color}30`,
            fontSize: "0.7rem", fontWeight: 700,
          }}>
            {tier.label}
          </span>
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 2 }}>
          Ward {cluster.ward_id}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          Last attributed: {new Date(cluster.last_seen).toLocaleDateString("en-IN")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: "1.6rem", fontWeight: 700,
          color: cluster.count >= 5 ? "#ef4444" : cluster.count >= 3 ? "#f59e0b" : "var(--text-secondary)",
          lineHeight: 1,
        }}>
          {cluster.count}
        </div>
        <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>attributions</div>
        <div style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          conf: {cluster.max_confidence.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

export default function RegistryPage() {
  const { data: attributions, isLoading } = useSWR<Attribution[]>(
    "attributions",
    () => api.getAttributions()
  );

  const clusters = attributions ? buildClusters(attributions) : [];
  const chronic = clusters.filter((c) => c.tier === "chronic");
  const memoTier = clusters.filter((c) => c.tier === "memo");
  const advisory = clusters.filter((c) => c.tier === "advisory");

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <h1 style={{ marginBottom: 8 }}>Repeat Offender Registry</h1>
        <p style={{ maxWidth: 640 }}>
          Entities attributed repeatedly are escalated through tiers.
          An accumulated case file — every past attribution + evidence chain — is ready for closure proceedings.
        </p>
        <div className="card" style={{
          marginTop: "var(--space-md)", padding: "10px 14px",
          background: "rgba(245,158,11,0.06)",
          borderColor: "rgba(245,158,11,0.2)",
          fontSize: "0.8rem", color: "var(--text-secondary)",
        }}>
          ⚠ Currently derived client-side from attribution history.
          The backend repeat-offender agent (clustering by source location across weeks) is not yet built.
          Attribution count ≥3 = memo tier; ≥5 = chronic offender flag.
        </div>
      </div>

      {/* Escalation legend */}
      <div style={{
        display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-xl)", flexWrap: "wrap",
      }}>
        {Object.entries(TIER_CONFIG).map(([key, { label, color, icon }]) => (
          <div key={key} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px",
            background: `${color}10`,
            border: `1px solid ${color}25`,
            borderRadius: "var(--radius-full)",
            fontSize: "0.8rem", fontWeight: 500, color,
          }}>
            {icon} {label}
            {key === "advisory" && <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(1–2×)</span>}
            {key === "memo"     && <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(3–4×)</span>}
            {key === "chronic"  && <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(5+×)</span>}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 88, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : clusters.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "var(--space-2xl)",
          border: "1px dashed var(--border-default)",
          borderRadius: "var(--radius-lg)", color: "var(--text-tertiary)",
        }}>
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "var(--space-md)" }}>🗂️</span>
          No attribution data yet. Run the attribution agent to populate.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
          {chronic.length > 0 && (
            <div>
              <h3 style={{ marginBottom: "var(--space-md)", color: "#ef4444" }}>🚨 Chronic Offenders ({chronic.length})</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {chronic.map((c) => <OffenderCard key={c.key} cluster={c} />)}
              </div>
            </div>
          )}
          {memoTier.length > 0 && (
            <div>
              <h3 style={{ marginBottom: "var(--space-md)", color: "#f59e0b" }}>⚠️ Enforcement Memo Tier ({memoTier.length})</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {memoTier.map((c) => <OffenderCard key={c.key} cluster={c} />)}
              </div>
            </div>
          )}
          {advisory.length > 0 && (
            <div>
              <h3 style={{ marginBottom: "var(--space-md)", color: "#3b82f6" }}>📋 Advisory Tier ({advisory.length})</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {advisory.map((c) => <OffenderCard key={c.key} cluster={c} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
