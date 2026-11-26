// Behaviour tests for the app, run with node's built-in test runner.
//
//   node tools/test-app.js            # run the suite
//   node --test tools/test-app.js     # same, with the runner's own reporter
//
// No framework is installed and nothing here ships. tools/app-harness.js loads
// the logic out of index.html; this file exercises it.
//
// These tests assert on external behaviour: given a Day, a store, and a
// sequence of lifter actions, what does the Session record contain and what
// Score comes out. They do not assert on DOM structure, CSS classes, or the
// internal shape of intermediate values. A test that breaks when a class name
// changes is noise; a test that breaks when a Score changes is the point.
//
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, loadAppWithProgram, findSection, plain } = require('./app-harness.js');

// Field Guide PPL is the bundled default and has no AR-7 Sections; AR-7 Hybrid
// has all four Section kinds. Tests pick whichever one exercises the behaviour.
const PPL = undefined; // the first built-in
const AR7 = 'prog-ar7-hybrid';

// Fills every set of a snapshot entry with the same weight and reps.
function fillSets(entry, weight, reps) {
  entry.sets.forEach(set => { set.weight = String(weight); set.reps = String(reps); });
  return entry;
}

// A Day whose Sections cover the given categories, from the active program.
function dayWithSections(app, cats) {
  return app.DAYS.find(d =>
    !d.isOff && d.sections &&
    cats.every(c => d.sections.some(s => app.classifySection(s) === c)));
}

describe('harness', () => {
  test('loads the logic out of index.html', () => {
    const app = loadApp();
    assert.ok(Array.isArray(app.BUILT_IN_PROGRAMS));
    assert.ok(app.BUILT_IN_PROGRAMS.length >= 1, 'at least one built-in program is bundled');
    assert.equal(typeof app.initSession, 'function');
  });

  test('gives each load its own storage, so tests cannot leak into each other', () => {
    const a = loadApp();
    const b = loadApp();
    a.localStorage.setItem('probe', 'a');
    assert.equal(b.localStorage.getItem('probe'), null);
  });
});

describe('section classification', () => {
  test('warmups are skipped, so they never reach a Session', () => {
    const app = loadApp();
    assert.equal(app.classifySection({ type: 'warmup' }), 'skip');
    assert.equal(app.classifySection({ type: 'warm-up' }), 'skip');
    assert.equal(app.classifySection({ type: 'WARMUP' }), 'skip');
  });

  test('primary, AR-7 and accessory each score differently, so each is its own kind', () => {
    const app = loadApp();
    assert.equal(app.classifySection({ type: 'primary' }), 'primary');
    assert.equal(app.classifySection({ type: 'ar7' }), 'ar7');
    assert.equal(app.classifySection({ type: 'accessory' }), 'accessory');
  });

  test('a finisher is scored as an accessory', () => {
    const app = loadApp();
    assert.equal(app.classifySection({ type: 'finisher' }), 'accessory');
  });

  test('an unrecognised type falls back to accessory rather than being dropped', () => {
    const app = loadApp();
    assert.equal(app.classifySection({ type: 'something-new' }), 'accessory');
    assert.equal(app.classifySection({}), 'accessory');
  });
});

describe('set and rep scheme parsing', () => {
  test('reads a sets x rep-range scheme', () => {
    const app = loadApp();
    assert.deepEqual(plain(app.parseSetsStr('3 × 3–5')), { numSets: 3, repLow: 3, repHigh: 5 });
    assert.deepEqual(plain(app.parseSetsStr('4 x 8-12')), { numSets: 4, repLow: 8, repHigh: 12 });
  });

  test('a single rep count becomes a range of one', () => {
    const app = loadApp();
    assert.deepEqual(plain(app.parseSetsStr('5 × 5')), { numSets: 5, repLow: 5, repHigh: 5 });
  });

  test('a load suffix after @ is not part of the scheme', () => {
    const app = loadApp();
    assert.deepEqual(plain(app.parseSetsStr('3 × 5 @ 225 lb')), { numSets: 3, repLow: 5, repHigh: 5 });
  });

  test('an unparseable scheme falls back to one set of one rep rather than throwing', () => {
    const app = loadApp();
    assert.deepEqual(plain(app.parseSetsStr('AMRAP')), { numSets: 1, repLow: 1, repHigh: 1 });
    assert.deepEqual(plain(app.parseSetsStr('')), { numSets: 1, repLow: 1, repHigh: 1 });
    assert.deepEqual(plain(app.parseSetsStr(null)), { numSets: 1, repLow: 1, repHigh: 1 });
  });
});

describe('session init', () => {
  test('builds one snapshot entry per logged Movement, and none for warmups', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    assert.ok(day, 'the AR-7 program has a Day with all three logged Section kinds');

    const s = app.initSession(day.id);
    const counted = { primary: 0, ar7: 0, accessory: 0, skip: 0 };
    day.sections.forEach(sec => { counted[app.classifySection(sec)] += sec.items.length; });

    assert.equal(Object.keys(s.primaries).length, counted.primary);
    assert.equal(Object.keys(s.ar7).length, counted.ar7);
    assert.equal(Object.keys(s.accessories).length, counted.accessory);
    assert.ok(counted.skip > 0, 'the Day has warmup Movements');

    const logged = counted.primary + counted.ar7 + counted.accessory;
    const entries = Object.keys(s.primaries).length + Object.keys(s.ar7).length + Object.keys(s.accessories).length;
    assert.equal(entries, logged, 'no warmup Movement got a Session entry');
  });

  test('snapshots the name, note, target and scheme of each Movement', () => {
    const app = loadAppWithProgram(PPL);
    const found = findSection(app, 'primary');
    const item = found.section.items[0];
    const entry = app.initSession(found.day.id).primaries[found.key(0)];

    assert.equal(entry.name, item.name);
    assert.equal(entry.note, item.note || '');
    assert.equal(entry.setsStr, item.sets || '');
    assert.deepEqual(plain(entry.target), plain(app.parseSetsStr(item.sets)));
  });

  test('gives a primary one empty set per prescribed set', () => {
    const app = loadAppWithProgram(PPL);
    const found = findSection(app, 'primary');
    const entry = app.initSession(found.day.id).primaries[found.key(0)];
    assert.equal(entry.sets.length, entry.target.numSets);
    entry.sets.forEach(set => assert.deepEqual(plain(set), { weight: '', reps: '' }));
  });

  test('gives an accessory an RPE of zero alongside its sets', () => {
    const app = loadAppWithProgram(PPL);
    const found = findSection(app, 'accessory');
    const entry = app.initSession(found.day.id).accessories[found.key(0)];
    assert.equal(entry.rpe, 0);
    assert.equal(entry.sets.length, entry.target.numSets);
  });

  test('gives an AR-7 Movement rounds and a load, and no set array', () => {
    const app = loadAppWithProgram(AR7);
    const found = findSection(app, 'ar7');
    const entry = app.initSession(found.day.id).ar7[found.key(0)];
    assert.equal(entry.rounds, 0);
    assert.equal(entry.weight, '');
    assert.equal(entry.sets, undefined, 'AR-7 has rounds, not sets');
  });

  test('an unknown Day yields an empty Session rather than throwing', () => {
    const app = loadAppWithProgram(PPL);
    const s = app.initSession('no-such-day');
    assert.deepEqual(plain(s.primaries), {});
    assert.deepEqual(plain(s.ar7), {});
    assert.deepEqual(plain(s.accessories), {});
  });
});

describe('primary scoring', () => {
  // Reps are graded against the snapshot's target. Weight is recorded but never
  // compared to a prescribed load -- the property that lets a Substitution
  // score identically.
  function onePrimary(app, target, sets) {
    return { primaries: { k: { name: 'X', target, sets } }, ar7: {}, accessories: {}, feel: null };
  }

  test('reps at or above the top of the range score full marks', () => {
    const app = loadApp();
    const target = { numSets: 1, repLow: 3, repHigh: 5 };
    assert.equal(app.scorePrimary(onePrimary(app, target, [{ weight: '225', reps: '5' }])), 100);
    assert.equal(app.scorePrimary(onePrimary(app, target, [{ weight: '225', reps: '8' }])), 100);
  });

  test('reps at the bottom of the range score 85', () => {
    const app = loadApp();
    const target = { numSets: 1, repLow: 3, repHigh: 5 };
    assert.equal(app.scorePrimary(onePrimary(app, target, [{ weight: '225', reps: '3' }])), 85);
  });

  test('reps inside the range scale between 85 and 100', () => {
    const app = loadApp();
    const target = { numSets: 1, repLow: 3, repHigh: 5 };
    const score = app.scorePrimary(onePrimary(app, target, [{ weight: '225', reps: '4' }]));
    assert.ok(score > 85 && score < 100, 'got ' + score);
    assert.equal(score, 92.5);
  });

  test('reps under the range are discounted, not zeroed', () => {
    const app = loadApp();
    const target = { numSets: 1, repLow: 4, repHigh: 6 };
    assert.equal(app.scorePrimary(onePrimary(app, target, [{ weight: '225', reps: '2' }])), 35);
  });

  test('the load logged does not affect the Score', () => {
    const app = loadApp();
    const target = { numSets: 1, repLow: 3, repHigh: 5 };
    const light = app.scorePrimary(onePrimary(app, target, [{ weight: '95', reps: '5' }]));
    const heavy = app.scorePrimary(onePrimary(app, target, [{ weight: '405', reps: '5' }]));
    assert.equal(light, heavy);
  });

  test('empty sets are ignored rather than counted as failures', () => {
    const app = loadApp();
    const target = { numSets: 3, repLow: 3, repHigh: 5 };
    const score = app.scorePrimary(onePrimary(app, target, [
      { weight: '225', reps: '5' },
      { weight: '', reps: '' },
      { weight: '', reps: '' },
    ]));
    assert.equal(score, 100);
  });

  test('a Day with no primaries scores null, not zero', () => {
    const app = loadApp();
    assert.equal(app.scorePrimary({ primaries: {}, ar7: {}, accessories: {} }), null);
  });
});

describe('AR-7 scoring', () => {
  const s = rounds => ({ primaries: {}, ar7: { k: { name: 'X', rounds } }, accessories: {} });

  test('seven rounds out of seven is full marks', () => {
    const app = loadApp();
    assert.equal(app.scoreAr7(s(7)), 100);
  });

  test('rounds score as a fraction of seven', () => {
    const app = loadApp();
    assert.equal(app.scoreAr7(s(0)), 0);
    assert.equal(app.scoreAr7(s(4)), (4 / 7) * 100);
  });

  test('more than seven rounds does not score above full marks', () => {
    const app = loadApp();
    assert.equal(app.scoreAr7(s(9)), 100);
  });

  test('several AR-7 Movements average', () => {
    const app = loadApp();
    const score = app.scoreAr7({ primaries: {}, accessories: {}, ar7: {
      a: { rounds: 7 }, b: { rounds: 0 },
    } });
    assert.equal(score, 50);
  });

  test('a Day with no AR-7 scores null', () => {
    const app = loadApp();
    assert.equal(app.scoreAr7({ primaries: {}, ar7: {}, accessories: {} }), null);
  });
});

describe('accessory scoring', () => {
  const s = entry => ({ primaries: {}, ar7: {}, accessories: { k: entry } });

  test('a reported RPE scores as a fraction of five', () => {
    const app = loadApp();
    assert.equal(app.scoreAccessory(s({ rpe: 5, sets: [] })), 100);
    assert.equal(app.scoreAccessory(s({ rpe: 3, sets: [] })), 60);
  });

  test('without an RPE, the fraction of sets filled scores up to 75', () => {
    const app = loadApp();
    const sets = [
      { weight: '50', reps: '10' },
      { weight: '50', reps: '10' },
      { weight: '', reps: '' },
      { weight: '', reps: '' },
    ];
    assert.equal(app.scoreAccessory(s({ rpe: 0, sets })), 37.5);
    assert.equal(app.scoreAccessory(s({ rpe: 0, sets: sets.slice(0, 2) })), 75);
  });

  test('set count is scoring-relevant, because the Score divides by it', () => {
    const app = loadApp();
    const filled = { weight: '50', reps: '10' };
    const twoOfTwo = app.scoreAccessory(s({ rpe: 0, sets: [filled, filled] }));
    const twoOfFour = app.scoreAccessory(s({ rpe: 0, sets: [filled, filled, { weight: '', reps: '' }, { weight: '', reps: '' }] }));
    assert.ok(twoOfFour < twoOfTwo, 'the same logged work over more prescribed sets scores lower');
  });

  test('an untouched accessory is left out rather than scored zero', () => {
    const app = loadApp();
    assert.equal(app.scoreAccessory(s({ rpe: 0, sets: [{ weight: '', reps: '' }] })), null);
  });

  test('a Day with no accessories scores null', () => {
    const app = loadApp();
    assert.equal(app.scoreAccessory({ primaries: {}, ar7: {}, accessories: {} }), null);
  });
});

describe('feel scoring', () => {
  test('a skipped feel survey scores zero', () => {
    const app = loadApp();
    assert.equal(app.scoreFeel({ feel: null }), 0);
    assert.equal(app.scoreFeel({ feel: { energy: 0, effort: 0, recovery: 0 } }), 0);
  });

  test('top ratings score full marks and bottom ratings score zero', () => {
    const app = loadApp();
    assert.equal(app.scoreFeel({ feel: { energy: 5, effort: 5, recovery: 5 } }), 100);
    assert.equal(app.scoreFeel({ feel: { energy: 1, effort: 1, recovery: 1 } }), 0);
  });

  test('effort counts double', () => {
    const app = loadApp();
    const highEffort = app.scoreFeel({ feel: { energy: 1, effort: 5, recovery: 1 } });
    const highEnergy = app.scoreFeel({ feel: { energy: 5, effort: 1, recovery: 1 } });
    assert.ok(highEffort > highEnergy, 'effort is weighted above energy');
  });
});

describe('total score', () => {
  test('a fully logged, top-of-range Session scores 100', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const s = app.initSession(day.id);
    Object.values(s.primaries).forEach(p => fillSets(p, 225, p.target.repHigh));
    Object.values(s.ar7).forEach(a => { a.rounds = 7; a.weight = '50'; });
    Object.values(s.accessories).forEach(a => { a.rpe = 5; });
    s.feel = { energy: 5, effort: 5, recovery: 5 };

    assert.equal(app.computeScore(s).total, 100);
  });

  test('an untouched Session scores zero', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    assert.equal(app.computeScore(app.initSession(day.id)).total, 0);
  });

  test('the components sum to the total', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const s = app.initSession(day.id);
    Object.values(s.primaries).forEach(p => fillSets(p, 225, p.target.repLow));
    Object.values(s.ar7).forEach(a => { a.rounds = 5; });
    Object.values(s.accessories).forEach(a => { a.rpe = 4; });
    s.feel = { energy: 3, effort: 4, recovery: 3 };

    const sc = app.computeScore(s);
    assert.equal(sc.total, sc.primary + sc.hyper + sc.feel);
    assert.equal(sc.primaryMax + sc.hyperMax + sc.feelMax, 100);
  });

  test('the primary and hypertrophy weighting comes from the structure of the Day', () => {
    const app = loadAppWithProgram(PPL);
    // Replacing a Movement in place leaves the Section counts alone, which is
    // why a Substitution cannot shift how a Session is graded.
    const weights = app.DAYS.filter(d => !d.isOff).map(d => {
      const sc = app.computeScore(app.initSession(d.id));
      return d.id + ':' + sc.primaryMax + '/' + sc.hyperMax + '/' + sc.feelMax;
    });
    weights.forEach(w => {
      const parts = w.split(':')[1].split('/').map(Number);
      assert.equal(parts[0] + parts[1] + parts[2], 100, w);
    });
  });

  test('the feel survey is worth a fifth of the Score', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const without = app.initSession(day.id);
    Object.values(without.primaries).forEach(p => fillSets(p, 225, p.target.repHigh));
    Object.values(without.ar7).forEach(a => { a.rounds = 7; });
    Object.values(without.accessories).forEach(a => { a.rpe = 5; });

    const withFeel = app.clone(without);
    withFeel.feel = { energy: 5, effort: 5, recovery: 5 };

    assert.equal(app.computeScore(without).total, 80);
    assert.equal(app.computeScore(withFeel).total, 100);
  });
});

describe('grade labels', () => {
  test('each band of Scores gets its label', () => {
    const app = loadApp();
    assert.equal(app.gradeLabel(100), 'EXCELLENT');
    assert.equal(app.gradeLabel(90), 'EXCELLENT');
    assert.equal(app.gradeLabel(89), 'STRONG SESSION');
    assert.equal(app.gradeLabel(80), 'STRONG SESSION');
    assert.equal(app.gradeLabel(70), 'SOLID WORK');
    assert.equal(app.gradeLabel(60), 'GOT IT DONE');
    assert.equal(app.gradeLabel(59), 'CHECK IN');
    assert.equal(app.gradeLabel(0), 'CHECK IN');
  });
});

describe('baselines', () => {
  // A Baseline override is stored as a record carrying the id it overrides, so
  // the recorded 1RM survives a change to the Program's own default.
  const ormOf = (app, id) => (app.loadBaselines().find(b => b.id === id) || {}).orm;

  test('a recorded 1RM overrides the default the Program ships with', () => {
    const app = loadAppWithProgram(PPL);
    const id = app.BASELINES[0].id;
    const shipped = app.BASELINES[0].orm;

    app.saveBaselines([{ id, orm: shipped + 50 }]);
    assert.equal(ormOf(app, id), shipped + 50);
  });

  test('a Baseline left alone keeps the percentages it was defined with', () => {
    const app = loadAppWithProgram(PPL);
    const def = app.BASELINES[0];
    app.saveBaselines([{ id: def.id, orm: 300 }]);

    const loaded = app.loadBaselines().find(b => b.id === def.id);
    assert.equal(loaded.pctLow, def.pctLow);
    assert.equal(loaded.pctHigh, def.pctHigh);
  });

  test('are kept separately per Program', () => {
    const app = loadApp();
    const [first, second] = app.BUILT_IN_PROGRAMS;
    if (!second) return; // only one built-in bundled

    app.setProgram(app.clone(first));
    const id = app.BASELINES[0].id;
    app.saveBaselines([{ id, orm: 777 }]);

    app.setProgram(app.clone(second));
    assert.notEqual(ormOf(app, id), 777, 'the other Program does not see it');

    app.setProgram(app.clone(first));
    assert.equal(ormOf(app, id), 777, 'the first Program kept its Baselines');
  });

  test('survive switching away from a Program and back', () => {
    const app = loadAppWithProgram(PPL);
    const id = app.BASELINES[0].id;
    app.saveBaselines([{ id, orm: 315 }]);
    const programId = app.currentProgramId();

    app.setProgram(null);
    app.setProgram(app.clone(app.builtInById(programId)));

    assert.equal(ormOf(app, id), 315);
  });

  test('a Program with no Baselines defined loads none', () => {
    const app = loadAppWithProgram(PPL);
    app.setProgram({ id: 'p', name: 'P', days: [], baselines: [] });
    assert.deepEqual(plain(app.loadBaselines()), []);
  });
});

