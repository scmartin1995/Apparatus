# Apparatus

A single-file training tracker that runs as an installable PWA. Log sessions,
score them, track 1RM baselines, and drive the whole thing from a program
definition rather than hardcoded workouts.

The app ships in `index.html` (plus self-hosted fonts in `fonts/`) — no build step, no dependencies. Open it over
HTTP (a service worker needs a real origin, not `file://`) and it works offline
from then on.

## Programs

The app always has a program loaded. There are two ways one gets there.

**A built-in program.** Every program in [`programs/`](programs) is bundled into
`index.html` as `BUILT_IN_PROGRAMS`, and *Built-In Programs* on the Import screen
switches between them. They work on first run, after a cleared browser, and on a
new device — nothing to upload, nothing to lose.

| file | |
| --- | --- |
| [`field-guide-ppl.json`](programs/field-guide-ppl.json) | **default** — 3-day PPL (Thu/Fri/Sat), exercise selection driven by the Pre-Script Coach's Field Guide |
| [`ar7-hybrid.json`](programs/ar7-hybrid.json) | 4-day hybrid with AR-7 Action/Reaction blocks |

[`programs/index.json`](programs/index.json) is the ordered list of what ships.
First entry is the default. Add a file, add it there, re-run the embed script.

**An imported program.** Import a CSV (or a previously exported JSON) and it
overrides whichever built-in is selected. *Restore Built-In Program* drops the
override, and picking a built-in from the list does too. You can't end up with no
program loaded.

A day marked `isOff` is read-only — no session, no logging. If it defines
sections they render like any other day; if it defines none, the app falls back
to a generic recovery/mobility screen built into `renderOffDays`. Field Guide PPL
defines its own, AR-7 uses the fallback.

1RM baselines are stored per program id, so each program keeps its own numbers —
switching between two built-ins, or out to an import and back, never overwrites
them. Session history is shared and is never touched by a switch, import, or
restore.

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
| `day` | Day name. Blank rows inherit the day above. Put weekdays in it ("Thursday", "Sun–Wed Off", "Mon/Wed/Fri") and the app opens on today's day. |
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
Programmed work that isn't logged scores zero, so skipping sets or exercises
lowers the score.

A CSV can't express day colors, durations, or 1RM values — the app fills those
in. Weekday scheduling comes from weekday names in the `day` column; weekdays no
day names go to the one rest day, if there is exactly one. Use JSON if you need
these preserved exactly.

### JSON export

*Export Program (JSON)* on the Import screen dumps the active program with your
current 1RMs folded in. It re-imports losslessly, which makes it the way to move
a program between devices or keep a backup.

## Layout

```
index.html                      the entire app
sw.js                           service worker (bump CACHE_NAME to ship an update)
manifest.json                   PWA manifest
icon-192.png / icon-512.png     app icons (Plate A logo)
favicon.svg / favicon-32.png    browser tab icon (simplified cut for small sizes)
apple-touch-icon.png            iPhone home-screen icon
fonts/                          self-hosted fonts + licences (FONT_FILES in sw.js must match
                                fonts.css; the APK build checks it. Bump CACHE_NAME when a font changes)
programs/*.json                 program definitions
programs/index.json             ordered list of what ships; first is the default
tools/embed-program.js          validates them and inlines them into index.html
tools/build-apk.sh              builds the Android app from android/ and the web app
apparatus-program-template.csv  CSV reference
```

Edit a program in `programs/`, then run `node tools/embed-program.js` to push
them all into the `BUILT_IN_PROGRAMS` block. The app has to inline them to work
offline, and that script is what keeps the two copies from drifting.

It validates before it writes, and refuses on anything that would fail quietly
at runtime — an unknown `section_type` (which would silently mis-score a
session), a `baselineId` with no matching baseline, a baseline-bound exercise
that still has a fixed load in its sets string, a `weekdayMap` entry naming a day
that doesn't exist, or two programs sharing an `id` (which would make them share
one set of 1RMs).

## Android app

`tools/build-apk.sh` wraps the web app in a WebView and writes
`android/build/apparatus.apk`, with the fonts bundled so it needs no network.
The script header lists the tools it needs.

The app keeps its own data, separate from the browser install. *Back Up All
Data* on the Manage Program screen writes the program, 1RMs and history to one
file; importing that file on the other side restores it.

An update only installs over the existing app if it is signed with the same
key. The keystore is not in the repo (`*.keystore` is gitignored); it is kept
in Google Drive as `apparatus-signing.keystore`. Put it at
`android/apparatus.keystore` before building, or the script creates a new key
and the installed app has to be uninstalled first, which wipes its data.

## Local preview

```bash
node .claude/serve.js
```

Serves the repo at <http://localhost:4321>. Shipping a change to an installed
copy requires bumping `CACHE_NAME` in `sw.js`, or the old version stays cached.
