# Apparatus

Apparatus holds the training program you are running, logs and scores each
session against it, and tracks the 1RM baselines that set your working loads.

## Language

### The plan

**Program**:
The full training plan currently loaded — its days, sections, movements, and the
baselines its loads derive from. Exactly one is active at a time.
_Avoid_: plan, routine, template, split

**Built-In Program**:
A Program that ships with the app and is selectable without importing anything.
_Avoid_: default program, preset, stock program

**Imported Program**:
A Program the user supplies as a file, which overrides whichever Built-In
Program is selected.
_Avoid_: custom program, uploaded program, user program

**Day**:
One training day within a Program, and the unit a Session is started from.
_Avoid_: workout, session, split day

**Off Day**:
A Day that prescribes no logged work and cannot be logged against.
_Avoid_: rest day, recovery day, deload

**Section**:
A named group of Movements within a Day. Its type decides how its Movements are
scored, and whether they are logged at all.
_Avoid_: block, group, superset, circuit

**Movement**:
A single prescribed exercise within a Section, carrying its own set and rep
scheme.
_Avoid_: exercise, workout, lift

**Lift**:
A Movement bound to a Baseline, so its working load is derived from a current
1RM rather than written into the Program.
_Avoid_: tracked exercise, main lift, compound

### Doing the work

**Session**:
One recorded attempt at a Day — what the user actually did, as opposed to what
the Day prescribed.
_Avoid_: workout, log, entry, instance

**Substitution**:
A Movement the user types in during a Session to stand in for a prescribed one,
replacing it for that Session only.
_Avoid_: alternate, swap, replacement, alternative workout

**Permanent Substitution**:
A Substitution the user marks to carry forward, so it also stands in for the
prescribed Movement in future Sessions of the same Day.
_Avoid_: saved substitution, program edit, override

### Measurement

**Baseline**:
A recorded 1RM for one Lift, together with the percentage range its working load
is drawn from. Kept separately per Program.
_Avoid_: max, PR, estimate

**Score**:
The 0–100 rating Apparatus assigns a finished Session, derived from its logged
work and the user's reported feel.
_Avoid_: rating, result

**Grade**:
The label attached to a band of Scores, such as EXCELLENT.
_Avoid_: rank, tier
