"""Pull the two n8n-written Supabase tables down to the files the pipeline reads.

The pipeline is batch and file-based by design; Supabase is where the CHANNELS
write. This is the bridge, run before (or by) the pipeline:

    citizen_reports    -> data/outputs/citizen_reports.json
                          (attribution's citizen_corroboration evidence)
    inspection_status  -> data/outputs/inspection_status.json
                          (the EXACT file the ledger already reads — its contract
                          was proven with a hand-written copy before n8n existed)

Needs SUPABASE_URL + SUPABASE_ANON_KEY in .env. Absent -> skips gracefully:
the pipeline must never fail because the channel layer isn't configured
(principle 2), it just runs without citizen/inspector evidence — which is
exactly today's behaviour.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from shared.config import DATA_OUT, H3_RES  # noqa: E402  (loads .env)

TABLES = {
    "citizen_reports": "citizen_reports.json",
    "inspection_status": "inspection_status.json",
}


def _resolve_wards_from_location(reports: list[dict]) -> int:
    """Give a ward to reports that only carry coordinates.

    A citizen who shares their location arrives with ward_id 'unassigned'. But
    attribution matches citizen evidence STRICTLY by ward and deliberately
    rejects 'unassigned' — so those reports were dead weight, never counting as
    corroboration, even though the bot tells people to share their location as
    the fallback when a ward name is ambiguous. Resolve lat/lon -> H3 cell ->
    ward here, where the real ward layer already lives.
    """
    wards_p = DATA_OUT / "wards.json"
    if not wards_p.exists():
        return 0
    try:
        import h3
        cell_to_ward = {c["cell"]: c["ward_id"]
                        for c in json.loads(wards_p.read_text(encoding="utf-8"))["cells"]}
    except Exception:  # noqa: BLE001 — never let this break the sync
        return 0

    fixed = 0
    for r in reports:
        if r.get("ward_id") not in (None, "", "unassigned"):
            continue
        lat, lon = r.get("lat"), r.get("lon")
        if lat is None or lon is None:
            continue
        try:
            ward = cell_to_ward.get(h3.latlng_to_cell(float(lat), float(lon), H3_RES))
        except (ValueError, TypeError):
            continue
        if ward:                      # outside the city grid -> leave unassigned
            r["ward_id"] = ward
            fixed += 1
    return fixed


def main() -> None:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not key:
        print("[supabase] SUPABASE_URL/SUPABASE_ANON_KEY not set — skipping sync "
              "(pipeline runs without citizen/inspector evidence)")
        return
    for table, fname in TABLES.items():
        req = urllib.request.Request(
            f"{url}/rest/v1/{table}?select=*",
            headers={"apikey": key, "Authorization": f"Bearer {key}"})
        rows = None
        for attempt in range(3):  # cold TLS handshakes to Supabase stall sometimes
            try:
                rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
                break
            except Exception as e:  # noqa: BLE001 — a dead channel must not kill batch
                err = f"{type(e).__name__}: {e}"
        if rows is None:
            print(f"[supabase] {table}: fetch failed after 3 tries ({err}) — skipped")
            continue
        note = ""
        if table == "citizen_reports":
            fixed = _resolve_wards_from_location(rows)
            if fixed:
                note = f" ({fixed} located by coordinates)"
        (DATA_OUT / fname).write_text(json.dumps(rows, indent=1, default=str),
                                      encoding="utf-8")
        print(f"[supabase] {table}: {len(rows)} rows -> data/outputs/{fname}{note}")


if __name__ == "__main__":
    main()
