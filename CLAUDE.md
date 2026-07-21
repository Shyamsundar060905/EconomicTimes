# AirCase

AI-powered urban air quality intelligence: signal -> attribution -> action.
From AQI dashboards to enforcement dispatch — names *who* is polluting,
*where*, with *what evidence*, and *what to do about it today*.

Full design doc: @./docs/architecture.md — read it before making architectural
changes. This file is operational context; that file is the source of truth
for *why* things are shaped the way they are.

## Monorepo layout (one deployable unit per top-level folder)
- `app/` — presentation: FastAPI serving layer (`app/backend/main.py`) +
  frontend (React+Vite+Leaflet, not yet built)
- `ingestion/` — data platform: `collectors/` (6 sources, live API + synthetic
  fallback per source) + `preprocessing/panel.py` (cell x hour feature table)
  + `synthetic.py` (adversarial hidden-source world for offline dev + truth-scored eval)
- `intelligence/` — `models/fusion.py` (LightGBM exposure field) +
  `models/signals.py` (robust multi-window statistics) + `agents/`
  (detect.py, attribution.py, llm_gateway.py)
- `shared/` — `config.py` (city bbox, H3 res, windows, paths) + `grid.py` (H3
  fabric, bearings, wind alignment) + `wards.py` (ward layer)
- `scripts/` — pipeline runner + evaluation scripts
- `docs/` — architecture.md (the 9-layer design), evaluation notes

## Non-negotiable design principles (do not violate silently)
1. **Deterministic arithmetic ranks; LLMs only explain.** Category scores,
   priority scores, and any ranking must be plain reproducible math. Never let
   an LLM call decide a score or ranking — it may only generate prose that
   explains a score already computed. If an LLM's answer conflicts with the
   arithmetic result, the arithmetic wins and the LLM output is discarded
   (see `intelligence/agents/attribution.py::attribute_one` for the pattern).
2. **Every LLM-dependent path needs a deterministic rule-based fallback.**
   No feature may go silent or crash because an API key is missing or a
   provider rate-limits. See `intelligence/agents/llm_gateway.py` (Gemini ->
   Groq -> None) and `attribution.py::rule_based_reason` for the pattern.
3. **Heavy compute in batch, serving stays read-only.** `app/backend/main.py`
   only reads precomputed files from `data/outputs/`. Never add live model
   inference to a request handler.
4. **Every evidence-based claim ships its evidence chain + confidence, and the
   confidence must actually discriminate.** Computed from evidence agreement,
   never LLM self-report — and *validated against truth*. A confidence that
   reads the same on hits and misses is decoration; ours previously did
   (0.74 vs 0.75) and had to be rebuilt. It is now margin + absolute evidence
   strength + count of independent agreeing instruments.
5. **Channels are dumb, agents are smart.** Messaging infra only moves bytes;
   no scoring or reasoning belongs there.
6. **Robust statistics only — never the mean.** Median for every aggregate, MAD
   for every spread. The outliers in this domain *are* the phenomenon: a mean
   lets one spike hour manufacture a chronic source out of one bonfire.
7. **One window is not a signal.** Every source claim is aggregated over
   24h/7d/30d and must survive the zoom-out. See `models/signals.py`.
8. **The evaluation must be able to fail.** Never let the synthetic generator
   hand the scorer its answer key. See "the 100% trap" below.

## Commands
```bash
pip install -r requirements.txt
$env:PYTHONPATH = "."                                    # PowerShell
python scripts/run_pipeline.py --synthetic --full        # ingest -> panel -> fusion -> detect -> attribute
python scripts/run_pipeline.py --synthetic               # fusion stage only (leaves hotspots.json STALE)
python intelligence/agents/detect.py                     # satellite+fire zone detection
python intelligence/agents/attribution.py                # source attribution
python scripts/eval_detection.py                         # THE headline stat (recall/precision vs truth)
python scripts/eval_attribution.py                       # attribution accuracy + confidence calibration
python scripts/eval_hotspot_recovery.py                  # fusion as an EXPOSURE map (not a detector)
python scripts/eval_station_sensitivity.py               # is recall an artefact of monitor siting? (no)
python scripts/compare_cities.py                         # can the satellite RESOLVE anything here?
uvicorn app.backend.main:app --reload --port 8000        # serving API
```

**Live mode.** Needs `FIRMS_KEY` + `OPENAQ_API_KEY` in `.env` (both free) and GEE
auth (`gcloud auth application-default login`; see `docs/gcp-setup.md`).
`shared/config.py` loads `.env` itself — no python-dotenv dependency.

