"use client";
import { useCallback, useReducer } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MapFilters, HotspotKind, SourceCategory, SatelliteChannel, LayerVisibility, LayerId } from "@/lib/types";
import { DEFAULT_LAYERS } from "@/lib/constants";

// ─── Filter state ─────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: MapFilters = {
  ward_ids: [],
  source_types: [],
  persistence_types: [],
  attributable_only: false,
  date: undefined,
  forecast_horizon: 0,
  satellite_channel: "no2_col",
};

type FilterAction =
  | { type: "SET_WARDS"; payload: string[] }
  | { type: "SET_SOURCES"; payload: SourceCategory[] }
  | { type: "SET_PERSISTENCE"; payload: HotspotKind[] }
  | { type: "SET_ATTRIBUTABLE"; payload: boolean }
  | { type: "SET_DATE"; payload: string | undefined }
  | { type: "SET_HORIZON"; payload: 0 | 24 | 48 | 72 }
  | { type: "SET_SAT_CHANNEL"; payload: SatelliteChannel }
  | { type: "RESET" };

function filterReducer(state: MapFilters, action: FilterAction): MapFilters {
  switch (action.type) {
    case "SET_WARDS":       return { ...state, ward_ids: action.payload };
    case "SET_SOURCES":     return { ...state, source_types: action.payload };
    case "SET_PERSISTENCE": return { ...state, persistence_types: action.payload };
    case "SET_ATTRIBUTABLE": return { ...state, attributable_only: action.payload };
    case "SET_DATE":        return { ...state, date: action.payload };
    case "SET_HORIZON":     return { ...state, forecast_horizon: action.payload };
    case "SET_SAT_CHANNEL": return { ...state, satellite_channel: action.payload };
    case "RESET":           return DEFAULT_FILTERS;
    default:                return state;
  }
}

// ─── Layer visibility state ───────────────────────────────────────────────────

type LayerAction =
  | { type: "TOGGLE"; payload: LayerId }
  | { type: "SET_ALL"; payload: Partial<LayerVisibility> };

function layerReducer(state: LayerVisibility, action: LayerAction): LayerVisibility {
  switch (action.type) {
    case "TOGGLE": return { ...state, [action.payload]: !state[action.payload] };
    case "SET_ALL": return { ...state, ...action.payload };
    default:        return state;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFilters() {
  const [filters, dispatchFilter] = useReducer(filterReducer, DEFAULT_FILTERS);
  const [layers, dispatchLayer] = useReducer(layerReducer, DEFAULT_LAYERS);

  const setWards = useCallback((ids: string[]) =>
    dispatchFilter({ type: "SET_WARDS", payload: ids }), []);
  const setSources = useCallback((s: SourceCategory[]) =>
    dispatchFilter({ type: "SET_SOURCES", payload: s }), []);
  const setPersistence = useCallback((p: HotspotKind[]) =>
    dispatchFilter({ type: "SET_PERSISTENCE", payload: p }), []);
  const setAttributableOnly = useCallback((v: boolean) =>
    dispatchFilter({ type: "SET_ATTRIBUTABLE", payload: v }), []);
  const setDate = useCallback((d: string | undefined) =>
    dispatchFilter({ type: "SET_DATE", payload: d }), []);
  const setHorizon = useCallback((h: 0 | 24 | 48 | 72) =>
    dispatchFilter({ type: "SET_HORIZON", payload: h }), []);
  const setSatChannel = useCallback((c: SatelliteChannel) =>
    dispatchFilter({ type: "SET_SAT_CHANNEL", payload: c }), []);
  const resetFilters = useCallback(() => dispatchFilter({ type: "RESET" }), []);
  const toggleLayer = useCallback((id: LayerId) =>
    dispatchLayer({ type: "TOGGLE", payload: id }), []);

  const hasActiveFilters =
    filters.ward_ids.length > 0 ||
    filters.source_types.length > 0 ||
    filters.persistence_types.length > 0 ||
    filters.attributable_only;

  return {
    filters,
    layers,
    setWards,
    setSources,
    setPersistence,
    setAttributableOnly,
    setDate,
    setHorizon,
    setSatChannel,
    resetFilters,
    toggleLayer,
    hasActiveFilters,
  };
}
