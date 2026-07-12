# AI-Powered Urban Air Quality Intelligence Platform — Architecture
## Complete System Architecture

**One-liner:** From AQI dashboards to enforcement dispatch — a platform that tells the city *who* is polluting, *where*, with *what evidence*, and *what to do about it today*.

**Thesis:** India does not have a monitoring problem; it has an action problem. Over 900 CAAQMS stations exist, yet a 2024 CAG audit found only 31% of monitored cities had any actionable response protocol. The platform closes the loop from signal to intervention, and treats a second, quieter problem as a first-class design constraint: **every civic dataset lies about coverage**. Station maps are biased toward where monitors happen to sit; citizen complaints are biased toward who is online and literate. It corrects both before ranking anything.

**Design principles**

1. Deterministic arithmetic ranks; LLMs only explain. Every score is reproducible plain math, so the priority queue is defensible to an administrator and a judge alike.
2. Every AI claim ships with its evidence chain and a confidence score. No black-box attributions.
3. Heavy compute runs in a batch pipeline; the API and frontend read precomputed JSON contracts. If the backend dies mid-demo, the map still renders.
4. Every LLM-dependent component has a deterministic rule-based fallback. The demo cannot be killed by a rate limit.
5. Channels are dumb, agents are smart. Messaging infrastructure only moves bytes; all intelligence lives in the agent pipeline.

---

## Layer 1 — Data Ingestion

Six independent pollers, each a small script writing raw files to `data/raw/`, run on a lightweight recompute scheduler (configurable interval, `--once` mode for cron). All sources are free, API-accessible, and national-coverage — the platform works for any Indian city with zero new hardware.

**Ground truth — station AQI.** OpenAQ v3 API (mirrors CPCB CAAQMS stations): hourly PM2.5, PM10, NO₂, SO₂, CO per station. This is the label source for the fusion model and the node signal for forecasting.

**Eye in the sky — satellite columns.** Sentinel-5P/TROPOMI via Google Earth Engine Python API (`COPERNICUS/S5P/OFFL/L3_NO2`, plus SO₂, CO, aerosol index), clipped to the city bbox, aggregated to a per-cell daily mean. GEE does the raster math server-side; we ingest a tidy table. *Why:* uniform coverage of every cell in the city — the unbiased anchor that station data can never be.

**Fire detection.** NASA FIRMS API: VIIRS/MODIS thermal anomalies within the city bbox, last 48h, with confidence and acquisition time. *Why:* waste burning and kiln activity are invisible to both stations and NO₂ columns but glow in thermal.

**Meteorology.** Open-Meteo (keyless): wind u/v components, temperature, precipitation, and **boundary layer height** — the single strongest meteorological predictor of AQI spikes (a shallow boundary layer traps emissions).

**Static geography.** One OpenStreetMap bbox fetch: industrial land use polygons, construction sites, kilns (`man_made=kiln`), fuel stations, road class and throughput, plus schools, hospitals, and eldercare for the vulnerability layer.

**Human sensors — citizen reports.** Inbound Telegram/WhatsApp/web intake (see Layer 7): a citizen sends a photo of garbage burning or a smoking stack, with voice or text in their own language. One multimodal LLM call transcribes, describes the image, classifies (`category: waste_burning | construction_dust | industrial | traffic | other`), extracts urgency signals, and guesses the ward against a validated ward list (never trusted blindly — validated in code, falls back to a location follow-up question). *Why:* a third observation tier — "900 stations + 2 satellites + a million human sensors" — and ground-truth verification for attributions.

---

## Layer 2 — Spatial Fabric

**H3 hexagonal grid, resolution 8** (~460 m cell edge, satisfying the "1 km grid" requirement) is the universal spatial key. Every observation from every source is assigned to a cell; every cell is assigned to a municipal ward by point-in-polygon against the official ward GeoJSON. Ward is the administrative unit (memos, advisories, dashboards); the cell is the analytical unit (models, attribution).

A panel builder assembles the **cell × hour feature table**: interpolated station readings, satellite columns (forward-filled between overpasses), fire counts within 2 km, wind vector, boundary layer height, land-use composition, road throughput, and time features (hour, day-of-week, season). Stored as timestamped SQLite snapshots so every downstream agent reads one consistent table and the demo can be replayed from any point in time.

---

## Layer 3 — The Coverage-Debiased Fusion Field

**What:** a citywide, per-cell, hourly surface PM2.5 estimate — not an interpolation of ~12 stations, but a learned fusion of satellite, meteorology, and geography anchored to station ground truth.

