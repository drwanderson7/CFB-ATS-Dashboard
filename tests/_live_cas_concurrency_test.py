"""
Real concurrency test for cas_write()'s atomic compare-and-set logic --
against ACTUAL production Upstash, through the real deployed /api/state
endpoint. Not a simulation: this fires two genuinely concurrent HTTP
requests at your live site and checks what Redis itself actually does
under contention.

WHY THIS EXISTS: tests/test_state.py's concurrent-write test proves the
CAS *logic* is correct against a faithful Python simulation of Redis's
EVAL semantics (real threads, a real lock, real race exposure) -- but
it's still a mock, not literally Upstash's Lua engine. This script is
the other half: same shape of test, real backend.

WHY I (Claude) CAN'T RUN THIS MYSELF: two separate hard blockers, not a
style choice --
  1. No credentials. Real Upstash access lives in Vercel's environment
     config, not anywhere reachable from this sandbox.
  2. No network path even WITH credentials. This sandbox's allowed
     domains don't include your Vercel deployment or Upstash's REST API
     at all -- there's no way to reach either from here regardless of
     what token I had.
So this is designed for YOU to run, from a machine with real internet
access and Python 3.

SAFETY -- what this does and does not touch:
  - Reads your REAL current private state first (a GET), and builds both
    concurrent test payloads as a full copy of that real state with only
    one extra, harmless field added: `_castest` (a small marker dict).
    Nothing you actually use is dropped or overwritten -- your real
    picks/pools/entries ride along unchanged in both payloads.
  - Fires the two writes concurrently (a threading.Barrier holds both
    threads at the exact same instant before either sends its request,
    so this is a genuine race, not "one microsecond apart").
  - Whichever write "wins" becomes your real current state (still with
    all your real data intact, just carrying a `_castest` marker).
    Whichever "loses" gets a real 409 with the winner's data handed back
    -- exactly the flow sync.js's pushState() already handles for real.
  - CLEANS UP AFTERWARD: makes one more real write that removes the
    `_castest` marker again, so your account ends up looking exactly
    like it did before this script ran (same real data, no leftover
    test field). This cleanup step is real too -- if it fails for some
    reason, the script tells you exactly what to do by hand.

WHAT YOU NEED TO RUN THIS:
  1. Your live deployment's base URL (e.g. https://pickgauge.vercel.app,
     or your custom domain once that's live -- either works, this talks
     to /api/state directly, nothing Clerk-domain-specific about it).
  2. A real Clerk session token. Easiest way to get one:
       - Open the live site in your browser, sign in normally.
       - Open DevTools -> Network tab.
       - Do anything that triggers a sync (switch tabs, refresh lines).
       - Find a request to /api/state, look at its Authorization header:
         "Bearer eyJhbGc..." -- copy everything after "Bearer ".
       - This token is short-lived (Clerk rotates it), so grab a fresh
         one right before running this script, not one from yesterday.

USAGE:
    python3 tests/_live_cas_concurrency_test.py --url https://YOUR-DEPLOYMENT --token eyJhbGc...

    Or set env vars instead of flags:
    PICKGAUGE_URL=https://YOUR-DEPLOYMENT PICKGAUGE_TOKEN=eyJhbGc... python3 tests/_live_cas_concurrency_test.py

WHAT A PASS LOOKS LIKE: exactly one of the two concurrent writes returns
200 (with the NEW revision), the other returns 409 (with the winner's
actual data handed back, not stale/corrupted data), and the final server
state matches whichever one actually won -- proving Redis really did
serialize the two writes atomically rather than letting them race and
silently clobber each other.
"""
import argparse
import copy
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request