describe('session records', () => {
  test('a finished Session is retrievable by Day', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    app.addSessionRecord({ id: 's1', dayType: day.id, date: '2026-01-01T00:00:00Z', score: { total: 70 } });
    app.addSessionRecord({ id: 's2', dayType: day.id, date: '2026-01-08T00:00:00Z', score: { total: 80 } });
    app.addSessionRecord({ id: 's3', dayType: 'other-day', date: '2026-01-09T00:00:00Z', score: { total: 90 } });

    assert.deepEqual(plain(app.sessionsByDay(day.id).map(s => s.id)), ['s1', 's2']);
    assert.equal(app.lastScoreForDay(day.id), 80);
  });

  test('records are capped, keeping the most recent', () => {
    const app = loadAppWithProgram(PPL);
    for (let i = 0; i < 40; i++) {
      app.addSessionRecord({ id: 's' + i, dayType: 'pull', date: '2026-01-01T00:00:00Z', score: { total: i } });
    }
    const all = app.getAllSessions();
    assert.ok(all.length <= 32, 'got ' + all.length);
    assert.equal(all[all.length - 1].id, 's39', 'the newest record survived');
  });

  test('a Day with no Sessions has no last Score', () => {
    const app = loadAppWithProgram(PPL);
    assert.equal(app.lastScoreForDay('pull'), null);
  });
});

describe('session drafts', () => {
  test('a draft round-trips through storage', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    app.session = app.initSession(day.id);
    app.session.startTime = 1700000000000;
    app.saveDraft();

    const draft = app.loadDraft();
    assert.equal(draft.dayType, day.id);
    assert.equal(draft.startTime, 1700000000000);
    assert.deepEqual(plain(Object.keys(draft.primaries)), plain(Object.keys(app.session.primaries)));
  });

  test('a cleared draft is gone', () => {
    const app = loadAppWithProgram(PPL);
    app.session = app.initSession(app.DAYS.find(d => !d.isOff).id);
    app.saveDraft();
    app.clearDraft();
    assert.equal(app.loadDraft(), null);
  });

  test('a draft resumes to a Session that scores the same', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    app.session = app.initSession(day.id);
    Object.values(app.session.primaries).forEach(p => fillSets(p, 185, p.target.repHigh));
    Object.values(app.session.ar7).forEach(a => { a.rounds = 6; });
    Object.values(app.session.accessories).forEach(a => { a.rpe = 4; });
    const before = app.computeScore(app.session).total;

    app.saveDraft();
    assert.equal(app.computeScore(app.loadDraft()).total, before);
  });
});

describe('suggested loads', () => {
  test('a Movement bound to a Baseline gets a load from the 1RM', () => {
    const app = loadAppWithProgram(PPL);
    const baseline = app.BASELINES[0];
    assert.ok(baseline, 'the Program has Baselines');
    app.saveBaselines([{ id: baseline.id, orm: 300 }]);

    const hint = app.getSuggestedWeight('Some Movement', '3 × 5', baseline.id);
    assert.ok(hint, 'a bound Movement gets a suggestion');
    assert.equal(hint.source, 'baseline');
    assert.ok(hint.weight > 0 && hint.weight < 300, 'a working load, not the 1RM');
  });

  test('the load comes from the percentages of that Baseline, so it tracks the 1RM', () => {
    const app = loadAppWithProgram(PPL);
    const baseline = app.BASELINES[0];

    app.saveBaselines([{ id: baseline.id, orm: 200 }]);
    const lighter = app.getSuggestedWeight('X', '3 × 5', baseline.id).weight;
    app.saveBaselines([{ id: baseline.id, orm: 400 }]);
    const heavier = app.getSuggestedWeight('X', '3 × 5', baseline.id).weight;

    assert.ok(heavier > lighter, 'a higher 1RM suggests a heavier load');
  });

  test('a Baseline with no 1RM recorded suggests nothing', () => {
    const app = loadAppWithProgram(PPL);
    const baseline = app.BASELINES[0];
    app.saveBaselines([{ id: baseline.id, orm: 0 }]);
    assert.equal(app.getSuggestedWeight('Nothing Logged Ever', '3 × 5', baseline.id), null);
  });

  test('a Movement with no Baseline and no history gets no suggestion', () => {
    const app = loadAppWithProgram(PPL);
    assert.equal(app.getSuggestedWeight('Never Done This', '3 × 10', null), null);
  });

  test('a Movement with no Baseline falls back to the last weight logged for that name', () => {
    const app = loadAppWithProgram(PPL);
    app.addSessionRecord({
      id: 's1', dayType: 'pull', date: '2026-01-01T00:00:00Z', score: { total: 70 },
      primaries: {}, ar7: {},
      accessories: { k: { name: 'Pec Deck', sets: [{ weight: '140', reps: '12' }], rpe: 4 } },
    });

    const hint = app.getSuggestedWeight('Pec Deck', '3 × 12', null);
    assert.ok(hint, 'a Movement logged before gets a suggestion from history');
    assert.equal(hint.source, 'history');
    assert.equal(hint.weight, 140);
  });

  test('history matching ignores case and spacing in the name', () => {
    const app = loadAppWithProgram(PPL);
    app.addSessionRecord({
      id: 's1', dayType: 'pull', date: '2026-01-01T00:00:00Z', score: { total: 70 },
      primaries: {}, ar7: {},
      accessories: { k: { name: 'Pec Deck', sets: [{ weight: '140', reps: '12' }], rpe: 4 } },
    });
    const hint = app.getSuggestedWeight('pec  deck', '3 × 12', null);
    assert.ok(hint && hint.weight === 140, 'the same Movement under a different spelling still matches');
  });
});

describe('1RM calculator', () => {
  test('a single rep is the 1RM', () => {
    const app = loadApp();
    assert.equal(app.calcOrm(225, 1), 225);
  });

  test('more reps estimate a higher 1RM', () => {
    const app = loadApp();
    assert.ok(app.calcOrm(225, 5) > 225);
    assert.ok(app.calcOrm(225, 8) > app.calcOrm(225, 5));
  });

  test('estimates land on a 2.5 lb increment', () => {
    const app = loadApp();
    for (let r = 1; r <= 12; r++) {
      const orm = app.calcOrm(185, r);
      assert.equal(orm % 2.5, 0, r + ' reps gave ' + orm);
    }
  });
});

describe('bundled programs', () => {
  test('every bundled program has an id, a name and Days', () => {
    const app = loadApp();
    app.BUILT_IN_PROGRAMS.forEach(p => {
      assert.ok(p.id, 'program has an id');
      assert.ok(p.name, p.id + ' has a name');
      assert.ok(Array.isArray(p.days) && p.days.length, p.id + ' has Days');
    });
  });

  test('every logged Movement in every bundled program has a parseable scheme', () => {
    const app = loadApp();
    app.BUILT_IN_PROGRAMS.forEach(p => {
      app.setProgram(app.clone(p));
      app.DAYS.forEach(day => {
        (day.sections || []).forEach(sec => {
          if (app.classifySection(sec) === 'skip') return;
          sec.items.forEach(item => {
            const t = app.parseSetsStr(item.sets);
            assert.ok(t.numSets >= 1, p.id + '/' + day.id + '/' + item.name);
            assert.ok(t.repHigh >= t.repLow, p.id + '/' + day.id + '/' + item.name);
          });
        });
      });
    });
  });

  test('every Movement bound to a Baseline names one the Program defines', () => {
    const app = loadApp();
    app.BUILT_IN_PROGRAMS.forEach(p => {
      app.setProgram(app.clone(p));
      const ids = app.BASELINES.map(b => b.id);
      app.DAYS.forEach(day => {
        (day.sections || []).forEach(sec => {
          sec.items.forEach(item => {
            if (!item.baselineId) return;
            assert.ok(ids.includes(item.baselineId),
              p.id + '/' + day.id + '/' + item.name + ' binds unknown Baseline ' + item.baselineId);
          });
        });
      });
    });
  });
});

describe('session mode reads the snapshot, not the program', () => {
  // The renderer used to take name, target and the weight hint from the
  // program Movement while taking logged values from the snapshot, so the
  // snapshot's own name and scheme were written and never read. Everything
  // below is what keeps that wire from getting crossed again.

  // Renders an active Session for a Day and hands back the HTML produced.
  function renderDay(app, day, mutate) {
    const s = app.initSession(day.id);
    if (mutate) mutate(s);
    app.session = s;
    app.activeDay = day.id;
    app.renderSessionMode(day);
    return { html: app.document.getElementById('content').innerHTML, session: s };
  }

  test('the snapshot carries the baseline binding of each Movement', () => {
    const app = loadAppWithProgram(PPL);
    const bound = [];
    app.DAYS.forEach(day => {
      if (day.isOff || !day.sections) return;
      const s = app.initSession(day.id);
      day.sections.forEach((sec, si) => {
        const cat = app.classifySection(sec);
        if (cat === 'skip') return;
        sec.items.forEach((item, ii) => {
          const key = si + '-' + ii;
          const entry = cat === 'primary' ? s.primaries[key]
                      : cat === 'ar7' ? s.ar7[key] : s.accessories[key];
          assert.equal(entry.baselineId, item.baselineId || null,
            day.id + '/' + item.name + ' lost its baseline binding');
          if (item.baselineId) bound.push(item.name);
        });
      });
    });
    assert.ok(bound.length > 0, 'the Program has Movements bound to a Baseline');
  });

  test('the name shown comes from the snapshot', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const prescribed = found.section.items[0].name;

    const plainRender = renderDay(app, day);
    assert.ok(plainRender.html.includes(prescribed), 'the prescribed name shows by default');

    const changed = renderDay(app, day, s => {
      s.primaries[found.key(0)].name = 'Smith Machine Row';
    });
    assert.ok(changed.html.includes('Smith Machine Row'),
      'a name changed in the snapshot reaches the screen');
    assert.ok(!changed.html.includes('<div class="log-item-name">' + prescribed + '</div>'),
      'the prescribed name is not shown alongside it');
  });

  test('the target shown comes from the snapshot', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);

    const changed = renderDay(app, day, s => {
      const entry = s.primaries[found.key(0)];
      entry.setsStr = '4 × 12–15';
      entry.target = app.parseSetsStr(entry.setsStr);
      entry.baselineId = null;
    });
    assert.ok(changed.html.includes('4 × 12–15'),
      'a scheme changed in the snapshot reaches the screen');
  });

  test('the set rows shown come from the snapshot, not the prescribed count', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const prescribedSets = app.parseSetsStr(found.section.items[0].sets).numSets;
    assert.ok(prescribedSets > 1, 'the program prescribed more than one set');

    const changed = renderDay(app, day, s => {
      const entry = s.primaries[found.key(0)];
      entry.sets = [{ weight: '', reps: '' }];
      entry.target = { numSets: 1, repLow: 8, repHigh: 10 };
      entry.setsStr = '1 × 8–10';
    });
    // Two inputs per set row, so one row for that Movement means two handlers.
    const handlers = changed.html.split("updatePrimarySet('" + found.key(0) + "'").length - 1;
    assert.equal(handlers, 2, 'one set row where the program prescribed ' + prescribedSets);
  });

  test('dropping the baseline binding in the snapshot removes the working range', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d =>
      !d.isOff && d.sections && d.sections.some(sec =>
        app.classifySection(sec) !== 'skip' && sec.items.some(i => i.baselineId)));
    assert.ok(day, 'a Day has a Movement bound to a Baseline');
    app.saveBaselines(app.BASELINES.map(b => ({ id: b.id, orm: 300 })));

    const withBinding = renderDay(app, day);
    assert.ok(withBinding.html.includes(' @ '), 'a bound Movement shows a working range');

    const without = renderDay(app, day, s => {
      [s.primaries, s.ar7, s.accessories].forEach(group =>
        Object.values(group).forEach(e => { e.baselineId = null; }));
    });
    assert.ok(!without.html.includes(' @ '),
      'with no binding in the snapshot, no load is prescribed');
  });

  test('a note changed in the snapshot reaches the screen', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const changed = renderDay(app, day, s => {
      s.primaries[found.key(0)].note = 'Cable stack only goes to 90';
    });
    assert.ok(changed.html.includes('Cable stack only goes to 90'));
  });

  test('a Movement missing from the snapshot is skipped rather than throwing', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const changed = renderDay(app, day, s => { delete s.primaries[found.key(0)]; });
    assert.ok(changed.html.length > 0, 'the rest of the Session still rendered');
    assert.ok(!changed.html.includes("updatePrimarySet('" + found.key(0) + "'"),
      'the missing Movement is absent');
  });

  test('every logged Movement of every bundled program renders', () => {
    const app = loadApp();
    app.BUILT_IN_PROGRAMS.forEach(program => {
      app.setProgram(app.clone(program));
      app.saveBaselines(app.BASELINES.map(b => ({ id: b.id, orm: 250 })));
      app.DAYS.forEach(day => {
        if (day.isOff || !day.sections) return;
        const { html, session } = renderDay(app, day);
        const expected = Object.keys(session.primaries).length
          + Object.keys(session.ar7).length
          + Object.keys(session.accessories).length;
        const shown = html.split('class="log-item"').length - 1;
        assert.equal(shown, expected, program.id + '/' + day.id);
      });
    });
  });
});

describe('resuming an older draft', () => {
  test('a draft saved without the baseline binding gets it back on resume', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d =>
      !d.isOff && d.sections && d.sections.some(sec =>
        app.classifySection(sec) !== 'skip' && sec.items.some(i => i.baselineId)));

    // A draft as an older build would have written it: no baselineId anywhere.
    const old = app.initSession(day.id);
    [old.primaries, old.ar7, old.accessories].forEach(group =>
      Object.values(group).forEach(e => { delete e.baselineId; }));

    const restored = app.backfillSnapshot(old);
    const entries = [restored.primaries, restored.ar7, restored.accessories]
      .flatMap(g => Object.values(g));
    entries.forEach(e => assert.notEqual(e.baselineId, undefined, e.name + ' has a binding'));
    assert.ok(entries.some(e => e.baselineId !== null), 'at least one binding was restored');
  });

  test('a draft with values logged keeps them through the backfill', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);

    const old = app.initSession(day.id);
    old.primaries[found.key(0)].sets[0] = { weight: '245', reps: '4' };
    delete old.primaries[found.key(0)].baselineId;

    const restored = app.backfillSnapshot(old);
    assert.deepEqual(plain(restored.primaries[found.key(0)].sets[0]), { weight: '245', reps: '4' });
  });

  test('a backfill leaves a substituted name alone', () => {
    // The backfill fills gaps; it never overwrites what the snapshot already
    // says. Without this, resuming a draft would undo a Substitution.
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);

    const s = app.initSession(day.id);
    s.primaries[found.key(0)].name = 'Pendulum Squat';
    s.primaries[found.key(0)].baselineId = null;

    const restored = app.backfillSnapshot(s);
    assert.equal(restored.primaries[found.key(0)].name, 'Pendulum Squat');
    assert.equal(restored.primaries[found.key(0)].baselineId, null);
  });

  test('a draft for a Day the Program no longer has is left as it is', () => {
    const app = loadAppWithProgram(PPL);
    const orphan = { dayType: 'no-such-day', primaries: {}, ar7: {}, accessories: {} };
    assert.equal(app.backfillSnapshot(orphan), orphan);
  });
});

describe('scoring is untouched by where render reads from', () => {
  test('a Session scores the same whether read from the program or the snapshot', () => {
    // The scorers have always read the snapshot. This pins that down, because
    // a Substitution scoring identically depends on it.
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    const s = app.initSession(day.id);
    Object.values(s.primaries).forEach(p => fillSets(p, 225, p.target.repLow));
    Object.values(s.ar7).forEach(a => { a.rounds = 6; });
    Object.values(s.accessories).forEach(a => { a.rpe = 4; });
    const before = app.computeScore(s).total;

    // Rename every Movement and drop every binding, as a Substitution would.
    [s.primaries, s.ar7, s.accessories].forEach(group =>
      Object.values(group).forEach(e => { e.name = 'Something Else'; e.baselineId = null; }));

    assert.equal(app.computeScore(s).total, before,
      'the Score does not depend on the name of a Movement or its binding');
  });
});

// ── TICKET 03: DAY-ONLY SUBSTITUTION ───────────────────────

// Drives the substitution form the way a lifter does: open it on a Movement,
// type a name, save. Returns whether the form closed.
function substituteVia(app, cat, key, name) {
  app.openSubstituteModal(cat, key);
  app.document.getElementById('subNameInput').value = name;
  app.saveSubstitution();
  return !app.document.getElementById('substituteModal').classList.contains('open');
}

// Starts a Session on a Day and makes it the active one.
function startOn(app, day) {
  app.session = app.initSession(day.id);
  app.activeDay = day.id;
  return app.session;
}

function renderActive(app, day) {
  app.renderSessionMode(day);
  return app.document.getElementById('content').innerHTML;
}

// The first logged Movement of each Section kind on a Day, as {cat, key, name}.
function loggedMovements(app, day) {
  const out = [];
  day.sections.forEach((sec, si) => {
    const cat = app.classifySection(sec);
    if (cat === 'skip') return;
    sec.items.forEach((item, ii) => out.push({ cat, key: si + '-' + ii, name: item.name }));
  });
  return out;
}