```powershell
# Delhi, November 2025 — the real landfill/stubble burning season. This is the run
# that found Bhalswa. July is monsoon: cloud masks NO2 and NOTHING BURNS (real FIRMS
# returns 2 fires over Bengaluru in 60 days), so BOTH of the detector's instruments
# are blind. Point it at a season it can actually see.
$env:AQ_CITY = "delhi"; $env:AQ_WINDOW_END = "2025-11-30"
python scripts/run_pipeline.py --full
```

Live mode **refuses to run** if satellite, fires, or OSM fall back to synthetic
(`pollers.NO_FALLBACK`) — each of those *invents a place we would then accuse*.
Stations may degrade: they feed the exposure map, not the detector.

## The three things that will mislead you if you don't know them

**0. Two of our three satellite channels are NOISE, and the synthetic world hides it.**
Measured on real S5P over Bengaluru *and* Delhi (`scripts/compare_cities.py`):

| channel | SNR (spatial signal / noise surviving a 60-day median) | verdict |
|---|---|---|
| NO2 | 2.6 – 2.8 | usable |
| SO2 | 0.66 – 0.87 | **noise** — 49% of values are *negative*, MAD 30x the median |
| AAI | 0.76 – 1.03 | **noise** |

TROPOMI SO2 is built for volcanoes and mega point-sources; an urban industrial
cluster sits far under its noise floor. AAI at a ~5.5 km footprint sees regional
aerosol, not a landfill. On real Delhi, taking `max(contrast)` across all three
flagged **470 of 1703 cells (28% of the city)** — and **87% of those were driven by
SO2 (63%) or AAI (24%)**, i.e. we were manufacturing enforcement targets out of
retrieval error, and a real burning landfill ranked *below* them. Detection is now
**NO2 contrast + FIRMS fire persistence only** (`detect.py::POLLUTANTS`).

Our synthetic satellite gave SO2 a clean industrial signature it does not have. The
old **4/4 headline leaned on it and was never real.** If you re-add SO2 or AAI to
any scoring path, you are re-adding noise. Don't.

## The other two

**1. The fusion field is an EXPOSURE map, not a source detector.**
It trains only on station cells, and stations are sited *away* from sources — so
it never observes a source, cannot learn a source response, and (tree ensemble)
cannot extrapolate to one. Measured: training stations see a mean source
contribution of 0.25 ug/m3 while the city reaches 210. Its field is
background-dominated and it is *worse than naive* on the dirtiest decile.
Detection runs on **satellite contrast + FIRMS fire persistence** instead
(`agents/detect.py`), which are the only layers with uniform coverage.
Do not "fix" this by feeding the fusion field back into detection.

**2. The 100% trap.** This project once reported *100% attribution accuracy*.
It was an artefact: the synthetic world emitted its hidden sources straight into
the OSM layer with exact coordinates and exact category labels, and used the
same `exp(-d/2)*wind_alignment` kernel the attribution scorer uses. The scorer
was handed the answer key. `ingestion/synthetic.py` is now deliberately
adversarial — different dispersion physics, sources that appear on no map, decoy
sites that emit nothing, a satellite blurred to its true ~5.5 km footprint, and
column-vs-surface decoupling. If a number ever comes back at 100%, assume
leakage before you assume success.

## Current state (keep this section updated as phases land)
- ✅ Ingestion (6 sources, live+fallback) + H3 fabric + ward layer
  (`shared/wards.py`: real GeoJSON if present, deterministic Voronoi otherwise).
- ✅ Fusion **exposure** field. LOSO R2 ~0.90, RMSE ~6.4 vs naive station-mean
  9.99 (~36% better citywide). Not a detector — see above.
- ✅ Detection (`agents/detect.py`): satellite neighbourhood contrast + fire
  persistence, robust median/MAD, multi-window 24h/7d/30d ->
  chronic / emerging / acute.
- ✅ Attribution: deterministic category scores, LLM explains only, rule
  fallback. Confidence now discriminates (hits 0.66 / misses 0.42).
- ✅ Zones + enforceable/diffuse split (`detect.py`). Hotspot CELLS are clustered
  into source ZONES (an inspector is dispatched to a zone, not a 460 m hexagon),
  and each zone is tagged `attributable`: does any instrument point at a *place*
  (OSM candidate <3 km, FIRMS fire, or SO2/AAI point-tracer contrast)? A cell that
  is only high in NO2 over dense roads is **diffuse urban background** — real
  pollution, no one to serve a notice on, a policy target. It stays on the map and
  is excluded from the enforcement queue.
