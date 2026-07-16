"use client";
import { LAYER_LABELS } from "@/lib/constants";
import type { LayerVisibility, LayerId } from "@/lib/types";

const LAYER_ORDER: LayerId[] = [
  "fusion", "stations", "satellite", "hotspots",
  "fires", "wind", "wards", "blindspots", "dispatch"
];

const LAYER_ICONS: Record<LayerId, string> = {
  fusion:     "🟥",
  stations:   "📍",
  satellite:  "🛰",
  hotspots:   "⬡",
  fires:      "🔥",
  wind:       "💨",
  wards:      "🗺",
  blindspots: "👁",
  dispatch:   "🚗",
};

interface Props {
  layers: LayerVisibility;
  onToggle: (id: LayerId) => void;
}

export default function LayerToggle({ layers, onToggle }: Props) {
  return (
    <div
      className="glass"
      style={{
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        minWidth: 170,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        Layers
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {LAYER_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => onToggle(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 12px",
              background: layers[id] ? "rgba(59,130,246,0.08)" : "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              color: layers[id] ? "var(--text-primary)" : "var(--text-tertiary)",
              fontSize: "0.8rem",
              fontFamily: "var(--font-sans)",
              transition: "all var(--transition-fast)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {/* Toggle indicator */}
            <span
              style={{
                width: 10, height: 10, borderRadius: 2,
                background: layers[id] ? "var(--accent-blue)" : "var(--border-strong)",
                flexShrink: 0,
                transition: "background var(--transition-fast)",
              }}
            />
            <span style={{ fontSize: "0.9rem" }}>{LAYER_ICONS[id]}</span>
            <span style={{ flex: 1 }}>{LAYER_LABELS[id]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
