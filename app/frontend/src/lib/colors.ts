/**
 * India NAQI (National Air Quality Index) breakpoints and color palette.
 * Used for all AQI-based coloring across the map layers and UI components.
 */

// ─── AQI Breakpoints ──────────────────────────────────────────────────────────

export const AQI_BREAKPOINTS = [0, 50, 100, 200, 300, 400, 500] as const;

export const AQI_CATEGORIES = [
  { label: "Good", range: "0–50", color: "#00b050", textColor: "#fff", pm25Max: 12 },
  { label: "Satisfactory", range: "51–100", color: "#92d050", textColor: "#222", pm25Max: 35.4 },
  { label: "Moderate", range: "101–200", color: "#ffff00", textColor: "#222", pm25Max: 55.4 },
  { label: "Poor", range: "201–300", color: "#ff9900", textColor: "#fff", pm25Max: 150.4 },
  { label: "Very Poor", range: "301–400", color: "#ff0000", textColor: "#fff", pm25Max: 250.4 },
  { label: "Severe", range: "401–500", color: "#99004c", textColor: "#fff", pm25Max: Infinity },
] as const;

/** Convert PM2.5 µg/m³ to India NAQI AQI (simplified linear interpolation) */
export function pm25ToAqi(pm25: number): number {
  if (pm25 <= 12) return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4) return Math.round(50 + ((100 - 50) / (35.4 - 12)) * (pm25 - 12));
  if (pm25 <= 55.4) return Math.round(100 + ((200 - 100) / (55.4 - 35.4)) * (pm25 - 35.4));
  if (pm25 <= 150.4) return Math.round(200 + ((300 - 200) / (150.4 - 55.4)) * (pm25 - 55.4));
  if (pm25 <= 250.4) return Math.round(300 + ((400 - 300) / (250.4 - 150.4)) * (pm25 - 150.4));
  return Math.round(400 + ((500 - 400) / (500 - 250.4)) * Math.min(pm25 - 250.4, 249.6));
}

export function getAqiCategory(aqi: number) {
  if (aqi <= 50) return AQI_CATEGORIES[0];
  if (aqi <= 100) return AQI_CATEGORIES[1];
  if (aqi <= 200) return AQI_CATEGORIES[2];
  if (aqi <= 300) return AQI_CATEGORIES[3];
  if (aqi <= 400) return AQI_CATEGORIES[4];
  return AQI_CATEGORIES[5];
}

export function pm25ToColor(pm25: number): [number, number, number, number] {
  return hexToRgba(getAqiCategory(pm25ToAqi(pm25)).color);
}

// ─── Color Utilities ──────────────────────────────────────────────────────────

export function hexToRgba(hex: string, alpha = 200): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b, alpha];
}

/** Continuous PM2.5 → RGBA for H3 choropleth (green → yellow → red → purple) */
export function pm25ToRgbaArray(pm25: number, alpha = 200): [number, number, number, number] {
  // Clamp to [0, 300] then map to a 6-stop gradient
  const stops: Array<{ at: number; r: number; g: number; b: number }> = [
    { at: 0,   r: 0,   g: 176, b: 80  },  // green
    { at: 50,  r: 146, g: 208, b: 80  },  // light green
    { at: 100, r: 255, g: 255, b: 0   },  // yellow
    { at: 200, r: 255, g: 153, b: 0   },  // orange
    { at: 300, r: 255, g: 0,   b: 0   },  // red
    { at: 400, r: 153, g: 0,   b: 76  },  // purple
  ];
  const v = Math.max(0, Math.min(pm25, 400));
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i], hi = stops[i + 1];
    if (v <= hi.at) {
      const t = (v - lo.at) / (hi.at - lo.at);
      return [
        Math.round(lo.r + t * (hi.r - lo.r)),
        Math.round(lo.g + t * (hi.g - lo.g)),
        Math.round(lo.b + t * (hi.b - lo.b)),
        alpha,
      ];
    }
  }
  return [153, 0, 76, alpha];
}

// ─── Severity Colors (for hotspot zones) ─────────────────────────────────────

export const SEVERITY_COLORS = {
  chronic:  { fill: hexToRgba("#ff0000", 160), border: hexToRgba("#ff0000", 255) },
  emerging: { fill: hexToRgba("#ff9900", 140), border: hexToRgba("#ff9900", 230) },
  acute:    { fill: hexToRgba("#ff6600", 120), border: hexToRgba("#ffcc00", 240) },
} as const;

// ─── Source Category Colors ───────────────────────────────────────────────────

export const SOURCE_COLORS: Record<string, string> = {
  industrial:    "#f87171",
  waste_burning: "#fb923c",
  construction:  "#facc15",
  traffic:       "#60a5fa",
};

// ─── Satellite Channel Colors ─────────────────────────────────────────────────

export const SAT_CHANNEL_COLORS: Record<string, [string, string]> = {
  no2_col: ["#dbeafe", "#1d4ed8"],
  so2_col: ["#fef3c7", "#b45309"],
  aai:     ["#ede9fe", "#7c3aed"],
};
