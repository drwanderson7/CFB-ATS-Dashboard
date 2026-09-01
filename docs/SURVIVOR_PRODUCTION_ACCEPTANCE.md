# PickGauge Survivor — production acceptance

Run this only after the cumulative Survivor build is deployed.

## Desktop / authenticated account
1. Sign in to production PickGauge.
2. Open Survivor and load SEC, Big Ten and Kelly.
3. Create a second entry, rename it, and save picks.
4. Save one edit and refresh immediately (inside the old 1.5-second debounce window).
5. Confirm entries/picks remain.
6. Sign out and sign back in; confirm they remain.
7. Remove/re-add one pick.
8. Confirm team reuse is blocked and Kelly cannot take opposite sides of one game.

## Second device / second browser
1. Sign into the same account.
2. Confirm durable entries and picks appear.
3. Change viewed Survivor pool/week/tab on device 2.
4. Confirm desktop's viewed pool/week/tab does not change.
5. Make a new pick on device 2.
6. Refresh desktop after sync; confirm the pick appears.

## Live results / rollover
1. Completed saved pick shows final W/L and score.
2. Current unfinished saved pick shows awaiting result.
3. Losing pick eliminates the entry.
4. Kelly 1/2 in a completed historical week is MISSING PICK.
5. Completed pool week advances to the next week.
6. Postponed game stays attached to its moved kickoff.
7. Stale incomplete game cannot strand the app indefinitely.
8. Final pool week shows SURVIVED only when every required pick is a completed win.

## Mobile
Test around 390px width and on a real phone if available:
- no page-wide overflow
- Season Board scrolls inside the board
- sticky team column remains usable
- opponent + win probability remain readable
- Week Rankings actions remain tappable
- Season Plan remains readable
- My Picks entry actions fit
- Kelly 2-pick rows fit
- History remains reachable/scrollable
- Weekly Snapshot buttons fit
- Export PNG works
- Share works where Web Share is supported

## Standalone retirement
Copy `docs/SURVIVOR_LIVE_ACCEPTANCE.example.json` to
`docs/SURVIVOR_LIVE_ACCEPTANCE.json`, fill it out, then run:

`node scripts/check_survivor_retirement_gate.mjs`

Do not retire the standalone Survivor project until that command passes.