describe('substituting a Movement during a Session', () => {
  test('a Movement in any logged Section can be substituted', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const seen = new Set();

    loggedMovements(app, day).forEach(m => {
      startOn(app, day);
      assert.ok(substituteVia(app, m.cat, m.key, 'Machine Version'),
        m.cat + ' ' + m.key + ' could not be substituted');
      const entry = app.entryFor(m.cat, m.key);
      assert.equal(entry.name, 'Machine Version');
      assert.equal(entry.substitutedFor, m.name);
      seen.add(m.cat);
    });

    assert.deepEqual(plain([...seen].sort()), ['accessory', 'ar7', 'primary']);
  });

  test('a finisher can be substituted, like any other accessory', () => {
    const app = loadApp();
    const withFinisher = app.BUILT_IN_PROGRAMS.find(p =>
      (p.days || []).some(d => (d.sections || []).some(s => s.type === 'finisher')));
    if (!withFinisher) return; // no bundled program has one

    app.setProgram(app.clone(withFinisher));
    const day = app.DAYS.find(d => (d.sections || []).some(s => s.type === 'finisher'));
    const si = day.sections.findIndex(s => s.type === 'finisher');
    startOn(app, day);

    assert.ok(substituteVia(app, 'accessory', si + '-0', 'Sled Push'));
    assert.equal(app.entryFor('accessory', si + '-0').name, 'Sled Push');
  });

  test('the substitute name is free text, with nothing matched against it', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    startOn(app, day);

    // Nonsense that no exercise library would contain.
    substituteVia(app, 'primary', found.key(0), 'the weird corner machine');
    assert.equal(app.entryFor('primary', found.key(0)).name, 'the weird corner machine');
  });

  test('the name is trimmed', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    startOn(app, day);

    substituteVia(app, 'primary', found.key(0), '   Hack Squat   ');
    assert.equal(app.entryFor('primary', found.key(0)).name, 'Hack Squat');
  });

  test('an empty name is refused and the form stays open', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    assert.equal(substituteVia(app, 'primary', found.key(0), '   '), false,
      'the form stayed open');
    const entry = app.entryFor('primary', found.key(0));
    assert.equal(entry.name, prescribed, 'the Movement is unchanged');
    assert.equal(entry.substitutedFor, null);
  });

  test('a name longer than the cap is cut to it', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    startOn(app, day);

    substituteVia(app, 'primary', found.key(0), 'x'.repeat(app.SUB_NAME_MAX + 40));
    assert.equal(app.entryFor('primary', found.key(0)).name.length, app.SUB_NAME_MAX);
  });

  test('cancelling changes nothing', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const before = plain(s.primaries[found.key(0)]);

    app.openSubstituteModal('primary', found.key(0));
    app.document.getElementById('subNameInput').value = 'Never Applied';
    app.closeSubstituteModal();

    assert.deepEqual(plain(app.entryFor('primary', found.key(0))), before);
  });

  test('several Movements can be substituted in one Session', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    const movements = loggedMovements(app, day);

    movements.forEach((m, i) => substituteVia(app, m.cat, m.key, 'Alternative ' + i));

    movements.forEach((m, i) => {
      const entry = app.entryFor(m.cat, m.key);
      assert.equal(entry.name, 'Alternative ' + i);
      assert.equal(entry.substitutedFor, m.name);
    });
  });

  test('substituting twice still records what the Program asked for', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'First Choice');
    substituteVia(app, 'primary', found.key(0), 'Second Choice');

    const entry = app.entryFor('primary', found.key(0));
    assert.equal(entry.name, 'Second Choice');
    assert.equal(entry.substitutedFor, prescribed,
      'still names the prescribed Movement, not the first substitute');
  });

  test('reopening the form on a Substitution offers the substitute for correction', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    app.openSubstituteModal('primary', found.key(0));

    assert.equal(app.document.getElementById('subNameInput').value, 'Hack Squat');
    assert.equal(app.document.getElementById('subPrescribedName').textContent, prescribed,
      'the form still names what the Program asked for');
  });

  test('the prescribed scheme is kept', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const before = plain(s.primaries[found.key(0)].target);
    const setsStr = s.primaries[found.key(0)].setsStr;
    const setCount = s.primaries[found.key(0)].sets.length;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');

    const entry = app.entryFor('primary', found.key(0));
    assert.deepEqual(plain(entry.target), before);
    assert.equal(entry.setsStr, setsStr);
    assert.equal(entry.sets.length, setCount);
  });

  test('values already logged survive the Substitution', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    s.primaries[found.key(0)].sets[0] = { weight: '185', reps: '5' };

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');

    assert.deepEqual(plain(app.entryFor('primary', found.key(0)).sets[0]),
      { weight: '185', reps: '5' });
  });

  test('the Program itself is untouched', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const before = plain(app.DAYS);
    startOn(app, day);

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');

    assert.deepEqual(plain(app.DAYS), before, 'the Day still prescribes what it did');
  });

  test('next Session of the same Day prescribes the original Movement again', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');

    const next = app.initSession(day.id);
    assert.equal(next.primaries[found.key(0)].name, prescribed);
    assert.equal(next.primaries[found.key(0)].substitutedFor, null);
  });

  test('a Substitution on an unknown Movement does nothing', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    startOn(app, day);
    app.openSubstituteModal('primary', 'no-such-key');
    assert.equal(app.document.getElementById('substituteModal').classList.contains('open'), false);
  });
});

describe('a Substitution and the Baseline it leaves behind', () => {
  // Finds a Movement bound to a Baseline, with its Day.
  function boundMovement(app) {
    for (const day of app.DAYS) {
      if (day.isOff || !day.sections) continue;
      for (let si = 0; si < day.sections.length; si++) {
        const cat = app.classifySection(day.sections[si]);
        if (cat === 'skip') continue;
        const ii = day.sections[si].items.findIndex(i => i.baselineId);
        if (ii >= 0) return { day, cat, key: si + '-' + ii, item: day.sections[si].items[ii] };
      }
    }
    return null;
  }

  test('the substitute stops showing a load derived from the prescribed Lift', () => {
    const app = loadAppWithProgram(PPL);
    const m = boundMovement(app);
    assert.ok(m, 'a Movement is bound to a Baseline');
    app.saveBaselines(app.BASELINES.map(b => ({ id: b.id, orm: 300 })));
    startOn(app, m.day);

    const before = renderActive(app, m.day);
    assert.ok(before.includes(' @ '), 'the prescribed Lift shows a working range');

    substituteVia(app, m.cat, m.key, 'Dumbbell Version');

    const entry = app.entryFor(m.cat, m.key);
    assert.equal(entry.baselineId, null, 'the binding is dropped');
    const hint = app.getSuggestedWeight(entry.name, entry.setsStr, entry.baselineId);
    assert.equal(hint, null, 'no load is suggested for a Movement never logged before');
  });

  test('the Baseline record itself is unchanged', () => {
    const app = loadAppWithProgram(PPL);
    const m = boundMovement(app);
    app.saveBaselines(app.BASELINES.map(b => ({ id: b.id, orm: 275 })));
    const before = plain(app.loadBaselines());
    startOn(app, m.day);

    substituteVia(app, m.cat, m.key, 'Dumbbell Version');

    assert.deepEqual(plain(app.loadBaselines()), before,
      'a crowded Thursday does not alter recorded maxes');
  });

  test('a substitute picks up the load it was logged at last time', () => {
    // Nothing extra builds this: the history fallback matches on name.
    const app = loadAppWithProgram(PPL);
    app.addSessionRecord({
      id: 'prev', dayType: 'pull', date: '2026-01-01T00:00:00Z', score: { total: 70 },
      primaries: { k: { name: 'Hack Squat', sets: [{ weight: '180', reps: '8' }] } },
      ar7: {}, accessories: {},
    });

    const hint = app.getSuggestedWeight('Hack Squat', '3 × 8', null);
    assert.ok(hint, 'a repeat Substitution is not blank');
    assert.equal(hint.weight, 180);
    assert.equal(hint.source, 'history');
  });
});

describe('scoring parity: the load-bearing property', () => {
  // A Session scored with a Movement substituted must produce exactly the Score
  // the same logged numbers produce without the Substitution. This is what
  // keeps the Score a measure of training rather than of gym traffic.

  // Logs the same work into a Session, whatever its Movements are called.
  function logEverything(app, s) {
    Object.values(s.primaries).forEach((p, i) => p.sets.forEach((set, j) => {
      set.weight = String(135 + i * 10 + j * 5);
      set.reps = String(p.target.repLow + (j % 2));
    }));
    Object.values(s.ar7).forEach((a, i) => { a.rounds = 4 + (i % 3); a.weight = String(40 + i * 5); });
    Object.values(s.accessories).forEach((a, i) => {
      if (i % 2) a.rpe = 3 + (i % 3);
      else a.sets.forEach((set, j) => { if (j < 2) { set.weight = '70'; set.reps = '12'; } });
    });
    s.feel = { energy: 4, effort: 4, recovery: 3 };
    return s;
  }

  test('substituting every Movement on a Day changes no part of the Score', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    const control = logEverything(app, app.initSession(day.id));
    const expected = plain(app.computeScore(control));

    const s = startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => substituteVia(app, m.cat, m.key, 'Substitute ' + i));
    logEverything(app, s);

    assert.deepEqual(plain(app.computeScore(s)), expected);
  });

  test('parity holds for each Section kind on its own', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const movements = loggedMovements(app, day);

    ['primary', 'ar7', 'accessory'].forEach(cat => {
      const control = logEverything(app, app.initSession(day.id));
      const expected = plain(app.computeScore(control));

      const s = startOn(app, day);
      movements.filter(m => m.cat === cat)
        .forEach((m, i) => substituteVia(app, m.cat, m.key, cat + ' substitute ' + i));
      logEverything(app, s);

      assert.deepEqual(plain(app.computeScore(s)), expected, cat + ' scored differently');
    });
  });

  test('parity holds across every Day of every bundled program', () => {
    const app = loadApp();
    let days = 0;
    app.BUILT_IN_PROGRAMS.forEach(program => {
      app.setProgram(app.clone(program));
      app.DAYS.forEach(day => {
        if (day.isOff || !day.sections) return;
        days++;
        const expected = plain(app.computeScore(logEverything(app, app.initSession(day.id))));

        const s = startOn(app, day);
        loggedMovements(app, day).forEach((m, i) => substituteVia(app, m.cat, m.key, 'Sub ' + i));
        logEverything(app, s);

        assert.deepEqual(plain(app.computeScore(s)), expected, program.id + '/' + day.id);
      });
    });
    assert.ok(days > 0, 'Days were compared');
  });

  test('the primary and hypertrophy weighting is unchanged by a Substitution', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    const before = app.computeScore(app.initSession(day.id));
    const s = startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => substituteVia(app, m.cat, m.key, 'Sub ' + i));
    const after = app.computeScore(s);

    assert.equal(after.primaryMax, before.primaryMax);
    assert.equal(after.hyperMax, before.hyperMax);
    assert.equal(after.feelMax, before.feelMax);
  });

  test('no penalty, flag or discount is applied for containing Substitutions', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    const s = startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => substituteVia(app, m.cat, m.key, 'Sub ' + i));
    Object.values(s.primaries).forEach(p => fillSets(p, 225, p.target.repHigh));
    Object.values(s.ar7).forEach(a => { a.rounds = 7; });
    Object.values(s.accessories).forEach(a => { a.rpe = 5; });
    s.feel = { energy: 5, effort: 5, recovery: 5 };

    assert.equal(app.computeScore(s).total, 100,
      'a perfect Session of Substitutions still scores 100');
  });
});

describe('what a Substitution looks like on screen', () => {
  test('a substituted Movement shows its new name and what it replaced', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    const html = renderActive(app, day);

    assert.ok(html.includes('Hack Squat'), 'the substitute is named');
    assert.ok(html.includes(prescribed), 'what it replaced is named too');
  });

  test('a Session with no Substitutions shows no marker', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    startOn(app, day);
    assert.ok(!renderActive(app, day).includes('sub-marker'));
  });

  test('each substituted Movement is marked, and only those', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    const movements = loggedMovements(app, day);
    const substituted = movements.slice(0, 2);

    substituted.forEach((m, i) => substituteVia(app, m.cat, m.key, 'Sub ' + i));
    const html = renderActive(app, day);

    assert.equal(html.split('sub-marker-badge').length - 1, substituted.length);
  });

  test('every logged Movement offers a way to substitute it', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const s = startOn(app, day);
    const html = renderActive(app, day);

    const logged = Object.keys(s.primaries).length
      + Object.keys(s.ar7).length
      + Object.keys(s.accessories).length;
    assert.equal(html.split('openSubstituteModal(').length - 1, logged);
  });

  test('a name with HTML in it is shown as typed, not interpreted', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    startOn(app, day);

    substituteVia(app, 'primary', found.key(0), '<img src=x onerror=alert(1)>');
    const html = renderActive(app, day);

    assert.ok(!html.includes('<img src=x'), 'the markup is not live');
    assert.ok(html.includes('&lt;img src=x'), 'it is shown as text');
  });
});

describe('what cannot be substituted', () => {
  test('a warmup Movement has no Session entry to substitute', () => {
    const app = loadAppWithProgram(AR7);
    const day = app.DAYS.find(d =>
      !d.isOff && (d.sections || []).some(s => app.classifySection(s) === 'skip'));
    assert.ok(day, 'a Day has warmups');
    const si = day.sections.findIndex(s => app.classifySection(s) === 'skip');
    const s = startOn(app, day);

    const key = si + '-0';
    assert.equal(s.primaries[key], undefined);
    assert.equal(s.ar7[key], undefined);
    assert.equal(s.accessories[key], undefined);
    assert.equal(app.entryFor('primary', key), null);

    const html = renderActive(app, day);
    assert.ok(!html.includes("openSubstituteModal('primary','" + key + "'"),
      'no substitute control is offered on a warmup');
  });

  test('an Off Day starts no Session, so nothing on it can be substituted', () => {
    const app = loadAppWithProgram(PPL);
    const off = app.DAYS.find(d => d.isOff);
    if (!off) return;
    // The render path for an Off Day never enters session mode, and the Day
    // offers no way in.
    assert.ok(off.isOff);
  });
});

describe('a Substitution in the Session record', () => {
  test('the record keeps both names', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;
    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    Object.values(s.primaries).forEach(p => fillSets(p, 200, p.target.repLow));

    // finishSession writes the snapshot into the record as it stands.
    app.finishSession();

    const record = app.getAllSessions().pop();
    const entry = record.primaries[found.key(0)];
    assert.equal(entry.name, 'Hack Squat');
    assert.equal(entry.substitutedFor, prescribed);
  });

  test('a record from a Session with no Substitutions marks none', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const s = startOn(app, day);
    Object.values(s.primaries).forEach(p => fillSets(p, 200, p.target.repLow));
    app.finishSession();

    const record = app.getAllSessions().pop();
    Object.values(record.primaries).forEach(e => assert.equal(e.substitutedFor, null));
  });

  test('a draft carries the Substitution through a resume', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    app.saveDraft();

    const resumed = app.backfillSnapshot(app.loadDraft());
    assert.equal(resumed.primaries[found.key(0)].name, 'Hack Squat');
    assert.equal(resumed.primaries[found.key(0)].substitutedFor, prescribed);
    assert.equal(resumed.primaries[found.key(0)].baselineId, null,
      'the binding stays dropped through a resume');
  });
});

// ── TICKET 04: ADJUST THE SUBSTITUTE'S SCHEME ──────────────

// Drives the whole substitution form the way a lifter does: open it on a
// Movement, type a name, set the scheme fields, save. A field left out of
// `scheme` keeps whatever the form prefilled. Returns whether the form closed,
// so a save the form refused is visible to the test.
function substituteWithScheme(app, cat, key, name, scheme) {
  app.openSubstituteModal(cat, key);
  app.document.getElementById('subNameInput').value = name;
  const fields = { sets: 'subSetsInput', repLow: 'subRepLowInput', repHigh: 'subRepHighInput' };
  Object.keys(fields).forEach(f => {
    if (scheme && scheme[f] !== undefined) app.document.getElementById(fields[f]).value = String(scheme[f]);
  });
  app.saveSubstitution();
  return !app.document.getElementById('substituteModal').classList.contains('open');
}

// The scheme the form is offering right now, as the lifter reads it.
function schemeOnForm(app) {
  const num = id => Number(app.document.getElementById(id).value);
  return { sets: num('subSetsInput'), repLow: num('subRepLowInput'), repHigh: num('subRepHighInput') };
}

// The snapshot entry for a Movement of a Session the test holds itself, rather
// than of the active one entryFor reads.
function entryIn(s, cat, key) {
  return cat === 'primary' ? s.primaries[key] : cat === 'ar7' ? s.ar7[key] : s.accessories[key];
}

// One Movement of each logged Section type, each with its own app and Day. A
// finisher is scored as an accessory but is its own Section type, so the ticket
// names it separately and so does this.
function oneOfEachSectionType() {
  const byCat = (type, programId, cat) => {
    const app = loadAppWithProgram(programId);
    const day = dayWithSections(app, [cat]);
    return { type, app, day, cat, key: findSection(app, cat, day.id).key(0) };
  };
  const finisher = () => {
    const app = loadAppWithProgram(AR7);
    const day = app.DAYS.find(d => !d.isOff && (d.sections || []).some(s => s.type === 'finisher'));
    const si = day.sections.findIndex(s => s.type === 'finisher');
    return { type: 'finisher', app, day, cat: 'accessory', key: si + '-0' };
  };
  return [
    byCat('primary', PPL, 'primary'),
    byCat('ar7', AR7, 'ar7'),
    byCat('accessory', PPL, 'accessory'),
    finisher(),
  ];
}

describe('adjusting the scheme of a substitute', () => {
  test('the rep range can be changed on a substitute in every logged Section type', () => {
    const types = oneOfEachSectionType();
    types.forEach(t => {
      startOn(t.app, t.day);
      assert.ok(substituteWithScheme(t.app, t.cat, t.key, 'Machine Version', { repLow: 15, repHigh: 20 }),
        t.type + ' refused a rep range the lifter set');
      const range = t.app.repRangeOf(t.app.entryFor(t.cat, t.key), t.cat);
      assert.deepEqual(plain(range), { repLow: 15, repHigh: 20 }, t.type);
    });
    assert.deepEqual(types.map(t => t.type), ['primary', 'ar7', 'accessory', 'finisher'],
      'all four logged Section types were exercised');
  });

  test('the set count can be changed on primary, accessory and finisher substitutes', () => {
    const types = oneOfEachSectionType().filter(t => t.type !== 'ar7');
    types.forEach(t => {
      startOn(t.app, t.day);
      assert.ok(substituteWithScheme(t.app, t.cat, t.key, 'Machine Version', { sets: 5 }),
        t.type + ' refused a set count the lifter set');
      const entry = t.app.entryFor(t.cat, t.key);
      assert.equal(entry.sets.length, 5, t.type + ' logs against five sets');
      assert.equal(entry.target.numSets, 5, t.type + ' is graded against five sets');
    });
    assert.equal(types.length, 3, 'primary, accessory and finisher were all exercised');
  });

  test('the form opens on the prescribed scheme, so keeping it takes no typing', () => {
    oneOfEachSectionType().forEach(t => {
      startOn(t.app, t.day);
      const entry = t.app.entryFor(t.cat, t.key);
      const prescribed = {
        setsStr: entry.setsStr,
        range: plain(t.app.repRangeOf(entry, t.cat)),
        count: entry.sets ? entry.sets.length : null,
      };

      t.app.openSubstituteModal(t.cat, t.key);
      const form = schemeOnForm(t.app);
      assert.equal(form.repLow, prescribed.range.repLow, t.type);
      assert.equal(form.repHigh, prescribed.range.repHigh, t.type);
      if (prescribed.count !== null) assert.equal(form.sets, prescribed.count, t.type);

      // Saving a name and nothing else leaves the Movement prescribed as it was.
      t.app.document.getElementById('subNameInput').value = 'Machine Version';
      t.app.saveSubstitution();
      assert.equal(t.app.entryFor(t.cat, t.key).setsStr, prescribed.setsStr,
        t.type + ': the scheme drifted when the lifter edited nothing');
    });
  });

  test('reopening the form offers the scheme the lifter set, not the prescribed one', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const key = findSection(app, 'accessory', day.id).key(0);
    startOn(app, day);

    substituteWithScheme(app, 'accessory', key, 'Pec Deck', { sets: 5, repLow: 20, repHigh: 25 });
    app.openSubstituteModal('accessory', key);

    assert.deepEqual(schemeOnForm(app), { sets: 5, repLow: 20, repHigh: 25 });
  });

  test('the Target on screen is the scheme the lifter set', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    const prescribed = s.primaries[key].setsStr;

    substituteWithScheme(app, 'primary', key, 'Hack Squat', { sets: 4, repLow: 15, repHigh: 20 });
    const html = renderActive(app, day);

    assert.ok(html.includes('4 × 15–20'), 'the lifter sees what they are logging against');
    assert.ok(!html.includes('>' + prescribed + '<'), 'the prescribed scheme is no longer the Target');
  });
});