**Why:** an official AQI map is a *measurement log, not a pollution census*. CPCB siting norms deliberately place monitors away from immediate sources, so naive interpolation systematically understates hotspot exposure and says nothing about the ~90% of the city with no monitor. Ranking enforcement on raw station data means enforcing where sensors are, not where pollution is — the exact class of coverage bias this platform exists to correct.

**How (implementable in ~1 day):**

1. **Training set:** every (cell, hour) where the cell contains a station. Features: S5P NO₂/SO₂/CO/aerosol-index, boundary layer height, wind speed and direction, temperature, hour/day-of-week, land-use shares, road throughput, fire count within 2 km. Label: that station's measured PM2.5. No interpolation touches the labels.
2. **Model:** LightGBM regressor with **spatio-temporal cross-validation** (folds split across both stations and time blocks, so the model is never graded on a station or a week it trained on).
3. **Inference:** predict all ~2,000 cells, hourly. Output: `fusion_field.json` — cell, predicted PM2.5, prediction interval.
4. **Validation — the headline number:** **leave-one-station-out.** Hide each station entirely, predict its cell from satellite + features, compare against its actual readings. Report per-station R²/RMSE. One rigorous number that says "our full-coverage map is trustworthy," which no interpolated dashboard can produce.
5. **SHAP values** per prediction feed the attribution agent's evidence (e.g., "this cell's estimate is driven 40% by the NO₂ column, 25% by low boundary layer").

Everything downstream — hotspot detection, attribution, forecasting, prioritisation — runs on the fusion field, not raw stations.

**Free byproduct — the network audit (see Layer 6, Feature F4):** cells where satellite and fusion say "high" but no monitor exists are *monitoring blind spots*, ranked into a next-sensor-placement recommendation; a station reading flat while the satellite spikes overhead is flagged for *sensor malfunction/tampering review*. The problem statement opens with a CAG audit; this feature audits the monitoring network itself.

---

## Layer 4 — Forecasting

**What:** 24–72h PM2.5 forecast per cell, via a spatio-temporal graph neural network with physically motivated, wind-aware structure.

**How:** cells are graph nodes carrying an hourly PM2.5 time series (from the fusion field); a 2-layer graph convolution aggregates across neighbours, then a GRU models temporal dynamics to predict the next windows. Plain PyTorch (normalized-adjacency matmul, no torch_geometric), trainable on CPU/Colab. The key structural choice: **wind-weighted directed adjacency**. Instead of a symmetric neighbour matrix,

```
A[i][j] = base + λ · max(0, cos(wind_bearing − bearing(j→i)))
```

so upwind neighbours influence a cell more than downwind ones — pollution advects, and the graph knows it. Adjacency is recomputed per forecast run from current wind. This is the honest implementation of "atmospheric dispersion modelling": a defensible simplification, stated as such, rather than a fake CFD claim.

**Baseline and evaluation:** an exponentially-decayed rolling persistence baseline keyed by (cell, hour-of-week) — "what does this cell usually read at this hour" — plus an eval harness that prints **forecast RMSE vs persistence RMSE** at multiple horizons. This is verbatim the judging criterion ("AQI forecast accuracy at hyperlocal resolution, RMSE versus persistence baseline"), answered with a number.

**Why the forecast matters beyond advisories:** it schedules enforcement ("stagnant winds Thursday — act before, not after") and powers the counterfactual ledger (Feature F2).

---

## Layer 5 — The Agent Pipeline

A LangGraph `StateGraph` orchestrates six nodes over a shared typed state (`AirQualityState`). Each node is wrapped in try/except with a structured error result, so one failing agent degrades the output instead of killing the run. The pipeline emits **Server-Sent Events** per node ("attribution: running… → completed"), which the frontend renders as a live agent progress strip — the system is *visibly* agentic during the demo.

A centralized LLM gateway serves all agents with provider switching (Gemini primary, Groq secondary, local Ollama last resort) and hardened JSON parsing (fence stripping, fallback on parse failure). Three interchangeable providers means no single rate limit or outage can take down demo day.

### Node 1 — Hotspot Detection
Flags cells where the fusion field exceeds the ward's rolling baseline by a configurable margin, or where the satellite shows a plume with no nearby station corroboration (a blind-spot spike). Output: candidate hotspots with severity and detection basis.

### Node 2 — Source Attribution Agent (the innovation core)
**What:** for each hotspot, names the responsible source category with a confidence score and a fully inspectable evidence chain.

