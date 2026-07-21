/**
 * API client — wraps every fetch with a static JSON fallback.
 * If the FastAPI backend is unreachable, reads from /data/*.json (demo insurance).
 */

// Default to "" (relative paths → fall through to the committed static JSON) so a
// deploy with NO backend is clean: Vercel won't accept an empty env value, so the
// var is simply absent, and absent must mean "no backend", not "localhost". For
// local dev against the backend, set NEXT_PUBLIC_API_URL=http://localhost:8000 in
// .env.local (see .env.example).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// Citizen reports do NOT go to the read-only FastAPI backend. They go to the n8n
// channel layer (live, HTTPS), which validates, canonicalises the ward against the
// official list, and writes to Supabase — the same table the pipeline syncs down
// for attribution's citizen_corroboration. "Channels are dumb, agents are smart":
// intake is the channel's job, not the serving API's.
const N8N_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ||
  "https://aq-intel.duckdns.org/webhook/citizen-report";

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
  "/compare":         "/data/city_comparison.json",
  "/satellite":       "/data/satellite.json",
};

function getFallbackPath(endpoint: string): string | null {
  // Strip query params for matching
  const path = endpoint.split("?")[0];
  return FALLBACK_MAP[path] ?? null;
}

/**
 * City-scoped fetch: reads a contract from that city's static bundle
 * (public/data/<city>/<file>). This is how city-switching works — every map
 * contract lives per-city and needs no backend. Falls back to the legacy flat
 * /data/<file> (the default-city bundle) if the per-city file is absent.
 */
export async function cityFetch<T>(city: string, file: string, fallback: T): Promise<T> {
  for (const url of [`/data/${city}/${file}`, `/data/${file}`]) {
    try {
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (res.ok) return (await res.json()) as T;
    } catch { /* try next */ }
  }
  return fallback;
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
  Ledger,
  ForecastCell,
  Action,
  DispatchRoute,
  CitizenReport,
  CreateReportPayload,
  PipelineRunResult,
  AgentName,
  CityComparison,
  Memo,
} from "./types";
import type { Station, FireDetection } from "@/hooks/useMapData";

export const api = {
  // ─── City-scoped contracts (drive the multi-city map) ─────────────────────────
  // These read that city's static bundle so switching city needs no backend.
  cityHotspots:   (city: string) => cityFetch<Hotspot[]>(city, "hotspots.json", []),
  cityFusion:     (city: string) => cityFetch<FusionResponse>(city, "fusion_field.json", { ts: "", n_hours: 0, cells: [] }),
  cityWards:      (city: string) => cityFetch<WardsResponse>(city, "wards.json", { synthetic: false, n_wards: 0, cells: [] } as unknown as WardsResponse),
  cityStations:   (city: string) => cityFetch<Station[]>(city, "stations.json", []),
  cityFires:      (city: string) => cityFetch<FireDetection[]>(city, "fires.json", []),
  citySatellite:  (city: string) => cityFetch<{ cell: string; no2: number }[]>(city, "satellite.json", []),
  cityAudit:      (city: string) => cityFetch<AuditResponse>(city, "audit.json", { blind_spots: [], sensor_flags: [], placement_recommendations: [] }),
  cityDispatch:   (city: string) => cityFetch<DispatchRoute[]>(city, "dispatch.json", []),
  cityActions:    (city: string) => cityFetch<Action[]>(city, "actions.json", []),
  cityForecast:   (city: string, h: 24 | 48 | 72) =>
    cityFetch<ForecastCell[]>(city, "forecast.json", []).then((all) => all.filter((f) => f.horizon_h === h)),
  cityAttributions: (city: string) => cityFetch<Attribution[]>(city, "attributions.json", []),
  cityMemos:      (city: string) => cityFetch<Memo[]>(city, "memos.json", []),
  cityLedger:     (city: string) => cityFetch<Ledger | null>(city, "ledger.json", null),
  cityAdvisories: (city: string) => cityFetch<{ ward_id: string; texts?: Record<string, string> }[]>(city, "advisories.json", []),

  // ─── Map data (legacy, single-city via backend) ──────────────────────────────
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
    apiFetch<Ledger>("/ledger").catch(() => null),

  // Multi-city comparison — each row is a full LIVE pipeline run over a real city.
  getComparison: () =>
    apiFetch<CityComparison[]>("/compare").catch(() => [] as CityComparison[]),

  // Sentinel-5P NO2 column per cell — the raw signal detection runs on.
  getSatellite: () =>
    apiFetch<{ cell: string; no2: number }[]>("/satellite").catch(() => [] as { cell: string; no2: number }[]),
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

  // ─── Memo ────────────────────────────────────────────────────────────────────
  // GET, not POST: the memo is PRECOMPUTED by the batch pipeline (serving stays
  // read-only). "Generate memo" fetches a document that already exists. Accepts an
  // action_id OR a zone_id — the backend matches either. When the backend is down,
  // fall back to the static memos.json and match client-side (demo insurance).
  getMemo: async (id: string): Promise<Memo> => {
    try {
      return await apiFetch<Memo>(`/memo/${id}`);
    } catch {
      const res = await fetch("/data/memos.json");
      if (!res.ok) throw new Error("memo unavailable");
      const memos = (await res.json()) as Memo[];
      const memo = memos.find(
        (m) => m.action_id === id || m.zone_id === id || m.memo_id === id
      );
      if (!memo) throw new Error(`no memo for ${id}`);
      return memo;
    }
  },

  // ─── Citizen ─────────────────────────────────────────────────────────────────
  getWardSummary: (wardId: string) =>
    apiFetch<{ ward_id: string; ward_name: string; aqi: number; pm25: number; advisory?: string }>
    (`/ward/${wardId}/summary`).catch(() => null),

  getReports: () =>
    apiFetch<CitizenReport[]>("/reports").catch(() => [] as CitizenReport[]),

  // Submit a citizen report to the n8n webhook (NOT the FastAPI backend). n8n
  // validates, canonicalises the ward, and writes to Supabase. The webhook returns
  // {ok, status}, so we synthesize a CitizenReport for the optimistic UI update —
  // the authoritative row lives in Supabase and appears after the next sync.
  submitReport: async (payload: CreateReportPayload): Promise<CitizenReport> => {
    // Frontend uses "construction_dust"; the schema/pipeline category is "construction".
    const category =
      payload.category === "construction_dust" ? "construction" : payload.category;

    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ward_id: payload.ward_id,
        category,
        description: payload.description ?? "",
        lat: payload.lat ?? null,
        lon: payload.lon ?? null,
        source: "web",
      }),
    });
    if (!res.ok) throw new Error(`Report submission failed (HTTP ${res.status})`);
    const ack = (await res.json().catch(() => ({}))) as { status?: string };

    // Optimistic local record. report_id is provisional until the Supabase sync
    // returns the authoritative row.
    const now = new Date().toISOString();
    return {
      report_id: `local-${Date.now()}`,
      ward_id: payload.ward_id,
      ward_name: payload.ward_id,
      category: payload.category,
      description: payload.description ?? "",
      status: (ack.status as CitizenReport["status"]) ?? "submitted",
      created_at: now,
      updated_at: now,
    };
  },
};
