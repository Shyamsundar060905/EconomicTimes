/**
 * API client — wraps every fetch with a static JSON fallback.
 * If the FastAPI backend is unreachable, reads from /data/*.json (demo insurance).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Map from API path to the fallback static file in /public/data/ */
const FALLBACK_MAP: Record<string, string> = {
  "/hotspots":        "/data/hotspots.json",
  "/attributions":    "/data/attributions.json",
  "/fusion":          "/data/fusion_field.json",
  "/forecast":        "/data/forecast.json",
  "/actions":         "/data/actions.json",
  "/dispatch":        "/data/dispatch.json",
  "/ledger":          "/data/ledger.json",
  "/audit":           "/data/audit.json",
  "/wards":           "/data/wards.json",
  "/stations":        "/data/stations.json",
  "/fires":           "/data/fires.json",
  "/loso":            "/data/loso.json",
};

function getFallbackPath(endpoint: string): string | null {
  // Strip query params for matching
  const path = endpoint.split("?")[0];
  return FALLBACK_MAP[path] ?? null;
}

export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
      // Don't cache dynamic data
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  } catch (err) {
    const fallback = getFallbackPath(endpoint);
    if (fallback) {
      console.warn(`[api] Backend unreachable (${endpoint}), loading fallback: ${fallback}`);
      try {
        const res = await fetch(fallback);
        if (res.ok) return res.json() as Promise<T>;
      } catch {
        // Static fallback also failed
      }
    }
    throw err;
  }
}

// ─── Typed endpoint helpers ────────────────────────────────────────────────────

import type {
  FusionResponse,
  WardsResponse,
  Hotspot,
  Attribution,
  LOSOResponse,
  AuditResponse,
  LedgerEntry,
  ForecastCell,
  Action,
  DispatchRoute,
  CitizenReport,
  CreateReportPayload,
  PipelineRunResult,
  AgentName,
} from "./types";

export const api = {
  // ─── Map data ────────────────────────────────────────────────────────────────
  getHotspots: () => apiFetch<Hotspot[]>("/hotspots"),
  getAttributions: () => apiFetch<Attribution[]>("/attributions"),
  getAttribution: (cell: string) => apiFetch<Attribution>(`/attribution/${cell}`),
  getFusion: (hourOffset = 0) => apiFetch<FusionResponse>(`/fusion?hour_offset=${hourOffset}`),
  getWards: () => apiFetch<WardsResponse>("/wards"),
  getLoso: () => apiFetch<LOSOResponse>("/loso"),

  // ─── Not-yet-built endpoints (return empty gracefully) ───────────────────────────────────
  // Forecast: FORECAST_WEIGHT = 0.0 until forecast agent is built.
  // severity = clip(base_severity + 0.0 * forecast_delta, 0, 1)
  // A zero we can explain beats a number we invented.
  getForecast: (horizon: 24 | 48 | 72 = 24) =>
    apiFetch<ForecastCell[]>(`/forecast?h=${horizon}`).catch(() => [] as ForecastCell[]),

  // Actions: zone-level (NOT cell-level). ~4–5 zones, not 74 cells.
  // Only attributable:true zones appear here (diffuse excluded from queue).
  getActions: () =>
    apiFetch<Action[]>("/actions").catch(() => [] as Action[]),
  getDispatch: () =>
    apiFetch<DispatchRoute[]>("/dispatch").catch(() => [] as DispatchRoute[]),
  getLedger: () =>
    apiFetch<LedgerEntry[]>("/ledger").catch(() => [] as LedgerEntry[]),
  getAudit: () =>
    apiFetch<AuditResponse>("/audit").catch(() => ({
      blind_spots: [],
      sensor_flags: [],
      placement_recommendations: [],
    } as AuditResponse)),

  // ─── Agent pipeline ───────────────────────────────────────────────────────────
  runAgent: async (agent: AgentName | "all"): Promise<PipelineRunResult> => {
    const res = await apiFetch<PipelineRunResult>("/run/agent", {
      method: "POST",
      body: JSON.stringify({ agent }),
    });
    return res;
  },

  // ─── Memo generation ─────────────────────────────────────────────────────────
  generateMemo: (actionId: string) =>
    apiFetch<{ memo_url: string }>(`/memo/${actionId}`, { method: "POST" }),

  // ─── Citizen ─────────────────────────────────────────────────────────────────
  getWardSummary: (wardId: string) =>
    apiFetch<{ ward_id: string; ward_name: string; aqi: number; pm25: number; advisory?: string }>
    (`/ward/${wardId}/summary`).catch(() => null),

  getReports: () =>
    apiFetch<CitizenReport[]>("/reports").catch(() => [] as CitizenReport[]),

  submitReport: async (payload: CreateReportPayload): Promise<CitizenReport> => {
    // If photo, use multipart; else JSON
    if (payload.photo) {
      const form = new FormData();
      form.append("ward_id", payload.ward_id);
      form.append("category", payload.category);
      if (payload.description) form.append("description", payload.description);
      if (payload.lat != null) form.append("lat", String(payload.lat));
      if (payload.lon != null) form.append("lon", String(payload.lon));
      form.append("photo", payload.photo);
      return apiFetch<CitizenReport>("/reports", { method: "POST", body: form, headers: {} });
    }
    return apiFetch<CitizenReport>("/reports", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