- 📊 Headline numbers (synthetic, anchored world — reproducible run to run):
  - recall **by what the instruments can physically see**:
    - **direct (thermal fire): 2/2** found and correctly named — **both are
      UNREGISTERED**, i.e. they appear on no map at all. This is the real result.
    - **NO2, confounded (industrial + traffic): 0/4.** NO2 is a real combustion
      tracer, but the road network lifts it across the whole core, so a point
      source has to out-shout its own neighbourhood. Hard, not impossible — on
      real Delhi this tier *did* surface industrial zones.
    - **no tracer at all (construction): 0/3.** Coarse PM. Nothing sees it.
  - enforceable-**zone** precision **2/2** (34 cells -> 3 zones; the 3rd is diffuse,
    correctly excluded from the enforcement queue); cell-level **85%** (28/33)
  - attribution **100%** (16/16, all unregistered); fusion LOSO R2 **0.898**
  - ⚠️ These are small n. Never sell 2/2 as a rate.
- 🌍 **Real Delhi, November 2025 (every source live).** The number that matters:
  - **Bhalswa landfill -> `waste_burning`, confidence 0.67**, evidence
    *"satellite fire detections in 30 hours (18% of the window)"*. A real polluter,
    in a real city, from public satellite data, with an evidence chain anyone can
    check by googling "Bhalswa landfill fire November 2025".
  - **Forecast — THREE real cities, and the DIRECTION is the finding.** Skill vs
    persistence (Nov 2025, 14-day held-out tail, real CPCB/TNPCB stations):
    | horizon | Delhi | Chennai | Bengaluru | verdict |
    |---|---|---|---|---|
    | 24h | -23% | -6% | -0% | **persistence WINS, 3/3** |
    | 48h | +12% | -5% | +3% | mixed — the crossover |
    | 72h | +2% | +14% | +10% | **model WINS, 3/3** |
    Persistence is excellent short-term and DECAYS with horizon; the model does not.
    48-72h is the enforcement-scheduling window ("stagnant winds Thursday, act
    before"). **Quote the direction, not the decimal** — the exact % moves with how
    many stations OpenAQ serves that day (same Delhi window has returned 26/22/20
    stations across sessions). Byte-reproducible within a session; drifts across days.
  - Okhla -> `traffic` (it genuinely sits on Mathura Road; defensible, incomplete).
    Ghazipur -> not detected (no fires in the window).
  - ❌ **The fusion exposure claim is WITHDRAWN.** On real Delhi it is **14% worse
    than a naive city-mean** (RMSE 75.4 vs 66.0, LOSO R2 0.52). We tried predicting
    the DEVIATION from the city median instead of the level — a construction that
    *cannot* lose to the baseline, since a zero residual IS the baseline — and it
    still lost. So the residual model predicts non-zero spatial corrections that are
    WRONG: it fits the training stations' siting quirks, not structure that transfers
    to a station it has never seen. With ~24 stations we cannot demonstrate spatial
    skill. Detection is the contribution. Do not quote the synthetic 0.84 as if it
    says anything about Delhi.
  - 🚩 **"0 of 9 sources within 2 km of a monitor" is NOT a finding.** It is an
    assumption: `pick_station_cells` excludes each source's k=2 ring (floor
    ~1.9-2.4 km), so it is true ~99% of the time by construction. Reporting it as
    a measurement is the same sin as the 100% trap. The *empirical* version, which
    owes nothing to our placement rule: **an unbiased, uniformly random 12-monitor
    network catches a median of 1 of 9 sources — it misses 8 of 9**
    (`scripts/eval_station_sensitivity.py`). Sparsity misses sources before bias
    even gets a turn. Quote that instead.
  - ✅ Detection recall is **invariant to station siting** (4/4 at exclusion k=2,
    1, and 0) because it reads satellite + FIRMS and never touches a station.
    Fusion LOSO *does* move with siting (0.90 -> 0.72), as it must. That contrast
    is the proof the headline isn't an artefact of a rule we invented.
- ⚠️ **Known blind spots, stated not hidden:** construction dust (coarse PM, no
  satellite tracer, doesn't burn) recall **0/3**; traffic corridors (NO2
  confounded with the diffuse urban road network) recall **0/2**. Closing these
  needs the OSM permit layer, PM10/PM2.5 coarse fraction, and citizen reports.
- ⬜ NOT built: forecast agent, prioritisation/dispatch (EPS + routing), memo
  agent (legal matcher), advisory agent, frontend, n8n channels, GEE Sentinel-5P
  collector (satellite is synthetic-only today — live mode silently mixes real
  stations with a synthetic satellite, which is scientifically invalid).

## Conventions
- Python 3.11, type hints on function signatures, no framework beyond what's
  already imported per file (pandas/numpy/lightgbm/h3/fastapi).
- New agents under `intelligence/agents/` follow the attribution.py shape:
  a `build_evidence()` function, a deterministic scoring function, an LLM
  call via `llm_gateway.complete_json()`, and a rule-based fallback with the
  identical output schema.