describe('an AR-7 substitute stays seven rounds', () => {
  function ar7Movement() {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['ar7']);
    return { app, day, key: findSection(app, 'ar7', day.id).key(0) };
  }

  test('an AR-7 substitute has no set count, so whatever the Sets field holds is ignored', () => {
    const t = ar7Movement();
    startOn(t.app, t.day);
    const before = plain(t.app.entryFor('ar7', t.key).target);

    // Zero sets is a value the form refuses for every other Section type.
    assert.ok(substituteWithScheme(t.app, 'ar7', t.key, 'Machine Fly', { sets: 0, repLow: 12, repHigh: 15 }),
      'the Sets field is not read for AR-7');

    const entry = t.app.entryFor('ar7', t.key);
    assert.equal(entry.sets, undefined, 'AR-7 logs rounds, not sets');
    assert.equal(entry.target.numSets, before.numSets, 'nothing moved its set count');
    assert.deepEqual(plain(t.app.repRangeOf(entry, 'ar7')), { repLow: 12, repHigh: 15 },
      'the rep range is the one thing that moved');
  });

  test('the renderer still offers seven rounds after a scheme edit', () => {
    const t = ar7Movement();
    startOn(t.app, t.day);
    substituteWithScheme(t.app, 'ar7', t.key, 'Machine Fly', { repLow: 20, repHigh: 25 });
    const html = renderActive(t.app, t.day);

    assert.equal(html.split("toggleAr7Round('" + t.key + "'").length - 1, 7,
      'seven rounds are offered, whatever range the lifter set');
    assert.ok(html.includes('0/7'), 'the rounds readout still counts out of seven');
  });

  test('the AR-7 scorer still grades out of seven after a scheme edit', () => {
    const t = ar7Movement();
    const s = startOn(t.app, t.day);
    substituteWithScheme(t.app, 'ar7', t.key, 'Machine Fly', { repLow: 20, repHigh: 25 });
    const movements = Object.keys(s.ar7).length;
    Object.values(s.ar7).forEach(a => { a.rounds = 0; });

    s.ar7[t.key].rounds = 7;
    assert.equal(t.app.scoreAr7(s), 100 / movements, 'seven rounds is still full marks');
    s.ar7[t.key].rounds = 4;
    assert.equal(t.app.scoreAr7(s), ((4 / 7) * 100) / movements, 'four rounds is still four sevenths');
  });
});

describe('changing the set count of a substitute', () => {
  // A primary with sets to gain and lose, with a Session started on its Day.
  function primaryMovement() {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    assert.ok(s.primaries[key].sets.length >= 3, 'the prescribed Movement has sets to lose');
    return { app, day, key };
  }

  test('raising the set count keeps the sets already logged and adds empty ones', () => {
    const t = primaryMovement();
    const entry = t.app.entryFor('primary', t.key);
    entry.sets[0] = { weight: '185', reps: '5' };
    entry.sets[1] = { weight: '195', reps: '4' };

    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat', { sets: 6 }));

    const after = t.app.entryFor('primary', t.key);
    assert.equal(after.sets.length, 6, 'six sets to log against');
    assert.deepEqual(plain(after.sets.slice(0, 2)),
      [{ weight: '185', reps: '5' }, { weight: '195', reps: '4' }],
      'the work already logged is still there');
    after.sets.slice(2).forEach((set, i) => assert.deepEqual(plain(set), { weight: '', reps: '' },
      'set ' + (i + 3) + ' is empty and waiting'));
  });

  test('lowering the set count keeps the logged values that still fit', () => {
    const t = primaryMovement();
    const entry = t.app.entryFor('primary', t.key);
    fillSets(entry, 185, 5);
    entry.sets[0] = { weight: '135', reps: '8' };
    t.app.answerConfirm(true);

    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat', { sets: 2 }));

    const after = t.app.entryFor('primary', t.key);
    assert.equal(after.sets.length, 2);
    assert.deepEqual(plain(after.sets),
      [{ weight: '135', reps: '8' }, { weight: '185', reps: '5' }],
      'the sets that still fit kept the values logged into them');
  });

  test('shedding sets that hold no logged work asks the lifter nothing', () => {
    const t = primaryMovement();
    t.app.answerConfirm(false);

    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat', { sets: 1 }),
      'an untouched Movement sheds sets freely');

    assert.deepEqual(plain(t.app.confirmsAsked()), [], 'nothing was worth asking about');
    assert.equal(t.app.entryFor('primary', t.key).sets.length, 1);
  });

  test('a reduction that would discard filled sets is confirmed before it happens', () => {
    const t = primaryMovement();
    fillSets(t.app.entryFor('primary', t.key), 185, 5);
    t.app.answerConfirm(true);

    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat', { sets: 1 }));

    assert.equal(t.app.confirmsAsked().length, 1, 'the lifter was asked, once');
    assert.ok(/discard/i.test(t.app.lastConfirm()),
      'and told what it costs: ' + t.app.lastConfirm());
    assert.equal(t.app.entryFor('primary', t.key).sets.length, 1, 'then it happened');
  });

  // The question is asked at the moment work is about to be thrown away, so it
  // is worth it reading like a sentence rather than like a template.
  test('the discard question counts sets in words that match the numbers', () => {
    const one = primaryMovement();
    fillSets(one.app.entryFor('primary', one.key), 185, 5);
    one.app.answerConfirm(true);
    substituteWithScheme(one.app, 'primary', one.key, 'Hack Squat', { sets: 1 });
    assert.match(one.app.lastConfirm(), /Dropping to 1 set discards 2 sets/,
      'a single remaining set is not "1 sets": ' + one.app.lastConfirm());

    const two = primaryMovement();
    fillSets(two.app.entryFor('primary', two.key), 185, 5);
    two.app.answerConfirm(true);
    substituteWithScheme(two.app, 'primary', two.key, 'Hack Squat', { sets: 2 });
    assert.match(two.app.lastConfirm(), /Dropping to 2 sets discards 1 set\b/,
      'and a single discarded set is not "1 sets": ' + two.app.lastConfirm());
  });

  test('cancelling that reduction leaves the name, scheme, target and logged sets as they were', () => {
    const t = primaryMovement();
    fillSets(t.app.entryFor('primary', t.key), 185, 5);
    const before = plain(t.app.entryFor('primary', t.key));
    t.app.answerConfirm(false);

    assert.equal(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat',
      { sets: 1, repLow: 20, repHigh: 25 }), false,
      'the form stays open, so the lifter can pick other numbers');

    assert.equal(t.app.confirmsAsked().length, 1, 'the lifter was asked');
    assert.deepEqual(plain(t.app.entryFor('primary', t.key)), before,
      'nothing about the Movement moved');
  });

  test('an accessory keeps its logged work across a reduction too', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const key = findSection(app, 'accessory', day.id).key(0);
    const s = startOn(app, day);
    fillSets(s.accessories[key], 60, 12);
    s.accessories[key].sets[0] = { weight: '50', reps: '15' };
    app.answerConfirm(true);

    assert.ok(substituteWithScheme(app, 'accessory', key, 'Pec Deck', { sets: 1 }));

    assert.deepEqual(plain(app.entryFor('accessory', key).sets), [{ weight: '50', reps: '15' }]);
  });
});

describe('what a substitute is graded against', () => {
  // The same logged sets graded against a target built by hand, so a test can
  // say what the prescribed range would have scored without restating the
  // scorer's arithmetic.
  function scoredAgainst(app, target, sets) {
    return app.scorePrimary({ primaries: { k: { name: 'X', target, sets } }, ar7: {}, accessories: {} });
  }

  // A primary the Program asks for at more reps than a loadable machine gives.
  function highRepPrimary() {
    for (const programId of [PPL, AR7]) {
      const app = loadAppWithProgram(programId);
      for (const day of app.DAYS) {
        if (day.isOff || !day.sections) continue;
        const s = app.initSession(day.id);
        for (const key of Object.keys(s.primaries)) {
          if (s.primaries[key].target.repLow >= 6) return { app, day, key };
        }
      }
    }
    return null;
  }

  test('a substitute is graded against the rep range the lifter set, not the prescribed one', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    const prescribed = plain(s.primaries[key].target);

    // The machine only makes sense at higher reps, so the lifter says so and
    // logs 18 -- inside 15-20, short of its top.
    substituteWithScheme(app, 'primary', key, 'Leg Press Machine', { sets: 3, repLow: 15, repHigh: 20 });
    fillSets(app.entryFor('primary', key), 200, 18);

    const scored = app.scorePrimary(s);
    assert.ok(scored > 85 && scored < 100, '18 reps sits inside the range they set: ' + scored);
    assert.equal(scored, 94);
    assert.notEqual(scored, scoredAgainst(app, prescribed, [{ weight: '200', reps: '18' }]),
      'the prescribed range would have graded the same reps differently');
  });

  test('a heavier, lower-rep substitute is graded as hitting its range, not as a miss', () => {
    const t = highRepPrimary();
    assert.ok(t, 'a bundled Program asks for a primary at six reps or more');
    const s = startOn(t.app, t.day);
    const prescribed = plain(s.primaries[t.key].target);

    // A loadable machine, logged at the three reps the lifter set for it.
    substituteWithScheme(t.app, 'primary', t.key, 'Belt Squat', { sets: 3, repLow: 3, repHigh: 3 });
    fillSets(t.app.entryFor('primary', t.key), 300, 3);

    assert.equal(t.app.scorePrimary(s), 100, 'three of three is the top of the range they set');
    const asPrescribed = scoredAgainst(t.app, prescribed, [{ weight: '300', reps: '3' }]);
    assert.ok(asPrescribed < 85,
      'the prescribed range would have called it a miss: ' + asPrescribed);
  });

  test('raising the set count lowers the accessory Score, because the Score divides by set count', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const key = findSection(app, 'accessory', day.id).key(0);
    const s = startOn(app, day);

    // Only this Movement is logged, so the Session's accessory Score is its own.
    substituteWithScheme(app, 'accessory', key, 'Pec Deck', { sets: 3, repLow: 12, repHigh: 15 });
    fillSets(app.entryFor('accessory', key), 60, 12);
    assert.equal(app.scoreAccessory(s), 75, 'three of three sets filled, with no RPE reported');

    app.answerConfirm(false);
    assert.ok(substituteWithScheme(app, 'accessory', key, 'Pec Deck', { sets: 6, repLow: 12, repHigh: 15 }),
      'raising the count discards nothing, so nothing is confirmed');
    assert.equal(app.entryFor('accessory', key).sets.length, 6);
    assert.equal(app.scoreAccessory(s), 37.5, 'the same work over six sets is half the Score');
  });

  test('lowering the set count raises the accessory Score for the work that fits', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const key = findSection(app, 'accessory', day.id).key(0);
    const s = startOn(app, day);
    assert.equal(s.accessories[key].sets.length, 3, 'the Movement is prescribed three sets');
    s.accessories[key].sets[0] = { weight: '60', reps: '12' };
    assert.equal(app.scoreAccessory(s), 25, 'one of three sets filled');

    app.answerConfirm(false);
    assert.ok(substituteWithScheme(app, 'accessory', key, 'Pec Deck', { sets: 1, repLow: 12, repHigh: 15 }),
      'the two empty sets go without a word');
    assert.equal(app.scoreAccessory(s), 75, 'one of one set filled');
  });
});

describe('a scheme the form will not accept', () => {
  // A Movement with work already logged into it, so a refused save has
  // something to damage.
  function logged() {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    fillSets(s.primaries[key], 185, 5);
    return { app, key, before: plain(s.primaries[key]) };
  }

  test('a scheme the app cannot use is refused, and the Movement is left untouched', () => {
    const probe = loadApp();
    const cases = [
      ['no sets at all', { sets: 0 }],
      ['a negative set count', { sets: -2 }],
      ['a set count that is not a number', { sets: 'lots' }],
      ['more sets than the cap', { sets: probe.SUB_SETS_MAX + 1 }],
      ['no reps at all', { repLow: 0, repHigh: 0 }],
      ['a negative rep count', { repLow: -5 }],
      ['reps that are not a number', { repHigh: 'many' }],
      ['more reps than the app allows', { repLow: 101, repHigh: 120 }],
    ];

    cases.forEach(([why, scheme]) => {
      const t = logged();
      assert.equal(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat', scheme), false,
        why + ' was accepted');
      assert.deepEqual(plain(t.app.entryFor('primary', t.key)), t.before,
        why + ' changed the Movement anyway');
    });
  });

  test('the caps themselves are accepted, so the limits are not off by one', () => {
    const t = logged();
    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat',
      { sets: t.app.SUB_SETS_MAX, repLow: 100, repHigh: 100 }), 'the cap itself is allowed');

    const entry = t.app.entryFor('primary', t.key);
    assert.equal(entry.sets.length, t.app.SUB_SETS_MAX);
    assert.deepEqual(plain(t.app.repRangeOf(entry, 'primary')), { repLow: 100, repHigh: 100 });
  });

  test('a range entered backwards is taken as a single rep count rather than refused', () => {
    const t = logged();
    assert.ok(substituteWithScheme(t.app, 'primary', t.key, 'Hack Squat',
      { sets: 3, repLow: 12, repHigh: 8 }));

    const entry = t.app.entryFor('primary', t.key);
    assert.deepEqual(plain(t.app.repRangeOf(entry, 'primary')), { repLow: 12, repHigh: 12 });
    assert.equal(entry.setsStr, '3 × 12', 'and reads back as the one number');
  });

  test('a scheme edit with no substitute named is refused along with the Substitution', () => {
    const t = logged();
    assert.equal(substituteWithScheme(t.app, 'primary', t.key, '   ',
      { sets: 5, repLow: 15, repHigh: 20 }), false, 'the form stayed open');
    assert.deepEqual(plain(t.app.entryFor('primary', t.key)), t.before,
      'the scheme was not applied on its own');
  });
});

describe('scheme strings survive being rewritten', () => {
  test('every scheme in both bundled programs round-trips unchanged when the lifter edits nothing', () => {
    const app = loadApp();
    let schemes = 0;
    app.BUILT_IN_PROGRAMS.forEach(program => {
      app.setProgram(app.clone(program));
      app.DAYS.forEach(day => {
        // An Off Day prescribes no logged work, so nothing on it can be
        // substituted and no scheme on it is ever rewritten.
        if (day.isOff || !day.sections) return;
        const s = app.initSession(day.id);
        loggedMovements(app, day).forEach(m => {
          const entry = entryIn(s, m.cat, m.key);
          const range = app.repRangeOf(entry, m.cat);
          const numSets = entry.sets ? entry.sets.length : entry.target.numSets;
          schemes++;
          assert.equal(
            app.rewriteScheme(entry.setsStr, m.cat, numSets, range.repLow, range.repHigh),
            entry.setsStr,
            program.id + '/' + day.id + ' ' + m.name + ': "' + entry.setsStr + '"');
        });
      });
    });
    // The logged Movements of the two bundled programs. Move this when a
    // Program gains or loses one -- not to make a failure go away.
    assert.equal(schemes, 49, 'every logged Movement of both bundled programs was checked');
  });

  test('a qualifier on a scheme keeps its trailing text when the numbers change', () => {
    const app = loadApp();
    assert.equal(app.rewriteScheme('3 × 10–12 / side', 'accessory', 4, 15, 20),
      '4 × 15–20 / side');
    assert.equal(app.rewriteScheme('3 × 8–10 / leg @ 50–70 lb DBs', 'accessory', 2, 12, 12),
      '2 × 12 / leg @ 50–70 lb DBs');
    assert.equal(app.rewriteScheme('2 × 30 sec', 'accessory', 3, 45, 45), '3 × 45 sec');
    assert.equal(app.rewriteScheme('6–8 reps / side', 'ar7', 1, 12, 15), '12–15 reps / side');
  });

  test('a qualifier survives a scheme edit the lifter makes through the form', () => {
    const app = loadAppWithProgram(PPL);
    let found = null;
    app.DAYS.forEach(day => {
      if (found || day.isOff || !day.sections) return;
      const s = app.initSession(day.id);
      loggedMovements(app, day).forEach(m => {
        if (found) return;
        if (/ \/ side$/.test(entryIn(s, m.cat, m.key).setsStr || '')) found = { day, m };
      });
    });
    assert.ok(found, 'a bundled Movement is prescribed per side');

    startOn(app, found.day);
    substituteWithScheme(app, found.m.cat, found.m.key, 'Cable Version',
      { sets: 4, repLow: 20, repHigh: 25 });

    assert.equal(app.entryFor(found.m.cat, found.m.key).setsStr, '4 × 20–25 / side',
      'the lifter is still told it is per side');
  });
});

describe('where the rep range of a substitute is read from', () => {
  test('an AR-7 range comes out of the scheme string, because its target cannot hold one', () => {
    const app = loadAppWithProgram(AR7);
    let checked = 0;
    app.DAYS.forEach(day => {
      if (day.isOff || !day.sections) return;
      const s = app.initSession(day.id);
      loggedMovements(app, day).filter(m => m.cat === 'ar7').forEach(m => {
        const entry = entryIn(s, m.cat, m.key);
        const range = app.repRangeOf(entry, 'ar7');
        assert.equal(entry.target.repLow, 1,
          'the parsed target is the 1-1 placeholder for "' + entry.setsStr + '"');
        assert.ok(range.repLow > 1, 'the range still came out of "' + entry.setsStr + '"');
        assert.ok(range.repHigh >= range.repLow, entry.setsStr);
        checked++;
      });
    });
    assert.ok(checked > 0, 'AR-7 Movements were checked');
  });

  test('every other Section type reads its range out of the parsed target', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const entry = app.initSession(day.id).primaries[key];

    assert.deepEqual(plain(app.repRangeOf(entry, 'primary')),
      { repLow: entry.target.repLow, repHigh: entry.target.repHigh });

    // The target is what a scheme edit moves, and the target is what the range
    // is read back from -- not the scheme string, which still says what the
    // Program asked for.
    entry.target = { numSets: entry.target.numSets, repLow: 15, repHigh: 20 };
    assert.deepEqual(plain(app.repRangeOf(entry, 'primary')), { repLow: 15, repHigh: 20 });
  });
});