**How:** a structured evidence profile is assembled per hotspot from data already in the panel — no new collection:

- `pollutant_signature` — ratio fingerprints: SO₂-heavy → industrial; PM-heavy evening spike → biomass/waste burning; NO₂ with morning/evening peaks → traffic; coarse PM10 near daytime activity → construction dust.
- `plume_alignment` — cosine similarity between the current wind bearing and the bearing from each candidate source (industrial polygon, kiln, active fire) to the hotspot: is the hotspot literally downwind of a named suspect?
- `fire_proximity` — FIRMS detections within 2 km, with recency and confidence.
- `landuse_context` — industrial/construction/kiln share of the surrounding cells; named OSM sites where available.
- `traffic_proxy` — road class and throughput at the current hour.
- `citizen_corroboration` — debias-weighted citizen reports of a matching category in this ward within 48h (see Feature F5).
- `fusion_shap` — which features drove the model's estimate for this cell.

The evidence dict goes to the LLM with a strict contract: *reason ONLY from this evidence, invent nothing, return strict JSON* `{primary_source, confidence, reason (2–3 sentences), evidence_factors[]}`. A deterministic rule-based reasoner produces the same schema when the LLM is unavailable, so attribution never fails silent. Confidence is computed from evidence agreement (how many independent signals point the same way), not from LLM self-report.

**Why this wins:** most teams will show *where* pollution is. Attribution with a visible, checkable evidence chain shows *why and who* — and the chain itself ("NO₂ plume aligned with wind from the NH-44 corridor; fusion estimate driven by traffic features; two citizen photo reports of the same") is what an administrator can put in front of a violator.

### Node 3 — Forecast Agent
Runs the wind-weighted forecaster (Layer 4) for hotspot cells and citywide; annotates each hotspot with 24/48/72h trajectory and an *urgency* flag (worsening meteorology = act now).

### Node 4 — Prioritisation & Dispatch Agent
**Enforcement Priority Score — deterministic, LLM-free by design:**

```
EPS = 100 × ( 0.35 · severity            # current + forecast AQI excess over ward baseline
            + 0.25 · attribution_conf     # evidence agreement for the named source
            + 0.20 · actionability        # is the source enforceable today (a site, a unit, a location — vs diffuse traffic)
            + 0.20 · vulnerability )      # schools, hospitals, eldercare, outdoor-worker density within exposure range
```

The same inputs always produce the same ranking — auditable, explainable, and immune to "the AI decided" criticism. The vulnerability term is an explicit equity weight: a moderate hotspot beside a school can outrank a severe one in an empty industrial buffer.

**Dispatch:** framed as maximum-coverage set cover — each candidate inspection stop "covers" the EPS-weighted burden of hotspots within a 400 m radius; a greedy selector (≥63%-of-optimal guarantee) picks stops under a stop budget, splits them across N inspection teams, and orders each team's stops with a nearest-neighbour route. Output: per-team ordered routes with distance and "% of citywide priority burden covered." This is the literal answer to "where to deploy inspectors for maximum impact."

### Node 5 — Enforcement Memo Agent
**What:** one click turns a ranked action into a dispatch-ready enforcement memo.

**How:** a report generator merges (a) the hotspot map snippet and fusion/forecast readings, (b) the attribution evidence chain verbatim, (c) the inspection route assignment, and (d) a **legal basis matched by a rule engine** — action configs with eligibility conditions, evaluated `eq/in/gte/lte` against the situation:

```
pollutant=PM2.5 ∧ AQI≥201 → GRAP Stage II measures (construction dust controls, DG-set restrictions)
source=waste_burning      → SWM Rules 2016 + applicable municipal bylaw, fine schedule
source=industrial ∧ SO₂↑  → Air Act §31A direction, CPCB emission norms reference
```

Deterministic rules pick the legal citation; the LLM only drafts the connective prose. Output: a rendered memo (HTML→PDF) with a reference number, logged to the ledger.

**Why:** the memo is the demo climax and the business case in one artifact — "signal to intervention" compressed from weeks of manual correlation to one click, with a legal citation an actual officer could act on.

### Node 6 — Advisory Agent
Generates ward-level health advisories from the forecast + vulnerability layer, in **text and voice, per language** (Kannada/Hindi/English for Bengaluru), under the same discipline as attribution: strict JSON, generated in the citizen's own language, calibrated severity, never over-promising. Rows are written to the database; the outbound channel layer (Layer 7) delivers them.

