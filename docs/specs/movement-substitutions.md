# Movement Substitutions

> Vocabulary in this spec follows [`GLOSSARY.md`](../../GLOSSARY.md). The storage
> decision behind Permanent Substitutions is recorded in
> [ADR 0001](../adr/0001-permanent-substitutions-as-an-override-layer.md).

## Problem Statement

The Program prescribes exactly one Movement per slot, and the app assumes you
will do it. Gyms do not work that way. The leg press is occupied, the cable
station has a queue, a bench is broken — and right now the lifter has three bad
options: log the prescribed Movement with numbers from something else they
actually did, skip the Movement and watch the Score drop for a reason that has
nothing to do with their effort, or abandon the Session.

None of those is honest. The first corrupts history and poisons the suggested
weights that are derived from it. The second makes the Score a measure of gym
traffic. The third loses the whole session.

There is also a slower version of the same problem. Sometimes a Movement is not
unavailable today, it is unavailable permanently — the lifter's gym has no hack
squat, or a machine has been removed. Today the only fix is to edit the Program
source and re-run the embed script, which is not something a lifter does from
the gym floor on a phone.

## Solution

During a Session, any logged Movement can be substituted: the lifter types in
whatever they are actually going to do, adjusts the sets and reps or keeps the
prescribed scheme, and logs against that instead. It is free text — no preset
list, no autocomplete, no library of approved alternatives to pick from. The
Session scores exactly as it would have, because the lifter did the work.

By default the Substitution holds for that day only. The Program is untouched and
next week prescribes the original Movement again. The Session record keeps both
names, so history shows what was actually done and what it stood in for.

When the Movement is gone for good, the lifter marks the Substitution as
permanent — either at the moment they make it, or from the Session Summary
afterwards if they did not decide in the moment. A Permanent Substitution stands
in for the prescribed Movement in every future Session of that Day, shows in the
Program view marked as a Substitution, and can be reverted from there. It still
does not modify the Program.

## User Stories

### Substituting during a Session

1. As a lifter, I want to substitute a Movement while a Session is active, so that an occupied machine does not stop me from training.
2. As a lifter, I want to type the substitute Movement's name freely, so that I can log whatever I actually did rather than hunting for the closest preset.
3. As a lifter, I want the substitute's sets and reps prefilled from the prescribed scheme, so that keeping the original scheme takes no effort.
4. As a lifter, I want to change the rep range on a substitute, so that a machine that only makes sense for higher reps can be logged as such.
5. As a lifter, I want to change the number of sets on a substitute, so that I can express a scheme the prescribed one does not fit.
6. As a lifter, I want my already-logged sets preserved when I change the set count, so that adjusting the scheme mid-Movement does not cost me the work I already recorded.
7. As a lifter, I want to be warned before a set-count reduction discards sets I have already filled in, so that I do not lose logged work by accident.
8. As a lifter, I want to substitute a Movement in any logged Section — primary, AR-7, accessory, or finisher — so that the flexibility is not arbitrarily limited to part of the Session.
9. As a lifter, I want to substitute more than one Movement in a single Session, so that a crowded gym is fully expressible.
10. As a lifter, I want to see clearly which Movements in the current Session are Substitutions and what each replaced, so that I always know what the Program actually asked for.
11. As a lifter, I want to revert a Substitution back to the prescribed Movement mid-Session, so that a machine freeing up does not leave me stuck with my workaround.
12. As a lifter, I want to be warned before reverting discards values I logged against the substitute, so that I understand what I am giving up.
13. As a lifter, I want to cancel out of the substitution form without changing anything, so that opening it by mistake is harmless.

### Scoring

14. As a lifter, I want a substituted Movement to score exactly as the Movement it replaced would have, so that my Score reflects my training and not my gym's equipment availability.
15. As a lifter, I want my Score's primary and hypertrophy weighting unchanged by a Substitution, so that swapping a Movement cannot shift how the Session is graded.
16. As a lifter, I want a substituted Movement graded against the rep range I actually set, so that a deliberately higher-rep alternative is not scored as a failure to hit the original range.
17. As a lifter, I want no penalty, flag, or discount applied to a Session because it contained Substitutions, so that I am never discouraged from recording what really happened.

### Baselines and suggested loads

