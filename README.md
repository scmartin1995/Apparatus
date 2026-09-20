# Apparatus

A single-file training tracker that runs as an installable PWA. Log sessions,
score them, track 1RM baselines, and drive the whole thing from a program
definition rather than hardcoded workouts.

Everything ships in `index.html` — no build step, no dependencies. Open it over
HTTP (a service worker needs a real origin, not `file://`) and it works offline
from then on.

## Programs

The app always has a program loaded. There are two ways one gets there.

**The locked program.** One program is bundled into `index.html` as
`LOCKED_PROGRAM`. It loads on first run, after a cleared browser, and on any new
device. Nothing to upload, nothing to lose.

Programs live in [`programs/`](programs), and the bundled one is a copy of
whichever file was last embedded:

| file | |
| --- | --- |
| [`field-guide-ppl.json`](programs/field-guide-ppl.json) | **currently bundled** — 3-day PPL (Thu/Fri/Sat), exercise selection driven by the Pre-Script Coach's Field Guide |
| [`ar7-hybrid.json`](programs/ar7-hybrid.json) | 4-day hybrid with AR-7 Action/Reaction blocks. Not bundled, but kept here and importable as JSON. |

Swap which one ships with `node tools/embed-program.js programs/<file>.json`.

**An imported program.** Import a CSV (or a previously exported JSON) and it
overrides the locked program. *Restore Built-In Program* on the Import screen
drops the override and falls back to AR-7. You can't end up with no program.

1RM baselines are stored per program, so switching between AR-7 and an imported
program doesn't wipe either one's numbers. Session history is never touched by
an import or a restore.

### Baselines drive the loads

An exercise with a `baselineId` has no fixed weight in the program. It carries
only its set and rep scheme, and the app appends a working range computed from
the current 1RM — `4 × 4–6` plus a 254 lb bench becomes `4 × 4–6 @ 210–215 lb`.
Raise the max on the Strength page and every place that lift appears moves with
it: the program view, the off-day view, and the target line while you're logging
the session.

The range comes from each baseline's own `pctLow`/`pctHigh`, so the suggested
weight badge during a session agrees with the prescribed target instead of
falling back to a generic rep-percentage curve. Exercises without a baseline
keep whatever load is written into their sets string.

The bound lifts are bench, overhead press, back squat, RDL, close-grip bench,
deadlift, and chest-supported row — the same seven in both programs.

### CSV format

`apparatus-program-template.csv` is the reference; *Download CSV Template* in
the app writes the same file. Columns:

| column | meaning |
| --- | --- |
| `day` | Day name. Blank rows inherit the day above. |
| `day_focus` | Subtitle, e.g. `Chest · Shoulders · Triceps` |
| `day_notes` | Session notes banner |
| `section` | Section heading. Repeat to add items to it. |
| `section_type` | `warmup`, `primary`, `ar7`, `finisher`, or `accessory` |
| `exercise` | Movement name |
| `sets` | e.g. `4 × 4–6`, `6–8 reps` |
| `exercise_note` | Rest, cues, progression rules |
| `track_1rm` | `yes` adds the lift to Strength Baselines |

`section_type` drives scoring: `warmup` rows aren't logged, `primary` scores on
load and reps, `ar7` on rounds completed, everything else on sets and RPE.

A CSV can't express day colors, durations, weekday scheduling, or 1RM values —
the app fills those in. Use JSON if you need them preserved.

### JSON export

*Export Program (JSON)* on the Import screen dumps the active program with your
current 1RMs folded in. It re-imports losslessly, which makes it the way to move
a program between devices or keep a backup.

## Layout

```
index.html                      the entire app
sw.js                           service worker (bump CACHE_NAME to ship an update)
manifest.json                   PWA manifest
icon-192.png / icon-512.png     app icons
programs/*.json                 program definitions, one of which is bundled
tools/embed-program.js          validates a program and inlines it into index.html
apparatus-program-template.csv  CSV reference
```

Edit a program in `programs/`, then run `node tools/embed-program.js` to push it
into the `LOCKED_PROGRAM` block. The app has to inline the program to work
offline, and that script is what keeps the two copies from drifting.

It validates before it writes, and refuses on anything that would fail quietly
at runtime — an unknown `section_type` (which would silently mis-score a
session), a `baselineId` with no matching baseline, a baseline-bound exercise
that still has a fixed load in its sets string, or a `weekdayMap` entry naming a
day that doesn't exist.

## Local preview

```bash
node .claude/serve.js
```

Serves the repo at <http://localhost:4321>. Shipping a change to an installed
copy requires bumping `CACHE_NAME` in `sw.js`, or the old version stays cached.
