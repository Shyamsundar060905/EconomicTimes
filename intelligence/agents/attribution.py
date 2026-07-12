"""Source Attribution Agent — the innovation core.

For each hotspot: assemble a structured evidence profile from data already in
the panel, score each source category deterministically, then have the LLM
write the grounded explanation (rule-based prose if no LLM). The LLM never
picks the answer alone — category scores are arithmetic; the LLM explains.

Evidence per hotspot:
  candidates        named sources within 5 km: distance, bearing, wind alignment
  pollutant_signature  satellite ratios vs city percentiles (SO2->industrial,
                       AAI->burning, NO2 @ rush hours->traffic)
  fire_activity     FIRMS detections near the cell, trailing 6 h
  landuse_context   source-kind counts within 1.5 km
  meteorology       wind, boundary layer (is air trapped? where does it come from?)

Output: data/outputs/attributions.json
"""
import json

import numpy as np
import pandas as pd

from shared.config import DATA_RAW, DATA_OUT
from shared.grid import cell_center, haversine_km, bearing_deg, wind_alignment, circular_mean_deg
from shared.wards import ward_frame
from intelligence.agents.llm_gateway import complete_json

CATEGORIES = ["industrial", "construction", "waste_burning", "traffic"]
MAX_SOURCE_KM = 5.0
WARDS = dict(zip(ward_frame().cell, ward_frame().ward_id))


# ------------------------------------------------------------ evidence
def build_evidence(cell: str, ts: pd.Timestamp, panel_row: pd.Series,
                   osm: pd.DataFrame, sat_pct: dict,
                   wind_hist: list[float] | None = None) -> dict:
    lat, lon = cell_center(cell)
    # Bearings live on a circle: the arithmetic mean of 350 and 10 is 180, which
    # points the evidence chain at exactly the wrong suspect. Chronic hotspots
    # summarise a week of wind, so they must use the circular mean.
    wind_from = circular_mean_deg(wind_hist) if wind_hist else float(panel_row.wind_from_deg)
    hour = int(panel_row.hour)

    def align(slat, slon):
        # chronic hotspots: 'frequently downwind' = mean alignment over the
        # week's winds; anomalies: alignment with the wind right now
        if wind_hist:
            return float(np.mean([wind_alignment(slat, slon, lat, lon, w) for w in wind_hist]))
        return wind_alignment(slat, slon, lat, lon, wind_from)

    candidates = []
    for r in osm[osm.kind.isin(CATEGORIES)].itertuples():
        d = haversine_km(r.lat, r.lon, lat, lon)
        if d > MAX_SOURCE_KM:
            continue
        candidates.append({
            "name": r.name, "type": r.kind, "distance_km": round(d, 2),
            "wind_alignment": round(align(r.lat, r.lon), 2),
        })
    candidates.sort(key=lambda c: (-c["wind_alignment"] / (1 + c["distance_km"])))

    sig = {}
    for col, pcts in sat_pct.items():
        v = float(panel_row[col])
        sig[col] = {"value": round(v, 1),
                    "city_percentile": int(100 * np.searchsorted(pcts, v) / len(pcts))}

    return {
        "cell": cell, "ts": str(ts), "ward_id": WARDS.get(cell, "unassigned"),
        "pm25_estimate": round(float(panel_row.get("pm25_hat", np.nan)), 1),
        "candidates": candidates[:8],
        "pollutant_signature": sig,
        "fire_activity": {"fires_6h": int(panel_row.fires_6h), "frp_6h": round(float(panel_row.frp_6h), 1)},
        "landuse_context": {k: int(panel_row[f"lu_{k}"]) for k in CATEGORIES},
        "meteorology": {"wind_from_deg": round(wind_from), "wind_ms": round(float(panel_row.wind_ms), 1),
                        "blh_m": round(float(panel_row.blh_m)), "hour_local": hour,
                        "air_trapped": bool(panel_row.blh_m < 500)},
    }


# ------------------------------------------------- deterministic scores
def category_scores(ev: dict) -> dict:
    """Plain arithmetic per category. The LLM never touches this."""
    s = {c: 0.0 for c in CATEGORIES}
    for cand in ev["candidates"]:
        # upwind proximity: alignment high & distance small -> strong
        s[cand["type"]] += cand["wind_alignment"] * np.exp(-cand["distance_km"] / 2.0)
    sig = ev["pollutant_signature"]
    if sig.get("so2_col", {}).get("city_percentile", 0) >= 80:
        s["industrial"] += 0.8
    if sig.get("aai", {}).get("city_percentile", 0) >= 80:
        s["waste_burning"] += 0.8
    hour = ev["meteorology"]["hour_local"]
    if sig.get("no2_col", {}).get("city_percentile", 0) >= 80 and (7 <= hour <= 10 or 17 <= hour <= 20):
        s["traffic"] += 0.8
    if ev["fire_activity"]["fires_6h"] > 0:
        s["waste_burning"] += 0.6 + 0.1 * ev["fire_activity"]["fires_6h"]
    for k in CATEGORIES:
        s[k] += 0.15 * min(ev["landuse_context"][k], 3)
    if 8 <= hour <= 18:
        s["construction"] *= 1.2   # construction is a daytime activity
    else:
        s["construction"] *= 0.5
    return {k: round(v, 3) for k, v in s.items()}


