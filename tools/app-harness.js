// Loads the app's logic into a node context so its behaviour can be tested.
//
// The app is one offline HTML file whose script is wrapped in an IIFE, so
// nothing inside it is reachable from outside. Rather than adding a test hook
// to what ships, this harness does the unwrapping itself: it reads index.html,
// extracts the inline script, strips the IIFE wrapper, drops the init tail that
// drives the DOM, and evaluates the rest in a `vm` context with stubs standing
// in for the browser. An appended epilogue hands the tests the functions and
// state they need.
//
// Nothing here ships. index.html is never written to.
//
// Used by tools/test-app.js. See tools/embed-program.js for the other script
// that validates the app without being part of it.
//
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
// APPARATUS_HTML runs the suite against another copy of the app, which is how a
// change is checked against the build before it.
const HTML = process.env.APPARATUS_HTML || path.join(ROOT, 'index.html');

// The shape of index.html that this harness relies on. If any of these stop
// matching, fail loudly here rather than somewhere confusing downstream.
const SCRIPT_OPEN = '<script>';
const SCRIPT_CLOSE = '</script>';
const WRAPPER = /^\s*\(function\(\)\s*\{\s*'use strict';\s*try\s*\{/;
const INIT_MARKER = /^\/\/ ── INIT /m;

function extractScript(html) {
  // More than one inline script is normal: a small bootstrap in <head> applies
  // a saved Light/Dark choice before the first paint, so the app is no longer
  // the only <script> in the file. The app is therefore identified by its own
  // shape — the one inline script whose body opens with the IIFE + 'use
  // strict' + try wrapper — and exactly one script must answer to that.
  // Picking the largest or the last script instead would quietly extract
  // whatever else lands in the file next, which is the confusion this
  // assertion exists to prevent.
  const bodies = [];
  for (let from = 0; ; ) {
    const open = html.indexOf(SCRIPT_OPEN, from);
    if (open === -1) break;
    const bodyAt = open + SCRIPT_OPEN.length;
    const close = html.indexOf(SCRIPT_CLOSE, bodyAt);
    if (close === -1) {
      throw new Error('app-harness: an inline <script> in index.html is never closed');
    }
    bodies.push(html.slice(bodyAt, close));
    from = close + SCRIPT_CLOSE.length;
  }
  const app = bodies.filter(body => WRAPPER.test(body));
  if (app.length !== 1) {
    throw new Error('app-harness: expected exactly 1 inline <script> in index.html whose ' +
      'body opens with the app\'s IIFE + try wrapper, found ' + app.length +
      ' (of ' + bodies.length + ' inline script(s))');
  }
  return app[0];
}

function unwrap(script) {
  const m = script.match(WRAPPER);
  if (!m) {
    throw new Error('app-harness: the script in index.html no longer opens with the expected IIFE + try wrapper');
  }
  const body = script.slice(m[0].length);
  const init = body.match(INIT_MARKER);
  if (!init) {
    throw new Error('app-harness: could not find the INIT section marker in index.html');
  }
  // Everything from INIT onwards drives the DOM and the service worker. Tests
  // set up program state explicitly instead, via the returned setProgram.
  return body.slice(0, init.index);
}

// ── BROWSER STUBS ──────────────────────────────────────────
// Only enough of a browser for the app's top-level wiring to evaluate without
// throwing. Tests exercise logic, not the DOM.
function makeElement(id) {
  const classes = new Set();
  const el = {
    id,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    offsetHeight: 0,
    files: [],
    classList: {
      add(...c) { c.forEach(x => classes.add(x)); },
      remove(...c) { c.forEach(x => classes.delete(x)); },
      toggle(c, on) {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
      contains(c) { return classes.has(c); },
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }; },
    // A bare tag the element's own markup contains comes back as an element,
    // so code that builds markup and wires up a child (the Undo toast's
    // button) can run. Anything else is still missing, as before.
    querySelector(sel) { return /^[a-z]+$/.test(sel) && el.innerHTML.includes('<' + sel) ? makeElement(sel) : null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    appendChild() {},
    removeChild() {},
    remove() {},
    replaceWith() {},
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    setAttribute() {},
    getAttribute() { return null; },
  };
  el.parentElement = el;
  return el;
}

function makeDocument() {
  const byId = new Map();
  return {
    // Memoized so classList state stays coherent across lookups of one id.
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeElement(id));
      return byId.get(id);
    },
    querySelector(sel) { return makeElement(sel); },
    querySelectorAll() { return []; },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeElement('html'),
    body: makeElement('body'),
  };
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); },
    key(i) { const keys = Array.from(store.keys()); return i < keys.length ? keys[i] : null; },
    get length() { return store.size; },
  };
}

