"use client";
/**
 * useMapData — generic SWR hooks for all secondary map layers.
 * Satellite, wind, and stations are not-yet-built endpoints;
 * they fall back gracefully to empty arrays / stubs.
 */
import useSWR from "swr";
import { api, apiFetch } from "@/lib/api";
import type { WardsResponse, AuditResponse, DispatchRoute, Action } from "@/lib/types";

// ── Wards ──────────────────────────────────────────────────────────────────────
export function useWards() {
  const { data, error, isLoading } = useSWR<WardsResponse>(
    "wards",
    () => api.getWards(),
    { revalidateOnFocus: false, dedupingInterval: 600_000 }
  );
  return { wards: data, cells: data?.cells ?? [], error, isLoading };
}

// ── Stations ──────────────────────────────────────────────────────────────────
export interface Station {
  cell: string;
  ward_id: string;
  station_name: string;
  lat: number;
  lon: number;
  pm25: number;
  pm10?: number;
  no2?: number;
  freshness_h: number;   // hours since last reading
}

export function useStations() {
  const { data, error, isLoading } = useSWR<Station[]>(
    "stations",
    () => apiFetch<Station[]>("/stations").catch(() => [] as Station[]),
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );
  return { stations: data ?? [], error, isLoading };
}

// ── Fires ──────────────────────────────────────────────────────────────────────
export interface FireDetection {
  cell: string;
  lat: number;
  lon: number;
  frp: number;           // fire radiative power (MW)
  confidence: number;    // [0,1]
  acquired_at: string;   // ISO timestamp
}

export function useFires() {
  const { data, error, isLoading } = useSWR<FireDetection[]>(
    "fires",
    () => apiFetch<FireDetection[]>("/fires").catch(() => [] as FireDetection[]),
    { refreshInterval: 600_000, revalidateOnFocus: false }
  );
  return { fires: data ?? [], error, isLoading };
}

// ── Audit (blind spots + sensor flags) ───────────────────────────────────────
export function useAudit() {
  const { data, error, isLoading } = useSWR<AuditResponse>(
    "audit",
    () => api.getAudit(),
    { revalidateOnFocus: false }
  );
  return {
    blindSpots: data?.blind_spots ?? [],
    sensorFlags: data?.sensor_flags ?? [],
    recommendations: data?.placement_recommendations ?? [],
    error,
    isLoading,
  };
}

// ── Dispatch routes ───────────────────────────────────────────────────────────
export function useDispatch() {
  const { data, error, isLoading } = useSWR<DispatchRoute[]>(
    "dispatch",
    () => api.getDispatch(),
    { revalidateOnFocus: false }
  );
  return { routes: data ?? [], error, isLoading };
}

// ── Actions (zone-level EPS queue) ───────────────────────────────────────────
export function useActions() {
  const { data, error, isLoading, mutate } = useSWR<Action[]>(
    "actions",
    () => api.getActions(),
    { revalidateOnFocus: false }
  );
  return { actions: data ?? [], error, isLoading, refresh: mutate };
}
