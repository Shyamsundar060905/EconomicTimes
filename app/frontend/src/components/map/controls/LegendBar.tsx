"use client";
/**
 * LegendBar — fixed bottom-right panel.
 * Shows whichever legend is most contextual based on active layers.
 * PM2.5 → AQI color ramp (fusion/hotspot), fire dot, station dot.
 */
import { AQI_BREAKPOINTS } from "@/lib/colors";
import type { LayerVisibility } from "@/lib/types";

interface Props {
  layers: LayerVisibility;
}

const AQI_LABELS = [
  { label: "Good",      range: "0–50",   color: "#22c55e" },
  { label: "Satisf.",   range: "51–100",  color: "#86efac" },
  { label: "Moderate",  range: "101–200", color: "#fde047" },
  { label: "Poor",      range: "201–300", color: "#fb923c" },
  { label: "Very Poor", range: "301–400", color: "#ef4444" },
  { label: "Severe",    range: "400+",    color: "#7f1d1d" },
];

function ColorRamp() {
  return (
    <div>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        PM2.5 (India NAQI AQI)
      </div>
      {AQI_LABELS.map(({ label, range, color }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", flex: 1 }}>{label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--text-tertiary)" }}>{range}</span>
        </div>
      ))}
    </div>
  );
}

function PersistenceLegend() {
  return (
    <div>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        Hotspot Type
      </div>
      {[
        { kind: "chronic",  color: "var(--persist-chronic)",  label: "Chronic (30d)" },
        { kind: "emerging", color: "var(--persist-emerging)", label: "Emerging (7d)" },
        { kind: "acute",    color: "var(--persist-acute)",    label: "Acute (24h)"   },
      ].map(({ kind, color, label }) => (
        <div key={kind} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function FireLegend() {
  return (
    <div>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        FIRMS Detections
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>High confidence</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Low confidence</span>
      </div>
    </div>
  );
}

function BlindSpotLegend() {
  return (
    <div>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        Blind Spots
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 12, height: 12, borderRadius: 2, background: "#fde047", opacity: 0.7, flexShrink: 0 }} />
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>No monitor — satellite high</span>
      </div>
      <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", marginTop: 4 }}>Brighter = higher rank</div>
    </div>
  );
}

export default function LegendBar({ layers }: Props) {
  const sections: React.ReactNode[] = [];
  if (layers.fusion || layers.hotspots) sections.push(<ColorRamp key="ramp" />);
  if (layers.hotspots) sections.push(<PersistenceLegend key="persist" />);
  if (layers.fires) sections.push(<FireLegend key="fire" />);
  if (layers.blindspots) sections.push(<BlindSpotLegend key="blind" />);

  if (sections.length === 0) return null;

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        bottom: 80,
        right: 12,
        zIndex: "var(--z-overlay)",
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        minWidth: 160,
        maxWidth: 200,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
      }}
    >
      {sections.map((s, i) => (
        <div key={i}>
          {i > 0 && (
            <div style={{ borderTop: "1px solid var(--border-subtle)", marginBottom: "var(--space-md)" }} />
          )}
          {s}
        </div>
      ))}
    </div>
  );
}
