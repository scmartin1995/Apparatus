# Permanent Substitutions live in a per-Program override layer

A Permanent Substitution has to outlive the Session that created it, which means
something has to persist. We keep those overrides in their own store, keyed per
Program, and apply them on top of a Day when it is resolved — rather than
rewriting the Program itself. The Program definition, built-in or imported, is
never modified by a Substitution.

This mirrors how Baselines already work: stored per Program id, applied to the
Program at read time, never folded into it.

## Considered Options

**Rewrite the active Program in storage.** Rejected. It would promote a Built-In
Program into an edited copy of itself, which makes *Restore Built-In Program*
ambiguous, and puts the user's overrides on a collision course with the embed
script — shipping an updated built-in program would either clobber their
substitutions or silently preserve stale ones.

## Consequences

Every surface that displays a Day's Movements must go through the resolver, or it
will show the prescribed Movement where a Permanent Substitution is in force.
That is the reason the resolver is a single seam rather than logic applied at
each call site.

Overrides are keyed by Program, Day, and the prescribed Movement's name. An
override whose Movement no longer appears in that Day is inert: it is ignored
rather than applied to a neighbouring Movement, which is the failure mode a
positional key would have.