18. As a lifter, I want a substituted Movement to stop showing a working range derived from the prescribed Lift's 1RM, so that I am never prescribed a barbell load for a dumbbell movement.
19. As a lifter, I want my 1RM Baselines left untouched when I substitute, so that a crowded Thursday does not alter my recorded maxes.
20. As a lifter, I want the suggested weight for a substitute to come from my own history of that Movement once I have logged it, so that repeat Substitutions get easier rather than starting blank every time.
21. As a lifter, I want my Baseline for a Lift to remain on the Strength page even if I have permanently substituted it away, so that I keep tracking a max I still care about.

### Marking a Substitution permanent

22. As a lifter, I want to mark a Substitution as permanent at the moment I create it, so that a Movement my gym does not have can be dealt with once.
23. As a lifter, I want day-only to be the default, so that the common case — a machine that is busy right now — never silently changes my Program.
24. As a lifter, I want to be asked at the end of the Session about Substitutions I did not decide on, so that I can make the call once I know how the alternative actually went.
25. As a lifter, I want that end-of-Session prompt to appear only when I actually made a Substitution, so that it is not noise on an ordinary Session.
26. As a lifter, I want to decide each Substitution in that prompt separately, so that one permanently-gone machine and one temporarily-busy one can have different answers.
27. As a lifter, I want the prompt to survive submitting my Session Feel ratings, so that answering one question does not destroy the other.
28. As a lifter, I want to dismiss the prompt and have it never return for that Session, so that an undecided Substitution does not nag me every time I open my history.
29. As a lifter, I want promoting a Substitution at the Summary to carry forward the scheme I ended the Session with, so that I do not have to re-enter it next week.
30. As a lifter, I want promoting a Substitution to leave the completed Session record alone, so that my history keeps saying what actually happened on that day.

### Living with Permanent Substitutions

31. As a lifter, I want a Permanent Substitution to appear in place of the prescribed Movement in the Program view, so that the Program shows me what I am actually going to do.
32. As a lifter, I want a Permanent Substitution marked as a Substitution and labelled with the Movement it replaced, so that it never looks like the Program changed on its own.
33. As a lifter, I want to revert a Permanent Substitution from the Program view, so that I can undo it without starting a Session.
34. As a lifter, I want a Permanent Substitution applied automatically when I start a Session for that Day, so that I do not re-enter it weekly.
35. As a lifter, I want to make a day-only Substitution on top of a Permanent Substitution, so that an alternative being unavailable too is still expressible.
36. As a lifter, I want that day-only Substitution to leave the Permanent Substitution intact, so that one bad day does not undo a settled decision.
37. As a lifter, I want my Permanent Substitutions kept separately per Program, so that switching between programs does not mix them up.
38. As a lifter, I want my Permanent Substitutions to survive switching away from a Program and back, so that they behave like my 1RM Baselines already do.
39. As a lifter, I want *Restore Built-In Program* to leave my Permanent Substitutions alone, so that dropping an imported Program does not quietly discard unrelated work.
40. As a lifter, I want Substitutions available on every Program regardless of where it came from, so that importing a CSV does not cost me the feature.
41. As a lifter, I want a Permanent Substitution to go inert rather than misapply itself if the Program no longer prescribes that Movement on that Day, so that editing or re-importing a Program cannot land my override on the wrong Movement.

### History

42. As a lifter, I want the Session Summary to show substituted Movements with what they replaced, so that reviewing a Session tells me the whole story.
43. As a lifter, I want the post-Session Edit Log to show the substitute's name, so that correcting my numbers afterwards is not confusing.
44. As a lifter, I want my history list to indicate Sessions that contained Substitutions, so that an unusual week is findable.
45. As a lifter, I want my Day score trend to remain comparable across Sessions with and without Substitutions, so that my progress line stays meaningful.

## Implementation Decisions

### Two kinds of Substitution

A **Substitution** is session-local: it exists only in the active Session's state
and in the resulting Session record. A **Permanent Substitution** additionally
persists in a per-Program override store. Both are free-text; neither modifies
the Program definition, the embedded built-in programs, or an imported Program.

### A single seam: the effective-Day resolver

A new resolver turns a Day plus the Permanent Substitution override store into an
*effective Day* — the same structure, with overridden Movements replaced. Every
surface that displays or consumes a Day's Movements goes through it: the Program
view, the Off Day view, and Session start. This is the only new seam, and the
reason it exists rather than applying overrides at each call site is that a
missed call site shows the lifter the wrong Movement with no error.

Day-only Substitutions need no new seam. `initSession` already snapshots each
Movement's `name`, `note`, `target`, and `setsStr` into the Session state, and
the scorers already read that snapshot rather than the Program. A day-only
Substitution is an edit to that snapshot.

