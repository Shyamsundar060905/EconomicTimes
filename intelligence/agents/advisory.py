"""Citizen Health Risk Advisory Agent — Node 6.

Ward-level health advisories: forecast AQI x population vulnerability -> a risk tier
and a plain-language advisory in the citizen's own language.

THE RULES THIS FOLLOWS (same discipline as every other agent here)

1. THE HEALTH CATEGORY IS DETERMINISTIC. The AQI band comes from the official CPCB
   NAQI breakpoints and the risk tier is plain arithmetic over (band, vulnerability).
   An LLM never decides how dangerous the air is. It may only phrase what the
   arithmetic already concluded.

2. THE FALLBACK MUST SPEAK THE LANGUAGES TOO. "Language coverage" that evaporates
   when GEMINI_API_KEY is missing is not coverage. So every language ships a
   rule-based template, and the LLM is a *nicety* that makes the prose warmer — not
   the thing that makes it exist.

3. THE ENGLISH IS NOT INVENTED. The health-impact wording is CPCB's own published
   NAQI advisory text per band. We are not qualified to write original medical advice
   and we do not; we route the official line to the right ward at the right time.

⚠️ VERIFICATION IS PER LANGUAGE, IT RECORDS THE METHOD, AND IT SHIPS IN THE OUTPUT.
Shipping health advice nobody on the team can read is exactly the confident-but-
unverified claim this project keeps deleting. So each language carries HOW it was
verified (see VERIFICATION), not merely whether:

    en  cpcb_official  — CPCB's own published NAQI wording. Not our words.
    hi  native_speaker — a Hindi speaker rejected the first draft as too formal; the
                         register was rewritten to everyday speech.
    ta  native_speaker — the team's native Tamil speaker approved it unchanged.
    kn  cross_checked  — nobody here reads Kannada. Machine-written, then rewritten
                         and cross-checked term-for-term against the corrections a
                         HUMAN made to the Hindi.

`cross_checked` is deliberately not `native_speaker`, and the disclaimer says so on
every Kannada advisory. A second model agreeing with the first is evidence of
CONSISTENCY, not of correctness. That distinction is the whole point of the field.

WHAT WE CAN AND CANNOT SEE FOR VULNERABILITY
The brief asks for "hospitals, schools, outdoor workers, elderly populations".
  schools + hospitals  -> we have them (OSM, `lu_sensitive`)
  outdoor workers      -> no free national dataset; NOT modelled
  elderly              -> needs Census ward-level age data; NOT modelled
We report the two we can measure and say so, rather than inventing a proxy.

Output: data/outputs/advisories.json
"""
import json

import pandas as pd

from shared.config import DATA_OUT, CITY
from intelligence.agents.memo import pm25_to_aqi
from intelligence.agents.llm_gateway import complete_json