- Outputs are written to `data/outputs/*.json` (frontend/API contracts) or
  `*.parquet` (large tabular data consumed by other Python code, not the API).
- `data/raw/` and `data/outputs/` are gitignored — regenerated by running
  scripts, never hand-edited or committed.
- Commit messages: conventional format (`feat(scope):`, `fix:`, `refactor:`,
  `docs:`, `ci:`) with a body explaining *why*, not just *what*.

## Known gotchas
- **The synthetic world's INSTRUMENTS were too kind, and that is the same class of
  bug as the 100% trap.** We made the *sources* adversarial and left the *sensors*
  perfect: clean SO2, clean AAI, 281 fires, full satellite coverage every day.
  Reality: SO2/AAI are noise, real FIRMS returns **2 fires over Bengaluru in 60
  days**, and monsoon cloud masks 71% of NO2. When you add a new instrument, model
  its NOISE before you model its signal.
- **Score candidates with MAX, not SUM.** `category_scores` used to sum over every
  nearby OSM site of a type. That asks "how many mapped sites of this type are near
  me" — a question about OSM's *coverage*, not about who is polluting. Synthetic had
  2 traffic corridors; real Delhi has **1,240**, so traffic won by sheer count and
  *both* burning landfills were attributed to traffic.
- **Every collector must fetch the WHOLE panel window.** FIRMS asked for 2 days,
  OpenAQ for 14, Open-Meteo for 14 — against a 60-day panel. `build_panel()`
  intersects station and weather hours, so a live run silently produced a 14-day
  panel, the 30-day detection window came back EMPTY, and every chronic source
  vanished with no error. (FIRMS caps `DAY_RANGE` at **5**, so it is walked in
  chunks.)
- **An empty critical source is as dangerous as a failed one, and it does not
  raise.** A loaded Overpass mirror returns HTTP 200 with zero elements; we wrote an
  empty OSM layer and carried on as if Delhi contained no industry. `NO_FALLBACK`
  now rejects zero-row payloads too. Overpass also 406s without a User-Agent and
  silently truncates at `out center 4000` (real Bengaluru returns 8,057 features —
  we were losing 500 industrial sites).
- **Live GEE emits tz-aware dates; the synthetic satellite emits naive ones.** The
  panel coerces to naive before merging, or pandas raises. Same family as the
  `DatetimeIndex.values` gotcha below.
- **The synthetic world is anchored to `config.SYNTHETIC_ANCHOR`, not to now.**
  It used to end at `utcnow()`, so the same code gave 72 hotspot cells at 22:00
  and 93 at 02:00 and every reported number silently meant "as measured last
  Tuesday". Do not reintroduce a wall-clock anchor; a synthetic world exists to be
  reproducible. Live mode uses real collector timestamps and is unaffected.
- **`ingestion/synthetic.py::RNG` is module-level and stateful.** `generate_all()`
  calls `_reset_rng()` first, so the world is a pure function of `WORLD_SEED`.
  Without it, calling `generate_all()` twice in one process yields two different
  worlds — which silently broke the station-siting sweep.
- **Never bind a tunable as a default argument** (`def f(k=SOME_GLOBAL)`). Python
  binds it once at definition, so `module.SOME_GLOBAL = 0` never reaches it. This
  made the station-sensitivity sweep test k=2 three times and report "recall is
  invariant" while measuring nothing. Read the global at call time.
- **Persistence is a property of a SOURCE, not of a cell.** A chronic source's
  fringe cells only go hot when the wind points at them, so over 30 days they look
  intermittent and classify as `emerging` — which would send an inspector hunting
  for a newly commissioned facility that does not exist. (Measured: the lone
  `emerging` and `acute` flags in one run were both fringe cells 2.0 km from the
  chronic landfill.) `detect.py::_reconcile_zones` clusters cells within 2 km and
  makes every cell inherit its zone's most persistent verdict. Do not classify
  cells independently.
- Windows PowerShell: use `$env:PYTHONPATH = "."` not `PYTHONPATH=. cmd`, and
  `Remove-Item -Recurse -Force` not `rm -rf`.
- `fusion.py` LOSO retrains 12 LightGBM models (one per held-out station).
- The panel is 60 days x 1210 cells = 1.74M rows. `_fire_features` is vectorised
  for exactly this reason; do not reintroduce a per-cell/per-hour Python loop.
- The synthetic world has 9 hidden sources around a Bengaluru bbox. If you change
  `config.BBOX`, regenerate the sources to match or switch fully to live mode.
- `pd.DatetimeIndex.values` strips the timezone and will silently break merges
  against the panel. Use `.repeat()` on the index itself.
