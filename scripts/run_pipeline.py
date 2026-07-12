"""End-to-end Phase-1 pipeline: ingest -> panel -> fusion field + LOSO.

  python scripts/run_pipeline.py --synthetic   # offline / demo-insurance mode
  python scripts/run_pipeline.py               # live APIs where keys exist, fallback otherwise
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from ingestion.collectors.pollers import run as ingest_run
from ingestion.preprocessing.panel import build_panel
from intelligence.models.fusion import run as fusion_run


def main():
    synthetic = "--synthetic" in sys.argv
    print("=" * 60)
    ingest_run(synthetic=synthetic)
    print("=" * 60)
    build_panel()
    print("=" * 60)
    fusion_run()
    print("=" * 60)
    print("Phase 1 complete: data/outputs/{panel,fusion_field}.parquet + loso.json")


if __name__ == "__main__":
    main()
