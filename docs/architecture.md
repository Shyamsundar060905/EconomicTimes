# AI-Powered Urban Air Quality Intelligence Platform — Architecture
## Complete System Architecture

**One-liner:** From AQI dashboards to enforcement dispatch — a platform that tells the city *who* is polluting, *where*, with *what evidence*, and *what to do about it today*.

**Thesis:** India does not have a monitoring problem; it has an action problem. Over 900 CAAQMS stations exist, yet a 2024 CAG audit found only 31% of monitored cities had any actionable response protocol. The platform closes the loop from signal to intervention, and treats a second, quieter problem as a first-class design constraint: **every civic dataset lies about coverage**. Station maps are biased toward where monitors happen to sit; citizen complaints are biased toward who is online and literate. It corrects both before ranking anything.

**Design principles**

1. Deterministic arithmetic ranks; LLMs only explain. Every score is reproducible plain math, so the priority queue is defensible to an administrator and a judge alike.
2. Every AI claim ships with its evidence chain and a confidence score. No black-box attributions. **And the confidence must actually discriminate** — a number that reads the same on right and wrong answers is decoration. Ours is validated against truth: median 0.66 on hits vs 0.42 on misses, and 100% precision above 0.70.
3. Heavy compute runs in a batch pipeline; the API and frontend read precomputed JSON contracts. If the backend dies mid-demo, the map still renders.
4. Every LLM-dependent component has a deterministic rule-based fallback. The demo cannot be killed by a rate limit.
5. Channels are dumb, agents are smart. Messaging infrastructure only moves bytes; all intelligence lives in the agent pipeline.
6. **Robust statistics only. Never the mean.** Every aggregate is a median and every spread is a MAD. A mean is not robust to outliers, and in this domain the outliers *are* the phenomenon: one spike hour inflates a mean and manufactures a chronic source out of a single bonfire.
7. **One window is not a signal.** Real-time data is noisy and cannot identify a source on its own. Every source claim is aggregated over 24 h / 7 d / 30 d and must survive the zoom-out; agreement across windows is what separates a standing violator from a fire.
8. **The evaluation must be able to fail.** A synthetic world that hands the scorer its own answer key produces 100% accuracy and teaches nothing (ours did, for a while — see below). The generator uses different physics than the scorer, some sources appear on no map, decoy sites emit nothing, and the satellite is blurred to its real footprint. Numbers are reported split by what is physically observable and what is not.

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

### ⚠️ Measured limitation — the fusion field is an EXPOSURE map, not a source detector

The original design said "everything downstream — hotspot detection, attribution, forecasting, prioritisation — runs on the fusion field." **That is wrong, and we measured it.**

The model is trained only on cells that contain a station, and CPCB siting norms deliberately place stations *away from sources* — the very fact this layer's rationale rests on. On the synthetic world the 12 training stations see a mean source contribution of **0.25 µg/m³** (p99 = 6.7; only 0.5% of station-hours exceed 10 µg/m³) while the rest of the city reaches **210 µg/m³**. Only 6 of 4,032 station-hours have a fire within range, against 4,414 citywide.

So the model never observes a source, cannot learn a source response, and — being a tree ensemble — **cannot extrapolate one either**: LightGBM predicts piecewise-constant, so a cell whose NO₂ column is far above anything a station ever saw gets the same prediction as the highest station. The fusion field's spatial spread at peak hour is 14 µg/m³ against a true spread of 37. Measured: it is ~9% *worse* than the naive station-mean baseline on the dirtiest decile, and understates it by ~9 µg/m³.

Bolting a physical dispersion term onto the model does not rescue this, because its coefficient would have to be calibrated on the same station data that contains no plumes.

**What the fusion field IS good for:** citywide exposure ("what is a person in this cell breathing"), where it cuts error ~15% vs the station-mean map at LOSO R² ≈ 0.90. That is a real and useful product. It is simply not the detector.

**Detection therefore moved to Layer 3b.** Everything downstream reads the fusion field for *exposure* and the detector for *sources*.

---

## Layer 3b — Detection: satellite contrast + fire persistence

Detection runs on the two instruments with **genuinely uniform coverage** — every cell, no siting bias:

- **Satellite contrast.** Per-cell *median* (never mean — one spike hour would manufacture a fake chronic source) of each S5P column over each window, scored by **neighbourhood contrast**: how far the cell sits above the annulus at 4–8 km around it, in robust MAD units. Contrast rather than a citywide rank, because the dense urban core is high everywhere and "this district is dense" is true, unactionable, and not a violator.
- **Fire persistence.** Fraction of window-hours with a FIRMS detection within 1.5 km. FIRMS observes burning *directly* — no inference, no contrast needed.

**Multi-window agreement (24 h / 7 d / 30 d)** then separates the three things an administrator must respond to differently. A real-time spike is noise; a source is what is still there when you zoom out:

| class | signal | response |
|---|---|---|
| `chronic` | elevated over 30 d | a standing violator — build the case file |
| `emerging` | elevated over 7 d, not 30 d | newly commissioned — act now |
| `acute` | elevated in 24 h only | a fire — send a truck, not a notice |

### Zones, and the enforceable/diffuse split

Two refinements make the output *dispatchable* rather than merely correct.

**Cells are clustered into zones.** Persistence is a property of a **source**, not of a cell: a chronic source's fringe cells only go hot when the wind points at them, so over 30 days they look intermittent and would classify as `emerging` — telling an inspector to go find a newly commissioned facility that does not exist. (Measured: the only `emerging` and `acute` flags in one run were both fringe cells 2.0 km from the chronic landfill.) Hotspot cells within 2 km are therefore connected into a zone, and every cell inherits its zone's most persistent verdict. An inspector is dispatched to a zone, not to a 460 m hexagon.

**Every zone is tagged `attributable`.** The question is not "is this polluted" but "is there anyone to serve a notice on". A zone is enforceable only if some instrument points at a *place*: a named OSM candidate within 3 km, FIRMS fire persistence, or an SO₂/aerosol-index contrast (point-source tracers). A zone that is high only in NO₂ over a dense road network is **diffuse urban background** — real pollution with no single actor responsible. It stays on the map and feeds ward advisories, but it is a **policy target, not an inspection**, and it is excluded from the enforcement queue.

Note the trap this rule is built to avoid: an OSM-proximity test *alone* would mark the landfill and the kiln as diffuse, because they appear on no map — which is precisely what makes finding them valuable. Fire evidence is what localises them.

**Measured on the synthetic world** (`scripts/eval_detection.py`):

| metric | result |
|---|---|
| observable sources found **and correctly named** | **4/4** |
| ...that appear on **no map at all** | **2/2** |
| enforceable-**zone** precision (each zone = one inspector dispatched) | **4/4** |
| attribution accuracy | 89% (48/54; 100% on unregistered) |
| precision at confidence ≥ 0.70 | 100% (17/17) |
| fusion LOSO R² (exposure, not detection) | 0.898 |

⚠️ **State 4/4 honestly.** It is n=4 — four detectable sources, four zones — not a robust rate, and by our own Principle 8 a number that comes back at 100% deserves suspicion before applause. The conservative companion is **cell-level precision 71%**; its shortfall is *plume extent inside correctly-found zones* (the failing cells sit inside the zone of the very source that produced them), not false accusations. A 1.6 km satellite footprint plus advection means a real source **necessarily** lights up a 2–3 km blob. Quote both.

### 🚩 The coverage-bias number, stated correctly

An earlier draft of this document reported **"0 of 9 sources sit within 2 km of a monitor"** as the headline coverage-bias finding. **It is not a finding. It is an assumption**, and reporting it as a measurement is precisely the error Principle 8 exists to prevent.

`pick_station_cells()` places monitors by excluding each source's cell and its k=2 ring — an effective floor of ~1.9–2.4 km. Exactly **one** of 1,039 candidate cells survives inside 2 km of a source, so P(any of the 12 stations lands there) = **1.1%**. The statement is true ~99% of the time *by construction*: it restates CPCB siting norms, which is why we model it, but a synthetic world cannot **discover** its own placement rule. That is the same class of error as the 100% attribution trap, wearing a different hat.

**The empirical version, which owes nothing to our placement rule:** scatter the same 12 monitors *uniformly at random* over the city — the least biased network anyone could build, with nothing avoiding sources on purpose — and they catch a **median of 1 of 9 sources. They miss 8 of 9.** P(a random network catches zero) = 21%. Only 12% of the city lies within 2 km of a source.