def confidence_from(scores: dict) -> float:
    """Evidence agreement, not LLM self-report: margin of top-1 over top-2."""
    vals = sorted(scores.values(), reverse=True)
    if vals[0] <= 0:
        return 0.1
    margin = (vals[0] - vals[1]) / vals[0]
    return round(float(np.clip(0.35 + 0.6 * margin, 0.1, 0.95)), 2)


# ---------------------------------------------------------- reasoners
PROMPT = """You are an air-pollution attribution analyst. Using ONLY the evidence
below, explain the most likely primary source of this PM2.5 hotspot. Do not
invent facts not present in the evidence. The category scores were computed
deterministically; your job is to explain, not to re-decide.

EVIDENCE:
{evidence}

CATEGORY SCORES (deterministic): {scores}

Return STRICT JSON only:
{{"primary_source": "<one of {cats}>",
  "reason": "<2-3 sentences citing specific evidence items>",
  "evidence_factors": ["<short factor>", "..."]}}"""


def rule_based_reason(ev: dict, scores: dict, top: str) -> dict:
    factors = []
    best_cand = next((c for c in ev["candidates"] if c["type"] == top), None)
    if best_cand:
        factors.append(f'{best_cand["name"]} is {best_cand["distance_km"]} km away, '
                       f'wind alignment {best_cand["wind_alignment"]}')
    sig = ev["pollutant_signature"]
    sig_map = {"industrial": "so2_col", "waste_burning": "aai", "traffic": "no2_col"}
    if top in sig_map and sig.get(sig_map[top], {}).get("city_percentile", 0) >= 80:
        factors.append(f'{sig_map[top]} at p{sig[sig_map[top]]["city_percentile"]} citywide')
    if top == "waste_burning" and ev["fire_activity"]["fires_6h"]:
        factors.append(f'{ev["fire_activity"]["fires_6h"]} satellite fire detections in last 6h')
    if ev["meteorology"]["air_trapped"]:
        factors.append(f'shallow boundary layer ({ev["meteorology"]["blh_m"]} m) trapping emissions')
    reason = (f"Deterministic evidence scoring points to {top.replace('_', ' ')} "
              f"as the primary source. " + "; ".join(factors[:3]) + ".")
    return {"primary_source": top, "reason": reason, "evidence_factors": factors}


def attribute_one(ev: dict) -> dict:
    scores = category_scores(ev)
    top = max(scores, key=scores.get)
    conf = confidence_from(scores)
    llm_out, provider = complete_json(PROMPT.format(
        evidence=json.dumps(ev, indent=1), scores=json.dumps(scores), cats=CATEGORIES))
    if llm_out and llm_out.get("primary_source") in CATEGORIES:
        # guardrail: LLM may only explain; if it disagrees with arithmetic, arithmetic wins
        if llm_out["primary_source"] != top:
            llm_out = rule_based_reason(ev, scores, top)
            provider += "+overridden"
        result = llm_out
    else:
        result, provider = rule_based_reason(ev, scores, top), "rules"
    return {"cell": ev["cell"], "ts": ev["ts"], "ward_id": ev["ward_id"],
            "pm25_estimate": ev["pm25_estimate"],
            "primary_source": result["primary_source"], "confidence": conf,
            "scores": scores, "reason": result["reason"],
            "evidence_factors": result.get("evidence_factors", []),
            "evidence": ev, "explained_by": provider}


# -------------------------------------------------------------- runner
def run(top_n: int = 100) -> list[dict]:
    hotspots = json.loads((DATA_OUT / "hotspots.json").read_text())[:top_n]
    panel = pd.read_parquet(DATA_OUT / "panel.parquet")
    field = pd.read_parquet(DATA_OUT / "fusion_field.parquet")
    osm = pd.read_parquet(DATA_RAW / "osm.parquet")
    panel["ts"] = pd.to_datetime(panel.ts, utc=True)
    field["ts"] = pd.to_datetime(field.ts, utc=True)
    panel = panel.merge(field, on=["cell", "ts"], how="left")
    sat_pct = {c: np.sort(panel[c].dropna().values) for c in ("no2_col", "so2_col", "aai")}

    out = []
    for h in hotspots:
        ts = pd.Timestamp(h["ts"])
        kind = h.get("kind", "anomaly")
        if kind == "chronic":
            week = panel[(panel.cell == h["cell"]) & (panel.ts > ts - pd.Timedelta(days=7))]
            if week.empty:
                continue
            row = week.mean(numeric_only=True)
            row["hour"] = 12  # neutral daytime context for chronic evidence
            wind_hist = week.wind_from_deg.tolist()
            ev = build_evidence(h["cell"], ts, row, osm, sat_pct, wind_hist=wind_hist)
        else:
            r = panel[(panel.cell == h["cell"]) & (panel.ts == ts)]
            if r.empty:
                continue
            ev = build_evidence(h["cell"], ts, r.iloc[0], osm, sat_pct)
        ev["hotspot_kind"] = kind
        out.append(attribute_one(ev))
    (DATA_OUT / "attributions.json").write_text(json.dumps(out, indent=2))
    by_src = pd.Series([o["primary_source"] for o in out]).value_counts().to_dict()
    prov = pd.Series([o["explained_by"] for o in out]).value_counts().to_dict()
    print(f"[attribute] {len(out)} hotspots attributed {by_src} (explained by {prov})")
    return out


if __name__ == "__main__":
    run()
