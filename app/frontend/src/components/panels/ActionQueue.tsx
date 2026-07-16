"use client";
/**
 * ActionQueue — EPS-ranked zone cards.
 *
 * KEY INVARIANTS (see architecture.md + eps-spec.md):
 * 1. An ACTION is a ZONE, not a cell.
 *    hotspots.json has ~74 rows but only ~5 zones. Group by zone_id.
 *    An inspector visits a place, not a 460 m hexagon.
 * 2. Only `attributable: true` zones enter the queue.
 *    Diffuse zones (urban background) stay on the map, feed ward advisories,
 *    but are EXCLUDED here — there is nobody to serve a notice on.
 * 3. EPS is zone-level: severity = max across zone's cells,
 *    attribution_conf = max over zone's cells.
 * 4. forecast_delta = 0 (forecast agent not yet built).
 *    FORECAST_WEIGHT = 0.0 — a zero we can explain beats a number we invented.
 */
import { useState, useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Hotspot, Attribution } from "@/lib/types";
import { SOURCE_LABELS, PERSISTENCE_LABELS } from "@/lib/constants";
import { SOURCE_COLORS } from "@/lib/colors";

interface Props {
  hotspots: Hotspot[];
  loading: boolean;
  selectedCell: string | null;
  onSelectCell: (cell: string) => void;
}

// ── Derived zone type (grouped from hotspot cells) ─────────────────────────────

interface Zone {
  zone_id: string;
  ward_id: string;
  ward_name: string;
  kind: Hotspot["kind"];
  attributable: boolean;
  /** Severity = max across cells (zone is as bad as its worst cell) */
  severity: number;
  /** PM2.5 median = median of cell-level pm25_med values */
  pm25_med: number;
  n_cells: number;
  cells: string[];
  /** Representative cell for attribution lookup (highest severity) */
  lead_cell: string;
  detection_basis: string;
  fires_6h: number;
}

function groupIntoZones(hotspots: Hotspot[]): Zone[] {
  const zoneMap = new Map<string, Zone>();
  for (const h of hotspots) {
    const existing = zoneMap.get(h.zone_id);
    if (!existing) {
      zoneMap.set(h.zone_id, {
        zone_id: h.zone_id,
        ward_id: h.ward_id,
        ward_name: h.ward_name,
        kind: h.kind,
        attributable: h.attributable,
        severity: h.severity,
        pm25_med: h.pm25_med,
        n_cells: 1,
        cells: [h.cell],
        lead_cell: h.cell,
        detection_basis: h.detection_basis,
        fires_6h: h.fires_6h,
      });
    } else {
      // kind: use the most persistent verdict across cells
      const kindRank: Record<Hotspot["kind"], number> = { chronic: 3, emerging: 2, acute: 1 };
      if (kindRank[h.kind] > kindRank[existing.kind]) existing.kind = h.kind;
      // severity: max
      if (h.severity > existing.severity) {
        existing.severity = h.severity;
        existing.lead_cell = h.cell;
      }
      // pm25_med: running average (will be approximately the zone median)
      existing.pm25_med = (existing.pm25_med * existing.n_cells + h.pm25_med) / (existing.n_cells + 1);
      existing.n_cells += 1;
      existing.cells.push(h.cell);
      existing.fires_6h = Math.max(existing.fires_6h, h.fires_6h);
      if (h.attributable) existing.attributable = true;
    }
  }
  return Array.from(zoneMap.values());
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 0.7 ? "#10b981" : value >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1, height: 4, background: "var(--border-subtle)",
          borderRadius: "var(--radius-full)", overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            background: color,
            borderRadius: "var(--radius-full)",
            transition: "width 0.5s ease-out",
          }}
        />
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color, minWidth: 30 }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function EPSBreakdown({ components, eps }: { components: Record<string, number>; eps: number }) {
  const items = [
    { key: "severity",         label: "Severity",    weight: 0.35 },
    { key: "attribution_conf", label: "Conf.",        weight: 0.25 },
    { key: "actionability",    label: "Actionability",weight: 0.20 },
    { key: "vulnerability",    label: "Vulnerability",weight: 0.20 },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          EPS Breakdown
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 700, color: "var(--accent-amber)" }}>
          {eps.toFixed(1)}
        </span>
      </div>
      {items.map(({ key, label, weight }) => {
        const val: number = (components[key] as number) ?? 0;
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", minWidth: 72 }}>{label}</span>
            <div style={{ flex: 1, height: 3, background: "var(--border-subtle)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(val * 100)}%`, height: "100%", background: "var(--accent-blue)", borderRadius: "var(--radius-full)" }} />
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--text-tertiary)", minWidth: 28 }}>
              {(val * weight * 100).toFixed(0)}
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", marginTop: 2, fontStyle: "italic" }}>
        forecast_delta = 0 (forecast agent not yet built)
      </div>
    </div>
  );
}

function EvidenceChain({ attribution }: { attribution: Attribution }) {
  const sourceColor = SOURCE_COLORS[attribution.primary_source] ?? "#888";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <div
        style={{
          padding: "10px 12px",
          background: "var(--bg-primary)",
          borderRadius: "var(--radius-sm)",
          fontSize: "0.82rem",
          lineHeight: 1.6,
          color: "var(--text-secondary)",
          borderLeft: `3px solid ${sourceColor}`,
        }}
      >
        {attribution.reason}
      </div>
      {attribution.evidence_factors.length > 0 && (
        <div>
          <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Evidence
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {attribution.evidence_factors.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--accent-emerald)", marginTop: 1, flexShrink: 0 }}>✓</span>
                {f}
              </div>
            ))}
          </div>
        </div>
      )}
      {attribution.evidence?.meteorology && (
        <div style={{ display: "flex", gap: "var(--space-md)", fontSize: "0.75rem", color: "var(--text-tertiary)", flexWrap: "wrap" }}>
          <span>💨 {attribution.evidence.meteorology.wind_from_deg}° · {attribution.evidence.meteorology.wind_ms.toFixed(1)} m/s</span>
          <span>🌡 BLH: {attribution.evidence.meteorology.blh_m}m
            {attribution.evidence.meteorology.air_trapped && " ⚠ trapped"}
          </span>
        </div>
      )}
      <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)" }}>
        Explained by: {attribution.explained_by}
      </div>
    </div>
  );
}