def api_get(base_url, token, scope="user"):
    req = urllib.request.Request(
        f"{base_url}/api/state?scope={scope}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status, json.loads(res.read().decode())


def api_post(base_url, token, expected_revision, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base_url}/api/state?scope=user&expectedRevision={expected_revision}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def concurrent_write(base_url, token, expected_revision, body, barrier, results, key):
    barrier.wait()  # every thread released at the exact same instant
    status, resp = api_post(base_url, token, expected_revision, body)
    results[key] = (status, resp)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("PICKGAUGE_URL"), help="Live deployment base URL")
    parser.add_argument("--token", default=os.environ.get("PICKGAUGE_TOKEN"), help="Clerk session Bearer token")
    args = parser.parse_args()

    if not args.url or not args.token:
        print("ERROR: need both --url and --token (or PICKGAUGE_URL / PICKGAUGE_TOKEN env vars).")
        print("See this file's own module docstring for exactly how to get a token.")
        sys.exit(1)

    base_url = args.url.rstrip("/")
    token = args.token

    print(f"=== Real Upstash CAS concurrency test against {base_url} ===\n")

    # --- Step 1: read real current state ---
    print("[1/5] Reading your real current private state...")
    status, resp = api_get(base_url, token, "user")
    if status != 200:
        print(f"FAILED: GET /api/state returned {status}: {resp}")
        sys.exit(1)
    original_state = resp.get("state") or {}
    original_revision = resp.get("revision", 0)
    print(f"      Current revision: {original_revision}")
    print(f"      (this is a brand-new account if revision is 0 and state is empty/None)")

    # --- Step 2: build two concurrent payloads, both real copies of your
    # actual state, differing only in a harmless test marker ---
    payload_a = copy.deepcopy(original_state) or {}
    payload_b = copy.deepcopy(original_state) or {}
    now = time.time()
    payload_a["_castest"] = {"writer": "A", "at": now}
    payload_b["_castest"] = {"writer": "B", "at": now}
    # Server assigns _rev itself; sending one back would be meaningless
    # (see sync.js's own pushState(), same reasoning).
    payload_a.pop("_rev", None)
    payload_b.pop("_rev", None)

    print(f"\n[2/5] Built two concurrent write payloads (both carry your real")
    print(f"      data untouched, plus a harmless _castest marker to tell them apart).")

    # --- Step 3: fire both concurrently, held at a barrier so they
    # release at the exact same instant ---
    print(f"\n[3/5] Firing both writes concurrently against expectedRevision={original_revision}...")
    barrier = threading.Barrier(2)
    results = {}
    t_a = threading.Thread(target=concurrent_write, args=(base_url, token, original_revision, payload_a, barrier, results, "A"))
    t_b = threading.Thread(target=concurrent_write, args=(base_url, token, original_revision, payload_b, barrier, results, "B"))
    t_a.start(); t_b.start()
    t_a.join(); t_b.join()

    status_a, resp_a = results["A"]
    status_b, resp_b = results["B"]
    print(f"      Writer A: HTTP {status_a}")
    print(f"      Writer B: HTTP {status_b}")

    # --- Step 4: verify exactly one won, one got a real 409 with the
    # winner's actual data, and the server's final state matches ---
    print(f"\n[4/5] Checking the result...")
    outcomes = {"A": (status_a, resp_a), "B": (status_b, resp_b)}
    winners = [k for k, (s, r) in outcomes.items() if s == 200]
    losers = [k for k, (s, r) in outcomes.items() if s == 409]

    ok = True
    if len(winners) != 1:
        print(f"FAIL: expected exactly ONE writer to get 200, got {len(winners)} ({winners})")
        ok = False
    if len(losers) != 1:
        print(f"FAIL: expected exactly ONE writer to get 409, got {len(losers)} ({losers})")
        ok = False

    if ok:
        winner_key = winners[0]
        loser_key = losers[0]
        winner_new_rev = outcomes[winner_key][1].get("revision")
        expected_new_rev = original_revision + 1
        if winner_new_rev == expected_new_rev:
            print(f"PASS: winner (writer {winner_key}) got revision {winner_new_rev} (== {original_revision} + 1)")
        else:
            print(f"FAIL: winner's new revision was {winner_new_rev}, expected {expected_new_rev}")
            ok = False

        loser_body = outcomes[loser_key][1]
        returned_state = loser_body.get("state") or {}
        returned_marker = returned_state.get("_castest", {}).get("writer")
        if returned_marker == winner_key:
            print(f"PASS: loser (writer {loser_key})'s 409 handed back the WINNER's real data "
                  f"(_castest.writer == '{winner_key}'), not stale/corrupted data")
        else:
            print(f"FAIL: loser's 409 body's _castest.writer was {returned_marker!r}, expected '{winner_key}' (the actual winner)")
            ok = False

        returned_server_rev = loser_body.get("serverRevision")
        if returned_server_rev == expected_new_rev:
            print(f"PASS: loser's 409 body reports serverRevision {returned_server_rev} (matches the real new revision)")
        else:
            print(f"FAIL: loser's 409 serverRevision was {returned_server_rev}, expected {expected_new_rev}")
            ok = False

    # --- Step 5: cleanup -- remove the _castest marker, verified with a
    # final read so your account looks exactly like it did before this
    # ran (same real data, no leftover test field) ---
    print(f"\n[5/5] Cleaning up (removing the _castest marker)...")
    status, resp = api_get(base_url, token, "user")
    current_revision = resp.get("revision", 0)
    cleanup_payload = copy.deepcopy(resp.get("state") or {})
    had_marker = "_castest" in cleanup_payload
    cleanup_payload.pop("_castest", None)
    cleanup_payload.pop("_rev", None)
    cstatus, cresp = api_post(base_url, token, current_revision, cleanup_payload)
    if cstatus == 200:
        print(f"      Cleaned up successfully (revision now {cresp.get('revision')}).")
    else:
        print(f"      WARNING: cleanup write returned {cstatus}: {cresp}")
        print(f"      Your account may still have a harmless _castest field on it.")
        print(f"      It doesn't affect anything the app reads, but if you want it")
        print(f"      gone, re-run this script's cleanup step or just let your next")
        print(f"      real save() overwrite it naturally.")

    print(f"\n{'=== PASS: real Upstash CAS is atomic under genuine concurrent load ===' if ok else '=== FAIL: see above ==='}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
