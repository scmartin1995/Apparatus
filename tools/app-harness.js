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
  // Only one inline script is expected; more than one means the file's shape
  // changed and the extraction below is no longer sound.
  const count = html.split(SCRIPT_OPEN).length - 1;
  if (count !== 1) {
    throw new Error('app-harness: expected exactly 1 inline <script> in index.html, found ' + count);
  }
  const open = html.indexOf(SCRIPT_OPEN);
  const close = html.lastIndexOf(SCRIPT_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    throw new Error('app-harness: could not find the inline <script> in index.html');
  }
  return html.slice(open + SCRIPT_OPEN.length, close);
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
    querySelector() { return null; },
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
  'saveDraft', 'loadDraft', 'clearDraft',
  'loadStoredProgram', 'saveProgram', 'clearProgram', 'clone', 'currentProgramId',
  'builtInById', 'selectedBuiltIn', 'initProgramState',
  'readBaselineMap', 'loadBaselines', 'saveBaselines',
  'calcOrm', 'repToPercent', 'getSuggestedWeight', 'weightHintHtml',
  'baselineFor', 'displaySets', 'workingRange',
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
  'prescribedItemFor', 'loggedValuesIn', 'revertEntry', 'revertSubstitution',
  'removeOverride', 'revertPermanentSubstitution', 'revertPermanentHere',
  'renderProgPage', 'renderOffDays',
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
  const sandbox = {
    document: makeDocument(),
    localStorage,
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', reload() {} },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
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
    URL: globalThis.URL,
    Blob: globalThis.Blob,
    FileReader: class { readAsText() {} },
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
