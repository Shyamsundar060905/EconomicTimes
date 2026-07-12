"""Hotspot detection — Node 1 of the agent pipeline.

A cell is a hotspot at hour T if its fusion-field estimate exceeds its own
rolling baseline (same hour-of-week, exponentially decayed) by both a relative
and an absolute margin. Using the cell's OWN baseline (not the city mean)
means a chronically dirty industrial cell must get WORSE to alert, and a
normally-clean residential cell alerts on a modest spike — which is what an
administrator actually wants.

Output: data/outputs/hotspots.json  (latest hour, ranked by severity)
"""
import json

import numpy as np
import pandas as pd

from shared.config import DATA_OUT
from shared.wards import attach_wards

REL_MARGIN = 1.25   # >= 25% above own baseline
ABS_MARGIN = 15.0   # and >= 15 ug/m3 above it
HALF_LIFE_DAYS = 7  # baseline decay
CHRONIC_SAT_PCT = 0.95  # top 5% satellite composite across cells
CHRONIC_FUS_MIN = 1.0   # and fusion agrees: >= +1 ug/m3 vs city 7-day median


def rolling_baseline(field: pd.DataFrame) -> pd.DataFrame:
    """Exponentially-decayed mean per (cell, hour-of-week), excluding the last 24h."""
    f = field.copy()
    f["how"] = f.ts.dt.dayofweek * 24 + f.ts.dt.hour
    cutoff = f.ts.max() - pd.Timedelta(hours=24)
    hist = f[f.ts <= cutoff].copy()
    age_days = (cutoff - hist.ts).dt.total_seconds() / 86400.0
    hist["w"] = 0.5 ** (age_days / HALF_LIFE_DAYS)
    hist["wx"] = hist.w * hist.pm25_hat
    g = hist.groupby(["cell", "how"])
    base = (g.wx.sum() / g.w.sum()).rename("baseline").reset_index()
    return f.merge(base, on=["cell", "how"], how="left")


def detect(field: pd.DataFrame | None = None, at: pd.Timestamp | None = None) -> pd.DataFrame:
    if field is None:
        field = pd.read_parquet(DATA_OUT / "fusion_field.parquet")
    field["ts"] = pd.to_datetime(field.ts, utc=True)
    f = rolling_baseline(field)
    at = at or f.ts.max()
    now = f[f.ts == at].dropna(subset=["baseline"]).copy()
    now["excess"] = now.pm25_hat - now.baseline
    # citywide-episode correction: subtract the median excess across all cells,
    # so a low-BLH day that lifts the WHOLE city doesn't flag every cell as a
    # "hotspot" — we detect LOCALIZED anomalies; citywide episodes are reported
    # separately as one flag.
    city_shift = float(now.excess.median())
    now["excess_local"] = now.excess - city_shift
    now["ratio"] = (now.baseline + now.excess_local) / now.baseline
    hot = now[(now.ratio >= REL_MARGIN) & (now.excess_local >= ABS_MARGIN)].copy()
    hot["kind"] = "anomaly"
    # anomaly severity: how far above its OWN baseline is this cell, right now
    if len(hot):
        hot["severity"] = (
            0.5 * np.clip(hot.pm25_hat / 250.0, 0, 1) +
            0.5 * np.clip(hot.excess_local / 80.0, 0, 1)
        ).round(3)
    if city_shift >= ABS_MARGIN:
        print(f"[detect] citywide episode flag: median excess {city_shift:+.1f} ug/m3 "
              f"(meteorology-driven; reported separately from local hotspots)")

    # ---- chronic hotspots: persistently above the CITY level ----
    # A cell beside a factory is 'normal' at its own elevated baseline, so the
    # anomaly detector can never see it. Chronic = 7-day mean far above the
    # citywide 7-day mean. This is the primary ENFORCEMENT target; anomalies
    # are the primary RESPONSE target.
    # The fusion model is trained at station cells only, and stations sit away
    # from sources — so it underestimates source-cell elevation. The satellite
    # has UNIFORM coverage of every cell, so chronic detection reads the 7-day
    # satellite composite directly and blends in the fusion excess.
    panel = pd.read_parquet(DATA_OUT / "panel.parquet")
    panel["ts"] = pd.to_datetime(panel.ts, utc=True)
    week_p = panel[panel.ts > at - pd.Timedelta(days=7)]
    comp = week_p.groupby("cell")[["no2_col", "so2_col", "aai"]].mean()
    pct = comp.rank(pct=True)                       # per-pollutant percentile across cells
    sat_score = pct.max(axis=1)                     # extreme in ANY pollutant counts

    week = f[f.ts > at - pd.Timedelta(days=7)]
    cell_mean = week.groupby("cell").pm25_hat.mean()
    city_mean = float(cell_mean.median())
    fus_excess = (cell_mean - city_mean).reindex(sat_score.index).fillna(0.0)

    chron_mask = (sat_score >= CHRONIC_SAT_PCT) & (fus_excess >= CHRONIC_FUS_MIN)
    chron_idx = sat_score[chron_mask].index
    chron_df = pd.DataFrame({
        "cell": chron_idx, "ts": at,
        "pm25_hat": cell_mean.reindex(chron_idx).round(2),
        "baseline": round(city_mean, 2),
        "excess_local": fus_excess[chron_idx].round(2),
        "ratio": (cell_mean.reindex(chron_idx) / city_mean).round(3),
        "severity": (0.6 * sat_score[chron_idx] +
                     0.4 * np.clip(fus_excess[chron_idx] / 10.0, 0, 1)).round(3),
        "kind": "chronic",
    })
    # NOTE: chronic severity is computed in chron_df from the satellite percentile
    # and must NOT be recomputed here. Chronic excess is small by construction (a
    # chronically dirty cell sits a few ug/m3 above the CITY median, not 80 above
    # its own baseline), so scoring it on the anomaly scale buries the very cells
    # this detector exists to surface — chronic is the primary ENFORCEMENT target.
    hot = pd.concat([hot, chron_df], ignore_index=True) if len(chron_df) else hot
    if len(hot):
        hot = hot.sort_values("severity", ascending=False)
    cols = ["cell", "ts", "pm25_hat", "baseline", "excess_local", "ratio", "severity", "kind"]
    out = hot[cols] if len(hot) else pd.DataFrame(columns=cols)
    out = attach_wards(out) if len(out) else out.assign(ward_id=[], ward_name=[])
    cols = cols + ["ward_id", "ward_name"]
    payload = [{**r, "ts": str(r["ts"]), **{k: round(float(r[k]), 2) for k in
                ("pm25_hat", "baseline", "excess_local", "ratio")}}
               for r in out[cols].to_dict("records")]
    (DATA_OUT / "hotspots.json").write_text(json.dumps(payload, indent=2))
    n_chron = int((out.kind == "chronic").sum()) if len(out) else 0
    print(f"[detect] {at}: {len(out)} hotspots ({len(out) - n_chron} anomaly, {n_chron} chronic) "
          f"of {now.cell.nunique()} cells")
    return out


if __name__ == "__main__":
    detect()
