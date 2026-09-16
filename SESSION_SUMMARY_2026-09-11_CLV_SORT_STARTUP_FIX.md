# Session Summary — 2026-09-11 — CLV Sort Startup Fix

## Production error
`/app` could fail during initialization with a stack beginning at `sortValue()` in `app/js/board.js` when the saved/current All Games sort was **CLV** inside a pool.

## Root cause
The CLV branch correctly computed `pickedSide` from the active entry, but then called:

```js
clvOf(g, e.side)
```

`e` did not exist in that scope, causing a `ReferenceError` during `sortGames()` in `init()`.

## Fix
The CLV sort now passes the real saved pick side:

```js
const ent=activeEntry();
const pick=ent&&ent.picks?ent.picks[g.key]:null;
const pickedSide=pick?pick.side:null;
const c=clvOf(g,pickedSide);
```

The additional guards also make CLV sorting safe for a newly created pool that does not yet have an active entry.

## Regression coverage
Added `tests/test_board_clv_sort_regression.mjs`, which:
- verifies the bad `e.side` reference cannot return;
- executes the extracted real `sortValue()` / `sortGamesBy()` helpers using CLV;
- verifies picked-side perspective is passed into `clvOf()`;
- verifies a pool with no active entry does not crash.

## Verification
- targeted board/CLV/client regression tests: PASS
- `node --check app/js/board.js`: PASS
- `bash scripts/test_all.sh --fast`: **138 files passed, 0 failed**

No visual/UI changes and no data migration required.