That is pure geometry, and it is the stronger claim: **sparsity misses sources before siting bias even gets a turn.** A dozen sensors cannot cover a city, however honestly you place them. Siting bias then makes it worse.

### And the recall does not depend on any of it

`scripts/eval_station_sensitivity.py` re-runs detection with the station exclusion dialled from k=2 (realistic siting) to k=0 (monitors may sit *directly on* a source). **Recall is constant at 4/4 across every regime**, because detection reads satellite + FIRMS and never touches a station. Fusion LOSO R², by contrast, moves from 0.90 to 0.72 — as it must, since it is trained on stations.

One number is siting-dependent; the other is not. That contrast is the evidence that the headline is not an artefact of a rule we invented.

### Known blind spots (stated, not hidden)

- **Construction dust is invisible to this detector.** It is coarse PM with no satellite tracer (S5P measures NO₂/SO₂/CO/aerosol index; none fingerprint it) and it does not burn. Recall on construction sources is **0/3**. Catching it needs the OSM permit layer, PM10/PM2.5 coarse-fraction from stations, and citizen reports — not this detector.
- **Traffic is confounded.** The NO₂ column does see traffic, but the diffuse road network raises NO₂ across the whole urban core, so a corridor does not stand out against its own neighbourhood. Recall on traffic corridors is **0/2**.

Claiming credit for finding what these instruments physically cannot see would be dishonest; so would quietly hiding the gap.

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
See **Layer 3b**. Satellite neighbourhood contrast + FIRMS fire persistence, aggregated over 24 h/7 d/30 d with robust statistics, classified `chronic` / `emerging` / `acute`. It does **not** run on the fusion field — that was the original design and it does not work, for measured reasons. Output: candidate hotspots with severity, ward, and detection basis.

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

**⚠️ These are the contracts as BUILT. Where they differ from an earlier draft of
this document, the code is right and the draft was wrong — build against these.**

```jsonc
// SHIPPED — generated by the pipeline today
GET /fusion?hour_offset=N
  {ts, n_hours, cells: [{cell, ward_id, pm25}]}       // pm25, NOT pm25_hat.
                                                       // No prediction interval is computed.

hotspots.json   [{cell, ward_id, ward_name, zone_id, kind, cell_kind, attributable,
                  severity, pm25_med, nearest_candidate_km,
                  z_w24h, z_w7d, z_w30d, fires_6h, detection_basis, ts}]
  // NOTE: rows are CELLS (~74) but they cluster into ZONES (~5). An inspector is
  // dispatched to a zone, not to a 460 m hexagon — group by zone_id.
  // `attributable: false` = diffuse urban background: real pollution, nobody to
  // serve a notice on. Stays on the map, EXCLUDED from the enforcement queue.
  // No `eps` / `rank` here — those belong to the prioritisation agent.

attributions.json [{cell, zone_id, ward_id, ts, pm25_estimate, primary_source,
                    confidence, scores{}, reason, evidence_factors[], evidence{},
                    explained_by}]
  // GET /attributions returns a SUBSET (cell, ward_id, ts, primary_source,
  // confidence, reason). The full evidence chain is GET /attribution/{cell}.

GET /wards      {synthetic, n_wards, cells: [{cell, ward_id, ward_name}]}

// SPECIFIED, NOT BUILT — see docs/eps-spec.md for the full schema
actions.json    [{action_id, zone_id, ward_id, ward_name, cells[], centroid{lat,lon},
                  eps, components{severity, attribution_conf, actionability,
                  vulnerability}, kind, source, confidence, n_cells, pm25_med, status}]
  // An action is a ZONE. `legal_basis` is NOT here — that is the memo agent's job.

dispatch.json   [{team_id, route_km, coverage_pct,
                  stops: [{seq, action_id, zone_id, ward_id, eps, lat, lon}]}]
  // stops carry lat/lon so the frontend can draw the route without resolving cells.

// NOT BUILT — no agent produces these yet
forecast.json   [{cell, horizon_h, pm25_hat, urgency}]
ledger.json     [{memo_id, dispatched_at, actioned_at, counterfactual, realized,
                  impact, response_hours}]
audit.json      {blind_spots[], sensor_flags[], placement_recommendations[]}
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
