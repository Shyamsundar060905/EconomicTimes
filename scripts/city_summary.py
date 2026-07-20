"""Distill one city's pipeline outputs into a comparison row, and snapshot them.

Multi-city is REAL here: each city is a separate full pipeline run over live
Sentinel-5P / FIRMS / OpenAQ / OSM. Because DATA_OUT is a single flat directory,
runs would clobber each other — so after each run we call this to (a) copy the
outputs into data/outputs_snapshots/<city>/ and (b) append a distilled summary
row to data/outputs/city_comparison.json, the contract the frontend /compare
view reads.

Everything here is DESCRIPTIVE of what the run actually produced — it invents no
metric. If a field could not be computed for a city (sparse stations, cloud), it
is null and the frontend says so, per the honesty rule.

    PYTHONPATH=. AQ_CITY=delhi python scripts/city_summary.py --snapshot
"""
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.config import CITY, DATA_OUT, WINDOW_END  # noqa: E402

SNAP_ROOT = DATA_OUT.parent / "outputs_snapshots"
COMPARISON_PATH = DATA_OUT / "city_comparison.json"


def _load(name: str):
    p = DATA_OUT / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def summarize() -> dict:
    """A comparison row for the current city, read straight from its outputs."""
    hotspots = _load("hotspots.json") or []
    attributions = _load("attributions.json") or []
    forecast_eval = _load("forecast_eval.json") or {}
    actions = _load("actions.json") or []
    advisories = _load("advisories.json") or []
    loso = _load("loso.json") or {}

    # detection: cells, zones, enforceable vs diffuse
    zones = {h.get("zone_id") for h in hotspots if h.get("zone_id") is not None}
    enforceable = [h for h in hotspots if h.get("attributable")]

    # attribution: how many named, by source category, mean confidence
    by_source = Counter(a.get("primary_source") for a in attributions)
    confs = [a.get("confidence") for a in attributions
             if isinstance(a.get("confidence"), (int, float))]
    mean_conf = round(sum(confs) / len(confs), 3) if confs else None

    # forecast skill vs persistence, per horizon (the brief's headline metric)
    skill = {}
    for h in ("h24", "h48", "h72"):
        row = forecast_eval.get(h) or {}
        skill[h] = row.get("skill_vs_persistence_pct")

    return {
        "city": CITY,
        "window_end": WINDOW_END or "now",
        "mode": "live" if WINDOW_END else "live/now",
        "detection": {
            "hotspot_cells": len(hotspots),
            "zones": len(zones),
            "enforceable_cells": len(enforceable),
        },
        "attribution": {
            "named": len(attributions),
            "by_source": dict(by_source),
            "mean_confidence": mean_conf,
        },
        "forecast_skill_vs_persistence_pct": skill,
        "fusion_loso_r2": (loso.get("overall") or {}).get("r2"),
        "actions_queued": len(actions),
        "advisory_wards": len(advisories),
    }


def snapshot() -> None:
    dest = SNAP_ROOT / CITY
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    # BOTH json AND parquet: the map's fusion choropleth reads fusion_field.parquet,
    # and the backend derives several endpoints from the parquets. A json-only
    # snapshot leaves the parquet on whatever city ran last, so a "restore" would
    # serve one city's hotspots over another city's fusion field. Snapshot all.
    for pattern in ("*.json", "*.parquet"):
        for p in DATA_OUT.glob(pattern):
            if p.name == "city_comparison.json":
                continue
            shutil.copy2(p, dest / p.name)
            n += 1
    print(f"[snapshot] {n} outputs (json+parquet) -> "
          f"{dest.relative_to(DATA_OUT.parent.parent)}")


def append_comparison(row: dict) -> None:
    rows = []
    if COMPARISON_PATH.exists():
        try:
            rows = json.loads(COMPARISON_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            rows = []
    # replace any existing row for this city (re-runnable, no dupes)
    rows = [r for r in rows if r.get("city") != row["city"]]
    rows.append(row)
    rows.sort(key=lambda r: r["city"])
    COMPARISON_PATH.write_text(json.dumps(rows, indent=2, ensure_ascii=False),
                               encoding="utf-8")
    print(f"[comparison] {row['city']} row written "
          f"({len(rows)} cities in city_comparison.json)")


def main() -> None:
    row = summarize()
    print(json.dumps(row, indent=2, ensure_ascii=False))
    append_comparison(row)
    if "--snapshot" in sys.argv:
        snapshot()


if __name__ == "__main__":
    main()