class FakeAudioContext {
  constructor() { this.destination = {}; }
  get currentTime() { return 0; }
  createOscillator() {
    return { connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' };
  }
  createGain() {
    return {
      connect() {},
      gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
    };
  }
}

// Names the tests reach for. A name the app does not define comes back
// undefined rather than throwing, so the suite can be pointed at an older build
// for comparison; REQUIRED below is what must be there for a run to mean
// anything, so a rename in the app still fails loudly instead of silently
// skipping tests.
const EXPORTS = [
  'classifySection', 'parseSetsStr', 'initSession',
  'scorePrimary', 'scoreAr7', 'scoreAccessory', 'scoreFeel', 'computeScore',
  'gradeLabel', 'diagnosticLine',
  'getAllSessions', 'saveAllSessions', 'addSessionRecord', 'sessionsByDay', 'lastScoreForDay',
  'SESSION_CAP',
  'saveDraft', 'loadDraft', 'clearDraft',
  'loadStoredProgram', 'saveProgram', 'clearProgram', 'clone', 'currentProgramId',
  'builtInById', 'selectedBuiltIn', 'initProgramState',
  'readBaselineMap', 'loadBaselines', 'saveBaselines',
  'calcOrm', 'repToPercent', 'getSuggestedWeight', 'weightHintHtml',
  'baselineFor', 'displaySets', 'workingRange',
  'sessionItem', 'prInfo',
  // window.-assigned, so it needs naming here; the bw flag is only reachable
  // through it the way a lifter reaches it, which is what a test wanting the
  // stored per-name preference written as a side effect has to drive.
  'isBodyweight', 'toggleBodyweight',
  'parseCSV', 'buildProgramFromCSV', 'slugify',
  'renderSessionMode', 'renderSummary', 'renderEditLog', 'render',
  'snapshotAsMovement', 'backfillSnapshot', 'escHtml',
  'substituteEntry', 'entryFor', 'openSubstituteModal', 'closeSubstituteModal',
  'saveSubstitution', 'SUB_NAME_MAX', 'SUB_SETS_MAX',
  'repRangeOf', 'rewriteScheme', 'setsLostBy', 'resizeSets', 'applyScheme',
  'renderHistoryPage', 'renderSparkline', 'checkDeloadNudge',
  'updateSessionPrimary', 'updateSessionAr7Weight', 'updateSessionAr7Rounds',
  'updateSessionAccessory', 'updateSessionRpe',
  'readOverrideMap', 'loadOverrides', 'saveOverrides', 'setOverride',
  'prescribedNameAt', 'effectiveDay',
  'undecidedSubstitutions', 'promoteSubstitution', 'dismissPromotionPrompt',
  'updateFeel', 'saveFeelDraft',
  'generateCSVTemplate', 'renderBaselines',
  'exportBackup', 'restoreBackup', 'handleProgramFile',
  'decisionsFor', 'LS_SUB_DECISIONS', 'LS_OVERRIDES', 'LS_SESSIONS',
  'prescribedItemFor', 'loggedValuesIn', 'revertEntry', 'revertSubstitution',
  'removeOverride', 'revertPermanentSubstitution', 'revertPermanentHere',
  'renderProgPage', 'renderOffDays',
  // Navigation, so a test can leave a view open behind the Summary and come back.
  'openProgPage', 'closeProgPage', 'closeSummary', 'switchDay',
  'showHistoryPage', 'openSessionSummary',
  'deleteSession', 'undoDeleteSession', 'finishUndo',
  'startSession', 'finishSession', 'discardSession', 'resumeSession',
  'BUILT_IN_PROGRAMS',
];

// Without these the app is not the app, and a run would prove nothing.
const REQUIRED = [
  'classifySection', 'parseSetsStr', 'initSession', 'computeScore',
  'renderSessionMode', 'loadBaselines', 'BUILT_IN_PROGRAMS',
];

const EPILOGUE = [
  'globalThis.__apparatus = {',
  EXPORTS.map(n => '  ' + n + ': (typeof ' + n + ' === "undefined" ? undefined : ' + n + '),').join('\n'),
  '  // Program state lives in the scope of the script, so reads and writes go',
  '  // through these rather than being poked at from outside.',
  '  setProgram(p) { PROGRAM = p; DAYS = p ? (p.days || []) : []; BASELINES = p ? (p.baselines || []) : []; },',
  '  get PROGRAM() { return PROGRAM; },',
  '  get DAYS() { return DAYS; },',
  '  get BASELINES() { return BASELINES; },',
  '  get session() { return session; },',
  '  set session(v) { session = v; },',
  '  get activeDay() { return activeDay; },',
  '  set activeDay(v) { activeDay = v; },',
  '};',
].join('\n');

// Loads a fresh copy of the logic in the app, with its own localStorage. Each
// test that cares about persistence calls this, so state cannot leak between
// tests. htmlPath loads some other copy of the app instead of the working one,
// which is how a render is compared against a reference build.
function loadApp(htmlPath) {
  const html = fs.readFileSync(htmlPath || HTML, 'utf8');
  // The app asks before throwing away logged work. Tests drive both answers,
  // and can read back what the lifter would have been asked.
  const prompts = { answer: true, asked: [] };
  const source = unwrap(extractScript(html)) + '\n' + EPILOGUE + '\n';

  const localStorage = makeLocalStorage();

  // A clock that only ever goes forward, and does it in hour-long strides.
  //
  // The Summary's Score count-up reads performance.now() to start, then
  // re-queues itself through requestAnimationFrame until the elapsed
  // fraction reaches 1. No test wants the frames in between — they assert on
  // the Summary's final rendered content — so the frame after the one that
  // starts an animation should already be past its duration. An hour a
  // reading guarantees that for any duration the app could plausibly use:
  // the count-up paints its first frame, then its last, and stops. A clock
  // that stood still would leave it re-queueing for ever, holding the
  // process open past the end of the run.
  let clockMs = 0;
  const now = () => (clockMs += 3.6e6);

  // Files the app hands the browser to save, and files the lifter hands it to
  // read. A download goes through a Blob and URL.createObjectURL, so the Blob
  // keeps its text where a test can read it synchronously, and the object URL
  // records it. A file chosen for import is read with FileReader, which here
  // delivers a file's text straight to onload: the app reads nothing after
  // readAsText, so firing synchronously changes no order the app relies on.
  // reload() is counted, because restoring a backup ends in one and a test
  // then has to load the app again from what was left in storage.
  const downloads = [];
  let reloads = 0;
  class HarnessBlob extends globalThis.Blob {
    constructor(parts, options) {
      super(parts, options);
      this.harnessText = (parts || []).map(String).join('');
    }
  }
  class HarnessURL extends globalThis.URL {
    static createObjectURL(blob) {
      downloads.push({ type: blob.type, text: blob.harnessText });
      return 'blob:harness/' + downloads.length;
    }
    static revokeObjectURL() {}
  }
  class HarnessFileReader {
    readAsText(file) {
      if (this.onload) this.onload({ target: { result: file.harnessText } });
    }
  }

  const sandbox = {
    document: makeDocument(),
    localStorage,
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', reload() { reloads++; } },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now },
    requestAnimationFrame(fn) { return setTimeout(() => fn(now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    confirm(message) { prompts.asked.push(String(message)); return prompts.answer; },
    alert() {},
    prompt() { return null; },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    URL: HarnessURL,
    Blob: HarnessBlob,
    FileReader: HarnessFileReader,
    AudioContext: FakeAudioContext,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
  vm.runInContext(source, context, { filename: 'index.html:script' });

  const app = sandbox.__apparatus;
  if (!app) throw new Error('app-harness: the script evaluated but exported nothing');
  const missing = REQUIRED.filter(n => app[n] === undefined);
  if (missing.length) {
    throw new Error('app-harness: index.html no longer defines ' + missing.join(', '));
  }
  app.localStorage = localStorage;
  app.document = sandbox.document;
  app.answerConfirm = answer => { prompts.answer = !!answer; };
  app.confirmsAsked = () => prompts.asked.slice();
  app.lastConfirm = () => prompts.asked[prompts.asked.length - 1] || null;
  app.downloads = () => downloads.slice();
  app.reloads = () => reloads;
  // A file the lifter picks, the way handleProgramFile receives one.
  app.fileOf = (name, text) => ({ name, size: text.length, harnessText: text });
  return app;
}

// Loads the app with a program already active. Defaults to the first built-in,
// which is what a lifter sees on a fresh install.
function loadAppWithProgram(programId, htmlPath) {
  const app = loadApp(htmlPath);
  const program = programId ? app.builtInById(programId) : app.BUILT_IN_PROGRAMS[0];
  if (!program) throw new Error('app-harness: no such built-in program: ' + programId);
  app.setProgram(app.clone(program));
  return app;
}

// Values built inside the vm carry that realm's prototypes, so Node's strict
// deep-equality rejects them against host-realm literals however alike they
// look. Tests comparing a structure pass it through here first.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Finds the first Day holding a Section of the given category, and the keys its
// items get in a Session snapshot. Keeps tests from hard-coding indices that a
// program edit would invalidate.
function findSection(app, cat, dayId) {
  const days = dayId ? app.DAYS.filter(d => d.id === dayId) : app.DAYS;
  for (const day of days) {
    if (!day.sections) continue;
    for (let si = 0; si < day.sections.length; si++) {
      if (app.classifySection(day.sections[si]) !== cat) continue;
      return {
        day,
        section: day.sections[si],
        sectionIndex: si,
        // The snapshot key for the nth item of this Section.
        key: (ii) => si + '-' + (ii || 0),
      };
    }
  }
  return null;
}

module.exports = { loadApp, loadAppWithProgram, findSection, plain, ROOT, HTML };