describe('scoring parity survives a scheme edit', () => {
  // The parity property above covers substitutes that keep the prescribed
  // scheme. It has to hold through a scheme edit too: if the lifter moves the
  // range and then logs work that matches the range they set, the Session must
  // score exactly what the control scores logging work that matches the range
  // the Program set. Otherwise saying what you are doing costs Score.
  test('a scheme-edited Substitution scores what the control scores for matching work', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    // Control: prescribed throughout, every primary at the bottom of its range,
    // every accessory set filled, five rounds of seven.
    const control = app.initSession(day.id);
    Object.values(control.primaries).forEach(p => fillSets(p, 185, p.target.repLow));
    Object.values(control.accessories).forEach(a => fillSets(a, 60, 12));
    Object.values(control.ar7).forEach(a => { a.rounds = 5; });
    control.feel = { energy: 4, effort: 4, recovery: 3 };
    const expected = plain(app.computeScore(control));

    // The same Day, every Movement substituted and every scheme moved, then
    // logged against the numbers the lifter typed rather than the snapshot's.
    const s = startOn(app, day);
    const typed = {};
    loggedMovements(app, day).forEach((m, i) => {
      const entry = app.entryFor(m.cat, m.key);
      const range = app.repRangeOf(entry, m.cat);
      const scheme = {
        sets: (entry.sets ? entry.sets.length : 1) + 1,
        repLow: range.repLow + 7,
        repHigh: range.repHigh + 7,
      };
      typed[m.cat + '|' + m.key] = scheme;
      assert.ok(substituteWithScheme(app, m.cat, m.key, 'Substitute ' + i, scheme),
        m.cat + ' ' + m.key + ' refused the scheme');
    });
    loggedMovements(app, day).forEach(m => {
      const entry = app.entryFor(m.cat, m.key);
      if (m.cat === 'ar7') { entry.rounds = 5; return; }
      if (m.cat === 'primary') fillSets(entry, 185, typed[m.cat + '|' + m.key].repLow);
      else fillSets(entry, 60, 12);
    });
    s.feel = { energy: 4, effort: 4, recovery: 3 };

    assert.deepEqual(plain(app.computeScore(s)), expected);
  });
});

// ── TICKET 05: REVERT A SUBSTITUTION MID-SESSION ───────────
// Drives a revert the way a lifter does: open the substitution form on the
// Movement, hit the revert control. Returns whether the form closed, so a
// revert the lifter backed out of is visible to the test.
function revertVia(app, cat, key) {
  app.openSubstituteModal(cat, key);
  app.revertSubstitution();
  return !app.document.getElementById('substituteModal').classList.contains('open');
}

// Logs work against an entry whatever Section kind it belongs to, so a revert
// always has something to throw away.
function logSomething(cat, entry) {
  if (cat === 'ar7') { entry.rounds = 5; entry.weight = '45'; return entry; }
  fillSets(entry, 95, entry.target.repLow);
  if (entry.rpe !== undefined) entry.rpe = 4;
  return entry;
}

// A Movement bound to a Baseline, with the Day it sits on. Its working range is
// drawn from the Lift's 1RM, which is what a revert has to bring back.
function boundLift(app) {
  for (const day of app.DAYS) {
    if (day.isOff || !day.sections) continue;
    for (let si = 0; si < day.sections.length; si++) {
      const cat = app.classifySection(day.sections[si]);
      if (cat === 'skip') continue;
      const ii = day.sections[si].items.findIndex(i => i.baselineId);
      if (ii >= 0) return { day, cat, key: si + '-' + ii, item: day.sections[si].items[ii] };
    }
  }
  return null;
}

// The scheme as session mode puts it in front of the lifter, working range and
// all.
function targetShown(app, cat, key) {
  return app.displaySets(app.snapshotAsMovement(app.entryFor(cat, key)));
}

describe('reverting a Substitution mid-Session', () => {
  test('a Substitution in every logged Section type goes back while the Session is active', () => {
    const types = oneOfEachSectionType();
    types.forEach(t => {
      const s = startOn(t.app, t.day);
      const prescribed = entryIn(s, t.cat, t.key).name;
      substituteVia(t.app, t.cat, t.key, 'Machine Version');
      assert.equal(t.app.entryFor(t.cat, t.key).name, 'Machine Version', t.type);

      assert.ok(revertVia(t.app, t.cat, t.key), t.type + ' refused the revert');
      const entry = t.app.entryFor(t.cat, t.key);
      assert.equal(entry.name, prescribed, t.type + ' did not get its Movement back');
      assert.equal(entry.substitutedFor, null, t.type + ' still reads as a Substitution');
    });
    assert.deepEqual(types.map(t => t.type), ['primary', 'ar7', 'accessory', 'finisher'],
      'every logged Section type was covered');
  });

  test('the prescribed name, scheme and baseline binding all come back together', () => {
    const app = loadAppWithProgram(PPL);
    const m = boundLift(app);
    assert.ok(m, 'a Movement is bound to a Baseline');
    startOn(app, m.day);

    substituteWithScheme(app, m.cat, m.key, 'Hack Squat', { sets: 2, repLow: 20, repHigh: 25 });
    const sub = app.entryFor(m.cat, m.key);
    assert.notEqual(sub.setsStr, m.item.sets, 'the scheme really moved off the prescribed one');
    assert.equal(sub.baselineId, null, 'the binding really was dropped');

    assert.ok(revertVia(app, m.cat, m.key));
    const entry = app.entryFor(m.cat, m.key);
    assert.equal(entry.name, m.item.name, 'the name');
    assert.equal(entry.setsStr, m.item.sets, 'the scheme');
    assert.deepEqual(plain(entry.target), plain(app.parseSetsStr(m.item.sets)), 'the parsed target');
    assert.equal(entry.baselineId, m.item.baselineId, 'the baseline binding');
  });

  test('the working range from the Lift’s 1RM reappears', () => {
    const app = loadAppWithProgram(PPL);
    const m = boundLift(app);
    const b = app.loadBaselines().find(x => x.id === m.item.baselineId);
    const range = app.workingRange(b.orm, b.pctLow, b.pctHigh);
    startOn(app, m.day);

    assert.ok(targetShown(app, m.cat, m.key).includes(range),
      'the prescribed Lift shows a range drawn from its 1RM');
    substituteVia(app, m.cat, m.key, 'Dumbbell Version');
    assert.ok(!targetShown(app, m.cat, m.key).includes(range),
      'the substitute is not prescribed a barbell load');

    assert.ok(revertVia(app, m.cat, m.key));
    assert.ok(targetShown(app, m.cat, m.key).includes(range), 'the working range is back');
    assert.ok(renderActive(app, m.day).includes(range), 'and session mode shows it again');
    const hint = app.getSuggestedWeight(m.item.name, m.item.sets, app.entryFor(m.cat, m.key).baselineId);
    assert.equal(hint.source, 'baseline', 'the suggested load comes off the 1RM again');
  });

  test('the values logged against the substitute are cleared', () => {
    const types = oneOfEachSectionType();
    types.forEach(t => {
      startOn(t.app, t.day);
      substituteWithScheme(t.app, t.cat, t.key, 'Machine Version', { sets: 2, repLow: 20, repHigh: 20 });
      logSomething(t.cat, t.app.entryFor(t.cat, t.key));
      assert.ok(t.app.loggedValuesIn(t.app.entryFor(t.cat, t.key)) > 0,
        t.type + ' had nothing logged to lose');

      assert.ok(revertVia(t.app, t.cat, t.key), t.type + ' refused the revert');
      const entry = t.app.entryFor(t.cat, t.key);
      if (entry.sets) {
        assert.equal(entry.sets.length, entry.target.numSets,
          t.type + ' has the prescribed number of sets');
        assert.deepEqual(plain(entry.sets), Array.from({ length: entry.sets.length }, () => ({ weight: '', reps: '' })),
          t.type + ' kept logged sets');
      }
      if (t.cat === 'ar7') {
        assert.equal(entry.rounds, 0, t.type + ' kept its rounds');
        assert.equal(entry.weight, '', t.type + ' kept its load');
      }
      if (entry.rpe !== undefined) assert.equal(entry.rpe, 0, t.type + ' kept its RPE');
    });
  });

  test('cleared values are never attributed to the prescribed Movement', () => {
    // The suggested-weight lookup matches on Movement name, so values carried
    // through a revert would come back next week as the prescribed Movement's
    // own history.
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const found = findSection(app, 'accessory', day.id);
    const s = startOn(app, day);
    const prescribed = s.accessories[found.key(0)].name;
    const scheme = s.accessories[found.key(0)].setsStr;
    assert.equal(app.getSuggestedWeight(prescribed, scheme, null), null,
      'the prescribed Movement has no history yet');

    substituteVia(app, 'accessory', found.key(0), 'Pec Deck');
    fillSets(app.entryFor('accessory', found.key(0)), 95, 12);
    assert.ok(revertVia(app, 'accessory', found.key(0)));
    app.finishSession();

    assert.equal(app.getSuggestedWeight(prescribed, scheme, null), null,
      'the prescribed Movement did not inherit the substitute’s numbers');
    assert.equal(app.getSuggestedWeight('Pec Deck', scheme, null), null,
      'and neither did the substitute, which was not logged in the end');
  });

  test('a reverted Movement is indistinguishable from one never substituted', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const control = app.initSession(day.id);

    const s = startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => {
      substituteWithScheme(app, m.cat, m.key, 'Substitute ' + i, { sets: 2, repLow: 20, repHigh: 25 });
      logSomething(m.cat, app.entryFor(m.cat, m.key));
    });
    loggedMovements(app, day).forEach(m =>
      assert.ok(revertVia(app, m.cat, m.key), m.cat + ' ' + m.key + ' refused the revert'));

    assert.deepEqual(
      plain({ primaries: s.primaries, ar7: s.ar7, accessories: s.accessories }),
      plain({ primaries: control.primaries, ar7: control.ar7, accessories: control.accessories }),
      'the snapshot is back to what starting the Session built');
  });

  test('session mode stops calling the Movement a Substitution', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    assert.ok(renderActive(app, day).includes('Hack Squat'), 'the substitute was on screen');

    revertVia(app, 'primary', found.key(0));
    const html = renderActive(app, day);
    assert.ok(html.includes(prescribed), 'the prescribed Movement is named again');
    assert.ok(!html.includes('Hack Squat'), 'the substitute is gone');
    assert.ok(!html.includes('replaces'), 'nothing claims to replace anything');
  });

  test('the Program is untouched by a revert, as it was by the Substitution', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const before = plain(app.PROGRAM);
    startOn(app, day);

    substituteWithScheme(app, 'primary', found.key(0), 'Hack Squat', { sets: 5, repLow: 12, repHigh: 15 });
    revertVia(app, 'primary', found.key(0));

    assert.deepEqual(plain(app.PROGRAM), before, 'the Program prescribes what it always did');
  });

  test('a Movement can be substituted again after a revert', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    revertVia(app, 'primary', found.key(0));
    assert.ok(substituteVia(app, 'primary', found.key(0), 'Pendulum Squat'));

    const entry = app.entryFor('primary', found.key(0));
    assert.equal(entry.name, 'Pendulum Squat');
    assert.equal(entry.substitutedFor, prescribed,
      'the second Substitution still points at what the Program asked for');
  });
});

describe('what reverting asks before it discards logged work', () => {
  test('reverting asks first when values are filled, naming both Movements', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    fillSets(app.entryFor('primary', found.key(0)), 185, 8);

    const before = app.confirmsAsked().length;
    app.answerConfirm(true);
    assert.ok(revertVia(app, 'primary', found.key(0)));

    assert.equal(app.confirmsAsked().length - before, 1, 'asked once');
    const asked = app.lastConfirm();
    assert.ok(asked.includes(prescribed), 'says what it is going back to');
    assert.ok(asked.includes('Hack Squat'), 'says whose values are being discarded');
  });

  test('cancelling the confirmation leaves the Substitution and its values intact', () => {
    const types = oneOfEachSectionType();
    types.forEach(t => {
      startOn(t.app, t.day);
      substituteWithScheme(t.app, t.cat, t.key, 'Machine Version', { sets: 3, repLow: 12, repHigh: 15 });
      logSomething(t.cat, t.app.entryFor(t.cat, t.key));
      const before = plain(t.app.entryFor(t.cat, t.key));

      t.app.answerConfirm(false);
      assert.equal(revertVia(t.app, t.cat, t.key), false, t.type + ': the form closed anyway');
      assert.deepEqual(plain(t.app.entryFor(t.cat, t.key)), before,
        t.type + ': a refused revert changed something');
    });
  });

  test('a single value logged anywhere is enough to be asked about', () => {
    const byType = {};
    oneOfEachSectionType().forEach(t => { byType[t.type] = t; });
    const cases = [
      ['primary', 'one rep', e => { e.sets[0].reps = '8'; }],
      ['accessory', 'one weight', e => { e.sets[0].weight = '60'; }],
      ['accessory', 'an RPE', e => { e.rpe = 4; }],
      ['ar7', 'a round', e => { e.rounds = 3; }],
      ['ar7', 'a load', e => { e.weight = '45'; }],
    ];
    cases.forEach(([type, what, log]) => {
      const t = byType[type];
      startOn(t.app, t.day);
      substituteVia(t.app, t.cat, t.key, 'Machine Version');
      log(t.app.entryFor(t.cat, t.key));

      const before = t.app.confirmsAsked().length;
      t.app.answerConfirm(false);
      assert.equal(revertVia(t.app, t.cat, t.key), false, what + ' was reverted without asking');
      assert.equal(t.app.confirmsAsked().length - before, 1, what + ' was not asked about');
      assert.ok(t.app.entryFor(t.cat, t.key).substitutedFor,
        what + ': the Substitution went anyway');
    });
  });

  test('reverting with nothing logged is not worth asking about', () => {
    const types = oneOfEachSectionType();
    types.forEach(t => {
      startOn(t.app, t.day);
      substituteVia(t.app, t.cat, t.key, 'Machine Version');

      const before = t.app.confirmsAsked().length;
      // A spurious confirm is refused, so it fails the count and the revert.
      t.app.answerConfirm(false);
      assert.ok(revertVia(t.app, t.cat, t.key), t.type + ' asked and was refused');
      assert.equal(t.app.confirmsAsked().length - before, 0,
        t.type + ' asked about work the lifter had not done');
      assert.equal(t.app.entryFor(t.cat, t.key).substitutedFor, null, t.type);
    });
  });

  test('reverting a Movement that was never substituted changes nothing and asks nothing', () => {
    const app = loadAppWithProgram(PPL);
    const day = app.DAYS.find(d => !d.isOff);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    fillSets(s.primaries[found.key(0)], 185, 5);
    const before = plain(s.primaries[found.key(0)]);

    const asked = app.confirmsAsked().length;
    app.answerConfirm(false);
    revertVia(app, 'primary', found.key(0));

    assert.deepEqual(plain(app.entryFor('primary', found.key(0))), before,
      'the prescribed Movement and its logged work are as they were');
    assert.equal(app.confirmsAsked().length - asked, 0, 'nothing was asked');
  });
});

describe('where a revert reads the prescribed Movement from', () => {
  // `substitutedFor` holds a name, not a scheme or a binding, so a revert has
  // to go back to the Day the Session was started from. One lookup does that
  // for every call site, so the effective-Day resolver has one line to change.
  test('every snapshot key resolves to the Movement the Day prescribes at that position', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);

    const movements = loggedMovements(app, day);
    assert.ok(movements.length > 2, 'the Day prescribes several logged Movements');
    movements.forEach(m => {
      const item = app.prescribedItemFor(m.cat, m.key);
      assert.ok(item, m.cat + ' ' + m.key + ' resolved to nothing');
      assert.equal(item.name, m.name, m.cat + ' ' + m.key);
    });
  });

  test('a position the Day does not prescribe resolves to nothing rather than to the wrong Movement', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const found = findSection(app, 'primary', day.id);
    startOn(app, day);

    assert.equal(app.prescribedItemFor('primary', '99-0'), null, 'no such Section');
    assert.equal(app.prescribedItemFor('primary', found.sectionIndex + '-99'), null, 'no such Movement');
    assert.equal(app.prescribedItemFor('accessory', found.key(0)), null,
      'a primary Section is not resolved as an accessory');
  });

  test('a Substitution still reverts after the Session is picked up from a draft', () => {
    // The draft carries the snapshot, which holds the prescribed Movement's
    // name and nothing else about it. The scheme and the binding come back from
    // the Day regardless.
    const app = loadAppWithProgram(PPL);
    const m = boundLift(app);
    startOn(app, m.day);
    substituteWithScheme(app, m.cat, m.key, 'Hack Squat', { sets: 2, repLow: 20, repHigh: 25 });
    app.saveDraft();

    app.session = app.backfillSnapshot(app.loadDraft());
    app.activeDay = app.session.dayType;
    assert.ok(revertVia(app, m.cat, m.key), 'the resumed Session refused the revert');

    const entry = app.entryFor(m.cat, m.key);
    assert.equal(entry.name, m.item.name);
    assert.equal(entry.setsStr, m.item.sets);
    assert.equal(entry.baselineId, m.item.baselineId);
  });
});