### Repairing the render path

`renderSessionMode` currently reads name, target, and the weight hint from the
Program Movement while reading logged values from the Session snapshot — so the
snapshot's own `name`, `target`, and `setsStr` are written by `initSession` and
never read during a Session. This must be flipped: session-mode render reads the
snapshot. Without that, a Substitution's name and adjusted scheme would not
appear on screen even though they would score correctly.

This is repairing a crossed wire, not introducing an abstraction. It is a
prerequisite for the feature, and it is also where regression risk sits — the
existing Session display must look identical when no Substitution is in play.

### The snapshot carries the baseline binding

The Session snapshot does not currently carry `baselineId`; the renderer reads it
from the Program Movement. Once render reads the snapshot, the snapshot must
carry it, because dropping the binding is how a Substitution stops prescribing
the wrong load:

```
// session snapshot entry — shape, not literal
{
  name,  note,  target: { numSets, repLow, repHigh },  setsStr,
  baselineId,          // null once substituted
  substitutedFor,      // prescribed Movement name, null when not a Substitution
  // ...existing logged fields: sets[], weight, rounds, rpe
}
```

`substitutedFor` records the Movement that was actually replaced in the
*effective* Day. Substituting on top of a Permanent Substitution therefore
records the permanent substitute's name, which is what the lifter was looking at.

### Scoring requires no changes

`scorePrimary` grades reps against the snapshot's `target` and never compares
logged weight to a prescribed load. `scoreAr7` is rounds-out-of-seven regardless
of Movement. `scoreAccessory` is RPE, or the fraction of sets filled.
`computeScore` derives its primary/hypertrophy weighting by counting Sections in
the Day, which in-place replacement leaves unchanged.

Consequently no scorer is modified. This is a property to protect with tests, not
a coincidence to rely on silently.

### The override store

Keyed by Program id, then Day id, then the prescribed Movement's name. Stored
alongside the app's other persisted state, in its own key — not inside the stored
Program. Baselines already establish this pattern. An entry carries the
substitute's name and its set/rep scheme. An entry whose prescribed Movement name
no longer appears in that Day is ignored, not reassigned.

Rationale and the rejected alternative are in ADR 0001.

### Set-count changes

Changing set count rebuilds the snapshot's set array, preserving logged values by
index as far as they fit. A reduction that would discard filled sets is confirmed
first. `scoreAccessory` divides by set count, so this is a scoring-relevant edit,
not only a display one.

### Reverting

Reverting restores the prescribed Movement's name, scheme, and baseline binding,
and clears the values logged against the substitute — confirmed first if any are
filled. Carrying the values over would attribute them to the prescribed Movement
and feed them to the history-based suggested-weight lookup, which matches on
slugified Movement name.

### Per-type behaviour

- **Primary and accessory/finisher**: name, set count, and rep range editable.
- **AR-7**: name and rep range editable. There is no set count; rounds are fixed
  at seven in both the renderer and the scorer. The `Action:` / `Reaction:`
  prefix convention is not enforced or injected.
- **Warmups**: excluded. `classifySection` skips them, so they have no Session
  entry to attach a Substitution to.
- **Off Days**: excluded. They start no Session, even though Field Guide PPL's
  off day renders four Sections of real Movements.

### Validation

The substitute name is trimmed, required to be non-empty, and length-capped for
layout. No autocomplete, no preset list, no matching against known Movements, no
duplicate detection. The free-text requirement is the point of the feature.

### End-of-Session prompt

A block on the Session Summary, rendered only when the Session contains
Substitutions that have not yet been decided. It is gated independently of the
Session Feel survey — the feel survey disappears permanently once feel is saved,
and bundling the two would mean one tap could silently lock every Substitution to
day-only. One row per undecided Substitution, each with a keep action, plus a
single dismiss that records the remainder as day-only. Once resolved, the block
does not return for that Session.

### Program and import interactions

- Substitutions are available on every Program, built-in or imported.
- Switching Programs preserves each Program's own overrides.
- *Restore Built-In Program* drops an imported Program; it does not clear
  overrides.
- The embed script and the program JSON schema are unchanged. The CSV format is
  unchanged — a CSV cannot express a Substitution and does not need to.

## Testing Decisions

### What a good test looks like here

