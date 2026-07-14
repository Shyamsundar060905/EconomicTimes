# Sample outputs — real Delhi, November 2025

**Committed on purpose.** `data/raw/` and `data/outputs/` are gitignored (they are
regenerated), but these three files are checked in so that **EPS, dispatch, the memo
agent and the frontend can be built with ZERO setup** — no API keys, no GEE, no
cloud account, no pipeline run.

This is the real thing: real Sentinel-5P, real NASA FIRMS, real CPCB stations, real
OpenStreetMap, over Delhi for the 60 days ending 2025-11-30.

| file | what |
|---|---|
| `delhi_hotspots.json` | 70 hotspot cells in **6 zones**. Group by `zone_id` — an action is a ZONE. |
| `delhi_attributions.json` | one verdict per zone, repeated onto each of its cells (the API is keyed by cell) |
| `delhi_landuse.json` | per-cell `lu_sensitive` (schools + hospitals within 1.5 km) — the **EPS vulnerability term**, extracted so you don't need the 2.4M-row panel |

## What's in it

**Bhalswa landfill → `waste_burning`, confidence 0.76** — *"satellite fire detections
in 30 hours (18% of the window)"*. A real burning landfill, found from space. Google
"Bhalswa landfill fire November 2025".

**Okhla landfill → `waste_burning`, confidence 0.52** — only 2 hours of fire, so the
confidence is honestly lower. Same verdict, different certainty. That is what a
calibrated confidence is for.

## Two things that will bite you

1. **An action is a ZONE, not a cell.** 70 cells → 6 zones. An inspector is dispatched
   to a place, not a 460 m hexagon. Group by `zone_id` or your queue will have 70
   near-duplicate cards for 6 real sites.

2. **Only `attributable: true` zones belong in the enforcement queue.** A diffuse zone
   is real pollution with nobody to serve a notice on — it stays on the map as a
   policy target. (In this Delhi extract every zone happens to be attributable;
   the synthetic world has a diffuse one, so handle the flag.)

## To regenerate (needs keys)

```powershell
$env:AQ_CITY = "delhi"; $env:AQ_WINDOW_END = "2025-11-30"
python scripts/run_pipeline.py --full
```

## To get the same shapes with NO keys at all

```powershell
$env:PYTHONPATH = "."
python scripts/run_pipeline.py --synthetic --full
```
Writes the same schemas to `data/outputs/`. Smaller world (12 cells, 3 zones) but it
has ground truth, so it is the only place accuracy can be *scored*.
