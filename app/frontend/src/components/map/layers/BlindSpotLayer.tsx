"use client";
/**
 * BlindSpotLayer — H3 cells where satellite says "high" but no monitor exists.
 * Ranked by satellite signal; best placement candidates pulse bright yellow.
 */
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { BlindSpot } from "@/lib/types";

export function buildBlindSpotLayer(
  blindSpots: BlindSpot[],
  onHover: (info: { x: number; y: number; content: React.ReactNode } | null) => void
) {
  if (!blindSpots.length) return null;

  // Normalise satellite_signal to [0,1] within this set for alpha
  const maxSig = Math.max(...blindSpots.map((b) => b.satellite_signal), 1);

  return new H3HexagonLayer<BlindSpot>({
    id: "blindspots",
    data: blindSpots,
    getHexagon: (d) => d.cell,
    getFillColor: (d) => {
      const t = d.satellite_signal / maxSig;
      return [253, 224, 71, Math.round(60 + t * 120)];  // yellow, intensity scaled
    },
    getLineColor: [253, 224, 71, 200],
    lineWidthMinPixels: 1.5,
    extruded: false,
    wireframe: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 60],
    onHover: (info) => {
      if (info.object) {
        const d = info.object as BlindSpot;
        onHover({
          x: info.x,
          y: info.y,
          content: (
            <div style={{ minWidth: 200 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: "#fde047" }}>
                👁 Monitoring Blind Spot
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 4 }}>
                Satellite signal: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {d.satellite_signal.toFixed(3)}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Placement rank: <span style={{ fontFamily: "var(--font-mono)", color: "#fde047" }}>#{d.rank}</span>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: 6 }}>
                {d.ward_id} · {d.cell.slice(0, 10)}…
              </div>
            </div>
          ),
        });
      } else onHover(null);
    },
    updateTriggers: { getFillColor: [blindSpots] },
  });
}
