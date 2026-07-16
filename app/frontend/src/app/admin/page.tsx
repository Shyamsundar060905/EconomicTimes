"use client";
/**
 * Admin Console — Main Dashboard Page
 * Full-bleed map (left ~70%) + collapsible Action Queue panel (right ~30%)
 */
import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import { mutate } from "swr";

import { useFilters }  from "@/hooks/useFilters";
import { useHotspots } from "@/hooks/useHotspots";
import { useFusion }   from "@/hooks/useFusion";
import { useAgentRun } from "@/hooks/useAgentRun";
import { useWards, useStations, useFires, useAudit, useDispatch } from "@/hooks/useMapData";

// All WebGL/heavy components are dynamically imported — no SSR
const MapContainer    = dynamic(() => import("@/components/map/MapContainer"),                { ssr: false, loading: () => <MapPlaceholder /> });
const LayerToggle     = dynamic(() => import("@/components/map/controls/LayerToggle"),        { ssr: false });
const TimeSlider      = dynamic(() => import("@/components/map/controls/TimeSlider"),         { ssr: false });
const FilterBar       = dynamic(() => import("@/components/filters/FilterBar"),               { ssr: false });
const ActionQueue     = dynamic(() => import("@/components/panels/ActionQueue"),              { ssr: false });
const AgentControlBar = dynamic(() => import("@/components/agents/AgentControlBar"),          { ssr: false });
const AgentProgressStrip = dynamic(() => import("@/components/agents/AgentProgressStrip"),   { ssr: false });

function MapPlaceholder() {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-secondary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-tertiary)", fontSize: "0.9rem",
    }}>
      <span style={{ marginRight: 8, fontSize: "1.2rem" }}>⬡</span>
      Loading map…
    </div>
  );
}

export default function AdminPage() {
  const [panelOpen, setPanelOpen]   = useState(true);
  const [hourOffset, setHourOffset] = useState(0);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  // ── Filters & layers ────────────────────────────────────────────────────────
  const {
    filters, layers,
    setWards, setSources, setPersistence, toggleLayer, setHorizon, resetFilters,
  } = useFilters();

  // ── Map data ────────────────────────────────────────────────────────────────
  const { hotspots, isLoading: hotspotsLoading } = useHotspots(filters);
  const { cells: fusionCells }                   = useFusion(hourOffset);
  const { cells: wardCells }                     = useWards();
  const { stations }                             = useStations();
  const { fires }                                = useFires();
  const { blindSpots }                           = useAudit();
  const { routes: dispatchRoutes }               = useDispatch();

  // ── Agent pipeline ──────────────────────────────────────────────────────────
  const onAgentComplete = useCallback(() => {
    mutate("hotspots");
    mutate(["fusion", hourOffset]);
    mutate("actions");
    mutate("dispatch");
    mutate("audit");
  }, [hourOffset]);
  const { agents, running, runAgent, resetAgents } = useAgentRun(onAgentComplete);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Map area ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0 }}>

        {/* Agent bar + progress strip — floats above map */}
        <div className="glass" style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          zIndex: "var(--z-overlay)",
          display: "flex", flexDirection: "column",
          borderBottom: "1px solid var(--border-subtle)",
        }}>
          <AgentControlBar agents={agents} running={running} onRun={runAgent} onReset={resetAgents} />
          <AgentProgressStrip agents={agents} />
        </div>

        {/* Left sidebar controls — layer toggle + filter bar */}
        <div style={{
          position: "absolute",
          top: 80, left: 12,
          zIndex: "var(--z-overlay)",
          display: "flex", flexDirection: "column",
          gap: "var(--space-sm)",
          maxWidth: 188,
        }}>
          <LayerToggle layers={layers} onToggle={toggleLayer} />
          <FilterBar
            filters={filters}
            onWards={setWards}
            onSources={setSources}
            onPersistence={setPersistence}
            onReset={resetFilters}
          />
        </div>

        {/* Time slider — centered at bottom */}
        <div style={{
          position: "absolute",
          bottom: 24, left: "50%",
          transform: "translateX(-50%)",
          zIndex: "var(--z-overlay)",
          width: "min(480px, 80%)",
        }}>
          <TimeSlider value={hourOffset} onChange={setHourOffset} />
        </div>

        {/* The full-bleed map */}
        <MapContainer
          layers={layers}
          filters={filters}
          fusionCells={fusionCells}
          hotspots={hotspots}
          stations={stations}
          fires={fires}
          wardCells={wardCells}
          blindSpots={blindSpots}
          dispatchRoutes={dispatchRoutes}
          hourOffset={hourOffset}
          selectedCell={selectedCell}
          onCellClick={setSelectedCell}
        />
      </div>

      {/* ── Right panel — Action Queue ──────────────────────────────────────── */}
      <div className="glass" style={{
        width: panelOpen ? 360 : 0,
        minWidth: panelOpen ? 320 : 0,
        maxWidth: 420,
        overflow: "hidden",
        transition: "width var(--transition-slow), min-width var(--transition-slow)",
        display: "flex", flexDirection: "column",
        borderLeft: "1px solid var(--border-subtle)",
        zIndex: "var(--z-panel)",
        position: "relative",
      }}>
        {/* Collapse tab */}
        <button
          onClick={() => setPanelOpen((p) => !p)}
          className="btn btn-ghost btn-icon"
          style={{
            position: "absolute", left: -36, top: "50%",
            transform: "translateY(-50%)",
            width: 28, height: 52,
            borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-default)",
            borderRight: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.7rem", zIndex: 1,
          }}
          title={panelOpen ? "Collapse panel" : "Expand panel"}
        >
          {panelOpen ? "›" : "‹"}
        </button>

        {panelOpen && (
          <ActionQueue
            hotspots={hotspots}
            loading={hotspotsLoading}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
          />
        )}
      </div>
    </div>
  );
}
