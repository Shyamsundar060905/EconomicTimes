# Spec — Enforcement Priority Score + Dispatch (Layer 5, Nodes 4)

**Status:** not built. **Blocks:** the frontend's `/actions` and `/dispatch`.
**Needs:** nothing. No GEE, no API keys, no cloud. Runs offline against the
synthetic world in two minutes:

```bash
git clone https://github.com/coffeine16/EconomicTimes.git && cd EconomicTimes
pip install -r requirements.txt
$env:PYTHONPATH = "."                                   # PowerShell
python scripts/run_pipeline.py --synthetic --full
```

Deliverable: `intelligence/agents/prioritise.py`, following the shape of
`attribution.py`. Writes `data/outputs/actions.json` and `dispatch.json`.

---

## The one rule

**Deterministic arithmetic ranks. An LLM may never touch a score.**

This is design principle #1 and it is not negotiable. The priority queue has to be
defensible to an administrator and a judge: same inputs, same ranking, every time,
with every term inspectable. An LLM may *explain* a score it did not choose. It may
not choose one.

---

## Part 1 — EPS

```
EPS = 100 × ( 0.35 · severity
            + 0.25 · attribution_conf
            + 0.20 · actionability
            + 0.20 · vulnerability )
```

Every term normalised to [0, 1]. Emit all four components alongside the total —
the frontend renders them as a breakdown, and "why is this #1" must be answerable
without reading code.

### AN ACTION IS A ZONE, NOT A CELL

The single most important thing in this spec. `hotspots.json` has ~74 rows, but
they cluster into **5 zones**, and an inspector is dispatched to a *place*, not to
a 460 m hexagon. Group by `zone_id` first. The queue is ~4 items, not 74.

Also: **only `attributable == true` zones enter the queue.** A diffuse zone is real
pollution with nobody to serve a notice on — it stays on the map, it feeds ward
advisories, it is a policy target. Putting it in an inspection queue would dispatch
a human being to go stand in traffic and issue a notice to nobody.

### The four terms — all four inputs already exist

| term | source | how |
|---|---|---|
| `severity` | `hotspots.json → severity` | already in [0,1]. Take the **max** across the zone's cells (the zone is as bad as its worst cell), not the mean. |
| `attribution_conf` | `attributions.json → confidence` | already in [0,1] and **calibrated** — 0.67 median on hits vs 0.42 on misses, 100% precision above 0.70. Take the max over the zone's cells. |
| `actionability` | `hotspots.json → attributable`, `kind`, `nearest_candidate_km` | see below |
| `vulnerability` | `panel.parquet → lu_sensitive` | count of schools/hospitals within 1.5 km. Take the max over the zone's cells, then `min(count / 5, 1.0)`. |

**`actionability`** — "can an inspector do something about this *today*":

```python
base = 1.0 if attributable else 0.0          # diffuse zones are excluded anyway
kind_weight = {"acute": 1.0,                 # a fire: go now
               "emerging": 0.8,              # newly commissioned: act before it entrenches
               "chronic": 0.6}[kind]         # a standing violator: real, but it will still be there tomorrow
locatable = 1.0 if nearest_candidate_km <= 3.0 else 0.6   # a named site vs a zone we inferred
actionability = base * kind_weight * locatable
```

`chronic` scores *lower* than `acute` here on purpose. That is not saying a
landfill matters less than a bonfire — severity already carries that. It says the
fire is the thing that stops being fixable if you wait, and this term is about
urgency of *dispatch*, not gravity of *offence*.

### Not available: forecast

The doc's EPS says "current **+ forecast** AQI excess". **The forecast agent does
not exist.** Do not block on it. Structure it so it drops in later:

```python
severity = clip(base_severity + FORECAST_WEIGHT * forecast_delta, 0, 1)
FORECAST_WEIGHT = 0.0   # set to ~0.3 when the forecast agent lands
```

Ship with `forecast_delta = 0` and a comment saying why. A zero you can explain
beats a number you invented.

---

## Part 2 — Dispatch

**The question:** given the ranked zones and *N* inspection teams, where do we
physically send them today?

Framed as **maximum-coverage set cover**:

1. Candidate stops = the centroid of each enforceable zone.
2. A stop "covers" the EPS-weighted burden of every hotspot cell within
   `COVER_RADIUS_KM = 0.4`.
3. **Greedy selection:** repeatedly take the stop that adds the most uncovered
   burden, until the stop budget is spent. Greedy on a submodular coverage
   function is provably **≥ (1 − 1/e) ≈ 63% of optimal** — say that out loud, it
   is a real guarantee and it costs nothing to state.
4. Split stops across `N_TEAMS` (round-robin by EPS, so no team gets all the
   worst ones).
5. Order each team's stops by **nearest-neighbour** from a depot.
6. Report `route_km` and `coverage_pct` = covered burden / total citywide burden.

Nearest-neighbour is not optimal and you should not pretend otherwise. Say
"greedy nearest-neighbour ordering" in the output, not "optimal route".

⚠️ **Sanity check the scale before you over-engineer.** There are currently **4
enforceable zones**. Set cover over 4 items is trivial. Write it to generalise, but
do not spend a day on a TSP solver for a problem with four nodes. Real data will
produce more; the synthetic world is small on purpose.

---

## Output contracts (frontend depends on these exactly)

```jsonc
// data/outputs/actions.json
[{
  "action_id":  "A01",
  "zone_id":    "Z00",
  "ward_id":    "W014",
  "ward_name":  "Ward 014",
  "cells":      ["88...", "88..."],        // every cell in the zone
  "centroid":   {"lat": 13.03, "lon": 77.52},
  "eps":        87.2,
  "components": {                           // MUST be present — the UI renders it
    "severity": 0.79, "attribution_conf": 0.82,
    "actionability": 0.60, "vulnerability": 0.40
  },
  "kind":         "chronic",
  "source":       "industrial",             // from attribution
  "confidence":   0.82,
  "n_cells":      21,
  "pm25_med":     142.3,
  "status":       "pending"                 // pending|dispatched|actioned|resolved
}]

// data/outputs/dispatch.json
[{
  "team_id":      "T1",
  "route_km":     18.4,
  "coverage_pct": 63.0,                     // % of citywide EPS burden covered
  "stops": [{"seq": 1, "action_id": "A01", "zone_id": "Z00",
             "ward_id": "W014", "eps": 87.2,
             "lat": 13.03, "lon": 77.52}]
}]
```

`legal_basis` is **deliberately absent** — that belongs to the memo agent, which
matches statute by rule engine. Do not guess at law here.

## Then add to `app/backend/main.py`

```python
GET /actions     -> actions.json      # read-only, like everything else
GET /dispatch    -> dispatch.json
```

Read-only, per principle #3. The API never computes; it serves what batch produced.

---

## Definition of done

- [ ] `python intelligence/agents/prioritise.py` writes both JSONs
- [ ] Re-running produces **byte-identical** output (it is pure arithmetic — if it
      does not, something is reading a clock or an unseeded RNG)
- [ ] Only `attributable` zones appear in `actions.json`
- [ ] `components` sum, times 100, equals `eps` — assert it in the code
- [ ] `coverage_pct` is between 0 and 100 and rises monotonically with stop budget
- [ ] Wired into `run_pipeline.py --full` and the two API endpoints
