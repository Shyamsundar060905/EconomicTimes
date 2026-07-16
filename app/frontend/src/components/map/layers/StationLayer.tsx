"use client";
/**
 * StationLayer — scatter plot of ground monitoring stations.
 * Colored by freshness: fresh = cyan, stale = dim grey.
 * Click shows PM2.5 reading + station name in tooltip.
 */
import { useMemo } from "react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { pm25ToRgbaArray } from "@/lib/colors";
import type { Station } from "@/hooks/useMapData";

// Returns a Deck.gl layer instance (or null if empty / hidden)
export function buildStationLayer(
  stations: Station[],
  onHover: (info: { x: number; y: number; content: React.ReactNode } | null) => void,
  onClickCell: (cell: string) => void
) {
  if (!stations.length) return null;
  return new ScatterplotLayer<Station>({
    id: "stations",
    data: stations,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: 400,
    radiusMinPixels: 5,
    radiusMaxPixels: 18,
    getFillColor: (d) =>
      d.freshness_h <= 2
        ? pm25ToRgbaArray(d.pm25, 230)
        : [80, 80, 80, 180],
    getLineColor: [255, 255, 255, 120],
    lineWidthMinPixels: 1,
    stroked: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    onHover: (info) => {
      if (info.object) {
        const d = info.object as Station;
        onHover({
          x: info.x,
          y: info.y,
          content: (
            <div style={{ minWidth: 180 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>📍 {d.station_name}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", marginBottom: 4 }}>
                PM2.5: {d.pm25.toFixed(1)} µg/m³
              </div>
              {d.pm10 !== undefined && (
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  PM10: {d.pm10.toFixed(1)} µg/m³
                </div>
              )}
              {d.no2 !== undefined && (
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  NO₂: {d.no2.toFixed(2)} mol/m²
                </div>
              )}
              <div style={{ fontSize: "0.7rem", color: d.freshness_h <= 2 ? "var(--accent-emerald)" : "var(--text-tertiary)", marginTop: 6 }}>
                {d.freshness_h <= 2 ? "🟢 Fresh" : `⚠ ${d.freshness_h}h stale`} · {d.ward_id}
              </div>
            </div>
          ),
        });
      } else onHover(null);
    },
    onClick: (info) => {
      if (info.object) onClickCell((info.object as Station).cell);
    },
    updateTriggers: { getFillColor: [stations] },
  });
}
