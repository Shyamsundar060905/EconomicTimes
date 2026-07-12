# AQ Intelligence Platform

From AQI dashboards to enforcement dispatch — signal -> attribution -> action.

## Monorepo layout (one deployable unit per top-level folder)
    app/            presentation: frontend (React+Vite+Leaflet) + read-only FastAPI
    ingestion/      data platform: collectors (6 sources) + preprocessing (cell x hour panel)
    intelligence/   models (fusion field) + agents (detection, attribution, LLM gateway)
    shared/         config + geo utilities imported by all units
    scripts/        end-to-end runner + truth-scored evaluations
    docs/           architecture + evaluation notes
    data/           BBMP.geojson (static input); raw/ and outputs/ are gitignored

## Quickstart (zero API keys)
    pip install -r requirements.txt
    PYTHONPATH=. python scripts/run_pipeline.py --synthetic
    PYTHONPATH=. python intelligence/agents/detect.py
    PYTHONPATH=. python intelligence/agents/attribution.py
    PYTHONPATH=. python scripts/eval_attribution.py
    uvicorn app.backend.main:app --port 8000   # then GET /hotspots, /fusion, /loso

## Live mode
    cp .env.example .env   # fill free keys (OpenAQ, FIRMS; Gemini/Groq optional)
    PYTHONPATH=. python scripts/run_pipeline.py   # per-source fallback to synthetic

## Current results (synthetic world, truth-scored)
    Fusion LOSO: RMSE ~4.9, R2 ~0.91 (12 stations, leave-one-station-out)
    Hotspot recovery: fusion cuts top-decile error ~19% vs naive station-mean
    Detection: citywide-episode flag + 71 local hotspots (anomaly + chronic paths)
    Attribution: 71/71 correct vs ground truth, mean confidence 0.93
