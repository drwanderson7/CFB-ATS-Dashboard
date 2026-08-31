# PickGauge — Vercel Web Analytics setup (Aug 30, 2026)

## What changed
- Added `vercel-analytics.js`, a CSP-safe external bootstrap for Vercel Web Analytics.
- Added `/vercel-analytics.js` then `/_vercel/insights/script.js` to all 9 user-visible HTML pages (`/`, `/app/`, methodology, pricing, privacy, responsible play, terms, contact, 404).
- `beforeSend` removes the entire query string and URL fragment before page-view transmission. PickGauge does not need those values for traffic analytics and Clerk/auth flows can use transient query state.
- Updated Account → Beta admin copy to distinguish PickGauge's signed-in first-party activation funnel from anonymous Vercel traffic analytics.
- Updated `privacy.html` (Aug 30) with separate Website traffic analytics and Signed-in product analytics sections. No Google Analytics, Meta Pixel, advertising tracker, or Vercel custom-event payloads were added.
- Added `tests/test_vercel_web_analytics.py` and updated the old beta privacy regression to match the new disclosure.

## Important infrastructure step still required
The live Vercel project is `cfb-ats-dashboard` (`prj_1cJTKOP1DcGNTx8S2PO0RzJi566r`). On Aug 30 the live `https://cfb-ats-dashboard.vercel.app/_vercel/insights/script.js` returned 404, confirming Web Analytics is not enabled yet.

After this code is uploaded/merged:
1. Vercel → `cfb-ats-dashboard` → **Analytics** → **Enable**.
2. Trigger/redeploy production after enabling (Vercel creates the analytics routes on a deployment after enablement).
3. Visit `https://pickgauge.com/` and `/app/`.
4. In browser DevTools → Network, confirm the analytics script is 200 and a same-origin analytics `view` request is sent.
5. In Vercel → Analytics, confirm pageviews/visitors begin appearing. Useful panels: Pages, Hostname, Referrers, Country, Devices, Browsers, Operating System.

## Architecture / privacy rationale
- Vercel Web Analytics = anonymous site-level acquisition/traffic layer.
- `/api/beta` = signed-in product activation/feature-use layer.
- Vercel Web Analytics uses anonymous aggregate traffic and no analytics cookies; PickGauge additionally removes query/hash state before transmission.
- Do not add emails, pool names, picks, model numbers, or imported-file contents as custom analytics events.

## Tests
- New Vercel analytics regression: 49/49 checks pass.
- Existing beta analytics/feedback regression: 54/54 checks pass after privacy assertion update.
- Existing Vercel security-header regression: 18/18 checks pass; no CSP weakening was necessary because both analytics files are same-origin.
- Current repo has 69 permanent test files: 68 non-browser + 1 Playwright E2E.
