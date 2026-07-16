"use client";
/**
 * WardLayer — GeoJSON polygon boundaries for municipal wards.
 * Drawn as thin outlines only (no fill), so they don't obscure the choropleth.
 * Cells from /wards are converted to H3 polygons client-side.
 */
import { H3HexagonLayer } from "@deck.gl/geo-layers";

interface WardCell {
  cell: string;
  ward_id: string;
  ward_name: string;
}

export function buildWardLayer(
  cells: WardCell[],
  onHover: (info: { x: number; y: number; content: React.ReactNode } | null) => void
) {
  if (!cells.length) return null;
  return new H3HexagonLayer<WardCell>({
    id: "wards",
    data: cells,
    getHexagon: (d) => d.cell,
    getFillColor: [0, 0, 0, 0],            // fully transparent fill
    getLineColor: [255, 255, 255, 28],     // very subtle white outline
    lineWidthMinPixels: 0.5,
    lineWidthMaxPixels: 1,
    extruded: false,
    wireframe: true,
    stroked: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 20],
    onHover: (info) => {
      if (info.object) {
        const d = info.object as WardCell;
        onHover({
          x: info.x,
          y: info.y,
          content: (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.ward_name}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {d.ward_id} · {d.cell.slice(0, 10)}…
              </div>
            </div>
          ),
        });
      } else onHover(null);
    },
    updateTriggers: { getLineColor: [] },
  });
}