# Which languages a city broadcasts in. The brief: "Bengaluru in Kannada, Chennai in
# Tamil, and so on." English is always included — it is the administrative language
# and the fallback everyone can read.
CITY_LANGUAGES = {
    "delhi": ["en", "hi"],
    "bengaluru": ["en", "kn"],
    "chennai": ["en", "ta"],
}
LANG_NAMES = {"en": "English", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil"}

# HOW EACH LANGUAGE WAS VERIFIED — the METHOD, not a boolean.
#
# A true/false flag cannot express what actually happened here, and the difference
# matters more than the flag: three different processes produced these four languages,
# and only two of them involved a human who reads the language.
#
#   cpcb_official  en — CPCB's own published NAQI wording. Not our words at all.
#   native_speaker hi — a Hindi speaker on the team rejected the first draft as too
#                       formal; the register was rewritten to everyday speech.
#   native_speaker ta — the team's native Tamil speaker approved it unchanged.
#   cross_checked  kn — NOBODY ON THIS TEAM READS KANNADA. The first draft was
#                       machine-written and sounded like a government notice. It was
#                       rewritten with LLM assistance and cross-checked term-for-term
#                       against the corrections a HUMAN made to the Hindi
#                       (ಗಾಳಿಯ ಗುಣಮಟ್ಟ->ಗಾಳಿ mirrors वायु गुणवत्ता->हवा, etc).
#
# `cross_checked` is deliberately NOT `native_speaker`. The Kannada is much better
# than it was and is structurally parallel to two human-verified languages — that is
# real evidence. But it is evidence of CONSISTENCY, not of correctness: a second model
# agreeing with the first is not a speaker confirming either. Ten minutes from any
# Kannada speaker upgrades this; nothing else does.
VERIFICATION = {"en": "cpcb_official", "hi": "native_speaker",
                "ta": "native_speaker", "kn": "cross_checked"}
NATIVE_VERIFIED = {"cpcb_official", "native_speaker"}
LANG_REVIEWED = {l: v in NATIVE_VERIFIED for l, v in VERIFICATION.items()}

# Google Cloud TTS voice per language, for the IVR/voice advisories the brief asks
# for. VERIFIED by querying the API, not by reading a doc: hi-IN 46 voices, kn-IN 38,
# ta-IN 38. (Amazon Polly has Hindi but NO Kannada and no Tamil — which is one of the
# reasons this project stays on GCP.)
TTS_VOICE = {
    "en": ("en-IN", "en-IN-Wavenet-A"),
    "hi": ("hi-IN", "hi-IN-Wavenet-A"),
    "kn": ("kn-IN", "kn-IN-Wavenet-A"),
    "ta": ("ta-IN", "ta-IN-Wavenet-A"),
}

# CPCB's OWN published health-impact statement per NAQI band. Not our words.
CPCB_HEALTH = {
    "Good": "Minimal impact.",
    "Satisfactory": "Minor breathing discomfort to sensitive people.",
    "Moderate": "Breathing discomfort to people with lung disease such as asthma, "
                "and discomfort to people with heart disease, children and older adults.",
    "Poor": "Breathing discomfort to most people on prolonged exposure.",
    "Very Poor": "Respiratory illness on prolonged exposure.",
    "Severe": "Respiratory effects even on healthy people; serious health impacts on "
              "people with lung/heart disease. Health impacts may be experienced even "
              "during light physical activity.",
}

# Rule-based advisory templates. THESE ARE THE FALLBACK AND THE DEFAULT — the LLM only
# rewrites them more warmly if a key happens to be present.
# Review status per language lives in LANG_REVIEWED, and is emitted per advisory.
TEMPLATES = {
    "en": {
        "Good": "Air quality in {ward} is good (AQI {aqi}). No precautions needed.",
        "Satisfactory": "Air quality in {ward} is satisfactory (AQI {aqi}). Sensitive "
                        "individuals may feel minor breathing discomfort.",
        "Moderate": "Air quality in {ward} is moderate (AQI {aqi}). People with asthma "
                    "or heart conditions, children and older adults should limit "
                    "prolonged outdoor exertion.",
        "Poor": "Air quality in {ward} is POOR (AQI {aqi}). Most people may feel "
                "breathing discomfort on prolonged exposure. Reduce outdoor activity.",
        "Very Poor": "Air quality in {ward} is VERY POOR (AQI {aqi}). Avoid outdoor "
                     "exertion. Keep windows closed. Use a mask outdoors.",
        "Severe": "Air quality in {ward} is SEVERE (AQI {aqi}). Avoid all outdoor "
                  "activity. Even healthy people may be affected. Seek medical help if "
                  "you have breathing difficulty.",
    },
    # PLAIN SPOKEN HINDI, NOT TRANSLATED-ENGLISH. Reviewed by a Hindi speaker on the
    # team, who flagged the first draft as too formal ("परिश्रम", "वायु गुणवत्ता",
    # "बाहरी गतिविधि कम करें" — all literary register nobody actually says).
    #
    # This is not a style preference. The brief's whole point is that the people most
    # exposed — outdoor workers — skew low-literacy. An advisory in officialese is an
    # advisory that does not get read, which makes it worse than useless: it looks
    # like coverage while delivering none. Everyday words, short sentences.
    #
    # The ward name deliberately stays in English ("Bhalswa की हवा..."). Code-mixing
    # is completely normal in Indian speech, and transliterating arbitrary proper
    # nouns programmatically mangles them.
    "hi": {
        "Good": "{ward} की हवा साफ़ है (AQI {aqi})। कोई दिक्कत नहीं।",
        "Satisfactory": "{ward} की हवा ठीक है (AQI {aqi})। जिन्हें साँस की दिक्कत रहती "
                        "है, उन्हें थोड़ी परेशानी हो सकती है।",
        "Moderate": "{ward} की हवा ठीक नहीं है (AQI {aqi})। दमा या दिल की बीमारी वाले "
                    "लोग, बच्चे और बुज़ुर्ग बाहर ज़्यादा देर मेहनत का काम न करें।",
        "Poor": "{ward} की हवा खराब है (AQI {aqi})। ज़्यादा देर बाहर रहने पर साँस लेने "
                "में दिक्कत हो सकती है। बाहर कम निकलें।",
        "Very Poor": "{ward} की हवा बहुत खराब है (AQI {aqi})। बाहर मेहनत का काम न करें। "
                     "खिड़कियाँ बंद रखें। बाहर जाएँ तो मास्क पहनें।",
        "Severe": "{ward} की हवा बहुत ज़्यादा खराब है (AQI {aqi})। बाहर निकलने से बचें। "
                  "सेहतमंद लोगों को भी दिक्कत हो सकती है। साँस लेने में परेशानी हो तो "
                  "डॉक्टर को दिखाएँ।",
    },
    # TAMIL — DRAFT, awaiting review by the native Tamil speaker on the team.
    # Written in the same plain register the Hindi was corrected to: everyday words,
    # short sentences, no officialese. `ஊர்` names stay in English (code-mixing).
    "ta": {
        "Good": "{ward} ல் காற்று நல்லா இருக்கு (AQI {aqi}). எந்த பிரச்சனையும் இல்லை.",
        "Satisfactory": "{ward} ல் காற்று பரவாயில்லை (AQI {aqi}). மூச்சு பிரச்சனை "
                        "உள்ளவங்களுக்கு கொஞ்சம் சிரமம் இருக்கலாம்.",
        "Moderate": "{ward} ல் காற்று சரியில்லை (AQI {aqi}). ஆஸ்துமா அல்லது இதய நோய் "
                    "உள்ளவங்க, குழந்தைங்க, வயசானவங்க வெளியே ரொம்ப நேரம் கஷ்டமான வேலை "
                    "செய்ய வேண்டாம்.",
        "Poor": "{ward} ல் காற்று மோசமா இருக்கு (AQI {aqi}). ரொம்ப நேரம் வெளியே இருந்தா "
                "மூச்சு விட சிரமம் இருக்கும். வெளியே கம்மியா போங்க.",
        "Very Poor": "{ward} ல் காற்று ரொம்ப மோசமா இருக்கு (AQI {aqi}). வெளியே கஷ்டமான "
                     "வேலை வேண்டாம். ஜன்னல்களை மூடி வையுங்க. வெளியே போனா மாஸ்க் போடுங்க.",
        "Severe": "{ward} ல் காற்று மிகவும் மோசமா இருக்கு (AQI {aqi}). வெளியே போறதை "
                  "தவிர்க்கவும். நல்ல உடல்நலம் உள்ளவங்களுக்கும் பிரச்சனை வரலாம். மூச்சு "
                  "விட சிரமம் இருந்தா டாக்டரை பாருங்க.",
    },
    # KANNADA — rewritten to everyday speech after the first draft was flagged as
    # sounding like a government advisory rather than a person talking. The
    # corrections mirror, term for term, the ones the Hindi reviewer made:
    #     ಗಾಳಿಯ ಗುಣಮಟ್ಟ        -> ಗಾಳಿ            (cf. वायु गुणवत्ता -> हवा)
    #     ಹೊರಾಂಗಣ ಶ್ರಮ         -> ಹೊರಗೆ ಕಷ್ಟದ ಕೆಲಸ (cf. परिश्रम -> मेहनत का काम)
    #     ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ     -> ಹೊರಗೆ ಹೋಗಿ      (cf. बाहरी गतिविधि -> बाहर निकलें)
    #     ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ   -> ಡಾಕ್ಟರ್‌ನ್ನು ನೋಡಿ (cf. चिकित्सक -> डॉक्टर)
    #     ಮುನ್ನೆಚ್ಚರಿಕೆ ಅಗತ್ಯವಿಲ್ಲ -> ಯಾವುದೇ ತೊಂದರೆ ಇಲ್ಲ
    #
    # Very Poor uses ತುಂಬಾ and Severe uses ಬಹಳ: a step up in severity without the
    # clumsy "ತುಂಬಾ ತುಂಬಾ" doubling that a literal port of the Hindi would have given.
    "kn": {
        "Good": "{ward} ನಲ್ಲಿ ಗಾಳಿ ಚೆನ್ನಾಗಿದೆ (AQI {aqi}). ಯಾವುದೇ ತೊಂದರೆ ಇಲ್ಲ.",
        "Satisfactory": "{ward} ನಲ್ಲಿ ಗಾಳಿ ಸರಿ ಇದೆ (AQI {aqi}). ಉಸಿರಾಟದ ತೊಂದರೆ "
                        "ಇರುವವರಿಗೆ ಸ್ವಲ್ಪ ತೊಂದರೆ ಆಗಬಹುದು.",
        "Moderate": "{ward} ನಲ್ಲಿ ಗಾಳಿ ಅಷ್ಟೇನು ಚೆನ್ನಾಗಿಲ್ಲ (AQI {aqi}). ಆಸ್ತಮಾ ಅಥವಾ "
                    "ಹೃದಯದ ಸಮಸ್ಯೆ ಇರುವವರು, ಮಕ್ಕಳು ಮತ್ತು ವಯಸ್ಸಾದವರು ಹೊರಗೆ ಹೆಚ್ಚು ಹೊತ್ತು "
                    "ಕಷ್ಟದ ಕೆಲಸ ಮಾಡಬೇಡಿ.",
        "Poor": "{ward} ನಲ್ಲಿ ಗಾಳಿ ಕೆಟ್ಟಿದೆ (AQI {aqi}). ಹೆಚ್ಚು ಹೊತ್ತು ಹೊರಗೆ ಇದ್ದರೆ "
                "ಉಸಿರಾಟಕ್ಕೆ ತೊಂದರೆ ಆಗಬಹುದು. ಹೊರಗೆ ಕಡಿಮೆ ಹೋಗಿ.",
        "Very Poor": "{ward} ನಲ್ಲಿ ಗಾಳಿ ತುಂಬಾ ಕೆಟ್ಟಿದೆ (AQI {aqi}). ಹೊರಗೆ ಕಷ್ಟದ ಕೆಲಸ "
                     "ಮಾಡಬೇಡಿ. ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿ ಇಡಿ. ಹೊರಗೆ ಹೋದರೆ ಮಾಸ್ಕ್ ಹಾಕಿ.",
        "Severe": "{ward} ನಲ್ಲಿ ಗಾಳಿ ಬಹಳ ಕೆಟ್ಟಿದೆ (AQI {aqi}). ಸಾಧ್ಯವಾದಷ್ಟು ಹೊರಗೆ "
                  "ಹೋಗಬೇಡಿ. ಆರೋಗ್ಯವಾಗಿರುವವರಿಗೂ ತೊಂದರೆ ಆಗಬಹುದು. ಉಸಿರಾಟಕ್ಕೆ ತೊಂದರೆ "
                  "ಇದ್ದರೆ ಡಾಕ್ಟರ್‌ನ್ನು ನೋಡಿ.",
    },
}

BAND_RANK = {"Good": 0, "Satisfactory": 1, "Moderate": 2, "Poor": 3,
             "Very Poor": 4, "Severe": 5}


def risk_tier(band: str, vulnerable_sites: int, worsening: bool) -> tuple[str, float]:
    """Deterministic. An LLM never decides how dangerous the air is.

    risk = the AQI band, escalated by (a) how many schools/hospitals sit in the ward
    and (b) whether the forecast says it is getting worse. The equity weight is
    explicit and arithmetic: a ward full of schools at 'Poor' outranks an empty
    industrial ward at 'Poor', because the same air hurts more people there.
    """
    base = BAND_RANK.get(band, 0) / 5.0
    vuln = min(vulnerable_sites / 10.0, 1.0)
    trend = 0.15 if worsening else 0.0
    score = min(0.70 * base + 0.15 * vuln + trend, 1.0)
    tier = ("critical" if score >= 0.75 else
            "high" if score >= 0.55 else
            "moderate" if score >= 0.35 else "low")
    return tier, round(score, 3)


PROMPT = """You are writing a public health advisory for a city ward in India.

The AQI band and the health impact are ALREADY DETERMINED by official CPCB
breakpoints — do not change them, do not soften or escalate them, and do not invent
medical advice beyond the official impact statement given.

Your only job: rewrite the given advisory so it is warm, plain, and readable by
someone with limited literacy, in EACH language listed. Keep it under 40 words per
language. Keep the AQI number and the ward name exactly as given.

WARD: {ward}
AQI: {aqi}  BAND: {band}
OFFICIAL CPCB HEALTH IMPACT: {impact}
BASELINE ADVISORY PER LANGUAGE: {baseline}
LANGUAGES: {langs}

Return STRICT JSON only: {{"texts": {{"<lang code>": "<advisory>", ...}}}}"""


def _ward_situation(ward_id: str, ward_name: str, pm25: float,
                    vulnerable_sites: int, worsening: bool, n_cells: int) -> dict:
    aqi, band = pm25_to_aqi(pm25)
    tier, score = risk_tier(band, vulnerable_sites, worsening)
    return {
        "ward_id": ward_id, "ward_name": ward_name,
        "pm25": round(pm25, 1), "aqi": aqi, "aqi_category": band,
        "health_impact_cpcb": CPCB_HEALTH[band],
        "risk_tier": tier, "risk_score": score,
        "worsening": worsening, "n_cells": n_cells,
        "vulnerability": {
            "schools_hospitals_nearby": int(vulnerable_sites),
            "outdoor_workers": None,   # no free national dataset — NOT modelled
            "elderly": None,           # needs Census ward age data — NOT modelled
        },
    }


def _texts(sit: dict, langs: list[str]) -> tuple[dict, str]:
    """Advisory text per language. Templates ARE the product; the LLM only warms them."""
    band, ward, aqi = sit["aqi_category"], sit["ward_name"], sit["aqi"]
    baseline = {l: TEMPLATES[l][band].format(ward=ward, aqi=aqi)
                for l in langs if l in TEMPLATES}

    # Only WARM the wards that need it. A 'low'-tier advisory (good/satisfactory air)
    # reads fine from the template — warming it is not worth an LLM call, and firing
    # one per ward across a whole city (227 here) blows the Gemini per-minute quota
    # after ~6 calls, so the rest 429 and fall back anyway. Gate on the deterministic
    # risk tier: template for 'low', LLM warming for moderate/high/critical. Uniform
    # output, no quota burn, and the LLM still touches every advisory that matters.
    if sit.get("risk_tier", "low") == "low":
        return baseline, "rules"

    out, provider = complete_json(PROMPT.format(
        ward=ward, aqi=aqi, band=band, impact=CPCB_HEALTH[band],
        baseline=json.dumps(baseline, ensure_ascii=False),
        langs=", ".join(LANG_NAMES.get(l, l) for l in langs)))

    if out and isinstance(out.get("texts"), dict):
        texts = {l: out["texts"].get(l) or baseline[l] for l in baseline}
        # the LLM must not drop the AQI number or invent a different one
        if all(str(aqi) in t for t in texts.values()):
            return texts, provider
    return baseline, "rules"


def run() -> list[dict]:
    langs = CITY_LANGUAGES.get(CITY, ["en"])
    wards = json.loads((DATA_OUT / "wards.json").read_text())
    cell_ward = {c["cell"]: (c["ward_id"], c["ward_name"]) for c in wards["cells"]}

    panel = pd.read_parquet(DATA_OUT / "panel.parquet")
    vuln = panel.groupby("cell").lu_sensitive.first()

    # Forecast at the 24h horizon is what a citizen advisory is about: tomorrow.
    fc_path = DATA_OUT / "forecast.json"
    forecast = json.loads(fc_path.read_text()) if fc_path.exists() else []
    fc24 = {f["cell"]: f for f in forecast if f["horizon_h"] == 24}

    field = pd.read_parquet(DATA_OUT / "fusion_field.parquet")
    field["ts"] = pd.to_datetime(field.ts, utc=True)
    now = field[field.ts == field.ts.max()].set_index("cell").pm25_hat

    rows = []
    for cell, (wid, wname) in cell_ward.items():
        f = fc24.get(cell)
        rows.append({
            "ward_id": wid, "ward_name": wname,
            # tomorrow's forecast if we have it, else today's estimate
            "pm25": float(f["pm25_hat"]) if f else float(now.get(cell, float("nan"))),
            "vuln": int(vuln.get(cell, 0)),
            "worsening": bool(f["urgency"]) if f else False,
        })
    df = pd.DataFrame(rows).dropna(subset=["pm25"])

    advisories = []
    # MEDIAN pm25 per ward, never the mean — one hot cell must not put a whole ward
    # on a severe alert, and one clean cell must not mask a bad one.
    for wid, g in df.groupby("ward_id"):
        sit = _ward_situation(
            wid, g.ward_name.iloc[0], float(g.pm25.median()),
            int(g.vuln.max()), bool(g.worsening.any()), len(g))
        texts, provider = _texts(sit, langs)
        unreviewed = [l for l in texts if not LANG_REVIEWED.get(l, False)]
        advisories.append({
            **sit,
            "languages": list(texts),
            "texts": texts,
            "written_by": provider,
            # per-language, not one flag for the whole thing
            "reviewed": {l: LANG_REVIEWED.get(l, False) for l in texts},
            "verification": {l: VERIFICATION.get(l, "unverified") for l in texts},
            "disclaimer": (
                "AQI band and health impact are the official CPCB NAQI classification. "
                + (f"Text in {', '.join(LANG_NAMES.get(l, l) for l in unreviewed)} has "
                   f"NOT been read by a native speaker — it is machine-written and "
                   f"cross-checked only. Get it reviewed before broadcasting."
                   if unreviewed else
                   "All languages verified by a speaker of that language.")),
        })

    advisories.sort(key=lambda a: -a["risk_score"])
    (DATA_OUT / "advisories.json").write_text(
        json.dumps(advisories, indent=2, ensure_ascii=False), encoding="utf-8")

    tiers = pd.Series([a["risk_tier"] for a in advisories]).value_counts().to_dict()
    prov = pd.Series([a["written_by"] for a in advisories]).value_counts().to_dict()
    print(f"[advisory] {len(advisories)} ward advisories in {langs} {tiers} "
          f"(written by {prov})")
    if advisories:
        top = advisories[0]
        print(f"[advisory]   worst: {top['ward_name']} AQI {top['aqi']} "
              f"({top['aqi_category']}) tier={top['risk_tier']} "
              f"{top['vulnerability']['schools_hospitals_nearby']} schools/hospitals")
    return advisories


if __name__ == "__main__":
    run()