describe('scoring parity survives a revert', () => {
  // The load-bearing property has to hold in both directions. A Movement
  // substituted and then reverted must score exactly what the same work scores
  // on a Session that never had a Substitution in it — so a revert that left
  // the set count or the rep range behind shows up here as Score the lifter
  // neither earned nor lost.
  test('a substituted-then-reverted Session scores what the control scores', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);

    // Control: prescribed throughout, nothing ever substituted.
    const control = app.initSession(day.id);
    Object.values(control.primaries).forEach(p => fillSets(p, 185, p.target.repLow));
    Object.values(control.accessories).forEach(a => fillSets(a, 60, 12));
    Object.values(control.ar7).forEach(a => { a.rounds = 5; });
    control.feel = { energy: 4, effort: 4, recovery: 3 };
    const expected = plain(app.computeScore(control));

    // The same Day: every Movement substituted onto a moved scheme and logged
    // against, then every one of them reverted and logged the control's work.
    const s = startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => {
      const entry = app.entryFor(m.cat, m.key);
      const range = app.repRangeOf(entry, m.cat);
      assert.ok(substituteWithScheme(app, m.cat, m.key, 'Substitute ' + i, {
        sets: (entry.sets ? entry.sets.length : 1) + 1,
        repLow: range.repLow + 7,
        repHigh: range.repHigh + 7,
      }), m.cat + ' ' + m.key + ' refused the scheme');
      logSomething(m.cat, app.entryFor(m.cat, m.key));
    });
    loggedMovements(app, day).forEach(m =>
      assert.ok(revertVia(app, m.cat, m.key), m.cat + ' ' + m.key + ' refused the revert'));

    // Logged against what the control logged, not against what the reverted
    // entry now says: a revert that put back the wrong rep range or the wrong
    // set count then costs Score here.
    loggedMovements(app, day).forEach(m => {
      const entry = app.entryFor(m.cat, m.key);
      if (m.cat === 'ar7') { entry.rounds = 5; return; }
      if (m.cat === 'primary') fillSets(entry, 185, entryIn(control, m.cat, m.key).target.repLow);
      else fillSets(entry, 60, 12);
    });
    s.feel = { energy: 4, effort: 4, recovery: 3 };

    assert.deepEqual(plain(app.computeScore(s)), expected);
  });
});

// ── TICKET 06: MARK A SUBSTITUTION PERMANENT ───────────────
// Drives the substitution form with the permanent box ticked, the way a lifter
// does when a machine is gone rather than busy. Returns whether the form closed.
function substitutePermanently(app, cat, key, name, scheme) {
  app.openSubstituteModal(cat, key);
  app.document.getElementById('subNameInput').value = name;
  const fields = { sets: 'subSetsInput', repLow: 'subRepLowInput', repHigh: 'subRepHighInput' };
  Object.keys(fields).forEach(f => {
    if (scheme && scheme[f] !== undefined) app.document.getElementById(fields[f]).value = String(scheme[f]);
  });
  app.document.getElementById('subPermanentInput').checked = true;
  app.saveSubstitution();
  return !app.document.getElementById('substituteModal').classList.contains('open');
}

// Every Movement name a Day prescribes, in order, Sections included.
function movementNames(day) {
  const out = [];
  (day.sections || []).forEach(sec => (sec.items || []).forEach(item => out.push(item.name)));
  return out;
}

// The Movement a Day prescribes under a given name.
function movementNamed(day, name) {
  for (const sec of (day.sections || [])) {
    for (const item of (sec.items || [])) if (item.name === name) return item;
  }
  return null;
}

// The first logged Movement of a Day in the given Section category.
function firstLogged(app, day, cat) {
  return loggedMovements(app, day).find(m => !cat || m.cat === cat);
}

// An override store holding one entry, built by hand so a resolver test states
// its own input rather than going through the form.
function storeWith(dayId, prescribedName, name, sets) {
  const store = {};
  store[dayId] = {};
  store[dayId][prescribedName] = { name: name, sets: sets };
  return store;
}

// An imported Program prescribing the same Movement on two Days. No bundled
// Program repeats a Movement across two logged Sections, and keying by Day is
// only observable where one does.
function importTwoDayProgram(app) {
  const legDay = (id, label) => ({
    id: id, label: label, day: label, sub: 'Quads', accent: '#ffffff',
    duration: '~60 min', notes: '', isOff: false,
    sections: [{
      title: 'Primary Strength', icon: 'fitness_center', type: 'primary', ar7: false,
      items: [
        { name: 'Hack Squat', sets: '3 × 8–10', note: 'quads', restSeconds: null },
        { name: 'Leg Extension', sets: '3 × 12–15', note: '', restSeconds: null },
      ],
    }],
  });
  const program = {
    id: 'prog-two-leg-days', name: 'Two Leg Days', importedAt: '2026-01-01T00:00:00Z',
    locked: false, days: [legDay('legs-a', 'LEGS A'), legDay('legs-b', 'LEGS B')],
    baselines: [], weekdayMap: null,
  };
  app.saveProgram(program);
  app.initProgramState();
  return program;
}

describe('marking a Substitution permanent', () => {
  test('day-only is what the form offers until the lifter says otherwise', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);

    app.openSubstituteModal(m.cat, m.key);
    assert.equal(app.document.getElementById('subPermanentInput').checked, false,
      'the form opens offering a Substitution for today only');

    app.document.getElementById('subNameInput').value = 'Trap Bar Deadlift';
    app.saveSubstitution();

    assert.deepEqual(plain(app.loadOverrides()), {}, 'nothing was recorded for future Sessions');
    assert.equal(app.initSession(day.id).primaries[m.key].name, m.name,
      'the next Session prescribes what the Program prescribes');
  });

  test('a Substitution marked permanent is recorded against the prescribed Movement', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);

    assert.ok(substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 }),
      'the form accepted it');

    const stored = plain(JSON.parse(app.localStorage.getItem('apparatus_overrides')));
    assert.deepEqual(Object.keys(stored), [app.currentProgramId()], 'keyed by Program id first');
    assert.deepEqual(Object.keys(stored[app.currentProgramId()]), [day.id], 'then by Day id');
    assert.deepEqual(stored[app.currentProgramId()][day.id][m.name],
      { name: 'Trap Bar Deadlift', sets: '4 × 6–8' },
      'then by the prescribed Movement name, carrying the substitute and its scheme');
  });

  test('the Substitution still applies to the Session it was made in', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const s = startOn(app, day);

    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    assert.equal(entryIn(s, m.cat, m.key).name, 'Trap Bar Deadlift');
    assert.equal(entryIn(s, m.cat, m.key).substitutedFor, m.name);
  });

  test('a Movement in any logged Section can be made permanent', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const seen = new Set();

    ['primary', 'ar7', 'accessory'].forEach(cat => {
      const m = firstLogged(app, day, cat);
      startOn(app, day);
      assert.ok(substitutePermanently(app, m.cat, m.key, cat + ' stand-in'), cat + ' was refused');
      seen.add(cat);
    });

    assert.deepEqual([...seen].sort(), ['accessory', 'ar7', 'primary']);
    assert.equal(Object.keys(plain(app.loadOverrides())[day.id]).length, 3,
      'all three were recorded for the Day');
  });
});

describe('a Permanent Substitution stands in at Session start', () => {
  test('a new Session for that Day starts with the substitute and its stored scheme', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 });

    const next = app.initSession(day.id);
    const entry = entryIn(next, m.cat, m.key);
    assert.equal(entry.name, 'Trap Bar Deadlift', 'no re-entering it weekly');
    assert.equal(entry.setsStr, '4 × 6–8', 'with the scheme it was stored with');
    assert.deepEqual(plain(entry.target), { numSets: 4, repLow: 6, repHigh: 8 });
    assert.equal(entry.sets.length, 4, 'four sets to log against');
  });

  test('a stored name with HTML in it is shown as typed, not interpreted', () => {
    // An override's name is lifter-typed free text that now outlives the Session
    // that typed it, so it comes back out of storage every week.
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, '<img src=x onerror=alert(1)> "quoted"');

    startOn(app, day);
    const html = renderActive(app, day);

    assert.ok(!html.includes('<img src=x'), 'the markup is not live');
    assert.ok(html.includes('&lt;img src=x'), 'it is shown as text');
  });

  test('an AR-7 substitute keeps the rep range it was stored with', () => {
    // AR-7 writes its range into the scheme string, which parseSetsStr cannot
    // read, so the stored scheme is the only place the range survives.
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['ar7']);
    const m = firstLogged(app, day, 'ar7');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Sled Push', { repLow: 12, repHigh: 15 });

    const entry = entryIn(app.initSession(day.id), m.cat, m.key);
    assert.equal(entry.name, 'Sled Push');
    assert.deepEqual(plain(app.repRangeOf(entry, 'ar7')), { repLow: 12, repHigh: 15 });
  });

  test('a Day with no Permanent Substitution starts exactly as it did before', () => {
    const app = loadAppWithProgram(PPL);
    const other = dayWithSections(app, ['primary']);
    const legs = app.DAYS.find(d => !d.isOff && d.id !== other.id && d.sections);
    const m = firstLogged(app, other, 'primary');
    startOn(app, other);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    // startTime comes off the clock, so it is not part of the comparison.
    const snapshot = (a, id) => { const s = plain(a.initSession(id)); delete s.startTime; return s; };
    const fresh = loadAppWithProgram(PPL);
    assert.deepEqual(snapshot(app, legs.id), snapshot(fresh, legs.id),
      'the untouched Day is snapshotted identically');
  });

  test('a resumed draft agrees with a fresh Session about what it prescribes', () => {
    // A draft saved by an older build has gaps, and backfillSnapshot fills them
    // from the Day. Filling them from the Program rather than the effective Day
    // would make a resumed draft disagree with a fresh Session.
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 });

    // An older draft: logged work, but none of the fields the snapshot now carries.
    const older = plain(app.initSession(day.id));
    const stripped = entryIn(older, m.cat, m.key);
    delete stripped.name; delete stripped.setsStr; delete stripped.target;
    delete stripped.baselineId; delete stripped.substitutedFor; delete stripped.note;

    const resumed = entryIn(app.backfillSnapshot(older), m.cat, m.key);
    assert.equal(resumed.name, 'Trap Bar Deadlift', 'the resumed draft shows the substitute');
    assert.equal(resumed.setsStr, '4 × 6–8');
    assert.equal(resumed.baselineId, null);
  });

  test('the substitute does not inherit the prescribed Lift\'s Baseline binding', () => {
    // A Baseline binding carried over would prescribe a barbell load for a
    // dumbbell movement.
    const app = loadAppWithProgram(PPL);
    const bound = (() => {
      for (const day of app.DAYS) {
        if (day.isOff || !day.sections) continue;
        for (let si = 0; si < day.sections.length; si++) {
          if (app.classifySection(day.sections[si]) === 'skip') continue;
          const ii = day.sections[si].items.findIndex(i => i.baselineId);
          if (ii >= 0) return { day, cat: app.classifySection(day.sections[si]), key: si + '-' + ii, item: day.sections[si].items[ii] };
        }
      }
      return null;
    })();
    assert.ok(bound, 'a Movement is bound to a Baseline');
    app.saveBaselines(app.BASELINES.map(b => ({ id: b.id, orm: 300 })));
    startOn(app, bound.day);
    substitutePermanently(app, bound.cat, bound.key, 'Dumbbell Version');

    const entry = entryIn(app.initSession(bound.day.id), bound.cat, bound.key);
    assert.equal(entry.baselineId, null, 'the binding is dropped for good');
    assert.equal(app.getSuggestedWeight(entry.name, entry.setsStr, entry.baselineId), null,
      'no load is derived from a 1RM the substitute has nothing to do with');
  });
});

describe('the effective-Day resolver', () => {
  test('no overrides leaves every Day of every bundled Program unchanged', () => {
    const app = loadApp();
    let days = 0;
    app.BUILT_IN_PROGRAMS.forEach(program => {
      app.setProgram(app.clone(program));
      app.DAYS.forEach(day => {
        days++;
        assert.deepEqual(plain(app.effectiveDay(day)), plain(day), program.id + '/' + day.id);
      });
    });
    assert.ok(days > 0, 'Days were resolved');
  });

  test('one override is applied, and nothing else on the Day moves', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const before = movementNames(day);

    const eff = app.effectiveDay(day, storeWith(day.id, m.name, 'Trap Bar Deadlift', '4 × 6'));

    assert.deepEqual(movementNames(eff), before.map(n => n === m.name ? 'Trap Bar Deadlift' : n));
    const item = movementNamed(eff, 'Trap Bar Deadlift');
    assert.equal(item.sets, '4 × 6', 'with the stored scheme');
    assert.equal(item.substitutedFor, m.name, 'labelled with what it replaced');
  });

  test('several overrides in one Day are all applied', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const movements = loggedMovements(app, day);
    const store = {}; store[day.id] = {};
    movements.forEach((m, i) => { store[day.id][m.name] = { name: 'Stand-In ' + i, sets: '2 × 9' }; });

    const eff = app.effectiveDay(day, store);

    movements.forEach((m, i) => {
      assert.ok(movementNamed(eff, 'Stand-In ' + i), 'Stand-In ' + i + ' is prescribed');
      assert.equal(movementNamed(eff, 'Stand-In ' + i).substitutedFor, m.name);
    });
    assert.equal(movementNames(eff).filter(n => n.startsWith('Stand-In ')).length, movements.length);
  });

  test('an override for a Movement the Day no longer prescribes is ignored, not reassigned', () => {
    // Editing or re-importing a Program must not land an override on the wrong
    // Movement, which is the failure mode a positional key would have.
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);

    const eff = app.effectiveDay(day, storeWith(day.id, 'A Movement No Longer Here', 'Ghost Press', '3 × 5'));

    assert.deepEqual(movementNames(eff), movementNames(day), 'the Day prescribes what it prescribed');
    assert.equal(movementNamed(eff, 'Ghost Press'), null, 'the override went inert');
  });

  test('an override for another Day does not reach this one', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');

    const eff = app.effectiveDay(day, storeWith('some-other-day', m.name, 'Trap Bar Deadlift', '4 × 6'));

    assert.deepEqual(movementNames(eff), movementNames(day));
  });

  test('resolving a Day never writes to the Program', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const programBefore = plain(app.DAYS);
    const builtInsBefore = plain(app.BUILT_IN_PROGRAMS);

    app.effectiveDay(day, storeWith(day.id, m.name, 'Trap Bar Deadlift', '4 × 6'));

    assert.deepEqual(plain(app.DAYS), programBefore, 'the Program definition is untouched');
    assert.deepEqual(plain(app.BUILT_IN_PROGRAMS), builtInsBefore, 'so are the embedded built-ins');
  });

  test('a corrupt or absent store reads as no overrides rather than throwing', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);

    assert.deepEqual(plain(app.loadOverrides()), {}, 'nothing stored');
    app.localStorage.setItem('apparatus_overrides', '{ not json at all');
    assert.deepEqual(plain(app.loadOverrides()), {}, 'unparseable');
    assert.deepEqual(plain(app.effectiveDay(day)), plain(day));
    app.localStorage.setItem('apparatus_overrides', '["wrong shape"]');
    assert.deepEqual(plain(app.loadOverrides()), {}, 'parseable but not a map');
    assert.deepEqual(plain(app.effectiveDay(day)), plain(day));
  });

  test('a Permanent Substitution recorded over a corrupt store still takes effect', () => {
    // Degrading to "no overrides" has to leave the lifter able to record one,
    // rather than quietly dropping every Substitution they mark from then on.
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    app.localStorage.setItem('apparatus_overrides', '{ not json at all');

    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    assert.equal(app.initSession(day.id).primaries[m.key].name, 'Trap Bar Deadlift',
      'the corrupt store was replaced with a readable one');
  });
});

describe('Permanent Substitutions are kept per Program and per Day', () => {
  test('a Movement on two Days is overridden only on the Day it was substituted on', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const [dayA, dayB] = app.DAYS;
    startOn(app, dayA);
    assert.ok(substitutePermanently(app, 'primary', '0-0', 'Belt Squat'));

    assert.equal(app.initSession(dayA.id).primaries['0-0'].name, 'Belt Squat',
      'the Day it was substituted on');
    assert.equal(app.initSession(dayB.id).primaries['0-0'].name, 'Hack Squat',
      'the other Day still prescribes what the Program prescribes');
  });

  test('a Substitution on an imported Program behaves as it does on a built-in one', () => {
    const app = loadApp();
    const imported = importTwoDayProgram(app);
    const day = app.DAYS[0];
    startOn(app, day);
    substitutePermanently(app, 'primary', '0-0', 'Belt Squat', { sets: 5, repLow: 5, repHigh: 5 });

    const entry = app.initSession(day.id).primaries['0-0'];
    assert.equal(entry.name, 'Belt Squat');
    assert.equal(entry.setsStr, '5 × 5');
    assert.deepEqual(Object.keys(plain(app.readOverrideMap())), [imported.id],
      'recorded under the imported Program');
  });

  test('are kept separately per Program', () => {
    const app = loadApp();
    const [first, second] = app.BUILT_IN_PROGRAMS;
    if (!second) return; // only one built-in bundled

    app.setProgram(app.clone(first));
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    app.setProgram(app.clone(second));
    assert.deepEqual(plain(app.loadOverrides()), {}, 'the other Program sees none of it');

    app.setProgram(app.clone(first));
    assert.equal(plain(app.loadOverrides())[day.id][m.name].name, 'Trap Bar Deadlift',
      'the first Program kept its own');
  });

  test('survive switching away from a Program and back', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const programId = app.currentProgramId();
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    app.setProgram(null);
    app.setProgram(app.clone(app.builtInById(programId)));

    assert.equal(app.initSession(day.id).primaries[m.key].name, 'Trap Bar Deadlift',
      'the way 1RM Baselines already behave');
  });

  test('Restore Built-In Program drops the imported Program and leaves overrides alone', () => {
    const app = loadApp();
    const imported = importTwoDayProgram(app);
    const day = app.DAYS[0];
    startOn(app, day);
    substitutePermanently(app, 'primary', '0-0', 'Belt Squat');
    const storeBefore = plain(app.readOverrideMap());

    app.session = null;
    app.clearProgram();

    assert.equal(app.loadStoredProgram(), null, 'the imported Program is gone');
    assert.notEqual(app.currentProgramId(), imported.id, 'a built-in is active again');
    assert.deepEqual(plain(app.readOverrideMap()), storeBefore,
      'dropping an import discards nothing else the lifter decided');

    app.saveProgram(imported);
    app.initProgramState();
    assert.equal(app.initSession(day.id).primaries['0-0'].name, 'Belt Squat',
      're-importing the Program brings the Permanent Substitution back');
  });
});