---

## Layer 6 — Cross-Cutting Intelligence Features

**F1. Citizens as sensors (inbound).** Described in Layers 1 and 7. Adds observation coverage, attribution corroboration, and the political story ("the platform listens").

**F2. The Counterfactual Intervention Ledger.** *What:* automatic measurement of whether each enforcement action worked. *How:* when a memo is actioned, the forecast for that cell at dispatch time is frozen as the **counterfactual** — what AQI was expected without intervention. Realized minus counterfactual, accumulated over the following 48–72h, is the action's measured impact, logged per memo alongside response time. *Why:* "demonstrated reduction in response time from signal to intervention" and "intervention effectiveness" are evaluation criteria verbatim — and this turns the platform from a dispatcher into a system that *learns which interventions work where*, which is the entire premise of multi-city comparison, delivered as a byproduct. A phase-2 training harness (features → calibrated classifier → SHAP) ships alongside it with the honest framing: rules rank today; the model trains itself as outcome labels accumulate.

**F3. Repeat Offender Registry.** *What:* entities attributed repeatedly get escalated. *How:* attribution outputs are clustered by source location/entity across weeks; ≥N attributions in a window promotes the entity through tiers — advisory → memo → chronic-offender flag with the accumulated case file (every past attribution + evidence chain, ready for closure proceedings). *Why:* enforcement agencies think in case files, not incidents. "We don't just find today's fire; we build the case" is a Business Impact line no dashboard has.

**F4. Monitoring Network Audit.** Blind-spot ranking (persistent satellite-high, monitor-absent cells → optimal next-sensor placement) and sensor anomaly flags (station flat while satellite spikes overhead → malfunction/tampering review). Free byproducts of the fusion field; direct answer to the CAG audit that anchors the problem statement.

**F5. Equity-Debiased Citizen Signal.** *What:* citizen reports weighted so connected wards don't drown out disconnected ones. *Why:* complaint data is a reporting log biased toward smartphone-owning, literate wards; rank by raw volume and enforcement chases the loudest neighbourhoods, not the dirtiest. *How:* each ward carries covariates (internet penetration, literacy, deprivation index); report weight scales inversely with ward digital access (a lightweight inverse-probability weighting), and a **silent-ward detector** flags wards where the fusion field says "severe" but citizen reports are near zero — those get *boosted* into the attribution corroboration term, not buried. ~2 hours of arithmetic on schema columns; a genuine equity claim with math behind it.

**F6. Voice advisories.** Advisory text → TTS → voice note delivered on Telegram/WhatsApp in the citizen's language. *Why:* the populations most exposed (outdoor workers) skew low-literacy; a spoken Kannada warning playing from a phone on stage is the "IVR in regional languages" deliverable made real, on existing plumbing.

**F7. Inspector loop (two-sided channel).** The same outbound channel serves a second audience: inspection teams receive their route + memo link on WhatsApp; replying "done" updates action status; the ledger stamps response time; and the citizen whose report corroborated the attribution receives *"your report led to an inspection."* Closing that loop back to the original citizen is the single most emotionally resonant beat available to the demo.

---

## Layer 7 — Channels (n8n)