function ZoneCard({ zone, rank, isSelected, onSelect }: {
  zone: Zone;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(isSelected);
  const { data: attribution, isLoading: loadingAttr } = useSWR<Attribution>(
    expanded ? ["attribution", zone.lead_cell] : null,
    () => api.getAttribution(zone.lead_cell)
  );
  const sourceColor = attribution ? SOURCE_COLORS[attribution.primary_source] : "#888";

  return (
    <div
      className="card"
      style={{
        borderColor: isSelected ? "var(--accent-blue)" : "var(--border-subtle)",
        background: isSelected ? "rgba(59,130,246,0.04)" : undefined,
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      {/* Header */}
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, cursor: "pointer" }}
        onClick={() => { onSelect(); setExpanded((e) => !e); }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Rank + badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: "var(--text-tertiary)",
                background: "var(--bg-tertiary)",
                padding: "1px 6px",
                borderRadius: "var(--radius-full)",
              }}
            >
              #{rank}
            </span>
            <span className={`badge badge-${zone.kind}`}>{PERSISTENCE_LABELS[zone.kind]}</span>
          </div>
          {/* Zone + ward */}
          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)", marginBottom: 2 }} className="truncate">
            {zone.zone_id} · {zone.ward_name}
          </div>
          {/* Metrics */}
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
            {zone.pm25_med.toFixed(1)} µg/m³ · {zone.n_cells} cells
            {zone.fires_6h > 0 && ` · 🔥 ${zone.fires_6h} fires`}
          </div>
        </div>
        {/* Severity square */}
        <div style={{ textAlign: "center", flexShrink: 0, marginLeft: "var(--space-sm)" }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: "var(--radius-sm)",
              background: `rgba(239,68,68,${zone.severity.toFixed(2)})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "white" }}>
              {(zone.severity * 100).toFixed(0)}
            </span>
          </div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-tertiary)", marginTop: 2 }}>SEV</div>
        </div>
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", cursor: "pointer",
          fontSize: "0.75rem", color: "var(--text-tertiary)",
          fontFamily: "var(--font-sans)", padding: 0,
          marginBottom: expanded ? 10 : 0,
        }}
      >
        {expanded ? "▲ Collapse" : "▼ Evidence + EPS"}
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {/* Attribution */}
          {attribution ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    background: `${sourceColor}20`,
                    color: sourceColor,
                    border: `1px solid ${sourceColor}40`,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                  }}
                >
                  {SOURCE_LABELS[attribution.primary_source] ?? attribution.primary_source}
                </span>
                <ConfidenceMeter value={attribution.confidence} />
              </div>
              <EvidenceChain attribution={attribution} />
            </>
          ) : loadingAttr ? (
            <div className="skeleton" style={{ height: 80, borderRadius: "var(--radius-sm)" }} />
          ) : (
            <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
              No attribution available for this zone
            </div>
          )}

          {/* EPS breakdown (from actions.json if available, else stub) */}
          {attribution && (
            <EPSBreakdown
              eps={zone.severity * 100}  // approximate until actions.json lands
              components={{
                severity: zone.severity,
                attribution_conf: attribution.confidence,
                actionability: zone.kind === "chronic" ? 0.6 : zone.kind === "emerging" ? 0.8 : 1.0,
                vulnerability: 0.4,  // placeholder until vulnerability data lands
              }}
            />
          )}

          {/* Detection basis */}
          <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", borderTop: "1px solid var(--border-subtle)", paddingTop: 8 }}>
            {zone.detection_basis}
          </div>

          {/* Cells */}
          <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>
            {zone.n_cells} cells · lead: <code style={{ fontFamily: "var(--font-mono)" }}>{zone.lead_cell.slice(0, 12)}…</code>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button className="btn btn-amber btn-sm" disabled style={{ flex: 1, justifyContent: "center" }}>
              📋 Generate Memo
            </button>
            <button className="btn btn-ghost btn-sm" disabled style={{ flex: 1, justifyContent: "center" }}>
              🗺️ Dispatch Route
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function ActionQueue({ hotspots, loading, selectedCell, onSelectCell }: Props) {
  // Step 1: group cells into zones
  const allZones = useMemo(() => groupIntoZones(hotspots), [hotspots]);

  // Step 2: only attributable zones enter the enforcement queue
  const enforceableZones = useMemo(
    () => allZones
      .filter((z) => z.attributable)
      .sort((a, b) => b.severity - a.severity),
    [allZones]
  );

  // Step 3: diffuse zones stay on the map and feed advisories — NOT in the queue
  const diffuseZones = useMemo(
    () => allZones.filter((z) => !z.attributable).sort((a, b) => b.severity - a.severity),
    [allZones]
  );

  // Find which zone contains the selected cell
  const selectedZoneId = selectedCell
    ? allZones.find((z) => z.cells.includes(selectedCell))?.zone_id ?? null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Panel header */}
      <div style={{ padding: "12px var(--space-md)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h4>Action Queue</h4>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
            {enforceableZones.length} zone{enforceableZones.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p style={{ fontSize: "0.75rem" }}>
          Zone-level · sorted by severity · expand for evidence + EPS
        </p>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm)" }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 88, borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
        ) : enforceableZones.length === 0 && !loading ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: 200,
            color: "var(--text-tertiary)", fontSize: "0.875rem", textAlign: "center", gap: 8,
          }}>
            <span style={{ fontSize: "2rem" }}>⬡</span>
            No enforceable zones detected.
            Run the detection + attribution agents to refresh.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {/* Enforceable zones */}
            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 4px" }}>
              Enforcement Queue ({enforceableZones.length})
            </div>
            {enforceableZones.map((zone, i) => (
              <ZoneCard
                key={zone.zone_id}
                zone={zone}
                rank={i + 1}
                isSelected={selectedZoneId === zone.zone_id}
                onSelect={() => onSelectCell(zone.lead_cell)}
              />
            ))}

            {/* Diffuse zones — shown as a secondary list, NOT in the queue */}
            {diffuseZones.length > 0 && (
              <>
                <div style={{
                  fontSize: "0.68rem", fontWeight: 700, color: "var(--text-tertiary)",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "4px 4px", marginTop: 12,
                  borderTop: "1px solid var(--border-subtle)", paddingTop: 12,
                }}>
                  Policy Targets — diffuse ({diffuseZones.length})
                </div>
                <div
                  style={{
                    padding: "8px 10px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.75rem",
                    color: "var(--text-tertiary)",
                    borderLeft: "2px solid var(--border-strong)",
                  }}
                >
                  ℹ These zones are real pollution — but diffuse urban background
                  with no single actor responsible. They remain on the map and feed
                  ward advisories. Dispatching an inspector would issue a notice to a road.
                </div>
                {diffuseZones.map((zone) => (
                  <div
                    key={zone.zone_id}
                    className="card"
                    style={{ cursor: "pointer", opacity: 0.7 }}
                    onClick={() => onSelectCell(zone.lead_cell)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: "0.85rem", marginBottom: 2 }}>
                          {zone.zone_id} · {zone.ward_name}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                          {zone.pm25_med.toFixed(1)} µg/m³ · {zone.n_cells} cells
                        </div>
                      </div>
                      <span className={`badge badge-${zone.kind}`} style={{ alignSelf: "flex-start" }}>
                        {zone.kind}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
