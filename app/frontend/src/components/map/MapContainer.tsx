"use client";
/**
 * MapContainer — Deck.gl + MapLibre GL base map.
 * Composes all toggleable layers from layer builder functions.
 * Layers are rebuilt only when their data or visibility changes.
 */
import { useState, useCallback, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { INITIAL_VIEW_STATE, MAP_STYLE } from "@/lib/constants";
import { pm25ToRgbaArray, SEVERITY_COLORS, hexToRgba } from "@/lib/colors";
import type { FusionCell, Hotspot, LayerVisibility, MapFilters, DispatchRoute, BlindSpot } from "@/lib/types";
import type { Station, FireDetection } from "@/hooks/useMapData";

import { buildStationLayer } from "./layers/StationLayer";
import { buildFireLayer }    from "./layers/FireLayer";
import { buildWardLayer }    from "./layers/WardLayer";
import { buildBlindSpotLayer } from "./layers/BlindSpotLayer";
import { buildDispatchLayers } from "./layers/DispatchLayer";
import LegendBar from "./controls/LegendBar";

// ── Tooltip state ─────────────────────────────────────────────────────────────

interface TooltipState {
  x: number;
  y: number;
  content: React.ReactNode;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  layers: LayerVisibility;
  filters: MapFilters;
  fusionCells: FusionCell[];
  hotspots: Hotspot[];
  stations?: Station[];
  fires?: FireDetection[];
  wardCells?: { cell: string; ward_id: string; ward_name: string }[];
  blindSpots?: BlindSpot[];
  dispatchRoutes?: DispatchRoute[];
  hourOffset: number;
  selectedCell: string | null;
  onCellClick: (cell: string | null) => void;
}

export default function MapContainer({
  layers,
  filters,
  fusionCells,
  hotspots,
  stations = [],
  fires = [],
  wardCells = [],
  blindSpots = [],
  dispatchRoutes = [],
  selectedCell,
  onCellClick,
}: Props) {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const setTip = useCallback(
    (info: { x: number; y: number; content: React.ReactNode } | null) => setTooltip(info),
    []
  );

  // ── Fusion PM2.5 choropleth ─────────────────────────────────────────────────
  const fusionLayer = useMemo(() => {
    if (!layers.fusion || !fusionCells.length) return null;
    return new H3HexagonLayer<FusionCell>({
      id: "fusion-choropleth",
      data: fusionCells,
      getHexagon: (d) => d.cell,
      getFillColor: (d) => pm25ToRgbaArray(d.pm25, 175),
      extruded: false,
      wireframe: false,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 40],
      onHover: (info) => {
        if (info.object) {
          const d = info.object as FusionCell;
          setTip({
            x: info.x, y: info.y,
            content: (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Fusion PM2.5</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem" }}>
                  {d.pm25.toFixed(1)} µg/m³
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: "0.75rem", marginTop: 4 }}>
                  {d.cell} · {d.ward_id}
                </div>
              </div>
            ),
          });
        } else setTip(null);
      },
      onClick: (info) => info.object && onCellClick((info.object as FusionCell).cell),
      updateTriggers: { getFillColor: [fusionCells] },
    });
  }, [layers.fusion, fusionCells, setTip, onCellClick]);

  // ── Hotspot zones ───────────────────────────────────────────────────────────
  const hotspotLayer = useMemo(() => {
    if (!layers.hotspots || !hotspots.length) return null;
    return new H3HexagonLayer<Hotspot>({
      id: "hotspot-zones",
      data: hotspots,
      getHexagon: (d) => d.cell,
      getFillColor: (d) => SEVERITY_COLORS[d.kind]?.fill ?? hexToRgba("#888", 100),
      getLineColor: (d) => SEVERITY_COLORS[d.kind]?.border ?? hexToRgba("#888", 200),
      getLineWidth: (d) => (d.kind === "chronic" ? 3 : d.kind === "emerging" ? 2 : 1.5),
      lineWidthMinPixels: 1.5,
      extruded: false,
      wireframe: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 60],
      onHover: (info) => {
        if (info.object) {
          const d = info.object as Hotspot;
          setTip({
            x: info.x, y: info.y,
            content: (
              <div style={{ minWidth: 220 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{d.zone_id} · {d.ward_name}</span>
                  <span className={`badge badge-${d.kind}`}>{d.kind}</span>
                </div>
                <div style={{ fontFamily: "var(--font-mono)" }}>PM2.5: {d.pm25_med.toFixed(1)} µg/m³</div>
                <div style={{ color: "var(--text-tertiary)", fontSize: "0.75rem", marginTop: 4 }}>
                  Severity: {(d.severity * 100).toFixed(0)}% ·{" "}
                  {d.attributable ? "Enforceable" : "Diffuse"}
                  {d.fires_6h > 0 && ` · 🔥 ${d.fires_6h} fires`}
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: "0.7rem", marginTop: 4, maxWidth: 240 }}>
                  {d.detection_basis}
                </div>
              </div>
            ),
          });
        } else setTip(null);
      },
      onClick: (info) => info.object && onCellClick((info.object as Hotspot).cell),
      updateTriggers: { getFillColor: [hotspots], getLineColor: [hotspots] },
    });
  }, [layers.hotspots, hotspots, setTip, onCellClick]);

  // ── Secondary layers (one memoized block; rebuilt when visibility or data change)
  const stationLayer  = useMemo(() => layers.stations ? buildStationLayer(stations, setTip, onCellClick) : null,  [layers.stations, stations, setTip, onCellClick]);
  const fireLayer     = useMemo(() => layers.fires     ? buildFireLayer(fires, setTip)               : null,  [layers.fires, fires, setTip]);
  const wardLayer     = useMemo(() => layers.wards     ? buildWardLayer(wardCells, setTip)           : null,  [layers.wards, wardCells, setTip]);
  const blindLayer    = useMemo(() => layers.blindspots? buildBlindSpotLayer(blindSpots, setTip)     : null,  [layers.blindspots, blindSpots, setTip]);
  const dispatchLayers= useMemo(() => layers.dispatch  ? buildDispatchLayers(dispatchRoutes, setTip) : [],   [layers.dispatch, dispatchRoutes, setTip]);

  // ── Selected cell highlight ──────────────────────────────────────────────────
  const selectedLayer = useMemo(() => {
    if (!selectedCell) return null;
    return new H3HexagonLayer({
      id: "selected-cell",
      data: [{ cell: selectedCell }],
      getHexagon: (d) => (d as { cell: string }).cell,
      getFillColor: [255, 255, 255, 30],
      getLineColor: [255, 255, 255, 230],
      lineWidthMinPixels: 2.5,
      extruded: false,
      wireframe: true,
      pickable: false,
    });
  }, [selectedCell]);

  // ── Compose all active layers (order matters: bottom → top) ─────────────────
  const deckLayers = useMemo(
    () => [
      fusionLayer,
      wardLayer,
      hotspotLayer,
      stationLayer,
      fireLayer,
      blindLayer,
      ...dispatchLayers,
      selectedLayer,
    ].filter(Boolean),
    [fusionLayer, wardLayer, hotspotLayer, stationLayer, fireLayer, blindLayer, dispatchLayers, selectedLayer]
  );

  return (
    <div className="map-container" style={{ background: "#06090f" }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) =>
          setViewState(vs as typeof INITIAL_VIEW_STATE)
        }
        controller={true}
        layers={deckLayers}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : "crosshair")}
        onClick={(info) => {
          if (!info.object) onCellClick(null);
        }}
      >
        <Map
          mapStyle={MAP_STYLE}
          attributionControl={{ compact: true }}
        />
      </DeckGL>

      {/* Context-sensitive legend */}
      <LegendBar layers={layers} />

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="glass"
          style={{
            position: "absolute",
            left: Math.min(tooltip.x + 12, window.innerWidth - 300),
            top: Math.min(tooltip.y + 12, window.innerHeight - 200),
            padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            pointerEvents: "none",
            zIndex: "var(--z-overlay)",
            maxWidth: 280,
            fontSize: "0.85rem",
            boxShadow: "var(--shadow-lg)",
            animation: "fadeIn 0.12s ease-out",
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