Messaging runs on an n8n workflow instance — kept deliberately dumb. Inbound workflows: Telegram and WhatsApp triggers normalize text/voice/photo, download media, and hand everything to one processing webhook (single multimodal LLM extraction call; ward validation in code; acknowledgment sent back in the citizen's language). Outbound workflow: a notify webhook fans advisory/memo/status rows out by channel per recipient, including voice notes.

*Why n8n and not custom code:* multi-channel I/O, media handling, and retries with zero backend code, already deployed and battle-tested. *The boundary:* n8n moves bytes; it never scores, ranks, or reasons. *Fallback:* if the instance is unrecoverable, a python-telegram-bot webhook replaces it and WhatsApp is cut — the architecture doesn't change.

---

## Layer 8 — Serving

A thin, read-only FastAPI over precomputed JSON contracts (heavy compute stays in the batch pipeline):

```
GET  /hotspots               ranked hotspots + attribution summaries
GET  /attribution/{cell}     full evidence chain for one hotspot
GET  /fusion?hour=…          citywide fusion field
GET  /forecast?h=24|48|72    forecast field + per-cell trajectories
GET  /actions                the EPS-ranked action queue
GET  /dispatch               per-team inspection routes
POST /memo/{action_id}       generate + return an enforcement memo (PDF)
GET  /ledger                 intervention ledger (counterfactual impacts, response times)
GET  /audit                  blind spots + sensor anomaly flags
POST /run/stream             trigger a pipeline run, stream per-agent SSE progress
```

The frontend also reads the same JSON files statically from `public/` — **demo insurance:** if the API process dies on stage, the map, queue, and evidence panels still render from the last batch output.

## Layer 9 — Frontend

React + Vite + Leaflet/OpenStreetMap (free tiles, no token dependency). Two roles:

**Admin console** — the product. A full-bleed map with toggleable layers (fusion choropleth, station markers, satellite plume overlay, fires, hotspots, blind spots, inspection routes) and a forecast time-slider (now → +72h). Right panel: the **Action Queue** — EPS-ranked cards filterable by ward and source type; a card expands to the evidence chain ("why this hotspot"), the counterfactual trajectory, and two buttons: *Generate memo* and *Dispatch route*. A persistent strip shows live SSE agent progress during pipeline runs. Secondary tabs: Ledger (interventions and measured impact), Registry (repeat offenders), Audit (network blind spots/anomalies).

**Citizen view** — deliberately sparse: my-ward AQI and forecast, current advisory in my language, a report button, and status of my past reports ("your report led to an inspection").

---

## Data Contracts (the pipeline↔frontend interface)

```
fusion_field.json      [{cell, ward, pm25_hat, interval, hour}]
hotspots.json          [{cell, ward, severity, detection_basis, eps, rank}]
attributions.json      [{cell, primary_source, confidence, reason, evidence_factors[], corroborations[]}]
forecast.json          [{cell, horizon_h, pm25_hat, urgency}]
actions.json           [{action_id, cell, ward, eps, components{}, source, legal_basis, status}]
dispatch.json          [{team_id, route_km, coverage_pct, stops[{seq, cell, ward, eps}]}]
ledger.json            [{memo_id, dispatched_at, actioned_at, counterfactual, realized, impact, response_hours}]
audit.json             {blind_spots[], sensor_flags[], placement_recommendations[]}
```

## Tech Stack

Python 3.11 · LightGBM (fusion) · PyTorch (forecast) · h3, geopandas, shapely, osmnx (spatial) · LangGraph (orchestration) · Gemini / Groq / Ollama (LLM, in fallback order) · FastAPI + SSE (serving) · SQLite (snapshots) · Supabase/Postgres (citizens, reports, advisories, ledger) · React + Vite + Leaflet (frontend) · n8n (channels) · Google Earth Engine, OpenAQ, NASA FIRMS, Open-Meteo, OSM (data — all free).

## Build Order (dependency order; no fixed clock)

1. **Ingestion + spatial fabric** — everything depends on it; verify GEE service-account auth and OpenAQ station coverage for the chosen city on day zero.
2. **Fusion field + LOSO validation** — unlocks detection, audit, and the headline rigor number.
3. **Attribution agent** — the innovation core; build the evidence schema, then the LLM contract, then the rule fallback.
4. **Forecast + baseline + RMSE harness** (parallel with 3).
5. **EPS + dispatch + memo + legal matcher** — the action spine.
6. **Frontend** (parallel from step 2 onward, against static JSON contracts).
7. **Channels:** inbound citizen intake, outbound advisories, voice, inspector loop.
8. **Ledger + registry + audit surfaces.**
9. **End-to-end rehearsal on live data; record the demo video early — never in the final hours.**

## The 3-Minute Demo Spine

Map shows a spike the official station map misses (fusion field) → attribution names the source with a visible evidence chain → forecast says Thursday gets worse → one click generates a memo with a legal citation → an inspector's route draws on the map and lands on a WhatsApp → a citizen's phone speaks a Kannada advisory aloud → the ledger shows a past intervention that measurably worked. Every added feature appears as a *moment inside this one story* — never as a separate chapter.

## Known Risks

GEE auth setup latency (do it first) · sparse station count for LOSO in smaller cities (Delhi as fallback demo city) · S5P columns are column densities, not surface values (the fusion model exists precisely to bridge this; say so honestly) · n8n instance health (test one outbound push immediately) · LLM rate limits (three-provider fallback + rule-based reasoners) · scope creep (the demo spine is the contract; anything not visible in it gets cut first).

## Appendix — Explicitly Deferred

*What-if policy sandbox* (slider: "suspend construction in ward X" → re-forecast): demos well but is the least defensible scientifically; build only if everything above is done, and label it illustrative.
