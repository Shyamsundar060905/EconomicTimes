"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Hotspot } from "@/lib/types";
import type { MapFilters } from "@/lib/types";

function filterHotspots(hotspots: Hotspot[], filters: Partial<MapFilters>): Hotspot[] {
  return hotspots.filter((h) => {
    if (filters.ward_ids?.length && !filters.ward_ids.includes(h.ward_id)) return false;
    if (filters.persistence_types?.length && !filters.persistence_types.includes(h.kind)) return false;
    if (filters.attributable_only && !h.attributable) return false;
    return true;
  });
}

export function useHotspots(filters?: Partial<MapFilters>) {
  const { data, error, isLoading, mutate } = useSWR<Hotspot[]>(
    "hotspots",
    () => api.getHotspots(),
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  const filtered = data && filters ? filterHotspots(data, filters) : (data ?? []);
  return { hotspots: filtered, raw: data ?? [], error, isLoading, refresh: mutate };
}