Tests assert on external behaviour: given a Day, an override store, and a
sequence of lifter actions, what does the effective Day contain, what does the
Session record contain, and what Score comes out. They do not assert on DOM
structure, CSS classes, or the internal shape of intermediate values. A test that
breaks when a class name changes is noise; a test that breaks when a Score
changes is the whole point.

### Harness

A dependency-free script under `tools/`, run with node's built-in test runner and
assertion module. It reads `index.html`, extracts the inline script, and
evaluates it in a `vm` context with a `localStorage` stub, then exercises the
pure logic directly.

**Prior art**: the existing embed script already establishes the pattern of a
node script that validates the app without shipping as part of it — it parses the
program JSON, checks invariants that would otherwise fail quietly at runtime, and
refuses rather than writing. The test script is the same idea pointed at
behaviour instead of data.

No test framework is installed, `index.html` stays a single file with no build
step, and nothing is added to what ships. Refactoring the app into modules to
make it testable is explicitly rejected — the single-file, no-build,
works-offline property is the project's premise.

### What is covered

- The effective-Day resolver: no overrides; one override; several overrides in
  one Day; an override for a Movement that is absent from the Day (inert);
  overrides isolated per Program and per Day.
- Day-only Substitution: snapshot reflects the new name and scheme; the Program
  structure is unchanged afterwards; `substitutedFor` records the replaced
  Movement.
- Substituting on top of a Permanent Substitution: `substitutedFor` names the
  permanent substitute; the override store is unchanged.
- Set-count change: increase preserves logged values; decrease preserves those
  that fit; the discard case is detectable before it happens.
- Revert: name, scheme, and baseline binding restored; logged values cleared.
- **Scoring parity** — the load-bearing test. A Session scored with a Movement
  substituted produces the same Score as the same logged numbers without the
  Substitution, across primary, AR-7, and accessory Sections. This is the
  property that must not silently regress.
- Baseline binding dropped on substitution; the Baseline record itself untouched.
- Promotion at the Summary writes an override carrying the end-of-Session scheme
  and does not mutate the Session record.

### Verified by hand

The parts a node harness cannot reach, checked against the local preview: the
substitution control and modal on a phone-width viewport, the Substitution marker
in session mode and the Program view, the Summary prompt appearing only when
undecided Substitutions exist and surviving a feel save, and — the regression
that matters — a Session with no Substitutions rendering exactly as it does today
after the render path is flipped to the snapshot.

## Out of Scope

- **Any preset or suggested-alternative list.** Explicitly rejected: the lifter
  types what they did. No exercise library, no "similar movements," no
  autocomplete.
- **Substituting warmups and Off Day Movements.**
- **Changing AR-7 round count**, or the Action/Reaction pairing.
- **Editing the Program itself** from the app. Permanent Substitutions are an
  override layer, not a program editor. Adding, removing, or reordering Movements
  remains a program-source-plus-embed-script job.
- **Marking orphaned Baselines.** A Baseline whose Lift has been permanently
  substituted away stays on the Strength page, unmarked.
- **Exporting Permanent Substitutions** with *Export Program (JSON)*, or
  importing them. The export remains the Program plus current 1RMs.
- **CSV support for Substitutions.**
- **Scoring differences of any kind** for substituted work — no flag, no
  discount, no bonus.
- **Promoting a Substitution to permanent from anywhere other than** the
  substitution form and the Session Summary prompt.
- **A management screen** listing all Permanent Substitutions. Revert lives in
  the Program view, in place.
- **Per-Session substitution analytics** beyond the history-list indicator — no
  "most substituted Movement," no adherence percentage.

## Further Notes

**The render-path repair is the risk, not the feature.** Flipping
`renderSessionMode` to read the Session snapshot touches every logged Movement in
every Session, including the overwhelming majority with no Substitution at all.
Get that wrong and the damage is far wider than the feature. Worth doing first,
on its own, and confirming the Session display is unchanged before anything
substitution-shaped is added.

**Suggested weights improve on their own.** `getSuggestedWeight` already falls
back to the last logged weight for a matching slugified Movement name. A
substitute shows no suggestion the first time and the lifter's own numbers every
time after — no extra work needed, and a reason day-only Substitutions do not
need to persist to stay convenient.

**The service worker will hide this.** Shipping requires bumping `CACHE_NAME`, or
installed copies keep serving the old app. Easy to forget and confusing to debug.

**Movements repeat across Days.** Field Guide PPL has three Movements appearing
on more than one Day, AR-7 has one. This is why overrides are keyed by Day rather
than by Movement name alone — a global key would reach Days the lifter never
intended to change.