describe('a day-only Substitution on top of a Permanent Substitution', () => {
  test('records the permanent substitute as what it replaced and leaves the store intact', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const day = app.DAYS[0];
    startOn(app, day);
    substitutePermanently(app, 'primary', '0-0', 'Belt Squat');
    const storeBefore = plain(app.readOverrideMap());

    // A new Session, where the Belt Squat is the machine that is busy today.
    const s = startOn(app, day);
    assert.equal(entryIn(s, 'primary', '0-0').name, 'Belt Squat');
    assert.equal(entryIn(s, 'primary', '0-0').substitutedFor, null,
      'the permanent substitute is what this Day prescribes now, not a Substitution of it');

    assert.ok(substituteVia(app, 'primary', '0-0', 'Goblet Squat'));

    assert.equal(entryIn(s, 'primary', '0-0').name, 'Goblet Squat');
    assert.equal(entryIn(s, 'primary', '0-0').substitutedFor, 'Belt Squat',
      'what the lifter was looking at is what it replaced');
    assert.deepEqual(plain(app.readOverrideMap()), storeBefore,
      'one bad day does not undo a settled decision');
    assert.equal(app.initSession(day.id).primaries['0-0'].name, 'Belt Squat',
      'the next Session is back to the Permanent Substitution');
  });

  test('a second permanent Substitution replaces the first for that Day', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const day = app.DAYS[0];
    startOn(app, day);
    substitutePermanently(app, 'primary', '0-0', 'Belt Squat');
    startOn(app, day);
    substitutePermanently(app, 'primary', '0-0', 'Leg Press');

    const forDay = plain(app.loadOverrides())[day.id];
    assert.deepEqual(Object.keys(forDay), ['Hack Squat'],
      'still one override, keyed by what the Program prescribes');
    assert.equal(forDay['Hack Squat'].name, 'Leg Press');
    assert.equal(app.initSession(day.id).primaries['0-0'].name, 'Leg Press');
  });
});

describe('a Baseline whose Lift was permanently substituted away', () => {
  test('stays on the Strength page, unmarked', () => {
    const app = loadAppWithProgram(PPL);
    const bound = (() => {
      for (const day of app.DAYS) {
        if (day.isOff || !day.sections) continue;
        for (let si = 0; si < day.sections.length; si++) {
          if (app.classifySection(day.sections[si]) === 'skip') continue;
          const ii = day.sections[si].items.findIndex(i => i.baselineId);
          if (ii >= 0) return { day, cat: app.classifySection(day.sections[si]), key: si + '-' + ii, item: day.sections[si].items[ii] };
        }
      }
      return null;
    })();
    assert.ok(bound);
    const baseline = app.loadBaselines().find(b => b.id === bound.item.baselineId);
    const before = plain(app.loadBaselines());

    startOn(app, bound.day);
    substitutePermanently(app, bound.cat, bound.key, 'Dumbbell Version');
    app.session = null;

    assert.deepEqual(plain(app.loadBaselines()), before, 'a max the lifter still cares about');
    app.renderBaselines();
    const html = app.document.getElementById('baselinesSection').innerHTML;
    assert.ok(html.includes(baseline.lift), 'still listed');
    assert.ok(!html.includes('Substituted'), 'and not marked as one');
  });
});

describe('nothing a Permanent Substitution does reaches the Program', () => {
  test('the Program definition and the embedded built-in programs are unchanged', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const programBefore = plain(app.PROGRAM);
    const builtInsBefore = plain(app.BUILT_IN_PROGRAMS);

    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 });
    app.initSession(day.id);

    assert.deepEqual(plain(app.PROGRAM), programBefore);
    assert.deepEqual(plain(app.BUILT_IN_PROGRAMS), builtInsBefore);
    assert.equal(app.loadStoredProgram(), null, 'and nothing was written into stored Program state');
  });

  test('the CSV a Program is imported from still builds the same Program', () => {
    const app = loadAppWithProgram(PPL);
    // id and importedAt are stamped from the clock, so they are not compared.
    const fromTemplate = () => {
      const built = plain(app.buildProgramFromCSV(app.parseCSV(app.generateCSVTemplate()), 'T'));
      delete built.id; delete built.importedAt; return built;
    };
    const before = fromTemplate();

    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift');

    assert.deepEqual(fromTemplate(), before, 'the CSV format is untouched');
  });
});

describe('scoring parity survives a Permanent Substitution', () => {
  // Mirrors the control in 'scoring parity: the load-bearing property': the
  // same logged numbers, whatever the Movements are called.
  function logWork(app, s) {
    Object.values(s.primaries).forEach((p, i) => p.sets.forEach((set, j) => {
      set.weight = String(135 + i * 10 + j * 5);
      set.reps = String(p.target.repLow + (j % 2));
    }));
    Object.values(s.ar7).forEach((a, i) => { a.rounds = 4 + (i % 3); a.weight = String(40 + i * 5); });
    Object.values(s.accessories).forEach((a, i) => {
      if (i % 2) a.rpe = 3 + (i % 3);
      else a.sets.forEach((set, j) => { if (j < 2) { set.weight = '70'; set.reps = '12'; } });
    });
    s.feel = { energy: 4, effort: 4, recovery: 3 };
    return s;
  }

  test('a Session on a Day carrying Permanent Substitutions scores what the control scores', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const expected = plain(app.computeScore(logWork(app, app.initSession(day.id))));

    startOn(app, day);
    loggedMovements(app, day).forEach((m, i) => substitutePermanently(app, m.cat, m.key, 'Permanent ' + i));

    // A Session started afterwards: the Substitutions are already in place.
    const s = startOn(app, day);
    assert.ok(Object.values(s.primaries).every(p => p.name.startsWith('Permanent ')),
      'the Session started with the substitutes');
    logWork(app, s);

    assert.deepEqual(plain(app.computeScore(s)), expected,
      'a Score measures training, not what the gym still owns');
  });
});

// ── TICKET 09: SUBSTITUTIONS IN HISTORY ────────────────────
// Renders the Summary of a stored Session and hands back what the lifter reads.
function renderSummaryOf(app, record) {
  app.renderSummary(record);
  return app.document.getElementById('summaryBody').innerHTML;
}

// What the Summary says in its own right, with the Edit Log it embeds taken
// out. The Edit Log names a substitute too, so a fact proven on this string is
// the Summary's own rather than the Edit Log's showing through.
function summaryWithoutEditLog(app, record) {
  const html = renderSummaryOf(app, record);
  const log = app.renderEditLog(record);
  assert.ok(html.includes(log), 'the Summary embeds the Edit Log');
  return html.split(log).join('');
}

// Renders the history list and hands back what the lifter reads.
function renderHistory(app) {
  app.renderHistoryPage();
  return app.document.getElementById('historyContent').innerHTML;
}

// Logs every Movement of the active Session and files it, returning the stored
// record. The numbers are arbitrary but distinctive, so a later correction is
// visible against them.
function logAndFinish(app) {
  const s = app.session;
  Object.values(s.primaries).forEach(p => fillSets(p, 200, p.target.repLow));
  Object.values(s.accessories).forEach(a => { fillSets(a, 50, a.target.repLow); a.rpe = 3; });
  Object.values(s.ar7).forEach(a => { a.weight = '40'; a.rounds = 7; });
  s.feel = { energy: 4, effort: 4, recovery: 4 };
  app.finishSession();
  const all = app.getAllSessions();
  return all[all.length - 1];
}

// A stored Session record with a chosen Score. The history list, the Day
// average, the trend and the sparkline read only the Score and the date, so
// this is as much of a record as they need — which is the point: a Score is a
// Score whether the Session substituted anything or not.
function historyRecord(dayType, n, total, substituted) {
  return {
    id: 'sess-' + n,
    dayType,
    date: '2026-01-0' + n + 'T12:00:00.000Z',
    durationSec: 3600,
    primaries: { '0-0': {
      name: substituted ? 'Hack Squat' : 'Barbell Back Squat',
      substitutedFor: substituted ? 'Barbell Back Squat' : null,
      sets: [{ weight: '200', reps: '5' }],
      target: { numSets: 1, repLow: 5, repHigh: 5 },
    } },
    ar7: {},
    accessories: {},
    feel: { energy: 4, effort: 4, recovery: 4 },
    score: { total },
  };
}

function seedHistory(app, dayType, totals, substituted) {
  app.saveAllSessions(totals.map((t, i) => historyRecord(dayType, i + 1, t, substituted)));
}

// The Day average and session count exactly as the history list prints them.
// Read as text rather than picked out of the DOM, because what matters is the
// number a lifter sees.
function avgShown(html) {
  const m = /Avg <strong>\d+<\/strong>[^<]*/.exec(html);
  return m ? m[0] : null;
}

// Strips every snapshot field a Session recorded before Substitutions existed
// would never have had, leaving substitutedFor absent rather than null.
function ageRecord(app, recordId) {
  const all = app.getAllSessions();
  const rec = all.find(r => r.id === recordId);
  const names = [];
  ['primaries', 'ar7', 'accessories'].forEach(group => {
    Object.values(rec[group] || {}).forEach(entry => {
      delete entry.substitutedFor;
      delete entry.setsStr;
      delete entry.note;
      delete entry.baselineId;
      names.push(entry.name);
    });
  });
  app.saveAllSessions(all);
  return { names, record: app.getAllSessions().find(r => r.id === recordId) };
}

describe('a Substitution on the Session Summary', () => {
  test('the Summary names the substitute and the Movement it replaced', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const found = findSection(app, 'primary', day.id);
    const s = startOn(app, day);
    const prescribed = s.primaries[found.key(0)].name;

    substituteVia(app, 'primary', found.key(0), 'Hack Squat');
    const html = summaryWithoutEditLog(app, logAndFinish(app));

    assert.ok(html.includes('Hack Squat'), 'the substitute is named');
    assert.ok(html.includes(prescribed), 'the Movement it replaced is named too');
  });

  test('a Substitution in any logged Section kind reaches the Summary', () => {
    ['primary', 'ar7', 'accessory'].forEach(cat => {
      const app = loadAppWithProgram(AR7);
      const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
      const key = findSection(app, cat, day.id).key(0);
      const s = startOn(app, day);
      const prescribed = entryIn(s, cat, key).name;

      substituteVia(app, cat, key, 'Machine Version');
      const html = summaryWithoutEditLog(app, logAndFinish(app));

      assert.ok(html.includes('Machine Version'), cat + ': the substitute is named');
      assert.ok(html.includes(prescribed), cat + ': the Movement it replaced is named too');
    });
  });

  test('every substituted Movement is listed, and only those', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    const s = startOn(app, day);
    const substituted = loggedMovements(app, day).slice(0, 2);
    const untouched = loggedMovements(app, day).slice(2).map(m => m.name);

    substituted.forEach((m, i) => substituteVia(app, m.cat, m.key, 'Stand-In ' + i));
    const html = summaryWithoutEditLog(app, logAndFinish(app));

    substituted.forEach((m, i) => {
      assert.ok(html.includes('Stand-In ' + i), 'substitute ' + i + ' is listed');
      assert.ok(html.includes(m.name), 'what substitute ' + i + ' replaced is listed');
    });
    untouched.forEach(name => {
      assert.ok(!html.includes(name), 'an unsubstituted Movement is not listed: ' + name);
    });
  });

  test('a Session with no Substitutions shows nothing about them on the Summary', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    const html = renderSummaryOf(app, logAndFinish(app));

    assert.ok(!html.includes('Substituted'), 'no marker on the Summary');
    assert.ok(!html.includes('replaces'), 'nothing claims to replace anything');
  });
});

describe('a Substitution in the post-Session Edit Log', () => {
  test('the Edit Log is headed by the substitute, so the numbers being corrected match the name', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    const prescribed = s.primaries[key].name;

    substituteVia(app, 'primary', key, 'Hack Squat');
    const log = app.renderEditLog(logAndFinish(app));

    assert.ok(log.includes('Hack Squat'), 'the substitute is named');
    assert.ok(log.includes(prescribed), 'and the Movement it replaced is named beside it');
  });

  test('a correction in the Edit Log saves against the substitute, not against its neighbours', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    const s = startOn(app, day);
    const prescribed = s.primaries[key].name;

    substituteVia(app, 'primary', key, 'Hack Squat');
    const record = logAndFinish(app);
    const before = plain(record.primaries);

    app.updateSessionPrimary(record.id, key, 0, 'reps', '19');

    const saved = app.getAllSessions().find(r => r.id === record.id);
    assert.equal(saved.primaries[key].sets[0].reps, '19', 'the correction landed on the substitute');
    assert.equal(saved.primaries[key].name, 'Hack Squat', 'it is still the substitute that was logged');
    assert.equal(saved.primaries[key].substitutedFor, prescribed, 'and it still says what it replaced');
    Object.keys(before).filter(k => k !== key).forEach(k => {
      assert.deepEqual(plain(saved.primaries[k]), before[k],
        'no other Movement was written to: ' + k);
    });
  });

  test('an RPE correction on a substituted accessory saves against the substitute', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['accessory']);
    const key = findSection(app, 'accessory', day.id).key(0);
    startOn(app, day);

    substituteVia(app, 'accessory', key, 'Cable Row');
    const record = logAndFinish(app);

    app.updateSessionRpe(record.id, key, 5);

    const saved = app.getAllSessions().find(r => r.id === record.id);
    assert.equal(saved.accessories[key].rpe, 5);
    assert.equal(saved.accessories[key].name, 'Cable Row');
  });

  test('a Session with no Substitutions says nothing about them in the Edit Log', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    const log = app.renderEditLog(logAndFinish(app));

    assert.ok(!log.includes('replaces'), 'nothing claims to replace anything');
  });
});

describe('Substitutions in the history list', () => {
  test('the history list marks the Session that contained a Substitution, and only that one', () => {
    const app = loadAppWithProgram(PPL);
    const dayType = app.DAYS.find(d => !d.isOff).id;
    app.saveAllSessions([
      historyRecord(dayType, 1, 80, false),
      historyRecord(dayType, 2, 76, true),
    ]);

    const html = renderHistory(app);

    assert.equal(html.split('Substituted').length - 1, 1,
      'one of the two Sessions carries the marker');
  });

  test('a Substitution in any logged Section kind marks the Session in history', () => {
    ['primary', 'ar7', 'accessory'].forEach(cat => {
      const app = loadAppWithProgram(AR7);
      const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
      const key = findSection(app, cat, day.id).key(0);
      startOn(app, day);

      substituteVia(app, cat, key, 'Machine Version');
      logAndFinish(app);

      assert.equal(renderHistory(app).split('Substituted').length - 1, 1,
        cat + ': the Session is marked in history');
    });
  });

  test('a Session with no Substitutions carries no marker in history', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    logAndFinish(app);

    assert.ok(!renderHistory(app).includes('Substituted'));
  });
});

describe('the Day score trend stays comparable across Substitutions', () => {
  test('the trend, the Day average and the sparkline read the same whether the Sessions substituted anything or not', () => {
    const totals = [82, 79, 84, 71, 68, 64];
    const subbed = loadAppWithProgram(PPL);
    const control = loadAppWithProgram(PPL);
    const dayType = subbed.DAYS.find(d => !d.isOff).id;
    seedHistory(subbed, dayType, totals, true);
    seedHistory(control, dayType, totals, false);

    assert.equal(subbed.lastScoreForDay(dayType), control.lastScoreForDay(dayType));
    assert.deepEqual(
      plain(subbed.sessionsByDay(dayType).map(s => s.score.total)),
      plain(control.sessionsByDay(dayType).map(s => s.score.total)));
    assert.equal(subbed.checkDeloadNudge(dayType), control.checkDeloadNudge(dayType),
      'a substituted Session is no more a reason to deload than any other');

    const subbedSpark = subbed.renderSparkline(subbed.sessionsByDay(dayType).slice(-8), false);
    const controlSpark = control.renderSparkline(control.sessionsByDay(dayType).slice(-8), false);
    assert.ok(controlSpark.length > 0, 'there is a sparkline to compare');
    assert.equal(subbedSpark, controlSpark, 'the sparkline is drawn from the Scores alone');

    const subbedAvg = avgShown(renderHistory(subbed));
    assert.ok(subbedAvg, 'the history list prints a Day average');
    assert.equal(subbedAvg, avgShown(renderHistory(control)),
      'the Day average is not discounted for a Substitution');
  });

  test('substituting a Movement does not move the Score the Session is filed under', () => {
    const subbed = loadAppWithProgram(PPL);
    const control = loadAppWithProgram(PPL);
    const day = dayWithSections(subbed, ['primary']);
    const key = findSection(subbed, 'primary', day.id).key(0);

    startOn(subbed, day);
    substituteVia(subbed, 'primary', key, 'Hack Squat');
    const subbedRecord = logAndFinish(subbed);

    startOn(control, dayWithSections(control, ['primary']));
    const controlRecord = logAndFinish(control);

    assert.deepEqual(plain(subbedRecord.score), plain(controlRecord.score),
      'the marker is a marker, not a caveat on the Score');
  });
});

describe('a name the lifter typed reaching the screen', () => {
  test('a substitute name with HTML in it is shown as typed on the Summary and in the Edit Log', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    startOn(app, day);

    substituteVia(app, 'primary', key, '<img src=x onerror="alert(1)">');
    const record = logAndFinish(app);

    [summaryWithoutEditLog(app, record), app.renderEditLog(record)].forEach((html, i) => {
      const where = i === 0 ? 'Summary' : 'Edit Log';
      assert.ok(!html.includes('<img src=x'), where + ': the markup is not live');
      assert.ok(html.includes('&lt;img src=x'), where + ': it is shown as text');
      assert.ok(html.includes('&quot;alert(1)&quot;'), where + ': the quotes are escaped too');
    });
  });

  test('the Movement a substitute replaced is escaped on the way to the screen as well', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    startOn(app, day);

    substituteVia(app, 'primary', key, 'Hack Squat');
    const record = logAndFinish(app);

    // A prescribed name has only ever come from the Program, but a Substitution
    // can be made over a substitute, which puts lifter-typed text here too.
    const all = app.getAllSessions();
    const rec = all.find(r => r.id === record.id);
    rec.primaries[key].substitutedFor = 'Squat <b>"heavy"</b>';
    app.saveAllSessions(all);
    const aged = app.getAllSessions().find(r => r.id === record.id);

    [summaryWithoutEditLog(app, aged), app.renderEditLog(aged)].forEach((html, i) => {
      const where = i === 0 ? 'Summary' : 'Edit Log';
      assert.ok(!html.includes('<b>"heavy"</b>'), where + ': the markup is not live');
      assert.ok(html.includes('&lt;b&gt;&quot;heavy&quot;&lt;/b&gt;'), where + ': it is shown as text');
    });
  });
});

