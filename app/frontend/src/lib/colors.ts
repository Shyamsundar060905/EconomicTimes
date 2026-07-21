/**
 * India NAQI breakpoints and the app's data palette.
 *
 * ⚠ THE PALETTE LIVES HERE AND IN globals.css, AND THE TWO MUST AGREE.
 * WebGL layers (deck.gl) need numeric RGBA and cannot read a CSS custom
 * property, so the hexes are duplicated once, here, next to the token name they
 * mirror. Nowhere else. Before this, LegendBar.tsx carried a THIRD, different
 * AQI palette (#22c55e/#fde047/…) — so the legend and the map it explained were
 * literally different colours.
 *
 * The values are the CPCB hue ORDER at roughly 60% saturation. The published
 * CPCB swatches (#00b050, #ffff00, #ff0000) are print/signage colours; at full
 * chroma across a whole choropleth they vibrate and read as a game board.
 */

// ─── AQI Breakpoints ──────────────────────────────────────────────────────────

export const AQI_BREAKPOINTS = [0, 50, 100, 200, 300, 400, 500] as const;

// India NAQI PM2.5 breakpoints (CPCB). These MUST match the backend's authoritative
// table (intelligence/agents/memo.py::NAQI_PM25) or the citizen map would show a
// different AQI than the advisory computed for the same ward. Earlier this file
// used US EPA breakpoints (12/35.4/55.4/…) with Indian labels — a real mismatch.
export const AQI_CATEGORIES = [
  // color ↔ --aqi-N  ·  textColor ↔ --aqi-N-ink
  { label: "Good",         range: "0–50",    color: "#5a9e72", textColor: "#0d1710", pm25Max: 30 },
  { label: "Satisfactory", range: "51–100",  color: "#94af63", textColor: "#131707", pm25Max: 60 },
  { label: "Moderate",     range: "101–200", color: "#d3b155", textColor: "#1a1508", pm25Max: 90 },
  { label: "Poor",         range: "201–300", color: "#d08e51", textColor: "#1b1006", pm25Max: 120 },
  { label: "Very Poor",    range: "301–400", color: "#c2635a", textColor: "#ffffff", pm25Max: 250 },
  { label: "Severe",       range: "401–500", color: "#8e4a67", textColor: "#ffffff", pm25Max: Infinity },
] as const;

/** Convert PM2.5 µg/m³ to India NAQI AQI. Mirrors backend memo.py::pm25_to_aqi. */
export function pm25ToAqi(pm25: number): number {
  // (conc_lo, conc_hi, aqi_lo, aqi_hi) — CPCB NAQI PM2.5 sub-index table
  const bands: [number, number, number, number][] = [
    [0, 30, 0, 50],
    [30, 60, 51, 100],
    [60, 90, 101, 200],
    [90, 120, 201, 300],
    [120, 250, 301, 400],
    [250, 1000, 401, 500],
  ];
  for (const [cLo, cHi, iLo, iHi] of bands) {
    if (pm25 <= cHi) {
      return Math.round(iLo + ((iHi - iLo) * (pm25 - cLo)) / (cHi - cLo));
    }
  }
  return 500;
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

/** Continuous PM2.5 → RGBA for the H3 choropleth. Interpolates the SAME six AQI
 *  band colours the legend lists, so a cell's fill is always findable in the key. */
export function pm25ToRgbaArray(pm25: number, alpha = 200): [number, number, number, number] {
  const stops: Array<{ at: number; rgb: [number, number, number] }> = [
    { at: 0,   rgb: [0x5a, 0x9e, 0x72] },  // Good
    { at: 50,  rgb: [0x94, 0xaf, 0x63] },  // Satisfactory
    { at: 100, rgb: [0xd3, 0xb1, 0x55] },  // Moderate
    { at: 200, rgb: [0xd0, 0x8e, 0x51] },  // Poor
    { at: 300, rgb: [0xc2, 0x63, 0x5a] },  // Very Poor
    { at: 400, rgb: [0x8e, 0x4a, 0x67] },  // Severe
  ];
  const v = Math.max(0, Math.min(pm25, 400));
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i], hi = stops[i + 1];
    if (v <= hi.at) {
      const t = (v - lo.at) / (hi.at - lo.at);
      return [
        Math.round(lo.rgb[0] + t * (hi.rgb[0] - lo.rgb[0])),
        Math.round(lo.rgb[1] + t * (hi.rgb[1] - lo.rgb[1])),
        Math.round(lo.rgb[2] + t * (hi.rgb[2] - lo.rgb[2])),
        alpha,
      ];
    }
  }
  return [0x8e, 0x4a, 0x67, alpha];
}

// ─── Persistence / severity (hotspot zones) ──────────────────────────────────
// ↔ --persist-chronic / --persist-emerging / --persist-acute

export const PERSISTENCE_HEX = {
  chronic:  "#c05c55",
  emerging: "#c99a4e",
  acute:    "#d3813f",
} as const;

export const SEVERITY_COLORS = {
  chronic:  { fill: hexToRgba(PERSISTENCE_HEX.chronic,  150), border: hexToRgba(PERSISTENCE_HEX.chronic,  240) },
  emerging: { fill: hexToRgba(PERSISTENCE_HEX.emerging, 130), border: hexToRgba(PERSISTENCE_HEX.emerging, 225) },
  acute:    { fill: hexToRgba(PERSISTENCE_HEX.acute,    115), border: hexToRgba(PERSISTENCE_HEX.acute,    235) },
} as const;

// ─── Source category ─────────────────────────────────────────────────────────
// ↔ --source-*. Categorical, not a ramp: chosen for separability at small sizes
// rather than for looking like a paint set.

export const SOURCE_COLORS: Record<string, string> = {
  industrial:    "#c0705b",
  waste_burning: "#ce9a4a",
  construction:  "#9a9382",
  traffic:       "#6e8fc0",
};

/** Neutral grey for a WebGL layer with no category match. deck.gl needs numeric
 *  RGBA and cannot read a CSS custom property, so unknown-value fallbacks live
 *  here rather than as a literal at the call site. */
export const UNKNOWN_HEX = "#7a7a7a";

// ─── Fire confidence (FIRMS) ─────────────────────────────────────────────────

export const FIRE_HEX = { high: "#d0603f", low: "#c99a4e" } as const;

// ─── Blind spots (network audit) ─────────────────────────────────────────────

export const BLINDSPOT_HEX = "#c9b04e";

// ─── Satellite channel ramps ─────────────────────────────────────────────────

export const SAT_CHANNEL_COLORS: Record<string, [string, string]> = {
  no2_col: ["#c9d4ea", "#4a5f8f"],
  so2_col: ["#e8ddc6", "#8a6a35"],
  aai:     ["#ddd6e6", "#665a80"],
};
