"""Regression coverage for first-party beta analytics + feedback."""
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BETA_PATH = ROOT / "api" / "beta.py"
INDEX = (ROOT / "app" / "index.html").read_text()
PRIVACY = (ROOT / "privacy.html").read_text()
BETA_JS = (ROOT / "app" / "js" / "beta.js").read_text()

spec = importlib.util.spec_from_file_location("pickgauge_beta", BETA_PATH)
beta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(beta)

failures = []
total = 0

def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

check("analytics event allowlist includes core product funnel", {
    "app_open", "tab_view", "odds_refresh", "predictions_load", "powers_pdf_import",
    "pool_import", "my_numbers_manual", "my_numbers_csv_import", "snapshot_export", "pick_set", "entry_submitted", "feedback_submitted"
}.issubset(beta.ALLOWED_EVENTS))
check("analytics property sanitizer keeps valid coarse values", beta._safe_props({
    "tab":"board", "device":"mobile", "context":"pool", "source":"csv", "secret":"nope"
}) == {"tab":"board", "device":"mobile", "context":"pool", "source":"csv"})
check("analytics property sanitizer drops arbitrary values", beta._safe_props({
    "tab":"<script>", "device":"phone-123", "context":"private", "source":"evil"
}) == {})
check("feedback is capped at 2000 chars", beta.MAX_FEEDBACK_CHARS == 2000)
check("analytics/feedback retention is 400 days", beta.RETENTION_SECONDS == 400 * 24 * 60 * 60)
check("admin summaries use existing PickGauge admin allowlist", 'PICKGAUGE_ADMIN_UIDS' in BETA_PATH.read_text())
check("beta endpoint sends explicit no-store", 'self.send_header("Cache-Control", "private, no-store, max-age=0")' in BETA_PATH.read_text())
check("beta POST requires Clerk auth", 'uid = verify_user(self)' in BETA_PATH.read_text())
check("feedback POST is rate limited", 'rate_limited(uid, "feedback", 5, 3600)' in BETA_PATH.read_text())
check("analytics POST is rate limited", 'rate_limited(uid, "event", 180, 60)' in BETA_PATH.read_text())
check("backend stores no raw analytics event stream", "LPUSH', KEYS[1]" not in beta.ANALYTICS_SCRIPT and "HINCRBY" in beta.ANALYTICS_SCRIPT)
check("daily unique users use HyperLogLog", "PFADD" in beta.ANALYTICS_SCRIPT and "PFCOUNT" in beta.SUMMARY_SCRIPT)
check("user identity is one-way hashed before analytics", 'hashlib.sha256(uid.encode()).hexdigest()' in BETA_PATH.read_text())

# Exercise analytics-summary parsing without Redis/network.
orig_eval = beta.kv_eval
try:
    beta.kv_eval = lambda script, keys, args: [
        3,
        "2026-08-26", 2, ["event:app_open", "4", "event:odds_refresh", "2", "event:tab_view|tab:board", "6"],
        "2026-08-25", 2, ["event:app_open", "3", "event:odds_refresh", "1"],
    ]
    summary = beta._analytics_summary(2)
    check("summary reports true range unique-user count", summary["uniqueUsers"] == 3)
    check("summary totals app opens across days", summary["totals"].get("event:app_open") == 7)
    check("summary totals odds refreshes across days", summary["totals"].get("event:odds_refresh") == 3)
    check("dimension counts stay in daily detail instead of top-level totals", "event:tab_view|tab:board" not in summary["totals"])
finally:
    beta.kv_eval = orig_eval

# Exercise feedback validation/storage payload without Redis/network.
calls = []
orig_eval = beta.kv_eval
orig_track = beta._track_event
try:
    beta.kv_eval = lambda script, keys, args: calls.append((script, keys, args)) or 1
    beta._track_event = lambda uid, event, props: calls.append(("track", uid, event, props)) or 1
    fid, err = beta._store_feedback("user_123", {
        "category":"bug", "message":"Board button does not respond", "tab":"board", "device":"mobile", "context":"pool",
        "email":"should-not-be-stored@example.com", "picks":["secret"],
    })
    check("valid feedback stores successfully", bool(fid) and err is None)
    stored = json.loads(calls[0][2][0])
    check("stored feedback contains pseudonymous user token", stored.get("user") and stored.get("user") != "user_123")
    check("stored feedback does not include email", "email" not in stored)
    check("stored feedback does not include picks", "picks" not in stored)
    check("stored feedback records coarse app context", stored.get("tab") == "board" and stored.get("device") == "mobile" and stored.get("context") == "pool")
    check("feedback submission increments aggregate feedback event", any(c[0] == "track" and c[2] == "feedback_submitted" for c in calls if isinstance(c, tuple)))
    fid2, err2 = beta._store_feedback("user_123", {"category":"bug", "message":"x"})
    check("too-short feedback is rejected", fid2 is None and err2)
    beta.kv_eval = lambda script, keys, args: None
    fid3, err3 = beta._store_feedback("user_123", {"category":"idea", "message":"A valid but unstorable message"})
    check("feedback does not claim success when Redis storage is unavailable", fid3 is None and "unavailable" in err3.lower())
finally:
    beta.kv_eval = orig_eval
    beta._track_event = orig_track

PICKS_JS = (ROOT / "app" / "js" / "picks.js").read_text()
check("pick selection is part of the product funnel analytics", 'trackBetaEvent("pick_set"' in PICKS_JS)
check("entry submission is part of the product funnel analytics", 'trackBetaEvent("entry_submitted"' in PICKS_JS)
check("persistent header feedback control exists", 'id="feedbackBtn"' in INDEX)
check("Help tab feedback CTA exists", 'id="helpFeedbackBtn"' in INDEX)
check("custom feedback modal exists", 'id="betaFeedbackModal"' in INDEX and 'aria-modal="true"' in INDEX)
check("feedback modal states no automatic pick/model/file attachment", 'no screenshots, picks, model numbers, or imported file contents are attached' in INDEX)
check("admin analytics card exists", 'id="betaAdminCard"' in INDEX and 'id="betaAnalyticsStats"' in INDEX)
check("beta client script is loaded", '<script src="/app/js/beta.js"></script>' in INDEX)
check("privacy policy discloses first-party analytics", 'first-party' in PRIVACY.lower() and 'analytics' in PRIVACY.lower())
check("privacy policy explicitly says no third-party analytics script", 'No Google Analytics, Meta Pixel, advertising tracker, or other third-party analytics script is loaded.' in PRIVACY)
check("privacy policy discloses feedback retention", 'Beta feedback also expires after about 400 days.' in PRIVACY)
check("privacy policy no longer claims PickGauge uses no analytics", "doesn't use analytics" not in PRIVACY)
check("client analytics never sends account email", "primaryEmailAddress" not in BETA_JS and "emailAddress" not in BETA_JS)

print(f"\n{'All ' + str(total) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total) + ' checks FAILED:'}")
if failures:
    for f in failures:
        print(" -", f)
    raise SystemExit(1)
