"use client";
/**
 * DispatchLayer — draws per-team inspection routes on the map.
 * Each route is a polyline through stop centroids, colored by team.
 * Stop positions are rendered as pins with EPS labels.
 */
import { LineLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { DispatchRoute, DispatchStop } from "@/lib/types";

// One distinct hue per team (up to 6 teams)
const TEAM_COLORS: [number, number, number, number][] = [
  [99,  102, 241, 220],  // indigo  — T1
  [16,  185, 129, 220],  // emerald — T2
  [245, 158,  11, 220],  // amber   — T3
  [239,  68,  68, 220],  // red     — T4
  [59,  130, 246, 220],  // blue    — T5
  [168,  85, 247, 220],  // purple  — T6
];

function teamColor(teamId: string): [number, number, number, number] {
  const idx = parseInt(teamId.replace(/\D/g, ""), 10) - 1;
  return TEAM_COLORS[idx % TEAM_COLORS.length];
}

// Build stop-pair lines for each route
interface RouteLine { from: [number, number]; to: [number, number]; team_id: string }
interface StopPoint { stop: DispatchStop; team_id: string }

export function buildDispatchLayers(
  routes: DispatchRoute[],
  onHover: (info: { x: number; y: number; content: React.ReactNode } | null) => void
) {
  if (!routes.length) return [];

  const lines: RouteLine[] = [];
  const points: StopPoint[] = [];

  for (const route of routes) {
    for (let i = 0; i < route.stops.length - 1; i++) {
      lines.push({
        from: [route.stops[i].lon, route.stops[i].lat],
        to:   [route.stops[i + 1].lon, route.stops[i + 1].lat],
        team_id: route.team_id,
      });
    }
    for (const stop of route.stops) {
      points.push({ stop, team_id: route.team_id });
    }
  }

  const lineLayer = new LineLayer<RouteLine>({
    id: "dispatch-routes",
    data: lines,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: (d) => teamColor(d.team_id),
    getWidth: 2,
    widthMinPixels: 2,
    widthMaxPixels: 5,
    pickable: false,
  });

  const stopLayer = new ScatterplotLayer<StopPoint>({
    id: "dispatch-stops",
    data: points,
    getPosition: (d) => [d.stop.lon, d.stop.lat],
    getRadius: 320,
    radiusMinPixels: 8,
    radiusMaxPixels: 16,
    getFillColor: (d) => teamColor(d.team_id),
    getLineColor: [255, 255, 255, 200],
    lineWidthMinPixels: 2,
    stroked: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    onHover: (info) => {
      if (info.object) {
        const { stop, team_id } = info.object as StopPoint;
        onHover({
          x: info.x,
          y: info.y,
          content: (
            <div style={{ minWidth: 180 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>🚗 Dispatch Stop #{stop.seq}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 2 }}>
                Team {team_id} · Zone {stop.zone_id}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Ward {stop.ward_id}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--accent-amber)", marginTop: 4 }}>
                EPS: {stop.eps.toFixed(1)}
              </div>
            </div>
          ),
        });
      } else onHover(null);
    },
    updateTriggers: { getFillColor: [routes] },
  });

  const labelLayer = new TextLayer<StopPoint>({
    id: "dispatch-labels",
    data: points,
    getPosition: (d) => [d.stop.lon, d.stop.lat],
    getText: (d) => `${d.stop.seq}`,
    getSize: 11,
    getColor: [255, 255, 255, 240],
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    fontFamily: "\"JetBrains Mono\", monospace",
    fontWeight: "bold",
    pickable: false,
    getPixelOffset: [0, 0],
  });

  return [lineLayer, stopLayer, labelLayer];
}