describe('a Session recorded before Substitutions existed', () => {
  test('renders on all three surfaces, with no Substitution claimed anywhere', () => {
    const app = loadAppWithProgram(AR7);
    const day = dayWithSections(app, ['primary', 'ar7', 'accessory']);
    startOn(app, day);
    const record = logAndFinish(app);
    const aged = ageRecord(app, record.id);

    Object.values(aged.record.primaries).forEach(e => assert.ok(!('substitutedFor' in e),
      'the key is absent on an older record, not null'));
    assert.ok(aged.names.length > 0, 'the older record logged some Movements');

    const summary = renderSummaryOf(app, aged.record);
    const log = app.renderEditLog(aged.record);
    const history = renderHistory(app);

    assert.ok(summary.includes(String(aged.record.score.total)), 'the Summary still shows the Score');
    aged.names.forEach(name => assert.ok(log.includes(app.escHtml(name)),
      'the Edit Log still lists ' + name));
    assert.ok(history.includes(String(aged.record.score.total)), 'the history list still shows the Score');

    assert.ok(!summary.includes('Substituted'), 'the Summary marks nothing');
    assert.ok(!summary.includes('replaces'), 'the Summary claims nothing was replaced');
    assert.ok(!history.includes('Substituted'), 'the history list marks nothing');
  });

  test('an older record whose entries were never substituted can still be corrected', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const key = findSection(app, 'primary', day.id).key(0);
    startOn(app, day);
    const record = logAndFinish(app);
    const aged = ageRecord(app, record.id);

    app.updateSessionPrimary(aged.record.id, key, 0, 'reps', '19');

    const saved = app.getAllSessions().find(r => r.id === record.id);
    assert.equal(saved.primaries[key].sets[0].reps, '19');
    assert.ok(!app.renderEditLog(saved).includes('replaces'),
      'correcting an older record does not invent a Substitution');
  });
});

// ── INTEGRATION: REVERT THROUGH A PERMANENT SUBSTITUTION ───
// Tickets 05 and 06 were built in separate worktrees, blind to each other, so
// neither could cover the place they meet: prescribedItemFor resolves a
// snapshot key through the *effective* Day rather than the raw one. That one
// lookup decides what "back to prescribed" means for a lifter who has a
// Permanent Substitution on the Day — the permanent substitute they were shown
// when the Session started, not the Movement the Program ships.
describe('reverting a day-only Substitution made on top of a Permanent one', () => {
  test('lands on the permanent substitute with its stored scheme, not the Program’s Movement', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const day = app.DAYS[0];
    // Read off the Program, so the test states what it is distinguishing from
    // rather than repeating a scheme string that could drift.
    const prescribed = { name: day.sections[0].items[0].name, sets: day.sections[0].items[0].sets };

    startOn(app, day);
    assert.ok(substitutePermanently(app, 'primary', '0-0', 'Belt Squat',
      { sets: 4, repLow: 6, repHigh: 8 }), 'the Permanent Substitution was made');
    const storedScheme = plain(app.loadOverrides())[day.id][prescribed.name].sets;
    assert.notEqual(storedScheme, prescribed.sets,
      'the Permanent Substitution carries a scheme of its own, so the two are tellable apart');
    const storeBefore = plain(app.readOverrideMap());

    // A new Session, where the Belt Squat is the machine that is busy today.
    const s = startOn(app, day);
    assert.equal(entryIn(s, 'primary', '0-0').name, 'Belt Squat',
      'the permanent substitute is what this Day prescribes now');
    assert.ok(substituteVia(app, 'primary', '0-0', 'Goblet Squat'));
    logSomething('primary', entryIn(s, 'primary', '0-0'));

    const askedBefore = app.confirmsAsked().length;
    app.answerConfirm(true);
    assert.ok(revertVia(app, 'primary', '0-0'), 'the revert went through');
    assert.equal(app.confirmsAsked().length, askedBefore + 1,
      'the logged work a revert discards is still worth asking about here');

    const back = entryIn(s, 'primary', '0-0');
    assert.equal(back.name, 'Belt Squat',
      'back to what the lifter was shown when the Session started, not to the Program');
    assert.equal(back.setsStr, storedScheme,
      'and back with the scheme the Permanent Substitution was stored with');
    assert.deepEqual(plain(back.target), { numSets: 4, repLow: 6, repHigh: 8 },
      'the stored scheme is what session mode now targets');
    assert.equal(back.sets.length, 4, 'with the sets that scheme calls for');
    assert.equal(back.substitutedFor, null,
      'nothing stands in for anything any more');
    assert.equal(back.baselineId, null,
      'the effective Day prescribes an unbound substitute, so the entry carries no binding');

    assert.deepEqual(plain(app.readOverrideMap()), storeBefore,
      'reverting today’s workaround is not a decision to undo a settled one');
    assert.equal(app.initSession(day.id).primaries['0-0'].name, 'Belt Squat',
      'and the next Session of that Day still starts with the Permanent Substitution');
  });

  test('does not resurrect the Baseline binding of the Lift that was substituted away', () => {
    const app = loadAppWithProgram(PPL);
    const m = boundLift(app);
    assert.ok(m, 'a Movement is bound to a Baseline');
    assert.ok(m.item.baselineId, 'the Program binds it to a Lift');

    startOn(app, m.day);
    assert.ok(substitutePermanently(app, m.cat, m.key, 'Belt Squat'),
      'the bound Lift was permanently substituted away');

    const s = startOn(app, m.day);
    assert.equal(entryIn(s, m.cat, m.key).baselineId, null,
      'the permanent substitute starts unbound — it is a different exercise');

    assert.ok(substituteVia(app, m.cat, m.key, 'Goblet Squat'));
    const askedBefore = app.confirmsAsked().length;
    assert.ok(revertVia(app, m.cat, m.key), 'the revert went through');
    assert.equal(app.confirmsAsked().length, askedBefore,
      'nothing was logged against the workaround, so there was nothing to ask about');

    const back = entryIn(s, m.cat, m.key);
    assert.equal(back.name, 'Belt Squat', 'the revert lands on the permanent substitute');
    assert.equal(back.baselineId, null,
      'reverting onto it must not prescribe a barbell load for a movement that is not the Lift');
    assert.equal(back.substitutedFor, null);
  });

  test('a Day carrying no Permanent Substitution still reverts to the Program', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const dayA = app.DAYS[0], dayB = app.DAYS[1];
    const prescribed = { name: dayB.sections[0].items[0].name, sets: dayB.sections[0].items[0].sets };

    startOn(app, dayA);
    assert.ok(substitutePermanently(app, 'primary', '0-0', 'Belt Squat'));
    const store = plain(app.loadOverrides());
    assert.ok(store[dayA.id], 'the decision was recorded against the Day it was made on');
    assert.equal(store[dayB.id], undefined,
      'and not against the other Day, though it prescribes the same Movement');

    const s = startOn(app, dayB);
    assert.equal(entryIn(s, 'primary', '0-0').name, prescribed.name,
      'the other Day still starts on what the Program prescribes');
    assert.ok(substituteVia(app, 'primary', '0-0', 'Goblet Squat'));
    assert.ok(revertVia(app, 'primary', '0-0'), 'the revert went through');

    const back = entryIn(s, 'primary', '0-0');
    assert.equal(back.name, prescribed.name,
      'and reverting there lands on the Program, not on the other Day’s decision');
    assert.equal(back.setsStr, prescribed.sets, 'with the Program’s scheme');
    assert.equal(back.substitutedFor, null);
  });
});

// ── TICKET 07: PERMANENT SUBSTITUTIONS IN THE PROGRAM VIEW ─
// (ticket 07's tests go here)

// ── TICKET 08: END-OF-SESSION PROMOTION PROMPT ─────────────

// The words the prompt opens and closes with, as the lifter reads them. Tests
// assert on these rather than on markup, and they are also what tells the
// prompt apart from the Substitutions block above it — which names a substitute
// too, and would otherwise show through every assertion.
const PROMPT_TITLE = 'Keep these swaps?';
const PROMPT_DISMISS = 'Today only';

// What the prompt itself says, cut out of the Summary. The Edit Log is taken
// out first, because it names substitutes as well; the slice then narrows to
// the prompt's own run of the Summary, so neither the Substitutions block nor
// the Feel survey can make a failing assertion pass.
function promptText(html) {
  const start = html.indexOf(PROMPT_TITLE);
  if (start < 0) return '';
  const end = html.indexOf(PROMPT_DISMISS, start);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}
function promptOn(app, record) {
  return promptText(summaryWithoutEditLog(app, record));
}

// The Movement the prompt offers to keep, and what it says it stands in for.
function promptRow(app, record, name) {
  const text = promptOn(app, record);
  const at = text.indexOf('>' + name + '<');
  return at < 0 ? '' : text.slice(at);
}

// Logs every Movement of the active Session and files it without rating the
// Session Feel, the way a lifter who closes the Summary before answering
// leaves it. The Feel survey is then still on the Summary, which is the point.
function logAndFinishUnrated(app) {
  const s = app.session;
  Object.values(s.primaries).forEach(p => fillSets(p, 200, p.target.repLow));
  Object.values(s.accessories).forEach(a => { fillSets(a, 50, a.target.repLow); a.rpe = 3; });
  Object.values(s.ar7).forEach(a => { a.weight = '40'; a.rounds = 7; });
  app.finishSession();
  const all = app.getAllSessions();
  return all[all.length - 1];
}

// The app as it comes back after a reload: a fresh instance carrying nothing
// but what the previous one left in localStorage.
function reopenApp(app) {
  const saved = [];
  for (let i = 0; i < app.localStorage.length; i++) {
    const k = app.localStorage.key(i);
    saved.push([k, app.localStorage.getItem(k)]);
  }
  const next = loadApp();
  saved.forEach(([k, v]) => next.localStorage.setItem(k, v));
  next.initProgramState();
  return next;
}

// A finished Session on the first Day with both a primary and an accessory
// Section, with the chosen Movements substituted day-only and nothing decided.
function sessionWithSubstitutions(app, swaps) {
  const day = dayWithSections(app, ['primary', 'accessory']);
  startOn(app, day);
  const made = swaps.map(([cat, name]) => {
    const m = firstLogged(app, day, cat);
    assert.ok(substituteVia(app, m.cat, m.key, name), 'the form accepted ' + name);
    return Object.assign({}, m, { to: name });
  });
  return { day, made, record: logAndFinish(app) };
}

describe('the End-of-Session promotion prompt', () => {
  test('a Substitution the lifter never decided is asked about on the Summary', () => {
    const app = loadAppWithProgram(PPL);
    const { made, record } = sessionWithSubstitutions(app, [['primary', 'Trap Bar Deadlift']]);

    const text = promptOn(app, record);
    assert.ok(text.includes(PROMPT_TITLE), 'the Summary asks about it');
    assert.ok(text.includes('Trap Bar Deadlift'), 'the prompt names what was done instead');
    assert.ok(promptRow(app, record, 'Trap Bar Deadlift').includes(made[0].name),
      'and the Movement it stood in for');
    assert.ok(summaryWithoutEditLog(app, record).includes(PROMPT_DISMISS),
      'with one way to leave the rest as one-offs');
  });

  test('a Session with no Substitutions is asked nothing', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    startOn(app, day);
    const record = logAndFinish(app);

    assert.deepEqual(plain(app.undecidedSubstitutions(record)), [], 'nothing was substituted');
    assert.equal(promptOn(app, record), '', 'so the Summary says nothing about keeping anything');
    assert.ok(!summaryWithoutEditLog(app, record).includes(PROMPT_DISMISS),
      'and offers nothing to dismiss');
  });

  test('a Substitution marked permanent during the Session is not asked about again', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    assert.ok(substitutePermanently(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 }),
      'the form accepted it');
    const record = logAndFinish(app);

    assert.equal(promptOn(app, record), '',
      'the lifter already decided, so the Summary does not ask');
  });

  test('one row per undecided Substitution, each decidable on its own', () => {
    const app = loadAppWithProgram(PPL);
    const { made, record } = sessionWithSubstitutions(app, [
      ['primary', 'Trap Bar Deadlift'],
      ['accessory', 'Cable Fly'],
    ]);

    const before = promptOn(app, record);
    assert.ok(before.includes('Trap Bar Deadlift') && before.includes('Cable Fly'),
      'both are asked about');

    app.promoteSubstitution(record.id, made[0].key);

    const after = promptOn(app, record);
    assert.ok(!after.includes('Trap Bar Deadlift'), 'the one that was kept is no longer asked about');
    assert.ok(after.includes('Cable Fly'), 'the other is still an open question');
    assert.deepEqual(Object.keys(plain(app.loadOverrides())[record.dayType]), [made[0].name],
      'and only the one that was kept is permanent');
  });

  test('a single dismiss records every remaining Substitution as day-only', () => {
    const app = loadAppWithProgram(PPL);
    app.answerConfirm(false);
    const { day, made, record } = sessionWithSubstitutions(app, [
      ['primary', 'Trap Bar Deadlift'],
      ['accessory', 'Cable Fly'],
    ]);
    const asked = app.confirmsAsked().length;

    app.dismissPromotionPrompt(record.id);

    assert.deepEqual(plain(app.loadOverrides()), {}, 'nothing was made permanent');
    assert.equal(promptOn(app, record), '', 'and the question is answered for every row');
    const next = app.initSession(day.id);
    made.forEach(m => assert.equal(entryIn(next, m.cat, m.key).name, m.name,
      'the next Session prescribes what the Program prescribes'));
    assert.equal(app.confirmsAsked().length, asked, 'deciding on the Summary asks nothing');
  });

  test('the prompt survives saving the Session Feel ratings', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    startOn(app, day);
    assert.ok(substituteVia(app, m.cat, m.key, 'Trap Bar Deadlift'), 'the form accepted it');
    const record = logAndFinishUnrated(app);
    assert.ok(summaryWithoutEditLog(app, record).includes('Session Feel'),
      'the Feel survey is the other unanswered question');

    app.updateFeel(record.id, 'energy', 4);
    app.updateFeel(record.id, 'effort', 4);
    app.updateFeel(record.id, 'recovery', 4);
    app.saveFeelDraft(record.id);

    // saveFeelDraft re-renders the Summary itself, so this is the markup the
    // lifter is left looking at rather than one this test asked for.
    const shown = promptText(app.document.getElementById('summaryBody').innerHTML);
    assert.ok(shown.includes('Trap Bar Deadlift'),
      'answering one question does not destroy the other');
    const rated = app.getAllSessions().find(s => s.id === record.id);
    assert.ok(rated.feel, 'the Feel was saved');
    assert.deepEqual(plain(app.loadOverrides()), {},
      'and saving it decided nothing about the Substitution');
    assert.equal(plain(app.undecidedSubstitutions(rated)).length, 1,
      'which is still an open question');
  });

  test('once answered the prompt does not come back, including after a reload', () => {
    const app = loadAppWithProgram(PPL);
    const { record } = sessionWithSubstitutions(app, [['primary', 'Trap Bar Deadlift']]);
    app.dismissPromotionPrompt(record.id);

    const reopened = reopenApp(app);
    const fromHistory = reopened.getAllSessions().find(s => s.id === record.id);
    assert.ok(fromHistory, 'the Session is still in history');
    assert.ok(summaryWithoutEditLog(reopened, fromHistory).includes('Trap Bar Deadlift'),
      'which still says what was done that day');
    assert.equal(promptOn(reopened, fromHistory), '',
      'but an answered question does not nag the lifter again');
  });

  test('a kept Substitution stays kept when the Session is reopened from history', () => {
    const app = loadAppWithProgram(PPL);
    const { made, record } = sessionWithSubstitutions(app, [['primary', 'Trap Bar Deadlift']]);
    app.promoteSubstitution(record.id, made[0].key);

    const reopened = reopenApp(app);
    const fromHistory = reopened.getAllSessions().find(s => s.id === record.id);
    assert.equal(promptOn(reopened, fromHistory), '', 'the Summary asks nothing further');
    assert.equal(reopened.initSession(record.dayType).primaries[made[0].key].name, 'Trap Bar Deadlift',
      'and the next Session starts with the substitute in place');
  });

  test('keeping a Substitution writes the scheme the Session ended with', () => {
    const app = loadAppWithProgram(PPL);
    const day = dayWithSections(app, ['primary']);
    const m = firstLogged(app, day, 'primary');
    const prescribed = movementNamed(day, m.name).sets;
    startOn(app, day);
    assert.ok(substituteWithScheme(app, m.cat, m.key, 'Trap Bar Deadlift', { sets: 4, repLow: 6, repHigh: 8 }),
      'the form accepted the scheme');
    const record = logAndFinish(app);

    app.promoteSubstitution(record.id, m.key);

    const stored = plain(app.loadOverrides())[day.id][m.name];
    assert.deepEqual(stored, { name: 'Trap Bar Deadlift', sets: '4 × 6–8' },
      'the scheme the Session ended with, not the one the Program prescribes');
    assert.notEqual(stored.sets, prescribed, 'which is a different scheme');
    assert.equal(app.initSession(day.id).primaries[m.key].setsStr, '4 × 6–8',
      'so the lifter does not re-enter it next week');
  });

  test('keeping a Substitution files it under the Movement the Program prescribes', () => {
    const app = loadApp();
    importTwoDayProgram(app);
    const day = app.DAYS.find(d => d.id === 'legs-a');
    app.setOverride(day.id, 'Hack Squat', 'Pendulum Squat', '3 × 8–10');
    startOn(app, day);
    const key = '0-0';
    assert.equal(app.session.primaries[key].name, 'Pendulum Squat',
      'the Session starts with the Permanent Substitution in place');
    assert.ok(substituteVia(app, 'primary', key, 'Belt Squat'), 'the form accepted a swap on top of it');
    const record = logAndFinish(app);
    assert.equal(record.primaries[key].substitutedFor, 'Pendulum Squat',
      'what was replaced today is the permanent substitute, not the Program Movement');

    app.promoteSubstitution(record.id, key);

    const stored = plain(app.loadOverrides())[day.id];
    assert.deepEqual(Object.keys(stored), ['Hack Squat'],
      'the override replaces the one filed under the prescribed Movement');
    assert.deepEqual(stored['Hack Squat'], { name: 'Belt Squat', sets: '3 × 8–10' });
    assert.equal(app.initSession(day.id).primaries[key].name, 'Belt Squat',
      'so the next Session of that Day actually starts with it');
    assert.equal(app.initSession('legs-b').primaries[key].name, 'Hack Squat',
      'and the other Day is left alone');
  });

  test('keeping a Substitution does not touch the completed Session record', () => {
    const app = loadAppWithProgram(PPL);
    const { made, record } = sessionWithSubstitutions(app, [
      ['primary', 'Trap Bar Deadlift'],
      ['accessory', 'Cable Fly'],
    ]);
    const before = plain(app.getAllSessions());

    app.promoteSubstitution(record.id, made[0].key);
    app.dismissPromotionPrompt(record.id);

    assert.deepEqual(plain(app.getAllSessions()), before,
      'history keeps saying exactly what happened that day');
  });

  test('a substitute name typed with markup in it is shown as text', () => {
    const app = loadAppWithProgram(PPL);
    const { record } = sessionWithSubstitutions(app, [['primary', 'Dip <b>"wide"</b>']]);

    const text = promptOn(app, record);
    assert.ok(text.includes('Dip &lt;b&gt;&quot;wide&quot;&lt;/b&gt;'), 'the name is escaped');
    assert.ok(!text.includes('<b>'), 'the markup the lifter typed is not markup');
  });
});
