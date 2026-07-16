"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { FusionResponse } from "@/lib/types";

export function useFusion(hourOffset = 0) {
  const { data, error, isLoading } = useSWR<FusionResponse>(
    ["fusion", hourOffset],
    () => api.getFusion(hourOffset),
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );
  return { fusion: data, cells: data?.cells ?? [], ts: data?.ts, error, isLoading };
}
