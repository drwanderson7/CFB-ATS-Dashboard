import * as score from '../survivor-core/js/survivor-score.js';
import * as portfolio from '../survivor-core/js/portfolio.js';
import * as results from '../survivor-core/js/results.js';
import * as sec from '../survivor-core/data/sec-pool-schedule-2026.js';
import * as bigten from '../survivor-core/data/bigten-pool-schedule-2026.js';
import * as kelly from '../survivor-core/data/kelly-pool-schedule-2026.js';
import * as pools from '../survivor-core/data/pool-teams.js';
import { CORE_MANIFEST } from '../survivor-core/core-manifest.js';

const core = Object.freeze({
  score,
  portfolio,
  results,
  schedules: Object.freeze({ sec, bigten, kelly }),
  pools,
  manifest: CORE_MANIFEST,
});

window.PickGaugeSurvivorCore = core;
window.dispatchEvent(new CustomEvent('pickgauge-survivor-core-ready', { detail: core }));
