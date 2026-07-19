import type { AgentName, HotspotKind, SourceCategory, ReportCategory, LayerId } from "./types";

// ─── Map ──────────────────────────────────────────────────────────────────────

/** Delhi initial viewport */
export const INITIAL_VIEW_STATE = {
  longitude: 77.15,
  latitude: 28.60,
  zoom: 11,
  pitch: 30,
  bearing: 0,
} as const;

/** Carto dark tiles (no token required) */
export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Delhi bounding box */
export const CITY_BBOX = {
  lat_min: 28.45, lat_max: 28.75,
  lon_min: 76.95, lon_max: 77.35,
} as const;

// ─── Layers ───────────────────────────────────────────────────────────────────

export const LAYER_LABELS: Record<LayerId, string> = {
  fusion:     "Fusion PM2.5",
  stations:   "Stations",
  satellite:  "Satellite",
  hotspots:   "Hotspots",
  fires:      "Fires",
  wind:       "Wind",
  wards:      "Ward Boundaries",
  blindspots: "Blind Spots",
  dispatch:   "Dispatch Routes",
};

export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  fusion:     true,
  stations:   true,
  satellite:  false,
  hotspots:   true,
  fires:      false,
  wind:       false,
  wards:      true,
  blindspots: false,
  dispatch:   false,
};

// ─── Agents ───────────────────────────────────────────────────────────────────

export const AGENT_LABELS: Record<AgentName, string> = {
  detection:      "Detection",
  attribution:    "Attribution",
  forecast:       "Forecast",
  prioritisation: "Prioritisation",
  memo:           "Enforcement Memo",
  advisory:       "Advisory",
  ledger:         "Ledger",
};

export const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  detection:      "Satellite contrast + fire persistence → chronic / emerging / acute zones",
  attribution:    "Names the responsible source with evidence chain + confidence",
  forecast:       "24–72h PM2.5 forecast per cell via wind-weighted graph neural net",
  prioritisation: "Enforcement Priority Score + inspection route assignment",
  memo:           "Generates dispatch-ready enforcement memo with legal citation",
  advisory:       "Ward-level health advisories in Kannada / Hindi / English",
};

export const AGENT_ORDER: AgentName[] = [
  "detection",
  "attribution",
  "forecast",
  "prioritisation",
  "memo",
  "advisory",
  "ledger",
];

// ─── Hotspot / Source ─────────────────────────────────────────────────────────

export const PERSISTENCE_LABELS: Record<HotspotKind, string> = {
  chronic:  "Chronic (30d)",
  emerging: "Emerging (7d)",
  acute:    "Acute (24h)",
};

export const PERSISTENCE_DESCRIPTIONS: Record<HotspotKind, string> = {
  chronic:  "Elevated over 30 days — build the case file",
  emerging: "Elevated over 7 days, not 30 — act now",
  acute:    "Elevated in 24h only — send a truck, not a notice",
};

export const SOURCE_LABELS: Record<SourceCategory, string> = {
  industrial:    "Industrial",
  waste_burning: "Waste Burning",
  construction:  "Construction",
  traffic:       "Traffic",
};

// ─── Citizen reports ──────────────────────────────────────────────────────────

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  waste_burning:    "Waste / Garbage Burning",
  construction_dust: "Construction Dust",
  industrial:       "Industrial Smoke",
  traffic:          "Vehicle Exhaust",
  other:            "Other",
};

export const REPORT_CATEGORY_ICONS: Record<ReportCategory, string> = {
  waste_burning:    "🔥",
  construction_dust: "🏗️",
  industrial:       "🏭",
  traffic:          "🚗",
  other:            "⚠️",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  submitted:    "Submitted",
  under_review: "Under Review",
  corroborated: "Corroborated",
  action_taken: "Action Taken",
  resolved:     "Resolved",
};

export const REPORT_STATUS_COLORS: Record<string, string> = {
  submitted:    "#6b7280",
  under_review: "#3b82f6",
  corroborated: "#f59e0b",
  action_taken: "#10b981",
  resolved:     "#22c55e",
};

// ─── Satellite ────────────────────────────────────────────────────────────────

export const SAT_CHANNEL_LABELS = {
  no2_col: "NO₂ Column",
  so2_col: "SO₂ Column",
  aai:     "Aerosol Index",
} as const;

// ─── AQI Category health advice ───────────────────────────────────────────────

export const AQI_ADVICE = [
  "Air quality is Good. Great day to be outside!",
  "Air quality is Satisfactory. Unusually sensitive people should consider limiting prolonged exertion.",
  "Air quality is Moderate. Reduce prolonged or heavy exertion. Take more breaks during outdoor activities.",
  "Air quality is Poor. People with heart or lung disease, the elderly and children should avoid prolonged exertion.",
  "Air quality is Very Poor. Everyone should avoid prolonged exertion. Sensitive groups: avoid all outdoor activity.",
  "Air quality is Severe. Everyone should avoid any outdoor exertion; sensitive groups should remain indoors.",
];
