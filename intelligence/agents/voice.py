"""
intelligence/agents/voice.py

Turns each ward's text advisory into an MP3 in that ward's language, using
Google Cloud Text-to-Speech. See docs/voice-spec.md for the full brief.

Design rules (project-wide, from spec §6):
  1. Cache by text hash — never re-synthesize unchanged text.
  2. Batch, never per-request — this runs in the pipeline, not in a request handler.
  3. Never fail the pipeline — TTS errors are logged and skipped, text ships regardless.

Usage:
    python intelligence/agents/voice.py
or, wired into the pipeline:
    from intelligence.agents.voice import run as voice_run
    voice_run()
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger("voice_agent")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

# ---------------------------------------------------------------------------
# Paths / config
# ---------------------------------------------------------------------------

DATA_OUT = Path("data/outputs")
ADVISORIES_PATH = DATA_OUT / "advisories.json"
AUDIO_DIR = DATA_OUT / "audio"
MANIFEST_PATH = AUDIO_DIR / "manifest.json"

GCP_PROJECT = "aq-intelligence"  # x-goog-user-project header, per spec §4
TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
TTS_TIMEOUT_SECS = 60

# language -> {code, voice}. Import TTS_VOICE from advisory.py if that's the
# canonical source in this repo; falling back to a local copy here so this
# module works standalone. NOTE: swap this import in if advisory.py already
# defines it, to avoid two sources of truth drifting apart.
try:
    from intelligence.agents.advisory import TTS_VOICE  # type: ignore
except ImportError:
    logger.warning(
        "Could not import TTS_VOICE from intelligence.agents.advisory; "
        "using a local fallback mapping. Verify this matches advisory.py."
    )
    TTS_VOICE = {
        "hi": {"language_code": "hi-IN", "name": "hi-IN-Wavenet-A"},
        "ta": {"language_code": "ta-IN", "name": "ta-IN-Wavenet-A"},
        "kn": {"language_code": "kn-IN", "name": "kn-IN-Wavenet-A"},
        "en": {"language_code": "en-IN", "name": "en-IN-Wavenet-A"},
    }

# Starting guess per spec — tune by ear (§4, §5). 0.9 = slightly slower than
# default, on the theory that a warning read too fast is a warning nobody
# follows. This is not something I can verify without hearing the output.
SPEAKING_RATE = 0.9


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def _gcloud_executable() -> str:
    """Resolve the actual gcloud executable path.

    On Windows, gcloud is installed as gcloud.cmd (a batch script), which
    subprocess cannot launch directly via CreateProcess without shell=True
    or the fully-resolved path (including extension). shutil.which() finds
    the right file (gcloud.cmd on Windows, gcloud elsewhere) using PATH and
    PATHEXT, avoiding the need for shell=True.
    """
    path = shutil.which("gcloud")
    if not path:
        raise RuntimeError(
            "gcloud not found on PATH. Make sure the Google Cloud SDK is "
            "installed and 'gcloud' works from this terminal."
        )
    return path


def _access_token() -> str:
    """Shell out to gcloud for a short-lived access token.

    Requires the caller to already be logged in (`gcloud auth login` /
    `gcloud auth application-default login`). Raises if gcloud isn't on
    PATH or the user isn't authenticated — callers should catch this.
    """
    result = subprocess.run(
        [_gcloud_executable(), "auth", "print-access-token"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gcloud auth print-access-token failed: {result.stderr.strip()}"
        )
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("gcloud returned an empty access token")
    return token


# ---------------------------------------------------------------------------
# Core synth call
# ---------------------------------------------------------------------------

def synthesize(text: str, language_code: str, voice_name: str,
               speaking_rate: float = SPEAKING_RATE) -> bytes:
    """Call Cloud TTS and return raw MP3 bytes. Raises on any failure —
    callers are responsible for catching (per rule 3, never fail pipeline).
    """
    body = {
        "input": {"text": text},
        "voice": {"languageCode": language_code, "name": voice_name},
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
    }
    req = urllib.request.Request(
        TTS_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {_access_token()}",
            "x-goog-user-project": GCP_PROJECT,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TTS_TIMEOUT_SECS) as resp:
        payload = json.loads(resp.read())
    audio_b64 = payload.get("audioContent")
    if not audio_b64:
        raise RuntimeError(f"TTS response had no audioContent: {payload}")
    return base64.b64decode(audio_b64)


# ---------------------------------------------------------------------------
# Hashing / caching
# ---------------------------------------------------------------------------

def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _load_existing_manifest() -> dict[str, dict[str, Any]]:
    """Returns {(ward_id, lang) key -> manifest entry} for cache lookups."""
    if not MANIFEST_PATH.exists():
        return {}
    try:
        entries = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Could not read existing manifest (%s), starting fresh", e)
        return {}
    return {f"{e['ward_id']}::{e['lang']}": e for e in entries}


# ---------------------------------------------------------------------------
# Main pipeline entry point
# ---------------------------------------------------------------------------

def run() -> None:
    """Synthesize audio for every ward/language in advisories.json.

    Never raises — per spec rule 3, a TTS/pipeline failure here must not
    take down the rest of the pipeline. Text advisories still ship.
    """
    if not ADVISORIES_PATH.exists():
        logger.error("No advisories.json at %s — skipping voice generation "
                     "(pipeline continues).", ADVISORIES_PATH)
        return

    try:
        advisories = json.loads(ADVISORIES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.error("Could not read/parse advisories.json (%s) — skipping "
                     "voice generation.", e)
        return

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    existing = _load_existing_manifest()
    manifest: list[dict[str, Any]] = []

    synthesized, skipped, failed = 0, 0, 0

    for advisory in advisories:
        ward_id = advisory.get("ward_id")
        languages = advisory.get("languages", [])
        texts = advisory.get("texts", {})
        verification = advisory.get("verification", {})

        if not ward_id:
            logger.warning("Advisory missing ward_id, skipping entry: %r", advisory)
            continue

        advisory.setdefault("audio", {})

        for lang in languages:
            text = texts.get(lang)
            if not text:
                logger.warning("No text for %s/%s, skipping", ward_id, lang)
                continue

            voice_cfg = TTS_VOICE.get(lang)
            if not voice_cfg:
                logger.warning("No TTS voice configured for language '%s' "
                               "(ward %s), skipping", lang, ward_id)
                continue

            text_hash = _text_hash(text)
            cache_key = f"{ward_id}::{lang}"
            cached = existing.get(cache_key)
            rel_path = f"audio/{ward_id}_{lang}.mp3"
            abs_path = DATA_OUT / rel_path

            # Rule 1: cache by text hash. Skip if unchanged AND file still exists.
            if cached and cached.get("text_hash") == text_hash and abs_path.exists():
                manifest.append(cached)
                advisory["audio"][lang] = rel_path
                skipped += 1
                continue

            # TTS_VOICE entries may be a (language_code, voice_name) tuple
            # (as in advisory.py) or a {"language_code": ..., "name": ...}
            # dict (the local fallback above). Handle both.
            if isinstance(voice_cfg, (tuple, list)):
                voice_language_code, voice_name = voice_cfg[0], voice_cfg[1]
            elif isinstance(voice_cfg, dict):
                voice_language_code = voice_cfg["language_code"]
                voice_name = voice_cfg["name"]
            else:
                logger.warning("Unrecognized TTS_VOICE entry shape for '%s': "
                               "%r, skipping", lang, voice_cfg)
                continue

            try:
                audio_bytes = synthesize(
                    text=text,
                    language_code=voice_language_code,
                    voice_name=voice_name,
                )
                abs_path.write_bytes(audio_bytes)
            except (urllib.error.URLError, RuntimeError, OSError, TimeoutError) as e:
                # Rule 3: log and skip, never raise. Text advisory still ships
                # without audio for this ward/language.
                logger.error("TTS failed for %s/%s: %s", ward_id, lang, e)
                failed += 1
                continue

            entry = {
                "ward_id": ward_id,
                "lang": lang,
                "path": rel_path,
                "voice": voice_name,
                "chars": len(text),
                "bytes": len(audio_bytes),
                "text_hash": text_hash,
                # Carried through from the advisory so nothing downstream can
                # claim more confidence than the underlying text actually has
                # (spec §5 — Kannada is cross_checked, not native-verified).
                "text_verification": verification.get(lang),
            }
            manifest.append(entry)
            advisory["audio"][lang] = rel_path
            synthesized += 1

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                              encoding="utf-8")

    try:
        ADVISORIES_PATH.write_text(
            json.dumps(advisories, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except OSError as e:
        logger.error("Could not write updated advisories.json with audio "
                     "paths: %s (audio files + manifest were still written)", e)

    logger.info(
        "Voice agent done: %d synthesized, %d cached/skipped, %d failed",
        synthesized, skipped, failed,
    )


if __name__ == "__main__":
    run()