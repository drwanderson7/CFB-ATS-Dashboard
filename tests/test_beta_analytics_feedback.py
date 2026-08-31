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
    "app_open", "signup", "pool_ready", "predictions_ready", "pick_ready", "snapshot_view",
    "tab_view", "odds_refresh", "predictions_load", "powers_pdf_import", "pool_import",
    "my_numbers_manual", "my_numbers_csv_import", "snapshot_export", "pick_set", "entry_submitted", "feedback_submitted"
}.issubset(beta.ALLOWED_EVENTS))
check("analytics property sanitizer keeps valid coarse values", beta._safe_props({
    "tab":"board", "device":"mobile", "context":"pool", "source":"csv", "season":2026, "week":1,
    "lastAction":"predictions_load", "lastActionSource":"server", "secret":"nope"
}) == {"tab":"board", "device":"mobile", "context":"pool", "source":"csv", "season":2026, "week":1,
      "lastAction":"predictions_load", "lastActionSource":"server"})
check("analytics property sanitizer drops arbitrary values", beta._safe_props({
    "tab":"<script>", "device":"phone-123", "context":"private", "source":"evil", "season":1900, "week":99,
    "lastAction":"password", "lastActionSource":"evil"
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
check("per-event unique milestone users use a separate HyperLogLog", "KEYS[3]" in beta.ANALYTICS_SCRIPT and "PFCOUNT" in beta.EVENT_UNIQUE_SCRIPT)
check("user identity is one-way hashed before analytics", 'hashlib.sha256(uid.encode()).hexdigest()' in BETA_PATH.read_text())

# Exercise analytics-summary parsing without Redis/network.
orig_eval = beta.kv_eval
try:
    def fake_eval(script, keys, args):
        if script == beta.SUMMARY_SCRIPT:
            return [
                3,
                "2026-08-26", 2, ["event:app_open", "4", "event:odds_refresh", "2", "event:tab_view|tab:board", "6", "event:app_open|device:mobile", "3"],
                "2026-08-25", 2, ["event:app_open", "3", "event:odds_refresh", "1", "event:app_open|device:desktop", "3"],
            ]
        if script == beta.EVENT_UNIQUE_SCRIPT:
            return ["app_open", 2, "signup", 1, "pool_ready", 2, "predictions_ready", 2, "pick_ready", 1, "snapshot_view", 1, "entry_submitted", 1]
        return None
    beta.kv_eval = fake_eval
    summary = beta._analytics_summary(2)
    check("summary reports true range unique-user count", summary["uniqueUsers"] == 3)
    check("summary totals app opens across days", summary["totals"].get("event:app_open") == 7)
    check("summary totals odds refreshes across days", summary["totals"].get("event:odds_refresh") == 3)
    check("dimension counts stay in daily detail instead of top-level totals", "event:tab_view|tab:board" not in summary["totals"])
    check("summary exposes exact unique users by activation milestone", summary["uniqueByEvent"].get("pool_ready") == 2 and summary["uniqueByEvent"].get("pick_ready") == 1)
    check("app-open funnel step keeps continuous established active-user union", summary["uniqueByEvent"].get("app_open") == 3)
    check("summary declares funnel unique rollout date", summary["funnelSince"] == beta.FUNNEL_UNIQUE_SINCE == "2026-08-30")
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
        "source":"help", "season":2026, "week":1, "lastAction":"predictions_load", "lastActionSource":"server",
        "email":"should-not-be-stored@example.com", "picks":["secret"], "poolName":"Office ATS",
    })
    check("valid feedback stores successfully", bool(fid) and err is None)
    stored = json.loads(calls[0][2][0])
    check("stored feedback contains pseudonymous user token", stored.get("user") and stored.get("user") != "user_123")
    check("stored feedback does not include email", "email" not in stored)
    check("stored feedback does not include picks", "picks" not in stored)
    check("stored feedback does not include pool name", "poolName" not in stored)
    check("stored feedback records coarse app context", stored.get("tab") == "board" and stored.get("device") == "mobile" and stored.get("context") == "pool")
    check("stored feedback records safe diagnostic context", stored.get("source") == "help" and stored.get("season") == 2026 and stored.get("week") == 1 and stored.get("lastAction") == "predictions_load" and stored.get("lastActionSource") == "server")
    check("feedback submission increments aggregate feedback event", any(c[0] == "track" and c[2] == "feedback_submitted" for c in calls if isinstance(c, tuple)))
    calls.clear()
    fid_legacy, err_legacy = beta._store_feedback("user_123", {"category":"idea", "message":"Please add a useful feature"})
    legacy_stored = json.loads(calls[0][2][0])
    check("legacy idea feedback normalizes to feature request", bool(fid_legacy) and err_legacy is None and legacy_stored.get("category") == "feature")
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
check("pick milestone is emitted after a successful pick", 'trackBetaEvent("pick_ready"' in PICKS_JS)
TABS_JS = (ROOT / "app" / "js" / "tabs.js").read_text()
POOLS_JS = (ROOT / "app" / "js" / "pool-contexts.js").read_text()
PREDS_JS = (ROOT / "app" / "js" / "prediction-tracker.js").read_text()
check("Snapshot view milestone is instrumented", 'trackBetaSnapshotView' in TABS_JS)
check("pool-ready milestone covers imported and manual pools", POOLS_JS.count('trackBetaEvent("pool_ready"') >= 3)
check("predictions-ready milestone covers cache and server loads", PREDS_JS.count("trackBetaEvent('predictions_ready'") >= 2)
check("persistent header feedback control exists", 'id="feedbackBtn"' in INDEX)
check("Help tab feedback CTA exists", 'id="helpFeedbackBtn"' in INDEX)
check("custom feedback modal exists", 'id="betaFeedbackModal"' in INDEX and 'aria-modal="true"' in INDEX)
check("feedback modal states sensitive content is not attached", 'no screenshots, picks, model numbers, pool names, email addresses, or imported file contents' in INDEX)
check("feedback modal shows attached diagnostic context", 'id="betaFeedbackContext"' in INDEX)
check("feedback UI uses explicit feature-request tag", 'option value="feature">Feature request' in INDEX and 'option value="idea"' not in INDEX)
check("admin analytics card exists", 'id="betaAdminCard"' in INDEX and 'id="betaAnalyticsStats"' in INDEX)
check("admin analytics card contains unique-user funnel and activity sections", 'id="betaAnalyticsFunnel"' in INDEX and 'id="betaFeatureActivity"' in INDEX and 'id="betaDailyActivity"' in INDEX)
check("beta client script is loaded", '<script src="/app/js/beta.js"></script>' in INDEX)
check("privacy policy discloses first-party analytics", 'first-party' in PRIVACY.lower() and 'analytics' in PRIVACY.lower())
check("privacy policy excludes ad/cross-site trackers while disclosing Vercel Web Analytics", 'Vercel Web Analytics' in PRIVACY and 'does not use Google Analytics, Meta Pixel, advertising trackers' in PRIVACY)
check("privacy policy discloses feedback retention", 'Beta feedback also expires after about 400 days.' in PRIVACY)
check("privacy policy discloses per-event unique funnel without raw history", 'per-event HyperLogLog' in PRIVACY and 'without storing a raw user-level event history' in PRIVACY)
check("privacy policy discloses coarse feedback diagnostics", 'season/week' in PRIVACY and 'coarse recent product action' in PRIVACY and 'pool names' in PRIVACY)
check("privacy policy no longer claims PickGauge uses no analytics", "doesn't use analytics" not in PRIVACY)
check("client analytics never sends account email", "primaryEmailAddress" not in BETA_JS and "emailAddress" not in BETA_JS)

print(f"\n{'All ' + str(total) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total) + ' checks FAILED:'}")
if failures:
    for f in failures:
        print(" -", f)
    raise SystemExit(1)
