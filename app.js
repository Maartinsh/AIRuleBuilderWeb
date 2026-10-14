/**
 * Rule Builder — Application Logic
 *
 * All UI rendering, JSON building, validation, import/export,
 * and form management logic lives here.
 *
 * Depends on: config.js (must be loaded first)
 */
'use strict';

/* =========================================================
   MULTI-RULE STATE
   ========================================================= */

let rules = [];          // Array of rule JSON objects (source of truth)
let activeRuleIndex = 0; // Currently-edited rule index
let selectedProduct = DEFAULT_PRODUCT; // Narrows which data sources are offered

/**
 * Topic registry for the current set: normalized topic name -> config object.
 * Configs arrive from imported envelope documents (precedence, tone, maxPerBatch,
 * throttle); topics created in the editor start with an empty config. Export
 * builds the document's "topics" block from the topics rules actually use.
 */
let topicConfigs = {};

/**
 * The product that *exclusively* owns a data source, or null when the source is
 * shared (DateTime, Phone, Wellness) or unknown. Only an exclusively-owned
 * source pins a rule to a product — a rule built purely from shared sources is
 * valid under either.
 */
function exclusiveOwner(source) {
  const owners = PRODUCTS.filter(p => (PRODUCT_DATA_SOURCES[p.id] || []).includes(source));
  return owners.length === 1 ? owners[0] : null;
}

/**
 * Whether a trigger node represents an actual authoring decision.
 *
 * Every rendered trigger carries a `dataSource`, because a <select> always has
 * something selected — an untouched trigger reports whichever source sorted
 * first. Treating that placeholder as a choice makes a brand-new rule look like
 * it belongs to whichever product owns the first source in the list, so a
 * trigger only counts once it names an event or carries conditions.
 */
function isConfiguredTrigger(expr) {
  if (!expr) return false;
  if (Array.isArray(expr.expressions)) return expr.expressions.some(isConfiguredTrigger);
  return !!(expr.id || expr.conditions?.length);
}

/** dataSources a rule actually commits to — placeholders excluded. */
function collectDataSources(rule, out = new Set()) {
  (function walk(expr) {
    if (!expr) return;
    if (Array.isArray(expr.expressions)) { expr.expressions.forEach(walk); return; }
    if (expr.dataSource && isConfiguredTrigger(expr)) out.add(expr.dataSource);
  })(rule?.triggerExpression);
  for (const v of rule?.output?.variables || []) {
    if (v.dataSource) out.add(v.dataSource);
  }
  return out;
}

/** Product ids a rule is pinned to. Empty = shared-only, valid under any product. */
function ruleProductIds(rule) {
  const ids = new Set();
  for (const ds of collectDataSources(rule)) {
    const owner = exclusiveOwner(ds);
    if (owner) ids.add(owner.id);
  }
  return ids;
}

/** Has any authoring happened yet? Drives whether the product is still open. */
function ruleIsStarted(rule) {
  if (!rule) return false;
  if (isConfiguredTrigger(rule.triggerExpression)) return true;
  return !!(rule.output?.instructions || rule.output?.variables?.length);
}

/** A fresh, unconfigured rule — the state the editor opens in. */
function blankRule() {
  return { id: 'rule_1', sessionScope: 'global', triggerExpression: { type: 'GROUP', groupType: 'AND' } };
}

/** The product an imported set belongs to, or null if it uses only shared sources. */
function inferProduct(list) {
  for (const rule of list || []) {
    const [first] = ruleProductIds(rule);
    if (first) return first;
  }
  return null;
}

/**
 * Adopts the product of a set that arrived from outside the editor (upload or
 * published version), so the switch reflects the file rather than whatever was
 * selected beforehand. A mixed file still fails validation; this just makes the
 * switch agree with the majority of it instead of silently disagreeing.
 */
function adoptProductFromRules() {
  selectedProduct = inferProduct(rules) || selectedProduct;
  refreshTemplateOptions();
  renderProductSwitch();
}

/**
 * Data sources to offer for the selected product.
 *
 * The filter is a UI convenience, not a validation rule — the engine accepts any
 * data source. Dropping an out-of-product value would silently rewrite a rule on
 * import, so a `current` that belongs to another product is kept, but tagged so
 * it never reads as something this product legitimately offers.
 *
 * `current` should only be passed for a trigger the author actually configured.
 * An untouched trigger just holds whichever source sorted first, and carrying
 * that across a product switch surfaces e.g. SmartDrive under Mojo for a rule
 * nobody has edited yet.
 */
function productSources(list, current) {
  const out = filterByProduct(list, selectedProduct).map(s => ({ value: s, label: s }));
  if (current && !out.some(o => o.value === current)) {
    const owner = exclusiveOwner(current);
    out.push({ value: current, label: owner ? `${current} — ${owner.label} only` : current });
  }
  return out;
}

/**
 * Switches product, starting the set over.
 *
 * A rule set ships as one file for one app, so the product is a property of the
 * whole set rather than of any one rule. There is no meaningful translation of
 * a Fleet rule into a Mojo one — the data sources have nothing in common — so
 * switching replaces the set instead of trying to carry it across.
 *
 * Disabling the switch instead was worse: the editor always holds at least one
 * rule and refuses to delete the last, so once that rule had content the choice
 * could never be revisited without a reload.
 */
function onProductChange(product) {
  if (product === selectedProduct) return true;

  saveActiveRule();
  if (rules.some(ruleIsStarted)) {
    const label = (PRODUCTS.find(p => p.id === product) || {}).label || product;
    const n = rules.length;
    const ok = confirm(
      `Switch to ${label}?\n\n` +
      `Your ${n} rule${n === 1 ? '' : 's'} will be discarded. A rule set targets a single ` +
      `product, and ${label} uses different data sources.\n\nThis cannot be undone.`
    );
    if (!ok) return false;
  }

  selectedProduct = product;
  rules = [blankRule()];
  activeRuleIndex = 0;
  topicConfigs = {}; // topics are part of the discarded set; seeds follow the product
  refreshTemplateOptions();
  renderProductSwitch(); // here, not in the click handler, so programmatic callers repaint too
  populateFormFromRule(rules[0]);
  renderRuleList();
  onFormChange();
  return true;
}

/* =========================================================
   TOPICS
   Topic names are identities the engine compares for equality
   (after slug normalization), unlike tone, which is free prose.
   The select is a closed list — free text exists only in the
   explicit "+ New topic…" flow, where typos are caught against
   the known vocabulary before they become a second topic.
   ========================================================= */

function normalizeTopic(raw) {
  const t = (raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  return t || null;
}

function _levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Topic -> number of rules using it, across the saved set. */
function topicUsage() {
  const counts = new Map();
  for (const r of rules) {
    if (r && r.topic) counts.set(r.topic, (counts.get(r.topic) || 0) + 1);
  }
  return counts;
}

/** Registry topics plus topics in use (imported sets may use unregistered ones). */
function setTopics() {
  return [...new Set([...Object.keys(topicConfigs), ...topicUsage().keys()])].sort();
}

/** The vocabulary offered in the topic dropdown: product seeds + this set's topics. */
function knownTopics() {
  const seeds = PRODUCT_TOPICS[selectedProduct] || [];
  return [...new Set([...seeds, ...setTopics()])].sort();
}

/**
 * The known topic a new name is probably a typo of: containment or edit distance
 * <= 2. Cannot catch semantic duplicates (groceries vs shopping) — the Topics
 * panel's side-by-side counts are the net for those.
 */
function nearestTopic(name) {
  let best = null;
  let bestDist = 3;
  for (const t of knownTopics()) {
    if (t === name) continue;
    if (t.includes(name) || name.includes(t)) return t;
    const d = _levenshtein(name, t);
    if (d < bestDist) { best = t; bestDist = d; }
  }
  return best;
}

function renderTopicOptions(selected) {
  const sel = document.getElementById('rule-topic');
  if (!sel) return;
  const topics = knownTopics();
  if (selected && !topics.includes(selected)) topics.push(selected);
  sel.innerHTML = '';
  sel.append(h('option', { value: '' }, '(none)'));
  for (const t of topics) sel.append(h('option', { value: t }, t));
  sel.append(h('option', { value: '__new__' }, '+ New topic…'));
  sel.value = selected || '';
}

function onTopicSelectChange(sel) {
  if (sel.value === '__new__') {
    const name = normalizeTopic(prompt('New topic name:'));
    if (!name) {
      renderTopicOptions('');
      onFormChange();
      return;
    }
    if (!knownTopics().includes(name)) {
      const near = nearestTopic(name);
      if (near) {
        const count = topicUsage().get(near) || 0;
        const useExisting = confirm(
          `"${name}" looks close to the existing topic "${near}"` +
          `${count ? ` (used by ${count} rule${count === 1 ? '' : 's'})` : ''}.\n\n` +
          `OK = use "${near}"   ·   Cancel = create "${name}" as a new topic`
        );
        if (useExisting) {
          renderTopicOptions(near);
          onFormChange();
          return;
        }
      }
      topicConfigs[name] = topicConfigs[name] || {};
    }
    renderTopicOptions(name);
  }
  onFormChange();
}

function renderTopicPanel() {
  const list = document.getElementById('topic-list');
  if (!list) return;
  // Never rebuild the panel under the user's cursor — updatePreview() runs on
  // every config keystroke, and replacing the input mid-typing would drop focus.
  if (list.contains(document.activeElement)) return;
  const usage = topicUsage();
  const names = setTopics();
  list.innerHTML = '';
  const badge = document.getElementById('topic-count-badge');
  if (badge) badge.textContent = names.length;
  if (!names.length) {
    list.append(h('div', { className: 'help-text' }, 'No topics yet — set one in Rule Basics.'));
    return;
  }
  for (const t of names) {
    const count = usage.get(t) || 0;
    const expanded = _expandedTopic === t;
    list.append(h('div', { className: 'rule-list-item', style: 'cursor:pointer',
      onClick: () => { _expandedTopic = expanded ? null : t; renderTopicPanel(); } },
      h('span', { className: 'rule-list-id' }, `${expanded ? '▾' : '▸'} ${t}`),
      h('span', { className: 'rule-list-scope' },
        count ? `${count} rule${count === 1 ? '' : 's'}` : '0 rules — not exported')
    ));
    if (expanded) list.append(_topicConfigEditor(t));
  }
}

let _expandedTopic = null;

/** Inline editor for one topic's registry config. Blank field = engine default. */
function _topicConfigEditor(topic) {
  const cfg = topicConfigs[topic] || {};
  const th = cfg.throttle || {};
  const field = (label, key, value, opts = {}) => h('div', {},
    h('label', {}, label),
    h('input', {
      type: opts.type || 'number', value: value ?? '', min: opts.min,
      placeholder: opts.placeholder || 'default',
      dataset: { topicField: key },
      onInput: (e) => _setTopicField(topic, key, e.target.value)
    })
  );
  return h('div', { className: 'form-grid', style: 'padding:6px 8px 12px' },
    field('Precedence', 'precedence', cfg.precedence),
    field('Max per batch', 'maxPerBatch', cfg.maxPerBatch, { min: 1 }),
    field('Tone', 'tone', cfg.tone, { type: 'text', placeholder: 'rule tone wins' }),
    field('Cooldown (min)', 'cooldownMinutes', th.cooldownMinutes, { min: 0 }),
    field('Max triggers / day', 'maxTriggersPerDay', th.maxTriggersPerDay, { min: 1 })
  );
}

function _setTopicField(topic, key, raw) {
  const cfg = (topicConfigs[topic] = topicConfigs[topic] || {});
  const v = raw.trim();
  if (key === 'cooldownMinutes' || key === 'maxTriggersPerDay') {
    const throttle = (cfg.throttle = cfg.throttle || {});
    if (v === '' || !Number.isFinite(Number(v))) delete throttle[key];
    else throttle[key] = Number(v);
    if (!Object.keys(throttle).length) delete cfg.throttle;
  } else if (v === '') {
    delete cfg[key];
  } else {
    cfg[key] = key === 'tone' ? v : Number(v);
  }
  onFormChange();
}

// Both are stamped into rule-schema.json by the contract build and promoted by loadSchema();
// the literals are the fallback for a failed fetch only. SCHEMA_VERSION is the grammar this
// bundle can express, RELEASED_SCHEMA_VERSION the highest any published engine accepts — they
// differ while a schema is built but not yet released.
let SCHEMA_VERSION = '1.2.0';
let RELEASED_SCHEMA_VERSION = '1.1.0';

const SCHEMA_BASELINE = '1.0.0';

// Grammar added since the baseline, newest first. A document is stamped with the lowest version
// that still reads it in full, never with the builder's own: an engine rejects a document stamped
// above its ceiling and drops every rule in it, so inheriting a version the rules do not use would
// disable rule sets that would have run fine.
const SCHEMA_FEATURES = [
  ['1.2.0', usesSearchOrChoiceOptions],
  ['1.1.0', usesNonStringComparisonValue],
];

function requiredSchemaVersion(rulesArray) {
  const match = SCHEMA_FEATURES.find(([, usedBy]) => rulesArray.some(r => r && usedBy(r)));
  return match ? match[0] : SCHEMA_BASELINE;
}

function eachExpression(expr, visit) {
  if (!expr || typeof expr !== 'object') return;
  visit(expr);
  for (const child of expr.expressions || []) eachExpression(child, visit);
}

function usesSearchOrChoiceOptions(rule) {
  if (rule.followUp && rule.followUp.options) return true;
  let found = false;
  eachExpression(rule.triggerExpression, e => { if (e.search) found = true; });
  return found;
}

function usesNonStringComparisonValue(rule) {
  const typed = c => c && 'value' in c && (Array.isArray(c.value)
    ? c.value.some(v => typeof v !== 'string')
    : typeof c.value !== 'string');

  let found = false;
  eachExpression(rule.triggerExpression, e => {
    if ((e.conditions || []).some(typed)) found = true;
  });
  for (const v of (rule.output && rule.output.variables) || []) {
    if ((v.filters || []).some(typed)) found = true;
  }
  return found;
}

function compareSchemaVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * The exported/published document, always in the envelope shape.
 *
 * A bare rules array has nowhere to carry schemaVersion, and an unstamped
 * document is read as the 1.0.0 baseline whatever grammar it actually uses — so
 * the array shape silently mislabels every rule written since. Nothing is lost
 * by dropping it: the envelope landed in engine 0.0.75 and schemaVersion in
 * 0.0.78, so any engine that reads the stamp already reads the envelope.
 *
 * The registry carries only topics in use — configs for removed topics would
 * otherwise accumulate forever.
 */
function buildDocument(rulesArray) {
  const used = new Set(rulesArray.map(r => r && r.topic).filter(Boolean));
  const topics = {};
  for (const t of [...used].sort()) topics[t] = topicConfigs[t] || {};
  return {
    schemaVersion: requiredSchemaVersion(rulesArray),
    ...(used.size ? { topics } : {}),
    rules: rulesArray
  };
}

/** Topics block for a publish payload, or null when the set uses no topics. */
function _topicsBlock(rulesArray) {
  return buildDocument(rulesArray).topics || null;
}

/** Post-import net: surface probable topic typos that arrived in a file. */
function _warnNearDuplicateTopics() {
  const names = setTopics();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (_levenshtein(names[i], names[j]) <= 2) {
        showToast(`Possible duplicate topics: "${names[i]}" / "${names[j]}" — if they mean the same thing, pick one topic on the affected rules.`, 6000);
        return;
      }
    }
  }
}

/** Normalized copy of an imported topics registry; non-object entries are dropped. */
function _adoptTopicConfigs(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, cfg] of Object.entries(raw)) {
      const t = normalizeTopic(name);
      if (t && cfg && typeof cfg === 'object' && !Array.isArray(cfg)) out[t] = cfg;
    }
  }
  return out;
}

/* =========================================================
   SCHEMA & VALIDATION
   ========================================================= */

let schema = null;
let ajvInstance = null;
let schemaValidator = null;

const _TIME_RE = /^\d{1,2}:\d{2}$/;
const _FROM_NOW_RE = /^[+-]?\d+[hdm]$/;
// Aggregate windows look backwards and must be positive, so no sign and no zero.
const _WINDOW_RE = /^[1-9]\d*[hdm]$/;
const _VALID_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);

function _isValidTime(v) {
  if (!_TIME_RE.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

const EMBEDDED_SCHEMA = null; // Will attempt fetch first

async function loadSchema() {
  try {
    const res = await fetch('./rule-schema.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    schema = await res.json();
    if (typeof schema['x-schemaVersion'] === 'string') SCHEMA_VERSION = schema['x-schemaVersion'];
    if (typeof schema['x-releasedSchema'] === 'string') RELEASED_SCHEMA_VERSION = schema['x-releasedSchema'];
  } catch (e) {
    console.warn('Could not fetch rule-schema.json, validation disabled:', e.message);
    showToast('Schema not loaded — validation unavailable. Serve via HTTP for full features.');
    return;
  }

  // Load Ajv from CDN — the browser bundle lives in the ajv-dist package
  // (the ajv package itself has no standalone build) and defines an `ajv7` global
  try {
    if (typeof Ajv === 'undefined' && typeof ajv7 === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/ajv-dist@8/dist/ajv7.min.js');
    }
    const AjvCtor = typeof Ajv !== 'undefined' ? Ajv : ajv7;
    ajvInstance = new AjvCtor({ allErrors: true, strict: false });
    // The schema root is a oneOf (legacy array | envelope with topics) so it can
    // describe both published shapes, but the editor always validates the bare
    // rules array — compiling the array branch avoids ajv reporting the other
    // branch's mismatches ("must be object") against every valid array.
    const editorSchema = schema.oneOf
      ? { $schema: schema.$schema, type: 'array', minItems: 1, items: { $ref: '#/definitions/rule' }, definitions: schema.definitions }
      : schema;
    schemaValidator = ajvInstance.compile(editorSchema);
  } catch (e) {
    console.warn('Could not load Ajv:', e.message);
    showToast('Ajv not loaded — schema validation unavailable.');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* =========================================================
   DOM UTILITIES
   ========================================================= */

/** Create a DOM element with attributes and children. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val === undefined || val === null) continue;
    if (key === 'className') el.className = val;
    else if (key === 'dataset') Object.assign(el.dataset, val);
    else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    }
    else if (key.startsWith('on') && typeof val === 'string') {
      // String handlers like onInput:'onFormChange()' — must use lowercase attribute name
      // so the browser recognises them as event handler content attributes.
      el.setAttribute(key.toLowerCase(), val);
    }
    else el.setAttribute(key, String(val));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** Create a <select> with options. */
function createSelect(options, attrs = {}) {
  const sel = h('select', attrs);
  for (const opt of options) {
    const value = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    sel.append(h('option', { value }, label));
  }
  return sel;
}

/** Create a labeled form field. */
function createField(labelText, inputEl, helpText) {
  const row = h('div', { className: 'form-row' });
  if (labelText) row.append(h('label', {}, labelText));
  row.append(inputEl);
  if (helpText) row.append(h('div', { className: 'help-text' }, helpText));
  return row;
}

/** Get a unique incrementing ID. */
let _idCounter = 0;
function uid() { return `uid-${++_idCounter}`; }

/* =========================================================
   CARD TOGGLE
   ========================================================= */

function toggleCard(header) {
  header.classList.toggle('open');
}

/* =========================================================
   SCOPE HINT
   ========================================================= */

function showScopeHint() {
  const scope = document.getElementById('rule-scope').value;
  const hint = document.getElementById('scope-hint');
  hint.textContent = SCOPE_HINTS[scope] || '';
}

function toggleOutputSection() {
  const enabled = document.getElementById('output-enabled').checked;
  document.getElementById('output-fields').classList.toggle('hidden', !enabled);
  updateVariablesAvailability();
}

function toggleFollowUpSection() {
  const enabled = document.getElementById('follow-up-enabled')?.checked === true;
  const choice = enabled && document.getElementById('follow-up-options-enabled')?.checked === true;
  document.getElementById('follow-up-fields')?.classList.toggle('hidden', !enabled);
  document.getElementById('follow-up-options-fields')?.classList.toggle('hidden', !choice);
  const confirmed = document.getElementById('follow-up-outcome-confirmed');
  if (confirmed) confirmed.textContent = choice ? 'Confirmed + the chosen item' : 'Confirmed';
  const help = document.getElementById('follow-up-outcomes-help');
  if (help) {
    help.innerHTML = choice
      ? 'Mobile receives <code>CONFIRMED</code> with <code>selection</code> (the chosen item exactly as the trigger delivered it) or <code>DENIED</code> for none of them. <code>LATER</code> is never stored for a choice; the rule re-asks with fresh options.'
      : 'Mobile receives <code>CONFIRMED</code> or <code>DENIED</code> (and <code>LATER</code> when the app enables it); these labels are not stored as action payloads.';
  }
  if (choice) renderFollowUpOptionCandidates();
}

/** Kept for Mojo: its rules have always exported this id. */
function defaultFollowUpId() {
  return selectedProduct === 'mojo' ? 'exercise_confirmation' : 'confirmation';
}

/**
 * Shows/hides the variables section based on whether instructions + tone are filled in.
 * Variables are only useful when the output section has content for the LLM prompt.
 */
function updateVariablesAvailability() {
  const enabled = document.getElementById('output-enabled').checked;
  const instructions = document.getElementById('output-instructions').value.trim();
  const tone = document.getElementById('output-tone').value.trim();
  const varsSection = document.getElementById('variables-section');
  if (!varsSection) return;

  const available = enabled && instructions.length > 0 && tone.length > 0;
  varsSection.classList.toggle('hidden', !available);
}

/* =========================================================
   TRIGGER EXPRESSION BUILDER
   ========================================================= */

/**
 * Renders a trigger expression as a trigger list.
 * 1 trigger = auto-SINGLE in JSON. 2+ triggers = auto-GROUP.
 */
function renderTriggerExpression(container, depth = 0, data = null) {
  container.innerHTML = '';

  // Parse data into trigger items
  let items = [];
  let groupType = 'AND';

  if (data) {
    if (data.type === 'SINGLE') {
      items = [data];
    } else if (data.type === 'GROUP') {
      groupType = data.groupType || 'AND';
      items = data.expressions || [];
    }
  }
  if (items.length === 0) items = [null]; // Start with one empty trigger

  // AND/OR toggle (hidden when only 1 trigger)
  const gtId = uid();
  const gtRow = h('div', { className: 'form-row' });
  const gtGroup = h('div', { className: 'radio-group', style: 'max-width:200px' });

  const andLabel = h('label', { for: `${gtId}-and` });
  const andInput = h('input', { type: 'radio', name: gtId, id: `${gtId}-and`, value: 'AND' });
  if (groupType === 'AND') andInput.checked = true;
  andLabel.append(andInput, h('span', {}, 'AND'));

  const orLabel = h('label', { for: `${gtId}-or` });
  const orInput = h('input', { type: 'radio', name: gtId, id: `${gtId}-or`, value: 'OR' });
  if (groupType === 'OR') orInput.checked = true;
  orLabel.append(orInput, h('span', {}, 'OR'));

  gtGroup.append(andLabel, orLabel);
  gtRow.append(h('label', {}, 'Combine Triggers'), gtGroup);
  container.append(gtRow);

  andInput.addEventListener('change', onFormChange);
  orInput.addEventListener('change', onFormChange);

  const hint = h('div', { className: 'help-text', style: 'margin-bottom:8px' },
    'Each trigger can use a different data source with its own trigger ID and conditions.'
  );
  container.append(hint);

  // Trigger list
  const triggerList = h('div', { className: 'expression-list', dataset: { field: 'triggerList' } });
  container.append(triggerList);

  for (const item of items) {
    if (item && item.type === 'GROUP') {
      addTriggerGroup(triggerList, depth, item);
    } else {
      addTriggerCard(triggerList, depth, item);
    }
  }

  // Buttons
  const btnRow = h('div', { style: 'display:flex;gap:8px;margin-top:8px' });
  btnRow.append(h('button', { className: 'btn-add', onClick: () => {
    addTriggerCard(triggerList, depth);
    updateTriggerListUI();
    renderSearchDestinationCandidates();
    onFormChange();
  } }, '+ Add Trigger'));

  if (depth < 2) {
    btnRow.append(h('button', { className: 'btn-add', onClick: () => {
      addTriggerGroup(triggerList, depth);
      updateTriggerListUI();
      onFormChange();
    } }, '+ Add Trigger Group'));
  }
  container.append(btnRow);

  // Show/hide AND/OR toggle and hint based on trigger count
  function updateTriggerListUI() {
    const count = triggerList.children.length;
    gtRow.classList.toggle('hidden', count <= 1);
    hint.classList.toggle('hidden', count <= 1);
    // Show/hide remove buttons
    for (const card of triggerList.children) {
      const removeBtn = card.querySelector(':scope > .item-header .btn-icon');
      if (removeBtn) removeBtn.style.display = count <= 1 ? 'none' : '';
    }
  }
  container._updateUI = updateTriggerListUI;
  updateTriggerListUI();
  // Only now do all of the rule's triggers exist, so this is the first point where
  // a destination select can see them all.
  if (depth === 0) renderSearchDestinationCandidates();
}

/**
 * Adds a single trigger card to the trigger list.
 */
function addTriggerCard(list, depth, data = null) {
  const card = h('div', { className: `item-card expression-card depth-${depth}` });
  const labelSpan = h('span', { className: 'item-label' }, `Trigger #${list.children.length + 1}`);
  const removeBtn = h('button', { className: 'btn-icon', title: 'Remove', onClick: () => {
    if (list.children.length <= 1) return;
    card.remove();
    const parent = list.closest('[data-field="triggerList"]')?.parentElement;
    if (parent?._updateUI) parent._updateUI();
    onFormChange();
  } }, '\u00D7');

  const header = h('div', { className: 'item-header' }, labelSpan, removeBtn);
  card.append(header);

  const triggerContainer = h('div');
  card.append(triggerContainer);
  list.append(card);

  renderSingleTrigger(triggerContainer, depth, data?.type === 'SINGLE' || !data?.type ? data : null);

  // Auto-update label with data source and trigger ID
  const dsSelect = triggerContainer.querySelector('[data-field="dataSource"]');
  if (dsSelect) {
    const updateLabel = () => {
      const idx = Array.from(list.children).indexOf(card) + 1;
      const ds = dsSelect.value || '';
      const tidEl = triggerContainer.querySelector('[data-field="triggerId"]');
      const tid = tidEl?.value || '';
      labelSpan.textContent = `Trigger #${idx}` + (ds ? ` \u2014 ${ds}` : '') + (tid ? ` / ${tid}` : '');
    };
    dsSelect.addEventListener('change', updateLabel);
    const tidEl = triggerContainer.querySelector('[data-field="triggerId"]');
    if (tidEl) {
      tidEl.addEventListener('input', updateLabel);
      tidEl.addEventListener('change', updateLabel);
    }
    updateLabel();
  }
}

/**
 * Adds a nested trigger group to the trigger list (for AND/OR sub-groups).
 */
function addTriggerGroup(list, parentDepth, data = null) {
  const card = h('div', { className: `item-card expression-card depth-${parentDepth}`, dataset: { isGroup: 'true' } });
  const labelSpan = h('span', { className: 'item-label' }, `Trigger Group`);
  const removeBtn = h('button', { className: 'btn-icon', title: 'Remove', onClick: () => {
    if (list.children.length <= 1) return;
    card.remove();
    const parent = list.closest('[data-field="triggerList"]')?.parentElement;
    if (parent?._updateUI) parent._updateUI();
    onFormChange();
  } }, '\u00D7');

  const header = h('div', { className: 'item-header' }, labelSpan, removeBtn);
  card.append(header);

  const groupContainer = h('div');
  card.append(groupContainer);
  list.append(card);

  renderTriggerExpression(groupContainer, parentDepth + 1, data);
}

/**
 * Renders a SINGLE trigger form.
 */
function renderSingleTrigger(container, depth, data = null) {
  container.innerHTML = '';
  container.dataset.field = 'singleTrigger';

  // Data Source
  // Only an author-configured trigger is worth carrying across a product switch.
  // A bare trigger holds whichever source sorted first, not a decision.
  const configured = !!(data?.id || data?.conditions?.length);
  const dsSelect = createSelect(productSources(DATA_SOURCES, configured ? data.dataSource : null), { id: uid(), onInput: 'onFormChange()' });
  dsSelect.dataset.field = 'dataSource';
  if (data?.dataSource) dsSelect.value = data.dataSource;

  // Trigger ID (context-sensitive)
  const idContainer = h('div', { className: 'form-row' });
  const idLabel = h('label', {}, 'Trigger ID');
  idContainer.append(idLabel);

  function buildIdInput(ds) {
    // Capture current value before removing old element
    const old = idContainer.querySelector('[data-field="triggerId"]');
    const prevValue = old ? old.value : (data?.id || '');
    // A typed places id sits in a wrapper of its own, with help text and the way
    // back to the list; a plain select is a direct child and idContainer stays.
    const wrapper = old?.closest('.form-row');
    if (wrapper && wrapper !== idContainer) wrapper.remove();
    else if (old) old.remove();
    const oldList = idContainer.querySelector('datalist');
    if (oldList) oldList.remove();

    const isApi = API_DATA_SOURCES.includes(ds);
    idLabel.textContent = isApi ? 'API Endpoint' : 'Trigger ID';

    if (isApi) {
      // API source — show endpoints from API_ENDPOINTS
      const endpoints = API_ENDPOINTS[ds] || [];
      const matched = endpoints.find(ep => ep.id === prevValue);

      // A free-text place search names itself. The id is typed, not picked, and
      // losing it on import would silently rewrite the rule.
      if (prevValue && !matched && placesPrefixOf(prevValue, ds) !== null) {
        idContainer.append(buildCustomPlaceIdInput(prevValue, ds));
        return;
      }

      const sel = h('select', {});
      sel.dataset.field = 'triggerId';
      sel.append(h('option', { value: '' }, '\u2014 Select API endpoint \u2014'));
      // A deprecated endpoint is offered only to the rule already on it, so an
      // import keeps its id while no new rule can be authored onto one.
      for (const ep of endpoints) {
        if (ep.deprecated && ep.id !== prevValue) continue;
        sel.append(h('option', { value: ep.id }, `${ep.label} \u2014 ${ep.description}`));
      }
      if (prevValue) sel.value = prevValue;
      sel.addEventListener('change', () => {
        if (sel.value === PLACES_CUSTOM_ENDPOINT) {
          sel.replaceWith(buildCustomPlaceIdInput(PLACES_PREFIX, ds));
        }
        onFormChange();
      });
      idContainer.append(sel);
    } else {
      const scope = document.getElementById('rule-scope')?.value || 'global';
      const ids = TRIGGER_IDS[ds] || [];

      if (ids.length === 0) {
        // Free text (UserCommand or unknown)
        const input = h('input', { type: 'text', placeholder: 'Enter trigger ID', onInput: 'onFormChange()' });
        input.dataset.field = 'triggerId';
        if (prevValue) input.value = prevValue;
        idContainer.append(input);
      } else {
        // Proper <select> dropdown — trip-only IDs are disabled (not hidden) for non-trip rules
        const sel = h('select', {});
        sel.dataset.field = 'triggerId';
        sel.append(h('option', { value: '' }, '\u2014 Select trigger ID \u2014'));
        for (const id of ids) {
          const isTripOnly = !isActivityScope(scope) && ACTIVITY_ONLY_EVENTS.includes(id);
          const opt = h('option', { value: id }, isTripOnly ? `${id} (activity scope only)` : id);
          if (isTripOnly) opt.disabled = true;
          sel.append(opt);
        }
        if (prevValue) sel.value = prevValue;
        sel.addEventListener('change', onFormChange);
        idContainer.append(sel);
      }
    }
  }

  /**
   * A places id typed rather than picked. Keeps `data-field="triggerId"` on the
   * one control that holds the whole id, so every reader of it stays unchanged.
   */
  function buildCustomPlaceIdInput(value, ds) {
    const wrap = h('div', { className: 'form-row' });
    const input = h('input', { type: 'text', placeholder: `${PLACES_PREFIX}truck_stop`, onInput: 'onFormChange()' });
    input.dataset.field = 'triggerId';
    input.value = value;
    input.addEventListener('input', () => { updateConditionsVisibility(); updateVisibility(); });
    const back = h('button', { type: 'button', className: 'btn-add', style: 'margin-top:6px' }, '\u2190 Pick from the endpoint list');
    back.addEventListener('click', () => {
      const old = idContainer.querySelector('[data-field="triggerId"]');
      if (old) old.closest('.form-row')?.remove();
      buildIdInput(ds);
      updateConditionsVisibility();
      updateVisibility();
      onFormChange();
    });
    wrap.append(input, h('div', { className: 'help-text' },
      `The id is the label this search is stored under. Name a category after ${PLACES_PREFIX} to use one of the endpoint\u2019s own \u2014 ${NEARBY_PLACE_CATEGORIES.join(', ')} \u2014 or anything else and say what to look for in Search for.`
    ), back);
    return wrap;
  }

  // Expose so scope changes can trigger a rebuild without clearing data source
  container._rebuildIdInput = () => buildIdInput(dsSelect.value);

  dsSelect.addEventListener('change', () => {
    buildIdInput(dsSelect.value);
    // Clear conditions from previous data source — they're no longer relevant
    condList.innerHTML = '';
    updateParameterHints(container, dsSelect.value);
    onFormChange();
  });

  const grid = h('div', { className: 'form-grid' },
    createField('Data Source', dsSelect),
    idContainer
  );
  container.append(grid);
  buildIdInput(dsSelect.value);

  // Conditions
  const condWrapper = h('div', { style: 'margin-top:12px' });
  const condLabel = h('label', {}, 'Conditions');
  const condList = h('div', { className: 'conditions-list' });
  condList.dataset.field = 'conditions';
  const condAddBtn = h('button', { className: 'btn-add', style: 'margin-top:6px', onClick: () => {
    const tid = container.querySelector('[data-field="triggerId"]')?.value || '';
    const cfg = TRIGGER_CONDITION_CONFIG[tid] || null;
    addCondition(condList, dsSelect.value, null, cfg);
    onFormChange();
  } }, '+ Add Condition');

  // "Event-only" hint + toggle for triggers that don't need conditions
  const eventOnlyHint = h('div', { className: 'help-text', style: 'margin-top:12px;margin-bottom:4px' },
    'Triggers on event occurrence \u2014 no conditions needed. '
  );
  const condToggleLink = h('button', {
    className: 'btn-add', style: 'margin-top:4px;font-size:0.6875rem',
    onClick: () => {
      const tid = container.querySelector('[data-field="triggerId"]')?.value || '';
      const cfg = TRIGGER_CONDITION_CONFIG[tid] || null;
      condWrapper.classList.remove('hidden');
      eventOnlyHint.classList.add('hidden');
      condToggleLink.classList.add('hidden');
      if (condList.children.length === 0) {
        addCondition(condList, dsSelect.value, null, cfg);
      }
      onFormChange();
    }
  }, '+ Add Conditions (optional)');

  // "Condition required" hint
  const condRequiredHint = h('div', { className: 'help-text', style: 'margin-top:12px;margin-bottom:4px;color:var(--color-warning)' },
    'This trigger requires at least one condition to function.'
  );
  condRequiredHint.classList.add('hidden');

  container.append(eventOnlyHint, condToggleLink, condRequiredHint);

  condWrapper.append(condLabel, condList, condAddBtn);
  container.append(condWrapper);

  if (data?.conditions) {
    for (const c of data.conditions) {
      const tid = data?.id || '';
      const cfg = TRIGGER_CONDITION_CONFIG[tid] || null;
      addCondition(condList, dsSelect.value, c, cfg);
    }
  }

  // Track previous trigger ID to detect changes
  let _prevTriggerId = data?.id || '';

  // Show/hide conditions based on trigger ID and auto-add when required
  function updateConditionsVisibility() {
    const tid = container.querySelector('[data-field="triggerId"]')?.value || '';
    const cfg = TRIGGER_CONDITION_CONFIG[tid] || null;
    const isEventOnly = EVENT_ONLY_TRIGGERS.has(tid) && !cfg?.conditionRequired;

    // Clear and re-initialize when trigger ID changes.
    // Flag events carry no parameters — clear any stale conditions but do not add a new one.
    if (tid !== _prevTriggerId) {
      condList.innerHTML = '';
      if (cfg && !cfg.mhubFlagEvent) {
        addCondition(condList, dsSelect.value, null, cfg);
      }
    }
    _prevTriggerId = tid;

    if (cfg?.noConditions) {
      // Job destination triggers: engine handles matching automatically, conditions not supported.
      condList.innerHTML = '';
      condWrapper.classList.add('hidden');
      condToggleLink.classList.add('hidden');
      condRequiredHint.classList.add('hidden');
      eventOnlyHint.textContent = 'Engine matches job locations automatically \u2014 conditions are not supported for this trigger.';
      eventOnlyHint.classList.remove('hidden');
    } else if (cfg?.mhubFlagEvent) {
      // MHub flag event: show a read-only flag state badge, no condition editor.
      condList.innerHTML = '';
      condWrapper.classList.add('hidden');
      condToggleLink.classList.add('hidden');
      condRequiredHint.classList.add('hidden');
      eventOnlyHint.innerHTML =
        `<span style="display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--color-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--color-accent) 35%,transparent);border-radius:6px;padding:5px 10px;font-size:0.8125rem">` +
        `<span style="font-size:0.9rem">&#9873;</span>` +
        `<span><strong>MHub flag event</strong> &mdash; fires when ${cfg.flagDescription}</span>` +
        `</span>`;
      eventOnlyHint.classList.remove('hidden');
    } else if (cfg?.conditionRequired) {
      // Fallback: ensure at least one condition exists (handles switching from flag events or
      // any path where the auto-add above was skipped).
      if (condList.children.length === 0) {
        addCondition(condList, dsSelect.value, null, cfg);
      }
      const hasConditions = condList.children.length > 0;
      eventOnlyHint.textContent = '';
      condWrapper.classList.remove('hidden');
      eventOnlyHint.classList.add('hidden');
      condToggleLink.classList.add('hidden');
      condRequiredHint.classList.toggle('hidden', hasConditions);
    } else {
      const hasConditions = condList.children.length > 0;
      if (isEventOnly && !hasConditions) {
        eventOnlyHint.textContent = 'Triggers on event occurrence \u2014 no conditions needed. ';
        condWrapper.classList.add('hidden');
        eventOnlyHint.classList.remove('hidden');
        condToggleLink.classList.remove('hidden');
        condRequiredHint.classList.add('hidden');
      } else {
        condWrapper.classList.remove('hidden');
        eventOnlyHint.classList.add('hidden');
        condToggleLink.classList.add('hidden');
        condRequiredHint.classList.add('hidden');
      }
    }
  }

  // Use event delegation on container so the listener survives trigger ID input rebuilds
  // (buildIdInput replaces the select element on every data source or scope change).
  container.addEventListener('change', (e) => {
    if (e.target.dataset?.field === 'triggerId') { updateConditionsVisibility(); updateVisibility(); }
  });
  container.addEventListener('input', (e) => {
    if (e.target.dataset?.field === 'triggerId') { updateConditionsVisibility(); updateVisibility(); }
  });

  // Reset prev-trigger tracking when the data source changes so the next trigger ID
  // selection always triggers a full re-init of the conditions panel.
  dsSelect.addEventListener('change', () => {
    _prevTriggerId = '';
    setTimeout(updateConditionsVisibility, 0);
  });
  updateConditionsVisibility();

  // POI sub-form (only for POI data source)
  const poiContainer = h('div', { className: 'hidden', dataset: { field: 'poi-container' } });
  renderPoiSubForm(poiContainer, data?.POI);
  container.append(poiContainer);

  // dateRangeInDays (only for API sources)
  const dateRangeContainer = h('div', { className: 'hidden', dataset: { field: 'dateRange-container' } });
  const dateRangeSelect = createSelect(
    // Mirrors DateRangeConstants.VALID_RANGES in the engine. The window runs
    // backwards for recorded data and forwards for patient_exercises, so the
    // labels stay direction-neutral.
    [{ value: '', label: 'Default (1 day)' }, { value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }],
    { onInput: 'onFormChange()' }
  );
  dateRangeSelect.dataset.field = 'dateRangeInDays';
  if (data?.dateRangeInDays) dateRangeSelect.value = String(data.dateRangeInDays);
  dateRangeContainer.append(createField('Date Range', dateRangeSelect));
  container.append(dateRangeContainer);

  const searchContainer = h('div', { className: 'hidden', dataset: { field: 'search-container' } });
  renderSearchSubForm(searchContainer, data?.search ?? null);
  container.append(searchContainer);

  // Extracted Parameters (UserCommand only)
  const epContainer = h('div', { className: 'hidden', style: 'margin-top:12px' });
  const epLabel = h('label', {}, 'Extracted Parameters ');
  epLabel.append(h('span', { className: 'label-hint' }, '(comma-separated)'));
  const epInput = h('input', { type: 'text', placeholder: 'e.g. $venue_request, $dateTime, $question', onInput: 'onFormChange()' });
  epInput.dataset.field = 'extractedParameters';
  if (data?.extractedParameters?.length) epInput.value = data.extractedParameters.join(', ');
  epContainer.append(epLabel, epInput);
  epContainer.append(h('div', { className: 'help-text' },
    'Named values parsed from user voice/text commands by the mobile app. Examples: $venue_request, $dateTime, $poi, $manualType, $question, $purchase, $cost'
  ));
  container.append(epContainer);

  // Show/hide POI, dateRange, and extractedParameters based on data source
  function updateVisibility() {
    const ds = dsSelect.value;
    poiContainer.classList.toggle('hidden', ds !== 'POI');
    const isApi = ['MZONE', 'GZONE', 'External Source'].includes(ds);
    dateRangeContainer.classList.toggle('hidden', !isApi);
    const hasEpData = epInput.value.trim().length > 0;
    epContainer.classList.toggle('hidden', ds !== 'UserCommand' && !hasEpData);

    const wasHidden = searchContainer.classList.contains('hidden');
    const id = container.querySelector('[data-field="triggerId"]')?.value;
    const isPlaces = isPlacesExpressionJSON({ id, dataSource: ds });
    searchContainer.classList.toggle('hidden', !isPlaces);
    const suffix = isPlaces ? placesSuffixOf(id, ds) : null;
    if (suffix !== null && placeCategoryOf(suffix, placesPrefixOf(id, ds)) === null) {
      searchContainer.dataset.freeText = '1';
    } else {
      delete searchContainer.dataset.freeText;
    }
    searchContainer._syncSearchFields?.();
    if (isPlaces && wasHidden) renderSearchDestinationCandidates();
  }
  dsSelect.addEventListener('change', updateVisibility);
  updateVisibility();
}

/**
 * Renders POI sub-form fields.
 */
function renderPoiSubForm(container, data = null) {
  container.innerHTML = '';
  const toggleRow = h('div', { className: 'toggle-row', style: 'margin-top:12px; opacity:0.4; pointer-events:none' });
  const toggle = h('label', { className: 'toggle-switch' });
  const cb = h('input', { type: 'checkbox', disabled: true });
  toggle.append(cb, h('span', { className: 'toggle-slider' }));
  toggleRow.append(toggle, h('label', { style: 'text-transform:none;font-weight:400;color:var(--color-text)' }, 'Add POI coordinates (coming soon)'));
  container.append(toggleRow);

  const fields = h('div', { className: data ? '' : 'hidden' });
  const latInput = h('input', { type: 'number', step: 'any', placeholder: '0.0', onInput: 'onFormChange()' });
  latInput.dataset.field = 'poi-lat';
  if (data?.coordinates?.lat) latInput.value = data.coordinates.lat;

  const lngInput = h('input', { type: 'number', step: 'any', placeholder: '0.0', onInput: 'onFormChange()' });
  lngInput.dataset.field = 'poi-lng';
  if (data?.coordinates?.lng) lngInput.value = data.coordinates.lng;

  const radiusInput = h('input', { type: 'text', placeholder: 'e.g. 500', onInput: 'onFormChange()' });
  radiusInput.dataset.field = 'poi-radius';
  if (data?.radius) radiusInput.value = data.radius;

  fields.append(
    h('div', { className: 'form-grid-3', style: 'margin-top:8px' },
      createField('Latitude', latInput),
      createField('Longitude', lngInput),
      createField('Radius (m)', radiusInput)
    )
  );
  container.append(fields);

  cb.addEventListener('change', () => {
    fields.classList.toggle('hidden', !cb.checked);
    onFormChange();
  });
}

/** The response field pair a destination trigger hands coordinates over in. */
function destinationCoordinateFields(id, dataSource) {
  return (API_ENDPOINTS[dataSource] || []).find(x => x.id === id)?.destinationCoordinates || null;
}

/**
 * Whether reading a destination from this trigger can be ruled out. An API endpoint
 * the config does not list stays open, since an imported rule may name one the
 * builder has not caught up with; an event data source is a fixed catalogue of
 * device attributes and never carries a destination.
 */
function cannotSupplyDestination(id, dataSource) {
  if (destinationCoordinateFields(id, dataSource)) return false;
  if (!API_DATA_SOURCES.includes(dataSource)) return true;
  return (API_ENDPOINTS[dataSource] || []).some(x => x.id === id);
}

/** Every field name the builder itself suggests, so a suggestion may be replaced. */
function suggestedCoordinateFieldNames() {
  const names = new Set();
  for (const endpoints of Object.values(API_ENDPOINTS)) {
    for (const ep of endpoints) {
      if (!ep.destinationCoordinates) continue;
      names.add(ep.destinationCoordinates.lat);
      names.add(ep.destinationCoordinates.lng);
    }
  }
  return names;
}

/** Every SINGLE trigger container of the form, in document order. */
function singleTriggerBoxes() {
  const root = document.getElementById('trigger-root');
  return root ? Array.from(root.querySelectorAll('[data-field="singleTrigger"]')) : [];
}

function triggerBoxInfo(box) {
  const label = box.closest('.item-card')?.querySelector(':scope > .item-header > .item-label')?.textContent || '';
  const searchBox = box.querySelector('[data-field="search-container"]');
  const id = box.querySelector('[data-field="triggerId"]')?.value || '';
  const dataSource = box.querySelector('[data-field="dataSource"]')?.value || '';
  return {
    id,
    dataSource,
    label: (label.match(/^Trigger #\d+/) || [''])[0],
    searchBox,
    hasSearch: !!searchBox && (!searchBox.classList.contains('hidden') || searchBox.dataset.declared === '1'),
    coordinates: destinationCoordinateFields(id, dataSource),
    ruledOut: cannotSupplyDestination(id, dataSource)
  };
}

/**
 * Repopulates every destination select from the current form. A destination may
 * not be the expression itself, may not be an expression that carries a search
 * block of its own, and has to deliver a coordinate pair the planner can read,
 * so those are withheld rather than offered and then rejected. An endpoint the
 * builder does not know is offered, since its response cannot be ruled out. A
 * selection that stops being offered is kept and labelled.
 */
function renderSearchDestinationCandidates() {
  const all = singleTriggerBoxes().map(triggerBoxInfo);
  for (const own of all) {
    if (!own.searchBox) continue;
    const select = own.searchBox.querySelector('[data-field="search-destination"]');
    if (!select) continue;

    const offered = all.filter(c => c.id && c.id !== own.id && !c.hasSearch && !c.ruledOut);
    const wanted = select.value;
    const options = [{ value: '', label: '— Select destination trigger —' }];
    for (const c of offered) options.push({ value: c.id, label: `${c.id} — ${c.label}` });

    if (wanted && !offered.some(c => c.id === wanted)) {
      const known = all.find(c => c.id === wanted);
      const why = !known ? 'not a trigger of this rule'
        : wanted === own.id ? 'this trigger itself'
        : known.hasSearch ? 'carries a search block of its own'
        : 'delivers no destination coordinates';
      options.push({ value: wanted, label: `${wanted} — ${why}` });
    }
    _updateSelectOptions(select, options);
    select.value = wanted;
    own.searchBox._syncSearchFields?.();
  }
}

/**
 * The search block of a places trigger. LocationSearchPlanner keys the freshness
 * gate off the block's presence, so an implicit nearby search would share one
 * cached response with every other rule on the same category - the builder emits
 * a block for every places trigger instead of leaving it out.
 */
function renderSearchSubForm(container, data = null) {
  container.innerHTML = '';
  if (data) container.dataset.declared = '1'; else delete container.dataset.declared;

  const importedMode = typeof data?.mode === 'string' ? data.mode : '';
  const known = SEARCH_MODES.some(m => m.id === importedMode);
  if (importedMode && !known) container.dataset.unknownMode = importedMode;
  else delete container.dataset.unknownMode;

  const modeName = uid();
  const modeGroup = h('div', { className: 'radio-group', style: 'max-width:560px', dataset: { field: 'search-mode-group' } });
  for (const m of SEARCH_MODES) {
    const inputId = `${modeName}-${m.id}`;
    const input = h('input', { type: 'radio', name: modeName, id: inputId, value: m.id, dataset: { field: 'search-mode' } });
    if (known ? importedMode === m.id : (!data && m.id === 'nearby')) input.checked = true;
    input.addEventListener('change', () => { updateModeFields(); onFormChange(); });
    modeGroup.append(h('label', { for: inputId }, input, h('span', {}, m.label)));
  }
  container.append(createField('Place Search', modeGroup));

  const help = h('div', { className: 'help-text', dataset: { field: 'search-mode-help' } });
  container.append(help);

  const destRow = h('div', { className: 'hidden', dataset: { field: 'search-destination-row' } });
  const destSelect = createSelect([]);
  destSelect.dataset.field = 'search-destination';
  const destHint = h('div', { className: 'help-text', dataset: { field: 'search-destination-hint' } });

  const latField = h('input', { type: 'text', placeholder: 'e.g. nextJobLat', onInput: 'onFormChange()' });
  latField.dataset.field = 'search-dest-lat-field';
  const lngField = h('input', { type: 'text', placeholder: 'e.g. nextJobLng', onInput: 'onFormChange()' });
  lngField.dataset.field = 'search-dest-lng-field';
  if (data?.destination?.latField != null) latField.value = data.destination.latField;
  if (data?.destination?.lngField != null) lngField.value = data.destination.lngField;

  const fieldGrid = h('div', { className: 'form-grid hidden', dataset: { field: 'search-destination-fields' } },
    createField('Latitude field', latField),
    createField('Longitude field', lngField)
  );
  destRow.append(createField('Destination', destSelect), destHint, fieldGrid);
  container.append(destRow);

  const initialDest = typeof data?.destination?.triggerId === 'string' ? data.destination.triggerId : '';
  if (initialDest) {
    _updateSelectOptions(destSelect, [{ value: initialDest, label: initialDest }]);
    destSelect.value = initialDest;
  }

  destSelect.addEventListener('change', () => {
    const id = destSelect.value;
    if (id) {
      const target = singleTriggerBoxes().map(triggerBoxInfo).find(c => c.id === id);
      const fields = destinationCoordinateFields(id, target?.dataSource);
      if (fields) {
        // A suggestion the builder made for the previous trigger is replaced; anything
        // typed by hand is left alone, since only the author knows why it is there.
        const suggested = suggestedCoordinateFieldNames();
        const replaceable = f => !f.value.trim() || suggested.has(f.value.trim());
        if (replaceable(latField)) latField.value = fields.lat;
        if (replaceable(lngField)) lngField.value = fields.lng;
      }
    }
    updateModeFields();
    onFormChange();
  });

  const pointLat = h('input', { type: 'number', step: 'any', placeholder: '0.0', onInput: 'onFormChange()' });
  pointLat.dataset.field = 'search-point-lat';
  const pointLng = h('input', { type: 'number', step: 'any', placeholder: '0.0', onInput: 'onFormChange()' });
  pointLng.dataset.field = 'search-point-lng';
  if (data?.point?.lat != null) pointLat.value = data.point.lat;
  if (data?.point?.lng != null) pointLng.value = data.point.lng;
  const pointRow = h('div', { className: 'hidden', dataset: { field: 'search-point-row' } },
    h('div', { className: 'form-grid' }, createField('Latitude', pointLat), createField('Longitude', pointLng))
  );
  container.append(pointRow);

  const radiusInput = h('input', { type: 'number', min: '1', step: '1', placeholder: '500', onInput: 'onFormChange()' });
  radiusInput.dataset.field = 'search-radius';
  if (data?.radius != null) radiusInput.value = data.radius;
  const detourInput = h('input', { type: 'number', min: '1', step: '1', placeholder: 'e.g. 2000', onInput: 'onFormChange()' });
  detourInput.dataset.field = 'search-detour';
  if (data?.maxDetourMeters != null) detourInput.value = data.maxDetourMeters;

  const limitInput = h('input', { type: 'number', min: '1', step: '1', placeholder: "endpoint's default", onInput: 'onFormChange()' });
  limitInput.dataset.field = 'search-limit';
  if (data?.limit != null) limitInput.value = data.limit;

  const radiusField = createField('Radius (m)', radiusInput);
  const detourField = h('div', { className: 'hidden', dataset: { field: 'search-detour-field' } }, createField('Max detour (m)', detourInput));
  container.append(h('div', { className: 'form-grid' }, radiusField, detourField));
  const radiusHint = h('div', { className: 'help-text', dataset: { field: 'search-radius-hint' } });
  container.append(radiusHint);

  const queryInput = h('input', { type: 'text', placeholder: 'e.g. truck stop with showers', onInput: 'onFormChange()' });
  queryInput.dataset.field = 'search-query';
  if (typeof data?.query === 'string') queryInput.value = data.query;
  const queryField = h('div', { className: 'hidden', dataset: { field: 'search-query-field' } },
    createField('Search for', queryInput,
      'Free text sent instead of a category. Required when the trigger ID names a label of your own rather than one of the endpoint\u2019s categories.')
  );
  container.append(h('div', { className: 'form-grid' }, queryField, createField('Limit', limitInput,
    'Maximum places to return. Part of the search\u2019s identity, not its presentation \u2014 two rules differing only in limit are two searches.')));

  function updateModeFields() {
    const mode = container.querySelector('[data-field="search-mode"]:checked')?.value || '';
    const spec = SEARCH_MODES.find(m => m.id === mode);
    help.textContent = spec ? spec.help
      : 'Pick a mode. The engine rejects a missing or unknown mode instead of reading it as a nearby search.';

    const needsDestination = mode === 'along_route' || mode === 'near_destination';
    destRow.classList.toggle('hidden', !needsDestination);
    pointRow.classList.toggle('hidden', mode !== 'near_point');
    detourField.classList.toggle('hidden', mode !== 'along_route');
    fieldGrid.classList.toggle('hidden', !destSelect.value);
    destHint.textContent = destSelect.value
      ? 'The engine reads these two fields from the other trigger’s response, so both must name real response parameters.'
      : destSelect.querySelector('option[value]:not([value=""])')
        ? 'The engine resolves the destination from the named trigger’s newest response and holds the search until it can, so a changed destination needs nothing of the app.'
        : 'No trigger of this rule delivers a destination, and there is no app-supplied fallback — add a jobs endpoint and read the destination from its response.';
    radiusHint.textContent = mode === 'along_route'
      ? 'Radius bounds how far ahead a place may be from the current position; max detour bounds the extra distance it costs. Blank radius uses the engine default of 500 m.'
      : 'Blank uses the engine default of 500 m.';

    // A category names the subject already, so a query there would narrow it
    // without saying so - the engine rejects that rather than sending it.
    queryField.classList.toggle('hidden', !container.dataset.freeText);
  }
  updateModeFields();
  container._syncSearchFields = updateModeFields;
}

function buildSearchJSON(box) {
  const q = f => box.querySelector(`[data-field="${f}"]`);
  const text = f => q(f)?.value?.trim() || '';
  const num = (f) => {
    const raw = text(f);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  };

  const mode = box.querySelector('[data-field="search-mode"]:checked')?.value || box.dataset.unknownMode || '';
  const search = {};
  if (mode) search.mode = mode;

  if (mode === 'along_route' || mode === 'near_destination') {
    const id = q('search-destination')?.value || '';
    const lat = text('search-dest-lat-field');
    const lng = text('search-dest-lng-field');
    if (id || lat || lng) {
      const destination = {};
      if (id) destination.triggerId = id;
      if (lat) destination.latField = lat;
      if (lng) destination.lngField = lng;
      search.destination = destination;
    }
  }

  if (mode === 'near_point') {
    const lat = num('search-point-lat');
    const lng = num('search-point-lng');
    if (lat !== undefined || lng !== undefined) {
      search.point = {};
      if (lat !== undefined) search.point.lat = lat;
      if (lng !== undefined) search.point.lng = lng;
    }
  }

  const radius = num('search-radius');
  if (radius !== undefined) search.radius = radius;
  if (mode === 'along_route') {
    const detour = num('search-detour');
    if (detour !== undefined) search.maxDetourMeters = detour;
  }
  const limit = num('search-limit');
  if (limit !== undefined) search.limit = limit;
  if (box.dataset.freeText) {
    const query = text('search-query');
    if (query) search.query = query;
  }
  return search;
}

/**
 * Updates parameter datalist hints for condition fields.
 */
function updateParameterHints(triggerContainer, dataSource) {
  const params = PARAMETERS[dataSource] || [];
  const labelMap = {};
  for (const v of (EVENT_VARIABLE_PARAMS[dataSource] || [])) labelMap[v.id] = v.label;
  const datalists = triggerContainer.querySelectorAll('[data-param-hints]');
  for (const dl of datalists) {
    dl.innerHTML = '';
    for (const p of params) {
      const id = typeof p === 'string' ? p : p.id;
      const label = (typeof p === 'object' && p.label) || labelMap[id] || '';
      dl.append(h('option', { value: id, label: label || id }, label));
    }
  }
}

/* =========================================================
   CONDITION BUILDER
   ========================================================= */

/**
 * Adds a condition card to the conditions list.
 */
function addCondition(list, dataSource, data = null, triggerConfig = null, filterFieldsOverride = null) {
  const card = h('div', { className: 'item-card' });
  const condType = data?.type || triggerConfig?.defaultConditionType || 'Value';

  const availableTypes = triggerConfig?.validConditionTypes || CONDITION_TYPES;

  const header = h('div', { className: 'item-header' });
  const typeSelect = createSelect(availableTypes, { style: 'width:auto' });
  typeSelect.dataset.field = 'conditionType';
  typeSelect.value = condType;
  if (availableTypes.length === 1) typeSelect.disabled = true;
  header.append(
    h('span', { className: 'item-label' }, 'Condition:'),
    typeSelect,
    h('button', { className: 'btn-icon', title: 'Remove', onClick: () => { card.remove(); onFormChange(); } }, '\u00D7')
  );
  card.append(header);

  const fieldsContainer = h('div', { className: 'item-fields' });
  card.append(fieldsContainer);
  list.append(card);

  function renderFields(type) {
    renderConditionFields(fieldsContainer, type, dataSource, data?.type === type ? data : null, triggerConfig, filterFieldsOverride);
  }

  typeSelect.addEventListener('change', () => {
    data = null;
    renderFields(typeSelect.value);
    onFormChange();
  });

  renderFields(condType);
}

/**
 * Datalist of the event names a data source can emit, for the free-text eventName
 * inputs on EventCount and Aggregate. Returns null when the source has no fixed
 * event list (UserCommand, API sources).
 */
function buildEventNameDatalist(listId, dataSource) {
  const ids = TRIGGER_IDS[dataSource] || [];
  if (ids.length === 0) return null;
  const list = h('datalist', { id: listId });
  for (const id of ids) list.append(h('option', { value: id }, id));
  return list;
}

/**
 * Renders the appropriate fields for a condition type.
 */
function renderConditionFields(container, type, dataSource, data = null, triggerConfig = null, filterFieldsOverride = null) {
  container.innerHTML = '';
  // Per-trigger validParameters (e.g. Google Places vs Weather under "External
  // Source") take priority over the flat per-dataSource list so the two engine
  // APIs never offer each other's fields.
  const rawParams = filterFieldsOverride || triggerConfig?.validParameters || PARAMETERS[dataSource] || [];
  // filterFieldsOverride items are {id, type, label} objects; PARAMETERS items are plain strings
  const params = rawParams.map(p => typeof p === 'string' ? p : p.id);
  const paramTypeMap = {};
  for (const p of rawParams) { if (typeof p === 'object') paramTypeMap[p.id] = p; }
  const paramListId = uid();

  switch (type) {
    case 'Value': {
      const isLocked = triggerConfig?.parameterLocked && triggerConfig?.defaultParameter;
      const lockedParam = triggerConfig?.defaultParameter || '';

      let paramInput;
      if (isLocked) {
        paramInput = h('input', { type: 'text', readonly: '', style: 'opacity:0.7;cursor:not-allowed', onInput: 'onFormChange()' });
        paramInput.value = data?.parameter || lockedParam;
      } else {
        paramInput = h('input', { type: 'text', list: paramListId, placeholder: 'parameter name', onInput: 'onFormChange()' });
        if (data?.parameter) paramInput.value = data.parameter;
      }
      paramInput.dataset.field = 'parameter';

      const paramList = h('datalist', { id: paramListId, dataset: { paramHints: '' } });
      const _labelMap = {};
      for (const v of (EVENT_VARIABLE_PARAMS[dataSource] || [])) _labelMap[v.id] = v.label;
      for (const p of params) {
        const lbl = paramTypeMap[p]?.label || _labelMap[p] || '';
        paramList.append(h('option', { value: p, label: lbl || p }, lbl));
      }

      // Operator set is driven by the selected parameter's type when available
      // (e.g. enum/string params don't support <, <=, >, >= — comparing levels
      // numerically makes no sense). Falls back to the trigger-level config or
      // the global default for untyped params.
      function opsForParam(paramName) {
        const fi = paramTypeMap[paramName];
        if (fi?.type === 'enum') return STRING_OPERATORS;
        if (fi?.type === 'string') return STRING_OPERATORS;
        if (fi && ['int', 'double'].includes(fi.type)) return NUMERIC_OPERATORS;
        if (fi?.type === 'bool') return ['==', '!='];
        return triggerConfig?.validOperators || OPERATORS;
      }
      const initialOps = opsForParam(paramInput.value);
      const opSelect = createSelect(initialOps, { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'operator';
      if (data?.operator && initialOps.includes(data.operator)) {
        opSelect.value = data.operator;
      }
      function refreshOps() {
        const ops = opsForParam(paramInput.value);
        const previous = opSelect.value;
        _updateSelectOptions(opSelect, ops);
        opSelect.value = ops.includes(previous) ? previous : ops[0];
      }

      const valueContainer = h('div', { className: 'form-row' });
      function renderValueInput(op) {
        valueContainer.innerHTML = '';
        // Determine type from filter field config or trigger config
        const paramName = paramInput.value;
        const fieldInfo = paramTypeMap[paramName];
        const isNumeric = fieldInfo
          ? ['int', 'double'].includes(fieldInfo.type)
          : false;
        const isBool = fieldInfo?.type === 'bool';
        const isEnum = fieldInfo?.type === 'enum' && Array.isArray(fieldInfo.values);
        const typeHint = fieldInfo ? ` (${fieldInfo.label})` : '';
        const baseHint = triggerConfig?.valueHint || (isBool ? 'true or false' : isNumeric ? 'number' : 'value');

        if (op === 'in' && paramName === 'day_of_week') {
          // Day-of-week chip selector
          const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
          const selected = new Set(data?.value && Array.isArray(data.value) ? data.value : []);
          const hiddenInput = h('input', { type: 'hidden' });
          hiddenInput.dataset.field = 'value';
          hiddenInput.dataset.valueType = 'array';
          hiddenInput.dataset.paramType = 'string';
          hiddenInput.value = [...selected].join(', ');

          const chipsRow = h('div', { className: 'day-chips' });
          for (const day of DAYS) {
            const chip = h('span', { className: 'day-chip' + (selected.has(day) ? ' selected' : '') }, day);
            chip.addEventListener('click', () => {
              if (selected.has(day)) { selected.delete(day); chip.classList.remove('selected'); }
              else { selected.add(day); chip.classList.add('selected'); }
              hiddenInput.value = DAYS.filter(d => selected.has(d)).join(', ');
              onFormChange();
            });
            chipsRow.append(chip);
          }
          valueContainer.append(h('label', {}, 'Days'), chipsRow, hiddenInput);
        } else if (op === 'in' && isEnum) {
          // Enum chip selector — same UX as day_of_week, values sourced from fieldInfo
          const selected = new Set(data?.value && Array.isArray(data.value) ? data.value : []);
          const hiddenInput = h('input', { type: 'hidden' });
          hiddenInput.dataset.field = 'value';
          hiddenInput.dataset.valueType = 'array';
          hiddenInput.dataset.paramType = 'string';
          hiddenInput.value = fieldInfo.values.filter(v => selected.has(v)).join(', ');

          const chipsRow = h('div', { className: 'day-chips' });
          for (const v of fieldInfo.values) {
            const chip = h('span', { className: 'day-chip' + (selected.has(v) ? ' selected' : '') }, v);
            chip.addEventListener('click', () => {
              if (selected.has(v)) { selected.delete(v); chip.classList.remove('selected'); }
              else { selected.add(v); chip.classList.add('selected'); }
              hiddenInput.value = fieldInfo.values.filter(x => selected.has(x)).join(', ');
              onFormChange();
            });
            chipsRow.append(chip);
          }
          valueContainer.append(h('label', {}, `Values${typeHint}`), chipsRow, hiddenInput);
        } else if (op === 'in') {
          const tagInput = h('input', {
            type: 'text',
            placeholder: isNumeric ? 'Comma-separated numbers, e.g. 4, 8, 12' : 'Comma-separated values',
            onInput: 'onFormChange()'
          });
          tagInput.dataset.field = 'value';
          tagInput.dataset.valueType = 'array';
          tagInput.dataset.paramType = fieldInfo?.type || '';
          if (data?.value && Array.isArray(data.value)) tagInput.value = data.value.join(', ');
          const tagLabel = h('label', {}, `Values${typeHint} `);
          tagLabel.append(h('span', { className: 'label-hint' }, '(comma-separated)'));
          valueContainer.append(tagLabel, tagInput);
          valueContainer.append(h('div', { className: 'help-text' },
            isNumeric ? 'Exported as JSON numbers, matching how the parameter is emitted.'
              : (isEnum || fieldInfo?.type === 'string') ? 'Exported as JSON strings.'
              : 'Exported as JSON strings unless every entry is a number.'
          ));
        } else if (isEnum) {
          // Equality / inequality against a fixed set of strings — use a <select>
          const options = [{ value: '', label: '— select value —' }].concat(
            fieldInfo.values.map(v => ({ value: v, label: v }))
          );
          const sel = createSelect(options, { onInput: 'onFormChange()' });
          sel.dataset.field = 'value';
          sel.dataset.valueType = 'string';
          if (data?.value !== undefined && !Array.isArray(data.value)) sel.value = String(data.value);
          valueContainer.append(h('label', {}, `Value${typeHint}`), sel);
        } else {
          const inputType = isNumeric ? 'number' : 'text';
          const valInput = h('input', { type: inputType, placeholder: baseHint, onInput: 'onFormChange()' });
          valInput.dataset.field = 'value';
          valInput.dataset.valueType = 'scalar';
          valInput.dataset.paramType = fieldInfo?.type || '';
          if (isNumeric && fieldInfo?.min !== undefined) valInput.min = String(fieldInfo.min);
          if (isNumeric && fieldInfo?.max !== undefined) valInput.max = String(fieldInfo.max);
          if (data?.value !== undefined && !Array.isArray(data.value)) valInput.value = String(data.value);
          const unitSuffix = isNumeric && fieldInfo?.unit ? ` (${fieldInfo.unit})` : '';
          const label = fieldInfo ? `Value${typeHint}${unitSuffix}` : 'Value';
          valueContainer.append(h('label', {}, label), valInput);

          // Unit note for triggers whose unit is not the obvious one (e.g. SmartDrive
          // trip_distance is whole km, not metres). The placeholder alone gets cut off.
          if (triggerConfig?.valueNote) {
            valueContainer.append(h('div', { className: 'help-text' }, triggerConfig.valueNote));
          }

          // Threshold legend + quick-pick chips. Ranges mirror the mobile
          // measurement screen's Low/Normal/High labels so rule writers can
          // pick "Extreme" instead of guessing a number.
          if (isNumeric && Array.isArray(fieldInfo?.thresholds) && fieldInfo.thresholds.length > 0) {
            const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);
            const legend = fieldInfo.thresholds
              .map(t => `${t.label}: ${fmt(t.range[0])}–${fmt(t.range[1])}`)
              .join(' · ');
            valueContainer.append(h('div', { className: 'threshold-legend' }, legend));

            const chipsRow = h('div', { className: 'day-chips threshold-chips' });
            for (const t of fieldInfo.thresholds) {
              const chip = h('span', { className: 'day-chip', title: `Sets value to ${fmt(t.range[0])} (start of ${t.label} range)` }, t.label);
              chip.addEventListener('click', () => {
                valInput.value = String(t.range[0]);
                onFormChange();
              });
              chipsRow.append(chip);
            }
            valueContainer.append(chipsRow);
          }
        }
      }
      // Re-render value input when parameter changes (to update type hints),
      // and refresh the operator dropdown so the available ops match the new
      // parameter's type (numeric vs enum/string vs bool).
      paramInput.addEventListener('change', () => {
        refreshOps();
        renderValueInput(opSelect.value);
      });
      opSelect.addEventListener('change', () => renderValueInput(opSelect.value));
      renderValueInput(opSelect.value);

      // Event name narrowing — for data sources whose events share attribute
      // names. Without it the engine takes the newest event carrying the
      // parameter, whichever milestone that was.
      const showEventName = VALUE_EVENT_NAME_SOURCES.has(dataSource);
      const eventNameSelect = createSelect(
        [{ value: '', label: 'Any event (newest match wins)' }].concat(
          (TRIGGER_IDS[dataSource] || []).map(id => ({ value: id, label: id }))
        ),
        { onInput: 'onFormChange()' }
      );
      eventNameSelect.dataset.field = 'eventName';
      if (data?.eventName) eventNameSelect.value = data.eventName;
      const eventNameField = createField(
        'Event Name', eventNameSelect,
        'Optional. Restricts the lookup to one event \u2014 needed when several events carry the same parameter.'
      );
      if (!showEventName) eventNameField.classList.add('hidden');

      // Source field — only show for BLE data source
      const showSource = dataSource === 'BLE' && !triggerConfig?.hideSource;
      const sourceInput = h('input', { type: 'text', placeholder: 'e.g. MHUB (optional)', onInput: 'onFormChange()' });
      sourceInput.dataset.field = 'source';
      if (data?.source) sourceInput.value = data.source;
      const sourceField = createField('Source', sourceInput, 'Optional. e.g. "MHUB" for BLE fuel hub');
      if (!showSource) sourceField.classList.add('hidden');

      container.append(
        h('div', { className: 'form-grid' },
          createField('Parameter', h('span', {}, paramInput, isLocked ? null : paramList)),
          createField('Operator', opSelect)
        ),
        valueContainer,
        eventNameField,
        sourceField
      );

      // Show locked parameter hint
      if (isLocked) {
        container.insertBefore(
          h('div', { className: 'help-text', style: 'margin-bottom:8px' },
            `Parameter "${lockedParam}" is auto-set for this trigger.`
          ),
          container.firstChild
        );
      }
      break;
    }

    case 'TimeRange': {
      const fromInput = h('input', { type: 'text', placeholder: 'HH:MM', onInput: 'onFormChange()' });
      fromInput.dataset.field = 'from';
      if (data?.from) fromInput.value = data.from;

      const toInput = h('input', { type: 'text', placeholder: 'HH:MM', onInput: 'onFormChange()' });
      toInput.dataset.field = 'to';
      if (data?.to) toInput.value = data.to;

      container.append(
        h('div', { className: 'form-grid' },
          createField('From (UTC, HH:MM)', fromInput),
          createField('To (UTC, HH:MM)', toInput)
        )
      );
      break;
    }

    case 'Time': {
      const opSelect = createSelect(OPERATORS.filter(o => o !== 'in'), { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'operator';
      if (data?.operator) opSelect.value = data.operator;

      const valInput = h('input', { type: 'text', placeholder: 'HH:MM', onInput: 'onFormChange()' });
      valInput.dataset.field = 'value';
      if (data?.value) valInput.value = data.value;

      container.append(
        h('div', { className: 'form-grid' },
          createField('Operator', opSelect),
          createField('Time (UTC, HH:MM)', valInput)
        )
      );
      break;
    }

    case 'Comparison': {
      const paramInput = h('input', { type: 'text', placeholder: 'e.g. score', onInput: 'onFormChange()' });
      paramInput.dataset.field = 'parameter';
      if (data?.parameter) paramInput.value = data.parameter;

      const lbInput = h('input', { type: 'text', placeholder: 'optional', onInput: 'onFormChange()' });
      lbInput.dataset.field = 'leaderboardId';
      if (data?.leaderboardId) lbInput.value = data.leaderboardId;

      const fp = createSelect(TIME_PERIODS, { onInput: 'onFormChange()' });
      fp.dataset.field = 'firstPeriod';
      if (data?.firstPeriod) fp.value = data.firstPeriod;

      const sp = createSelect(TIME_PERIODS, { onInput: 'onFormChange()' });
      sp.dataset.field = 'secondPeriod';
      if (data?.secondPeriod) sp.value = data.secondPeriod;

      const opSelect = createSelect(OPERATORS.filter(o => o !== 'in'), { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'operator';
      if (data?.operator) opSelect.value = data.operator;

      const valInput = h('input', { type: 'text', placeholder: 'threshold', onInput: 'onFormChange()' });
      valInput.dataset.field = 'value';
      valInput.dataset.valueType = 'string';
      if (data?.value) valInput.value = data.value;

      container.append(
        h('div', { className: 'form-grid' },
          createField('Parameter', paramInput),
          createField('Leaderboard ID (opt)', lbInput)
        ),
        h('div', { className: 'form-grid' },
          createField('First Period', fp),
          createField('Second Period', sp)
        ),
        h('div', { className: 'form-grid' },
          createField('Operator', opSelect),
          createField('Value', valInput)
        )
      );
      break;
    }

    case 'EventCount': {
      const hasLockedEventName = triggerConfig?.defaultEventName;
      const enInput = h('input', {
        type: 'text',
        placeholder: 'e.g. driving_behaviour_event_braking',
        onInput: 'onFormChange()',
        ...(hasLockedEventName ? { readonly: '', style: 'opacity:0.7;cursor:not-allowed' } : {})
      });
      enInput.dataset.field = 'eventName';
      if (data?.eventName) {
        enInput.value = data.eventName;
      } else if (hasLockedEventName) {
        enInput.value = triggerConfig.defaultEventName;
      }
      const ecNameListId = uid();
      const ecNameList = buildEventNameDatalist(ecNameListId, dataSource);
      if (ecNameList && !hasLockedEventName) enInput.setAttribute('list', ecNameListId);

      const availableOps = triggerConfig?.validOperators || OPERATORS.filter(o => o !== 'in');
      const opSelect = createSelect(availableOps, { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'operator';
      if (data?.operator) opSelect.value = data.operator;
      else opSelect.value = '>=';

      const valInput = h('input', { type: 'number', placeholder: '3', min: '0', onInput: 'onFormChange()' });
      valInput.dataset.field = 'value';
      valInput.dataset.valueType = 'integer';
      if (data?.value !== undefined) valInput.value = data.value;

      const elements = [];
      if (hasLockedEventName) {
        elements.push(h('div', { className: 'help-text', style: 'margin-bottom:8px' },
          `Event name "${triggerConfig.defaultEventName}" is auto-set for this trigger.`
        ));
      }
      elements.push(
        createField('Event Name', h('span', {}, enInput, ecNameList)),
        h('div', { className: 'form-grid' },
          createField('Operator', opSelect),
          createField('Count Threshold', valInput)
        )
      );
      container.append(...elements);
      break;
    }

    case 'RelativeTimeWindow': {
      const paramInput = h('input', { type: 'text', placeholder: 'e.g. departure_time', onInput: 'onFormChange()' });
      paramInput.dataset.field = 'parameter';
      if (data?.parameter) paramInput.value = data.parameter;

      const fnInput = h('input', { type: 'text', placeholder: 'e.g. 1h, -4h, 30m', onInput: 'onFormChange()' });
      fnInput.dataset.field = 'fromNow';
      if (data?.fromNow) fnInput.value = data.fromNow;

      container.append(
        h('div', { className: 'form-grid' },
          createField('Parameter', paramInput),
          createField('From Now', fnInput, 'Format: 1h, -4h, 30m, -2d')
        )
      );
      break;
    }

    case 'Aggregate': {
      const enInput = h('input', { type: 'text', placeholder: 'e.g. session_completed', onInput: 'onFormChange()' });
      enInput.dataset.field = 'eventName';
      if (data?.eventName) enInput.value = data.eventName;
      const agNameListId = uid();
      const agNameList = buildEventNameDatalist(agNameListId, dataSource);
      if (agNameList) enInput.setAttribute('list', agNameListId);

      const opSelect = createSelect(AGGREGATE_OPS, { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'op';
      opSelect.value = data?.op || 'max';

      const fieldInput = h('input', { type: 'text', placeholder: 'e.g. average_rom', onInput: 'onFormChange()' });
      fieldInput.dataset.field = 'field';
      if (data?.field) fieldInput.value = data.field;
      const agFieldListId = uid();
      const agFieldList = h('datalist', { id: agFieldListId });
      for (const prm of (PARAMETERS[dataSource] || [])) {
        if (typeof prm === 'string' || !['int', 'double'].includes(prm.type)) continue;
        agFieldList.append(h('option', { value: prm.id, label: prm.label || prm.id }, prm.label || prm.id));
      }
      if (agFieldList.children.length > 0) fieldInput.setAttribute('list', agFieldListId);

      const cmpSelect = createSelect(NUMERIC_OPERATORS, { onInput: 'onFormChange()' });
      cmpSelect.dataset.field = 'operator';
      cmpSelect.value = data?.operator || '>';

      const valInput = h('input', { type: 'number', placeholder: '55', onInput: 'onFormChange()' });
      valInput.dataset.field = 'value';
      if (data?.value !== undefined) valInput.value = data.value;

      const winInput = h('input', { type: 'text', placeholder: 'e.g. 7d', onInput: 'onFormChange()' });
      winInput.dataset.field = 'window';
      if (data?.window) winInput.value = data.window;

      // Only the global session has a fixed id, so it is the sole nameable scope.
      const scopeSelect = createSelect(['', 'global'], { onInput: 'onFormChange()' });
      scopeSelect.dataset.field = 'scope';
      scopeSelect.value = data?.scope || '';

      // count reduces events, not a field value, so hide Field when it is selected.
      const fieldRow = createField('Field', h('span', {}, fieldInput, agFieldList), "Numeric attribute to reduce. Not used by 'count'.");
      const syncFieldRow = () => { fieldRow.style.display = opSelect.value === 'count' ? 'none' : ''; };
      opSelect.addEventListener('change', syncFieldRow);
      syncFieldRow();

      container.append(
        createField('Event Name', h('span', {}, enInput, agNameList)),
        h('div', { className: 'form-grid' },
          createField('Reducer', opSelect),
          fieldRow
        ),
        h('div', { className: 'form-grid' },
          createField('Operator', cmpSelect),
          createField('Threshold', valInput)
        ),
        h('div', { className: 'form-grid' },
          createField('Window', winInput, 'Rolling look-back: 7d, 12h, 30m'),
          createField('Scope (opt)', scopeSelect, "Blank = the rule's own session. 'global' = full history.")
        )
      );
      break;
    }
  }
}

/* =========================================================
   OUTPUT & VARIABLE BUILDER
   ========================================================= */

let _varCounter = 0;

function addVariable(data = null) {
  const list = document.getElementById('variables-list');
  const card = h('div', { className: 'item-card' });
  _varCounter++;

  const header = h('div', { className: 'item-header' },
    h('span', { className: 'item-label' }, `Variable #${_varCounter}`),
    h('button', { className: 'btn-icon', title: 'Remove', onClick: () => { card.remove(); onFormChange(); } }, '\u00D7')
  );
  card.append(header);

  const fields = h('div', { className: 'item-fields' });

  // ── Category ──
  const categorySelect = createSelect([
    { value: '', label: '\u2014 Select category \u2014' },
    { value: 'api', label: 'API Data Source' },
    { value: 'event', label: 'Event / Device Data' }
  ]);
  categorySelect.dataset.field = 'var-category';

  // ── Data Source (populated by category) ──
  const dsSelect = createSelect([{ value: '', label: '\u2014 Select data source \u2014' }]);
  dsSelect.dataset.field = 'var-dataSource';

  // ── Endpoint (populated by data source — API only) ──
  const endpointSelect = createSelect([{ value: '', label: '\u2014 Select endpoint \u2014' }]);
  endpointSelect.dataset.field = 'var-endpoint';
  const endpointRow = h('div', { className: 'form-row hidden' });
  endpointRow.dataset.field = 'var-endpoint-row';
  endpointRow.append(h('label', {}, 'API Endpoint'));
  endpointRow.append(endpointSelect);

  // ── Endpoint description hint ──
  const endpointHint = h('div', { className: 'help-text hidden', style: 'margin-top:4px' });
  endpointHint.dataset.field = 'var-endpoint-hint';

  // ── Parameter (populated by endpoint or data source) ──
  const paramSelect = createSelect([{ value: '', label: '\u2014 Select parameter \u2014' }]);
  paramSelect.dataset.field = 'var-param';

  // ── Custom ID (shown when "Custom" selected) ──
  const customIdInput = h('input', { type: 'text', placeholder: 'Custom variable ID', onInput: 'onFormChange()' });
  customIdInput.dataset.field = 'var-id';
  const customIdRow = h('div', { className: 'form-row hidden' });
  customIdRow.append(h('label', {}, 'Custom ID'));
  customIdRow.append(customIdInput);
  customIdRow.append(h('div', { className: 'help-text' },
    'Can be any field name from the API response. The engine will look for this key in the event data and pass its value to the LLM.'));

  // ── Hint for simple variables ──
  const simpleHint = h('div', { className: 'help-text hidden', style: 'margin-top:4px' }, 'Auto-extracted by the engine \u2014 no extra configuration needed.');
  simpleHint.dataset.field = 'var-simple-hint';

  // ── API extraction fields (conditionally shown) ──
  const apiFields = h('div', { className: 'hidden' });
  apiFields.dataset.field = 'var-api-fields';

  // Trigger ID — shown as dropdown when disambiguation needed
  const tiSelect = createSelect([{ value: '', label: '(auto-detect)' }]);
  tiSelect.dataset.field = 'var-triggerId';
  tiSelect.addEventListener('change', () => onFormChange());
  const tiRow = h('div', { className: 'form-row hidden' });
  tiRow.dataset.field = 'var-triggerId-row';
  tiRow.append(h('label', {}, 'Trigger ID '), h('span', { className: 'label-hint' }, '(multiple triggers use this data source)'));
  tiRow.append(tiSelect);

  // Source Key — dropdown populated from endpoint's array params
  const srcSelect = createSelect([{ value: '', label: '\u2014 Select source key \u2014' }]);
  srcSelect.dataset.field = 'var-source';
  srcSelect.addEventListener('change', () => onFormChange());
  const srcRow = h('div', { className: 'form-row' });
  srcRow.append(h('label', {}, 'Source Key '), h('span', { className: 'label-hint' }, '(array key in API response)'));
  srcRow.append(srcSelect);

  // Fields
  const fieldsInput = h('input', { type: 'text', placeholder: 'e.g. id, description, status', onInput: 'onFormChange()' });
  fieldsInput.dataset.field = 'var-fields';
  const fieldsRow = h('div', { className: 'form-row' });
  fieldsRow.append(h('label', {}, 'Fields '), h('span', { className: 'label-hint' }, '(comma-separated fields to extract)'));
  fieldsRow.append(fieldsInput);

  // Filters
  const filtersLabel = h('label', { style: 'margin-top:8px' }, 'Filters ');
  filtersLabel.append(h('span', { className: 'label-hint' }, '(filter array items before extraction)'));
  const filtersList = h('div', { className: 'conditions-list' });
  filtersList.dataset.field = 'var-filters';

  apiFields.append(tiRow, srcRow, fieldsRow, filtersLabel, filtersList);
  apiFields.append(
    h('button', { className: 'btn-add', style: 'margin-top:4px', onClick: () => {
      const srcKey = srcSelect.value;
      const ff = FILTER_FIELDS[srcKey] || null;
      addCondition(filtersList, dsSelect.value, null, null, ff);
      onFormChange();
    } }, '+ Add Filter')
  );

  // ── Wire up cascading dropdowns ──

  categorySelect.addEventListener('change', () => {
    const cat = categorySelect.value;
    const all = cat === 'api' ? API_DATA_SOURCES : cat === 'event' ? EVENT_DATA_SOURCES : [];
    // _pendingValue is set by the import path below, which dispatches this event
    // before it can assign dsSelect.value \u2014 without it an out-of-product source
    // would have no option to select and the variable would silently lose it.
    const sources = productSources(all, dsSelect._pendingValue || dsSelect.value);
    _updateSelectOptions(dsSelect, [{ value: '', label: '\u2014 Select data source \u2014' }, ...sources]);
    _updateSelectOptions(endpointSelect, [{ value: '', label: '\u2014 Select endpoint \u2014' }]);
    _updateSelectOptions(paramSelect, [{ value: '', label: '\u2014 Select parameter \u2014' }]);
    endpointRow.classList.add('hidden');
    endpointHint.classList.add('hidden');
    customIdRow.classList.add('hidden');
    simpleHint.classList.add('hidden');
    apiFields.classList.add('hidden');
    onFormChange();
  });

  dsSelect.addEventListener('change', () => {
    const ds = dsSelect.value;
    const isApiDs = API_DATA_SOURCES.includes(ds);

    // Reset downstream
    _updateSelectOptions(paramSelect, [{ value: '', label: '\u2014 Select parameter \u2014' }]);
    customIdRow.classList.add('hidden');
    simpleHint.classList.add('hidden');
    apiFields.classList.add('hidden');
    endpointHint.classList.add('hidden');

    if (isApiDs) {
      // Show endpoint dropdown, populate with endpoints for this data source
      endpointRow.classList.remove('hidden');
      const endpoints = API_ENDPOINTS[ds] || [];
      _updateSelectOptions(endpointSelect, [
        { value: '', label: '\u2014 Select endpoint \u2014' },
        ...endpoints.map(ep => ({ value: ep.id, label: `${ep.label}  (${ep.id})` })),
      ]);
    } else {
      // Event/device: hide endpoint, show params directly
      endpointRow.classList.add('hidden');
      _updateSelectOptions(endpointSelect, [{ value: '', label: '\u2014 Select endpoint \u2014' }]);
      const params = EVENT_VARIABLE_PARAMS[ds] || [];
      _updateSelectOptions(paramSelect, [
        { value: '', label: '\u2014 Select parameter \u2014' },
        ...params.map(p => ({ value: p.id, label: `${p.id} \u2014 ${p.label}` })),
        { value: '__custom__', label: '\u2014 Custom \u2014' }
      ]);
    }
    onFormChange();
  });

  endpointSelect.addEventListener('change', () => {
    const ds = dsSelect.value;
    const epId = endpointSelect.value;
    const endpoints = API_ENDPOINTS[ds] || [];
    const ep = endpoints.find(e => e.id === epId);

    // Reset downstream
    customIdRow.classList.add('hidden');
    simpleHint.classList.add('hidden');
    apiFields.classList.add('hidden');

    if (ep) {
      // Show endpoint description
      endpointHint.textContent = ep.description;
      endpointHint.classList.remove('hidden');

      // Build parameter dropdown from endpoint's response fields
      _buildParamSelect(paramSelect, ep.params);

      // Populate source key dropdown from endpoint's array params
      const sourceKeys = [...new Set(ep.params.filter(p => p.source).map(p => p.source))];
      _updateSelectOptions(srcSelect, [
        { value: '', label: '\u2014 Select source key \u2014' },
        ...sourceKeys.map(s => ({ value: s, label: s }))
      ]);
    } else {
      endpointHint.classList.add('hidden');
      _updateSelectOptions(paramSelect, [{ value: '', label: '\u2014 Select parameter \u2014' }]);
      _updateSelectOptions(srcSelect, [{ value: '', label: '\u2014 Select source key \u2014' }]);
    }
    onFormChange();
  });

  paramSelect.addEventListener('change', () => {
    const paramId = paramSelect.value;
    const ds = dsSelect.value;
    const isApi = categorySelect.value === 'api';
    const isCustom = paramId === '__custom__';

    // Custom ID input
    customIdRow.classList.toggle('hidden', !isCustom);

    // Look up param config from endpoint or flat VARIABLE_PARAMS
    let paramCfg = null;
    if (!isCustom && ds) {
      if (isApi) {
        const epId = endpointSelect.value;
        const endpoints = API_ENDPOINTS[ds] || [];
        const ep = endpoints.find(e => e.id === epId);
        if (ep) paramCfg = ep.params.find(p => p.id === paramId);
      }
      if (!paramCfg) paramCfg = (VARIABLE_PARAMS[ds] || []).find(p => p.id === paramId);
    }
    // Simple = single field extraction (no source/fields needed)
    // Complex = array extraction (has source and fields)
    const isSimple = paramCfg ? (!paramCfg.source && !paramCfg.fields) : false;

    // Simple hint: show which field the LLM will receive
    if (paramCfg && isSimple) {
      simpleHint.textContent = `LLM receives: ${paramId} = <value from API response>`;
      simpleHint.classList.remove('hidden');
    } else {
      simpleHint.classList.add('hidden');
    }

    // API fields: show for complex params or custom
    if (isApi) {
      const showExtraction = isCustom || (paramCfg && !isSimple);
      apiFields.classList.toggle('hidden', !showExtraction);

      // Auto-fill source/fields from param defaults
      if (paramCfg && !isSimple) {
        srcSelect.value = paramCfg.source || '';
        fieldsInput.value = (paramCfg.fields || []).join(', ');
      } else if (isCustom) {
        // Don't clear — user may be typing
      } else {
        srcSelect.value = '';
        fieldsInput.value = '';
      }
    } else {
      apiFields.classList.add('hidden');
    }

    onFormChange();
  });

  // ── Layout ──
  fields.append(
    h('div', { className: 'form-grid' },
      createField('Category', categorySelect),
      createField('Data Source', dsSelect)
    ),
    endpointRow,
    endpointHint,
    h('div', { className: 'form-row' }, createField('Parameter', paramSelect)),
    customIdRow,
    simpleHint,
    apiFields
  );
  card.append(fields);
  list.append(card);

  // ── Pre-fill from data (import / template) ──
  if (data) {
    const isApi = API_DATA_SOURCES.includes(data.dataSource);
    categorySelect.value = isApi ? 'api' : 'event';
    dsSelect._pendingValue = data.dataSource || '';
    categorySelect.dispatchEvent(new Event('change'));
    dsSelect._pendingValue = '';

    if (data.dataSource) {
      dsSelect.value = data.dataSource;
      dsSelect.dispatchEvent(new Event('change'));
    }

    // For API sources, detect and set the endpoint
    if (isApi && data.dataSource) {
      const varId = data.id || data.value || '';
      const triggerId = data.triggerId || '';
      const endpoints = API_ENDPOINTS[data.dataSource] || [];

      // Find endpoint: match by triggerId first, then by param id
      let matchedEp = null;
      if (triggerId) {
        matchedEp = endpoints.find(ep => ep.id === triggerId);
      }
      if (!matchedEp && varId) {
        matchedEp = endpoints.find(ep => ep.params.some(p => p.id === varId));
      }
      // Fallback: try matching varId directly as endpoint id (simple vars where id == triggerId)
      if (!matchedEp && varId) {
        matchedEp = endpoints.find(ep => ep.id === varId);
      }

      if (matchedEp) {
        endpointSelect.value = matchedEp.id;
        endpointSelect.dispatchEvent(new Event('change'));
      }

      // Set parameter
      if (varId) {
        const knownParam = matchedEp ? matchedEp.params.some(p => p.id === varId) : false;
        if (knownParam) {
          paramSelect.value = varId;
          paramSelect.dispatchEvent(new Event('change'));
        } else {
          paramSelect.value = '__custom__';
          customIdRow.classList.remove('hidden');
          customIdInput.value = varId;
          paramSelect.dispatchEvent(new Event('change'));
        }
      }

      // API-only fields: override auto-filled defaults with actual data
      if (data.triggerId || data.source || data.fields || data.filters) {
        apiFields.classList.remove('hidden');
        simpleHint.classList.add('hidden');
        if (data.triggerId) tiSelect.value = data.triggerId;
        if (data.source) srcSelect.value = data.source;
        if (data.fields) fieldsInput.value = data.fields.join(', ');
        if (data.filters) {
          const ff = FILTER_FIELDS[data.source] || null;
          for (const f of data.filters) addCondition(filtersList, dsSelect.value, f, null, ff);
        }
      }
    } else {
      // Event/device source
      const varId = data.id || data.value || '';
      if (varId) {
        const knownParam = (EVENT_VARIABLE_PARAMS[data.dataSource] || []).some(p => p.id === varId);
        if (knownParam) {
          paramSelect.value = varId;
          paramSelect.dispatchEvent(new Event('change'));
        } else {
          paramSelect.value = '__custom__';
          customIdRow.classList.remove('hidden');
          customIdInput.value = varId;
          paramSelect.dispatchEvent(new Event('change'));
        }
      }
    }
  }

  onFormChange();
}

/** Helper: replace all options in a <select> element. */
function _updateSelectOptions(select, options) {
  select.innerHTML = '';
  for (const opt of options) {
    if (typeof opt === 'string') select.append(h('option', { value: opt }, opt));
    else select.append(h('option', { value: opt.value }, opt.label));
  }
}

/**
 * Builds a flat <select> from endpoint params.
 * Format: "fieldId — description" for simple fields,
 *         "fieldId — description (array)" for array extraction.
 */
function _buildParamSelect(select, params) {
  select.innerHTML = '';
  select.append(h('option', { value: '' }, '\u2014 Select field \u2014'));

  for (const p of params) {
    const suffix = p.source ? ' (array)' : '';
    const label = `${p.id} \u2014 ${p.label}${suffix}`;
    select.append(h('option', { value: p.id }, label));
  }

  select.append(h('option', { value: '__custom__' }, '\u2014 Custom field \u2014'));
}

/**
 * Collects all (dataSource, triggerId) pairs from API triggers in the DOM.
 * Used to determine if triggerId disambiguation is needed for variables.
 */
function _collectApiTriggers(container) {
  const triggers = [];
  if (!container) container = document.getElementById('trigger-root');
  const triggerList = container.querySelector('[data-field="triggerList"]');
  if (!triggerList) return triggers;

  for (const card of triggerList.children) {
    if (card.dataset.isGroup === 'true') {
      const groupContainer = card.querySelector(':scope > div:last-child');
      if (groupContainer) triggers.push(..._collectApiTriggers(groupContainer));
    } else {
      const tc = card.querySelector(':scope > div:last-child');
      if (!tc) continue;
      const ds = tc.querySelector('[data-field="dataSource"]')?.value || '';
      const tid = tc.querySelector('[data-field="triggerId"]')?.value || '';
      if (ds && API_DATA_SOURCES.includes(ds)) triggers.push({ dataSource: ds, triggerId: tid });
    }
  }
  return triggers;
}

/**
 * Updates triggerId visibility on all variable cards.
 * Shows triggerId dropdown only when multiple triggers share a variable's data source.
 * Called from onFormChange() so it reacts to trigger expression changes.
 */
function _updateVariableVisibility() {
  const apiTriggers = _collectApiTriggers();
  const varList = document.getElementById('variables-list');

  for (const card of varList.querySelectorAll(':scope > .item-card')) {
    const ds = fieldVal(card, 'var-dataSource');
    const category = fieldVal(card, 'var-category');
    const tiRow = card.querySelector('[data-field="var-triggerId-row"]');
    const tiSelect = card.querySelector('[data-field="var-triggerId"]');
    if (!tiRow || !tiSelect || category !== 'api') continue;

    // Find triggers matching this variable's data source
    const matching = apiTriggers.filter(t => t.dataSource === ds && t.triggerId);
    const needsDisambiguation = matching.length >= 2;

    tiRow.classList.toggle('hidden', !needsDisambiguation);

    if (needsDisambiguation) {
      const currentVal = tiSelect.value;
      _updateSelectOptions(tiSelect, [
        { value: '', label: '(auto-detect)' },
        ...matching.map(t => ({ value: t.triggerId, label: t.triggerId }))
      ]);
      if (currentVal) tiSelect.value = currentVal;
    }
  }
}

/* =========================================================
   FOLLOW-UP CHOICE OPTIONS
   ========================================================= */

function collectSingleExpressions(expr, out = []) {
  if (!expr) return out;
  if (expr.type === 'SINGLE') {
    if (expr.id) out.push({ id: expr.id, dataSource: expr.dataSource || '' });
  } else if (Array.isArray(expr.expressions)) {
    expr.expressions.forEach(e => collectSingleExpressions(e, out));
  }
  return out;
}

/**
 * The output variables a choice follow-up can enumerate: list variables (source +
 * fields) with the trigger that delivers them. The engine reads a variable from
 * its explicit triggerId, otherwise from any expression with the variable's data
 * source; one that neither reaches never yields an option, and a rule with
 * options is held until one does - so only `backed` candidates are offered.
 */
function followUpOptionCandidates(rule) {
  const expressions = collectSingleExpressions(rule?.triggerExpression);
  const ids = new Set(expressions.map(e => e.id));
  const sameSource = ds => expressions.some(e => e.dataSource.toLowerCase() === String(ds || '').toLowerCase());
  return (rule?.output?.variables || [])
    .filter(v => v.id && v.source)
    .map(v => ({
      id: v.id,
      source: v.source,
      fields: Array.isArray(v.fields) ? v.fields : [],
      dataSource: v.dataSource || '',
      triggerId: v.triggerId || '',
      backed: v.triggerId ? ids.has(v.triggerId) : sameSource(v.dataSource)
    }));
}

/**
 * Why nothing can be offered: either no trigger of the rule returns a list (on-device
 * events carry single values), or one does and no variable reads it yet.
 */
function noCandidateHint(expressions) {
  const listTriggers = expressions.flatMap(e => {
    const endpoint = (API_ENDPOINTS[e.dataSource] || []).find(x => x.id === e.id);
    const sources = [...new Set((endpoint?.params || []).filter(p => p.source).map(p => p.source))];
    return sources.length ? [{ id: e.id, sources }] : [];
  });
  if (!listTriggers.length) {
    const named = expressions.map(e => e.id).filter(Boolean).join(', ');
    const subject = named
      ? `${named} deliver${expressions.length === 1 ? 's' : ''} single values, not a list`
      : 'No trigger of this rule returns a list';
    return `${subject}, so there is nothing to pick from. Keep this off for a yes / no question, or add a trigger that returns a list (a nearby-places search, the jobs API, trips).`;
  }
  return listTriggers
    .map(t => `${t.id} returns a ${t.sources.join(' / ')} list: add a variable with Source Key ${t.sources[0]} and Fields to offer it.`)
    .join(' ');
}

/** Primitive paths an option label can read, expanded from the variable's fields. */
function labelPathCandidates(candidate) {
  const nested = OPTION_LABEL_PATHS[candidate.source] || {};
  return candidate.fields.flatMap(f => nested[f] || [f]);
}

function parseFieldList(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Repopulates the options-variable select from the current form. Called on every
 * form change so adding a list variable or removing a trigger is reflected at once.
 * A selection that stops being offered is kept and labelled, never dropped silently.
 */
function renderFollowUpOptionCandidates(preferred, rule) {
  const select = document.getElementById('follow-up-options-variable');
  if (!select) return;
  if (!rule) {
    rule = {
      output: { variables: buildVariablesJSON() },
      triggerExpression: buildTriggerJSON(document.getElementById('trigger-root'))
    };
  }
  const candidates = followUpOptionCandidates(rule);
  const offered = candidates.filter(c => c.backed);
  const wanted = preferred !== undefined ? preferred : select.value;

  const options = [{
    value: '',
    label: offered.length ? '\u2014 Select variable \u2014' : '\u2014 No list variable reads from this rule\u2019s triggers \u2014'
  }];
  for (const c of offered) {
    options.push({ value: c.id, label: `${c.id} \u2014 ${c.source} list${c.triggerId ? ` from ${c.triggerId}` : ''}` });
  }
  if (wanted && !offered.some(c => c.id === wanted)) {
    const stale = candidates.find(c => c.id === wanted);
    options.push({
      value: wanted,
      label: `${wanted} \u2014 ${stale ? 'not read by any trigger in this rule' : 'not a list variable of this rule'}`
    });
  }
  _updateSelectOptions(select, options);
  select.value = wanted || '';

  const hint = document.getElementById('follow-up-options-variable-hint');
  if (hint) hint.textContent = offered.length
    ? 'The engine numbers the items when the rule fires; the answer carries the chosen item whole.'
    : noCandidateHint(collectSingleExpressions(rule.triggerExpression));

  renderFollowUpLabelChoices(candidates.find(c => c.id === select.value) || null);
}

/**
 * Clickable label-field chips over the chosen variable's fields. The text input is
 * the source of truth (its order is the spoken order); a chip adds or removes its
 * path there. Switching variable resets the input to the first two paths.
 */
function renderFollowUpLabelChoices(candidate) {
  const host = document.getElementById('follow-up-options-label-chips');
  const input = document.getElementById('follow-up-options-labels');
  if (!host || !input) return;
  const paths = candidate ? labelPathCandidates(candidate) : [];
  const variableId = candidate ? candidate.id : '';
  if (host.dataset.variable !== variableId) {
    host.dataset.variable = variableId;
    input.value = paths.slice(0, 2).join(', ');
  }
  const chosen = new Set(parseFieldList(input.value));
  host.innerHTML = '';
  for (const path of paths) {
    host.append(h('button', {
      type: 'button',
      className: `label-chip${chosen.has(path) ? ' active' : ''}`,
      onClick: () => {
        const current = parseFieldList(input.value);
        input.value = (current.includes(path) ? current.filter(p => p !== path) : [...current, path]).join(', ');
        renderFollowUpLabelChoices(candidate);
        onFormChange();
      }
    }, path));
  }
  host.classList.toggle('hidden', paths.length === 0);
}

/** Loads a followUp.options object (or null) into the form. */
function setFollowUpOptionsForm(options) {
  renderFollowUpOptionCandidates(options?.fromVariable || '');
  const labels = Array.isArray(options?.labelFields) ? options.labelFields.filter(l => typeof l === 'string') : [];
  document.getElementById('follow-up-options-labels').value = labels.join(', ');
  document.getElementById('follow-up-options-max').value = Number.isInteger(options?.max) ? options.max : '';
  renderFollowUpOptionCandidates();
}

function buildFollowUpOptionsJSON() {
  const options = {
    fromVariable: val('follow-up-options-variable'),
    labelFields: parseFieldList(val('follow-up-options-labels'))
  };
  const max = val('follow-up-options-max');
  if (max !== '') options.max = Number(max);
  return options;
}

/* =========================================================
   SCOPE WARNING SYSTEM
   Checks for incompatibilities between rule scope and
   variable data sources or trigger events.
   Scope hierarchy: activity < daily < global
   Trip can access all data; daily/global cannot access trip data.
   ========================================================= */

/**
 * Checks all variable cards and trigger cards for scope incompatibilities.
 * Shows inline warnings when activity-scoped data is used in daily/global rules.
 */
function checkScopeWarnings() {
  const scope = val('rule-scope') || 'global';

  // ── Variable scope warnings ──
  const varList = document.getElementById('variables-list');
  for (const card of varList.querySelectorAll(':scope > .item-card')) {
    const existing = card.querySelector('.scope-warning');
    if (existing) existing.remove();

    const ds = fieldVal(card, 'var-dataSource');
    if (!ds) continue;

    const req = VARIABLE_SCOPE[ds];
    if (req === 'activity' && !isActivityScope(scope)) {
      const warn = h('div', { className: 'scope-warning' },
        `${ds} data is activity-scoped \u2014 the buffer is cleared when the activity ends. ` +
        `This variable won\u2019t have data in \u201C${scope}\u201D scope. Consider using \u201Cactivity\u201D scope for this rule.`
      );
      card.append(warn);
    }
  }

  // ── Trigger scope warnings ──
  _checkTriggerScopeWarnings(document.getElementById('trigger-root'), scope);
}

/**
 * Recursively checks trigger expression cards for scope incompatibilities.
 */
function _checkTriggerScopeWarnings(container, scope) {
  if (!container) return;
  const triggerList = container.querySelector('[data-field="triggerList"]');
  if (!triggerList) return;

  for (const card of triggerList.children) {
    const existing = card.querySelector('.scope-warning');
    if (existing) existing.remove();

    if (card.dataset.isGroup === 'true') {
      const groupContainer = card.querySelector(':scope > div:last-child');
      if (groupContainer) _checkTriggerScopeWarnings(groupContainer, scope);
    } else {
      const triggerContainer = card.querySelector(':scope > div:last-child');
      if (!triggerContainer) continue;

      const tid = triggerContainer.querySelector('[data-field="triggerId"]')?.value || '';
      if (tid && ACTIVITY_ONLY_EVENTS.includes(tid) && !isActivityScope(scope)) {
        const warn = h('div', { className: 'scope-warning' },
          `\u201C${tid}\u201D is an activity-only event \u2014 it won\u2019t fire in \u201C${scope}\u201D scope. ` +
          `Use \u201Cactivity\u201D scope for rules with this trigger.`
        );
        card.append(warn);
      }
    }
  }
}

/* =========================================================
   JSON BUILDER
   Reads form DOM and constructs clean JSON output.
   ========================================================= */

/**
 * Builds the complete rule JSON from the current form state.
 */
function buildRuleJSON() {
  const rule = {};

  // -- Basics --
  const id = val('rule-id');
  if (id) rule.id = id;

  const desc = val('rule-description');
  if (desc) rule.description = desc;

  const scope = val('rule-scope');
  if (scope) rule.sessionScope = scope;

  const priority = intVal('rule-priority');
  if (priority > 0) rule.priority = priority;

  const topic = val('rule-topic');
  if (topic && topic !== '__new__') rule.topic = topic;

  // Omitted when automatic so documents for existing rules stay byte-identical.
  if (val('rule-conversation') === 'manual') rule.conversation = 'manual';

  // -- Throttle --
  const cooldown = intVal('throttle-cooldown') || 30;
  const maxTriggers = intVal('throttle-max') || 3;
  if (cooldown > 0 || maxTriggers > 0) {
    rule.throttle = {};
    if (cooldown > 0) rule.throttle.cooldownMinutes = cooldown;
    if (maxTriggers > 0) rule.throttle.maxTriggersPerDay = maxTriggers;
  }

  // -- Output --
  const outputEnabled = document.getElementById('output-enabled').checked;
  if (outputEnabled) {
    const instructions = val('output-instructions');
    if (instructions) {
      rule.output = { instructions };
      const tone = val('output-tone');
      if (tone) rule.output.tone = tone;

      const variables = buildVariablesJSON();
      if (variables.length > 0) rule.output.variables = variables;
    }
  }

  // -- Conversational follow-up --
  if (document.getElementById('follow-up-enabled')?.checked) {
    rule.followUp = {
      id: val('follow-up-id') || defaultFollowUpId(),
      question: val('follow-up-question')
    };
    if (document.getElementById('follow-up-options-enabled')?.checked) {
      rule.followUp.options = buildFollowUpOptionsJSON();
    }
  }

  // -- Trigger Expression --
  const triggerRoot = document.getElementById('trigger-root');
  const trigger = buildTriggerJSON(triggerRoot);
  if (trigger) rule.triggerExpression = trigger;

  return rule;
}

/**
 * Builds trigger expression JSON from a container element.
 */
function buildTriggerJSON(container) {
  const triggerList = container.querySelector('[data-field="triggerList"]');
  if (!triggerList) return null;

  const cards = Array.from(triggerList.children);
  if (cards.length === 0) return null;

  // Single trigger -> SINGLE type
  if (cards.length === 1 && !cards[0].dataset.isGroup) {
    const triggerContainer = cards[0].querySelector(':scope > div:last-child');
    if (!triggerContainer) return null;
    return buildSingleTriggerJSON(triggerContainer);
  }

  // Multiple triggers -> GROUP type
  const trigger = { type: 'GROUP' };
  const gtRadio = container.querySelector('input[type="radio"]:checked');
  if (gtRadio) trigger.groupType = gtRadio.value;
  else trigger.groupType = 'AND';

  const expressions = [];
  for (const card of cards) {
    if (card.dataset.isGroup === 'true') {
      const groupContainer = card.querySelector(':scope > div:last-child');
      if (groupContainer) {
        const expr = buildTriggerJSON(groupContainer);
        if (expr) expressions.push(expr);
      }
    } else {
      const triggerContainer = card.querySelector(':scope > div:last-child');
      if (triggerContainer) {
        const expr = buildSingleTriggerJSON(triggerContainer);
        if (expr) expressions.push(expr);
      }
    }
  }

  if (expressions.length > 0) trigger.expressions = expressions;
  return trigger;
}

function buildSingleTriggerJSON(container) {
  const trigger = { type: 'SINGLE' };

  const idEl = container.querySelector('[data-field="triggerId"]');
  if (idEl?.value) trigger.id = idEl.value;

  const dsEl = container.querySelector('[data-field="dataSource"]');
  if (dsEl?.value) trigger.dataSource = dsEl.value;

  // Conditions
  const condList = container.querySelector('[data-field="conditions"]');
  if (condList) {
    const conditions = buildConditionsJSON(condList);
    if (conditions.length > 0) trigger.conditions = conditions;
  }

  // Extracted Parameters
  const epEl = container.querySelector('[data-field="extractedParameters"]');
  if (epEl?.value) {
    const params = epEl.value.split(',').map(s => s.trim()).filter(Boolean);
    if (params.length > 0) trigger.extractedParameters = params;
  }

  // POI
  const poiContainer = container.querySelector('[data-field="poi-container"]');
  if (poiContainer && !poiContainer.classList.contains('hidden')) {
    const cb = poiContainer.querySelector('input[type="checkbox"]');
    if (cb?.checked) {
      const lat = numVal(poiContainer.querySelector('[data-field="poi-lat"]'));
      const lng = numVal(poiContainer.querySelector('[data-field="poi-lng"]'));
      const radius = poiContainer.querySelector('[data-field="poi-radius"]')?.value;
      if (radius) {
        trigger.POI = { coordinates: { lat: lat || 0, lng: lng || 0 }, radius };
      }
    }
  }

  // dateRangeInDays
  const drEl = container.querySelector('[data-field="dateRangeInDays"]');
  if (drEl?.value) trigger.dateRangeInDays = parseInt(drEl.value);

  // An imported block is kept even once the trigger is no longer a places one, so
  // that the endpoint mismatch gets reported instead of silently disappearing.
  const searchContainer = container.querySelector('[data-field="search-container"]');
  if (searchContainer && (!searchContainer.classList.contains('hidden') || searchContainer.dataset.declared === '1')) {
    trigger.search = buildSearchJSON(searchContainer);
  }

  return trigger;
}

/**
 * Builds conditions JSON from a conditions list container.
 */
function buildConditionsJSON(condList) {
  const conditions = [];
  for (const card of condList.querySelectorAll(':scope > .item-card')) {
    const typeEl = card.querySelector('[data-field="conditionType"]');
    if (!typeEl) continue;
    const type = typeEl.value;
    const fieldsContainer = card.querySelector('.item-fields');
    if (!fieldsContainer) continue;

    const cond = buildSingleConditionJSON(fieldsContainer, type);
    if (cond) conditions.push(cond);
  }
  return conditions;
}

function buildSingleConditionJSON(container, type) {
  const cond = { type };

  switch (type) {
    case 'Value': {
      const param = fieldVal(container, 'parameter');
      if (param) cond.parameter = param;
      const op = fieldVal(container, 'operator');
      if (op) cond.operator = op;

      const valueEl = container.querySelector('[data-field="value"]');
      if (valueEl) {
        cond.value = parseConditionValue(valueEl);
      }

      const valueEventName = fieldVal(container, 'eventName');
      if (valueEventName) cond.eventName = valueEventName;

      const source = fieldVal(container, 'source');
      if (source) cond.source = source;
      break;
    }
    case 'TimeRange':
      cond.from = fieldVal(container, 'from') || '';
      cond.to = fieldVal(container, 'to') || '';
      break;
    case 'Time':
      cond.operator = fieldVal(container, 'operator') || '==';
      cond.value = fieldVal(container, 'value') || '';
      break;
    case 'Comparison':
      const cparam = fieldVal(container, 'parameter');
      if (cparam) cond.parameter = cparam;
      const lb = fieldVal(container, 'leaderboardId');
      if (lb) cond.leaderboardId = lb;
      cond.firstPeriod = fieldVal(container, 'firstPeriod') || 'currentMonth';
      cond.secondPeriod = fieldVal(container, 'secondPeriod') || 'lastMonth';
      cond.operator = fieldVal(container, 'operator') || '<';
      cond.value = fieldVal(container, 'value') || '0';
      break;
    case 'EventCount':
      cond.eventName = fieldVal(container, 'eventName') || '';
      cond.operator = fieldVal(container, 'operator') || '>=';
      const ecVal = container.querySelector('[data-field="value"]');
      cond.value = ecVal ? parseInt(ecVal.value) || 0 : 0;
      break;
    case 'RelativeTimeWindow':
      cond.parameter = fieldVal(container, 'parameter') || '';
      cond.fromNow = fieldVal(container, 'fromNow') || '';
      break;
    case 'Aggregate': {
      cond.eventName = fieldVal(container, 'eventName') || '';
      cond.op = fieldVal(container, 'op') || 'max';
      // count reduces events rather than a field, so omit field entirely.
      if (cond.op !== 'count') {
        const aggField = fieldVal(container, 'field');
        if (aggField) cond.field = aggField;
      }
      cond.operator = fieldVal(container, 'operator') || '>';
      const agVal = container.querySelector('[data-field="value"]');
      cond.value = agVal ? parseFloat(agVal.value) || 0 : 0;
      cond.window = fieldVal(container, 'window') || '';
      const agScope = fieldVal(container, 'scope');
      if (agScope) cond.scope = agScope;
      break;
    }
  }

  return cond;
}

/**
 * Coerces one typed-in token to the JSON type its parameter is emitted in.
 *
 * `paramType` is the type config.js declares for the parameter; an unrecognised parameter falls
 * back to detecting the type from what was typed, which is what scalar values have always done.
 */
function coerceConditionScalar(raw, paramType) {
  const text = String(raw).trim();
  if (text === '') return '';

  if (paramType === 'int' || paramType === 'double') {
    const num = Number(text);
    return Number.isFinite(num) ? num : text;
  }
  if (paramType === 'bool') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
  if (paramType === 'enum' || paramType === 'string') {
    return text;
  }

  if (text === 'true') return true;
  if (text === 'false') return false;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

/**
 * Parses a condition value based on its type annotation.
 *
 * Scalars auto-detected numbers while `in` sets were always split into strings, so one builder
 * emitted `"value": 4` and `"value": ["4"]` for the same parameter. Both go through
 * coerceConditionScalar now.
 */
function parseConditionValue(el) {
  const raw = el.value;
  const vtype = el.dataset.valueType;
  const paramType = el.dataset.paramType || '';

  if (vtype === 'array') {
    const items = raw.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => coerceConditionScalar(s, paramType));

    // One parameter arrives as one type, so a set of mixed types can never match on every
    // element. With no declared type, all-or-nothing detection keeps the set homogeneous:
    // "4, 8, 12" becomes numbers, "MON, TUE" strings, and "4, MON" stays strings rather than
    // silently splitting into both.
    if (!paramType && items.some(i => typeof i === 'number') && !items.every(i => typeof i === 'number')) {
      return items.map(String);
    }
    return items;
  }
  if (vtype === 'integer') {
    return parseInt(raw) || 0;
  }
  if (vtype === 'string') {
    return raw;
  }
  return coerceConditionScalar(raw, paramType);
}

/**
 * Builds variables JSON from the variables list.
 */
function buildVariablesJSON() {
  const list = document.getElementById('variables-list');
  const variables = [];
  for (const card of list.querySelectorAll(':scope > .item-card')) {
    const v = {};
    const ds = fieldVal(card, 'var-dataSource');
    if (ds) v.dataSource = ds;

    // ID: from param dropdown or custom input
    const param = fieldVal(card, 'var-param');
    if (param && param !== '__custom__') {
      v.id = param;
    } else {
      const customId = fieldVal(card, 'var-id');
      if (customId) v.id = customId;
    }

    const category = fieldVal(card, 'var-category');

    // For API sources, include triggerId from the selected endpoint
    // when it differs from the variable ID (complex extraction needs it)
    if (category === 'api') {
      const epId = fieldVal(card, 'var-endpoint');

      // API extraction fields (only when visible)
      const apiSection = card.querySelector('[data-field="var-api-fields"]');
      if (apiSection && !apiSection.classList.contains('hidden')) {
        // Explicit triggerId from extraction fields takes priority
        const ti = fieldVal(card, 'var-triggerId');
        if (ti) {
          v.triggerId = ti;
        } else if (epId && v.id !== epId) {
          // Endpoint ID as triggerId when param ID differs
          v.triggerId = epId;
        }
        const src = fieldVal(card, 'var-source');
        if (src) v.source = src;
        const fieldsStr = fieldVal(card, 'var-fields');
        if (fieldsStr) v.fields = fieldsStr.split(',').map(s => s.trim()).filter(Boolean);

        const filtersList = card.querySelector('[data-field="var-filters"]');
        if (filtersList) {
          const filters = buildConditionsJSON(filtersList);
          if (filters.length > 0) v.filters = filters;
        }
      }
    }

    if (v.dataSource && v.id) variables.push(v);
  }
  return variables;
}

// Helper: get value of an element by ID
function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
function intVal(id) { return parseInt(document.getElementById(id)?.value) || 0; }
function numVal(el) { return el ? parseFloat(el.value) || 0 : 0; }
function fieldVal(container, field) {
  const el = container.querySelector(`[data-field="${field}"]`);
  return el?.value?.trim() || '';
}

function saveActiveRule() {
  if (activeRuleIndex >= 0 && activeRuleIndex < rules.length) {
    rules[activeRuleIndex] = buildRuleJSON();
  }
}

function addNewRule() {
  saveActiveRule();
  if (rules.some(ruleIsStarted) && !confirm('Start a new rule? Upload or export your current rule first. Continuing will discard this draft.')) return;
  rules = [blankRule()];
  activeRuleIndex = 0;
  topicConfigs = {};
  _setLoadedBadge(null);
  populateFormFromRule(rules[0]);
  updatePreview();
  showToast('New rule started');
}

function renderRuleList() {
  const list = document.getElementById('rule-list');
  list.innerHTML = '';
  const rule = rules[activeRuleIndex];
  if (!rule) return;
  list.append(h('div', { className: 'rule-list-item active' },
    h('span', { className: 'rule-list-id' }, rule.id || '(untitled rule)'),
    h('span', { className: 'rule-list-scope' },
      rule.conversation === 'manual'
        ? `${rule.sessionScope || 'global'} · manual`
        : (rule.sessionScope || 'global'))
  ));
}

/* =========================================================
   PREVIEW & SYNTAX HIGHLIGHTING
   ========================================================= */

let _previewDebounce = null;

function onFormChange() {
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(updatePreview, 150);
}

function updatePreview() {
  saveActiveRule();
  const jsonStr = JSON.stringify(buildDocument(rules), null, 2);
  const highlighted = syntaxHighlight(jsonStr);

  document.getElementById('preview-body').innerHTML = highlighted;

  // Meta info
  const bytes = new Blob([jsonStr]).size;
  const lines = jsonStr.split('\n').length;
  document.getElementById('preview-meta').textContent =
    `1 rule, ${lines} lines, ${bytes} bytes`;

  // Live validation (non-blocking) — the schema validator checks the rules array
  liveValidate(rules);
  renderRuleList();
  renderTopicPanel();
  checkScopeWarnings();
  _updateVariableVisibility();
  renderFollowUpOptionCandidates(undefined, rules[activeRuleIndex]);
  renderSearchDestinationCandidates();
}

/**
 * Syntax-highlights a JSON string.
 */
function syntaxHighlight(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    function(match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

/* =========================================================
   VALIDATION
   ========================================================= */

function liveValidate(jsonArray) {
  const panel = document.getElementById('preview-validation');
  const results = validateRule(jsonArray);
  showValidation(panel, results);
  highlightErrorFields(jsonArray);
}

function validateAndShow() {
  saveActiveRule();
  const results = validateRule(rules);
  const panel = document.getElementById('preview-validation');
  showValidation(panel, results);
  highlightErrorFields(rules);
  if (results.valid) showToast('Validation passed!');
}

/**
 * Migrates legacy fields in an imported rule to their current equivalents.
 * "trip" was the pre-rename name of the activity session scope; the engine
 * no longer accepts it, so it is upgraded on import.
 */
function migrateRule(rule) {
  if (rule && rule.sessionScope === 'trip') rule.sessionScope = 'activity';
  if (rule && rule.topic != null) {
    const t = normalizeTopic(rule.topic);
    if (t) rule.topic = t; else delete rule.topic;
  }
  // The engine parses the mode case-insensitively; the schema enum does not.
  if (rule && rule.conversation != null) {
    const c = String(rule.conversation).trim().toLowerCase();
    if (c === 'manual') rule.conversation = 'manual'; else delete rule.conversation;
  }
  if (rule?.triggerExpression) {
    migrateLegacyRadius(rule.triggerExpression);
    migrateSearchDestination(rule.triggerExpression);
  }
  return rule;
}

function readSingleRuleDocument(parsed) {
  const envelope = Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.rules
    ? parsed[0] : parsed;
  const loaded = Array.isArray(envelope) ? envelope : (envelope?.rules ?? [envelope]);
  if (!Array.isArray(loaded) || loaded.length !== 1) {
    throw new Error('Import exactly one rule at a time. Split multi-rule files into separate files.');
  }
  if (!loaded[0] || typeof loaded[0] !== 'object' || Array.isArray(loaded[0]) || loaded[0].rules) {
    throw new Error('The file must contain one rule or one document with a single rule.');
  }
  return { loaded, topics: envelope.topics };
}

function uploadJSON(input) {
  const file = input.files[0];
  input.value = ''; // reset so same file can be re-uploaded
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch (err) {
      showToast(`Invalid JSON: ${err.message}`, 5000);
      return;
    }

    let loaded, topics;
    try {
      ({ loaded, topics } = readSingleRuleDocument(parsed));
    } catch (err) {
      showToast(err.message, 5000);
      return;
    }
    loaded.forEach(migrateRule);

    // Validate using the existing validation pipeline
    const results = validateRule(loaded);
    const panel = document.getElementById('preview-validation');
    showValidation(panel, results);

    // Load into editor regardless of errors so the user can fix them
    rules = loaded.map(r => JSON.parse(JSON.stringify(r)));
    activeRuleIndex = 0;
    topicConfigs = _adoptTopicConfigs(topics);
    _setLoadedBadge(null);
    adoptProductFromRules(); // before rendering, so dropdowns offer the file's product
    populateFormFromRule(rules[0]);
    showScopeHint();
    renderRuleList();
    updatePreview();
    highlightErrorFields(rules);
    _warnNearDuplicateTopics();

    if (results.valid) {
      showToast('Rule loaded — validation passed!', 4000);
    } else {
      showToast(`Loaded with ${results.errors.length} error(s) — see validation panel.`, 5000);
    }
  };
  reader.readAsText(file);
}

function _resolveInstancePath(root, pointer) {
  let node = root;
  for (const part of pointer.split('/').slice(1)) {
    if (node == null) return undefined;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node;
}

/* Discriminated-union branch info derived from rule-schema.json: maps each
   "type" const (SINGLE, GROUP, Value, TimeRange, ...) to the union of the
   required/allowed properties of the definitions carrying that const. Built
   lazily from the fetched schema so it stays in sync as the schema evolves. */
let _branchTypeInfo = null;
function _getBranchTypeInfo() {
  if (!_branchTypeInfo && schema && schema.definitions) {
    _branchTypeInfo = {};
    for (const def of Object.values(schema.definitions)) {
      const t = def && def.properties && def.properties.type && def.properties.type.const;
      if (!t) continue;
      const info = _branchTypeInfo[t] || (_branchTypeInfo[t] = { required: new Set(), props: new Set() });
      (def.required || []).forEach(p => info.required.add(p));
      Object.keys(def.properties).forEach(p => info.props.add(p));
    }
  }
  return _branchTypeInfo || {};
}

/**
 * Tames Ajv's anyOf/oneOf error explosion, where one real problem surfaces as
 * an error per failed branch plus the combinator itself. Drops errors coming
 * from discriminated branches the object's "type" doesn't select, folds
 * either-or required-property alternatives into a single message, drops the
 * bare combinator wrapper errors (they carry no info beyond their branch
 * errors), and dedupes what remains.
 */
function _filterSchemaErrors(rawErrors, jsonArray) {
  const branchInfo = _getBranchTypeInfo();
  const out = [];
  const eitherOr = new Map(); // instancePath + anyOf schema path -> folded required props
  for (const err of rawErrors) {
    if (err.keyword === 'anyOf' || err.keyword === 'oneOf') continue;
    // Ajv reports the failed if/then pair as well as the branch error inside it;
    // "must match \"then\" schema" adds nothing to the branch error it wraps.
    if (err.keyword === 'if') continue;
    // A field forbidden by the active search mode fails a `not`, which Ajv can only
    // report as "must NOT be valid" without naming it. validateSearch names it.
    if (err.keyword === 'not' && err.instancePath.includes('/search')) continue;

    // Errors from oneOf branches the object's declared "type" doesn't select
    const target = _resolveInstancePath(jsonArray, err.instancePath.replace(/\/type$/, ''));
    const info = target && typeof target === 'object' && typeof target.type === 'string'
      ? branchInfo[target.type] : undefined;
    if (info) {
      // The selected branch's own const passes, so a const failure on "type"
      // can only come from a non-selected branch
      if (err.keyword === 'const' && err.instancePath.endsWith('/type')) continue;
      if (err.keyword === 'required' && !info.required.has(err.params.missingProperty)) continue;
      if (err.keyword === 'additionalProperties' && info.props.has(err.params.additionalProperty)) continue;
    }

    const anyOfBase = (err.schemaPath.match(/^(.*\/anyOf)\/\d+\/required$/) || [])[1];
    if (anyOfBase && err.keyword === 'required') {
      const key = `${err.instancePath}|${anyOfBase}`;
      if (!eitherOr.has(key)) eitherOr.set(key, { err, props: [] });
      eitherOr.get(key).props.push(err.params.missingProperty);
      continue;
    }

    out.push(err);
  }
  for (const { err, props } of eitherOr.values()) {
    out.push({ ...err, message: `must have required property ${props.map(p => `'${p}'`).join(' or ')}` });
  }
  const seen = new Set();
  return out.filter(err => {
    const key = `${err.instancePath}|${err.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validates rule JSON. Returns { valid, errors[], warnings[] }.
 */
function validateRule(jsonArray) {
  const errors = [];
  const warnings = [];

  if (jsonArray.length !== 1) {
    errors.push('The builder requires exactly one rule per upload.');
  }

  // Schema validation (if available)
  if (schemaValidator) {
    const valid = schemaValidator(jsonArray);
    if (!valid && schemaValidator.errors) {
      for (const err of _filterSchemaErrors(schemaValidator.errors, jsonArray)) {
        errors.push(`${err.instancePath || '/'}: ${err.message}`);
      }
    }
  }

  // The stamp is what an engine checks before reading anything, and it rejects the whole
  // document rather than the offending rule. Publishing a set that needs grammar no released
  // engine has therefore takes down every rule in it, including ones that ran yesterday.
  const needs = requiredSchemaVersion(jsonArray);
  if (compareSchemaVersions(needs, RELEASED_SCHEMA_VERSION) > 0) {
    warnings.push(
      `This set uses schema ${needs} grammar, and the newest released engine accepts up to ` +
      `${RELEASED_SCHEMA_VERSION}. Devices on it reject the whole document — every rule here, not ` +
      `only the ones using the new grammar. Hold it back until the release carrying schema ${needs} ships.`
    );
  }

  // A rule set is deployed to one app, so it must target a single product.
  // The product switch blocks this while editing, but an uploaded JSON file can
  // still arrive mixed — this is where that gets caught.
  const productsInSet = new Set();
  for (const rule of jsonArray) {
    for (const id of ruleProductIds(rule)) productsInSet.add(id);
  }
  if (productsInSet.size > 1) {
    const names = [...productsInSet].map(id => (PRODUCTS.find(p => p.id === id) || {}).label || id);
    errors.push(
      `Rule set mixes ${names.join(' and ')} data sources. A rule set must target a single product.`
    );
  }

  // Custom validations
  const ruleIds = new Set();
  for (let idx = 0; idx < jsonArray.length; idx++) {
    const rule = jsonArray[idx];
    const prefix = jsonArray.length > 1 ? `Rule "${rule.id || idx + 1}": ` : '';

    if (!rule.id) errors.push(`${prefix}Rule ID is required`);
    if (rule.id && ruleIds.has(rule.id)) errors.push(`${prefix}Duplicate rule ID "${rule.id}"`);
    if (rule.id) ruleIds.add(rule.id);
    if (!rule.triggerExpression) errors.push(`${prefix}Trigger expression is required`);
    if (!rule.output) {
      errors.push(`${prefix}"output" is required`);
    }
    if (rule.output && !rule.output.instructions) {
      errors.push(`${prefix}Output requires non-empty "instructions"`);
    }
    if (rule.followUp && !rule.output) {
      errors.push(`${prefix}A conversational follow-up requires "output"`);
    }
    if (rule.followUp && !rule.followUp.question?.trim()) {
      errors.push(`${prefix}Follow-up question is required`);
    }
    validateFollowUpOptions(rule, errors, warnings, prefix);

    // Scope-event warnings
    const scope = rule.sessionScope || 'global';
    if (!isActivityScope(scope)) {
      const triggerIds = collectTriggerIds(rule.triggerExpression);
      for (const tid of triggerIds) {
        if (ACTIVITY_ONLY_EVENTS.includes(tid)) {
          warnings.push(`${prefix}"${tid}" only fires in the activity scope, but rule scope is "${scope}"`);
        }
      }
    }

    // Trigger ID vs data source warnings
    validateTriggerDataSource(rule.triggerExpression, warnings);

    // Mojo parameters that are ambiguous or no longer exist
    validateMojoConditions(rule.triggerExpression, warnings, prefix);

    // Required fields on every SINGLE expression (blocks publish)
    validateTriggerFields(rule.triggerExpression, errors, prefix);

    // Required conditions check
    validateRequiredConditions(rule.triggerExpression, errors, prefix);

    // Job destination triggers must not have conditions
    validateNoConditions(rule.triggerExpression, errors, prefix);

    // Condition field content validation (format, required fields per type)
    validateConditionFields(rule.triggerExpression, errors, prefix);

    // Value shape against the operator reading it, and value type against the parameter
    validateValueConditionTypes(rule.triggerExpression, errors, warnings, prefix);

    // Place-search block, mode consistency and destination boundaries
    validateSearch(rule, errors, warnings, prefix);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

const SEARCH_MODE_LIST = SEARCH_MODES.map(m => m.id).join(', ');
const SEARCH_ALLOWED_FIELDS = ['mode', 'destination', 'point', 'radius', 'maxDetourMeters', 'query', 'limit'];
const SEARCH_NUMBER_FIELDS = ['radius', 'maxDetourMeters', 'limit'];
const PLACE_CATEGORY_LIST = NEARBY_PLACE_CATEGORIES.join(', ');
const SEARCH_DESTINATION_FIELDS = ['triggerId', 'latField', 'lngField'];
const LEGACY_RADIUS_PARAMETER = 'radius';

/** A key absent and a key set to JSON null are the same thing to the engine. */
function declaredValue(obj, key) {
  const v = obj?.[key];
  return v === null ? undefined : v;
}
function hasKey(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Key order is not part of JsonObject equality, so it must not be part of this either. */
function canonicalJson(value) {
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Mirrors RulesValidator.forEachSingleExpression, paths included. */
function forEachSingleExpression(expr, path, action) {
  if (!isPlainObject(expr)) return;
  if (!Array.isArray(expr.expressions)) { action(expr, path); return; }
  expr.expressions.forEach((e, i) => forEachSingleExpression(e, `${path}.expressions[${i}]`, action));
}

function isExternalSourceName(dataSource) {
  return String(dataSource || '').toLowerCase() === 'external source';
}
function isMzoneName(dataSource) {
  return String(dataSource || '').toUpperCase() === 'MZONE';
}

/**
 * Which places grammar an expression is written in, or null when it is not a
 * place search at all. Mirrors RulesValidator.placesPrefixOf: `nearby_*` counts
 * only on MZONE and `google_nearby_*` only on External Source, so an id that
 * collides with another source's event stream is never read as a search.
 */
function placesPrefixOf(id, dataSource) {
  if (typeof id !== 'string') return null;
  if (isMzoneName(dataSource) && id.startsWith(PLACES_PREFIX)) return PLACES_PREFIX;
  if (isExternalSourceName(dataSource) && id.startsWith(LEGACY_PLACES_PREFIX)) return LEGACY_PLACES_PREFIX;
  return null;
}
function isPlacesExpressionJSON(expr) {
  const prefix = placesPrefixOf(expr?.id, expr?.dataSource);
  return prefix !== null && expr.id.length > prefix.length;
}
function placesSuffixOf(id, dataSource) {
  const prefix = placesPrefixOf(id, dataSource);
  return prefix === null ? null : id.slice(prefix.length);
}

/** The category a suffix names, or null when it is a free-text label. */
function placeCategoryOf(suffix, prefix) {
  if (prefix === LEGACY_PLACES_PREFIX) return LEGACY_PLACE_TYPES[suffix] || null;
  return NEARBY_PLACE_CATEGORIES.includes(suffix) ? suffix : null;
}

/** The category a suffix was meant to be when it differs only in case or separators. */
function suggestPlaceCategory(suffix) {
  const normalized = String(suffix).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized) return null;
  return NEARBY_PLACE_CATEGORIES.find(c => c.toLowerCase() === normalized) || null;
}

function searchNumberError(searchPath, field, value) {
  const number = typeof value === 'number' ? value : null;
  if (number !== null && Number.isInteger(number) && number >= 1) return null;
  const quoted = typeof value === 'string' && Number.isFinite(Number(value)) && value.trim() !== '';
  const spelling = quoted ? ' (a quoted number is a string)' : '';
  return `${searchPath}.${field} must be an integer of at least 1${spelling} - got ${JSON.stringify(value)}`;
}

/**
 * Mirrors RulesValidator.validateSearch so the panel says what CI will. Messages are
 * kept word-for-word; only the rule prefix replaces the engine's "[i]." index.
 */
function validateSearch(rule, errors, warnings, prefix) {
  const expressions = [];
  const searching = new Set();
  const blocksById = new Map();

  forEachSingleExpression(rule?.triggerExpression, 'triggerExpression', (expr) => {
    if (typeof expr.id === 'string' && typeof expr.dataSource === 'string') {
      expressions.push({ id: expr.id, dataSource: expr.dataSource });
    }
    if (typeof expr.id !== 'string') return;
    const block = declaredValue(expr, 'search');
    if (block !== undefined) searching.add(expr.id);
    if (!blocksById.has(expr.id)) blocksById.set(expr.id, new Set());
    blocksById.get(expr.id).add(canonicalJson(block));
  });

  for (const [id, blocks] of blocksById) {
    if (blocks.size > 1) {
      errors.push(`${prefix}triggerExpression uses id '${id}' with different search blocks; variables and destination references require one search per trigger id within a rule`);
    }
  }

  forEachSingleExpression(rule?.triggerExpression, 'triggerExpression', (expr, path) => {
    const isPlaces = isPlacesExpressionJSON(expr);
    const placesPrefix = placesPrefixOf(expr?.id, expr?.dataSource);
    if (placesPrefix !== null) {
      validatePlacesSubject(expr, `${prefix}${path}`, placesPrefix, errors, warnings);
    }

    if (declaredValue(expr, 'POI') !== undefined) {
      warnings.push(isPlaces
        ? `${prefix}${path}.POI is read nowhere; a fixed anchor is search.point with "mode": "near_point"`
        : `${prefix}${path}.POI is read nowhere and can be removed; search is accepted only on a places expression (${PLACES_PREFIX}<Category> on MZONE), so there is nothing to move it to here`);
    }

    if (isPlaces && Array.isArray(expr.conditions)) {
      expr.conditions.forEach((co, ci) => {
        if (!isPlainObject(co) || co.type !== 'Value' || co.parameter !== LEGACY_RADIUS_PARAMETER) return;
        warnings.push(`${prefix}${path}.conditions[${ci}] 'radius' is superseded by search.radius: it is lifted into search.radius and is no longer evaluated`);
        if (legacyRadiusValue(co.value) === null) {
          errors.push(`${prefix}${path}.conditions[${ci}].value legacy radius must be a positive integer - got ${JSON.stringify(co.value)}`);
        }
      });
    }

    const element = declaredValue(expr, 'search');
    if (element === undefined) return;

    const searchPath = `${path}.search`;
    if (!isPlainObject(element)) {
      errors.push(`${prefix}${searchPath} must be an object`);
      return;
    }
    const search = element;

    if (!isPlaces) {
      errors.push(`${prefix}${searchPath} is only supported on a places expression - ${PLACES_PREFIX}<Category> on MZONE, or a deprecated ${LEGACY_PLACES_PREFIX}* on External Source; '${expr.id}' (${expr.dataSource}) has no request builder that reads it, so it would be silently ignored`);
    }

    for (const field of Object.keys(search)) {
      if (!SEARCH_ALLOWED_FIELDS.includes(field)) {
        errors.push(`${prefix}${searchPath}.${field} is not supported`);
      }
    }

    const declaredMode = declaredValue(search, 'mode');
    const modeString = typeof declaredMode === 'string' ? declaredMode : null;
    const mode = SEARCH_MODES.some(m => m.id === modeString) ? modeString : null;
    if (mode === null) {
      if (declaredMode === undefined) {
        errors.push(`${prefix}${searchPath}.mode is required and must be one of ${SEARCH_MODE_LIST}`);
      } else if (modeString === null) {
        errors.push(`${prefix}${searchPath}.mode must be a string, one of ${SEARCH_MODE_LIST} - got ${JSON.stringify(declaredMode)}`);
      } else {
        errors.push(`${prefix}${searchPath}.mode '${modeString}' is not one of ${SEARCH_MODE_LIST}. An unknown mode is never read as a nearby search`);
      }
    }

    const hasDestination = hasKey(search, 'destination');
    const hasPoint = hasKey(search, 'point');
    const hasDetour = hasKey(search, 'maxDetourMeters');

    if (mode !== null) {
      const needsDestination = mode === 'along_route' || mode === 'near_destination';
      if (needsDestination && !hasDestination) {
        errors.push(`${prefix}${searchPath}.destination is required for mode '${mode}'`);
      }
      if (!needsDestination && hasDestination) {
        errors.push(`${prefix}${searchPath}.destination is not allowed for mode '${mode}'`);
      }
      if (mode === 'near_point' && !hasPoint) {
        errors.push(`${prefix}${searchPath}.point is required for mode '${mode}'`);
      }
      if (mode !== 'near_point' && hasPoint) {
        errors.push(`${prefix}${searchPath}.point is not allowed for mode '${mode}'`);
      }
      if (mode !== 'along_route' && hasDetour) {
        errors.push(`${prefix}${searchPath}.maxDetourMeters is only allowed for mode 'along_route'`);
      }
      if (mode === 'along_route' && !hasDetour) {
        errors.push(`${prefix}${searchPath}.maxDetourMeters is required for mode '${mode}'`);
      }
    }

    if (hasDestination) {
      validateSearchDestination(search.destination, `${prefix}${searchPath}.destination`, expr.id, expressions, searching, errors, warnings);
    }
    if (hasPoint) {
      validateSearchPoint(search.point, `${prefix}${searchPath}.point`, errors);
    }

    for (const field of SEARCH_NUMBER_FIELDS) {
      if (!hasKey(search, field)) continue;
      const message = searchNumberError(`${prefix}${searchPath}`, field, search[field]);
      if (message) errors.push(message);
    }

    if (hasKey(search, 'query')) {
      const query = declaredValue(search, 'query');
      if (typeof query !== 'string' || query.trim() === '') {
        errors.push(`${prefix}${searchPath}.query must be a non-blank string - got ${JSON.stringify(query)}`);
      }
    }
  });
}

/**
 * What a place search is for. Mirrors RulesValidator.validatePlacesSubject: the
 * subject lives in the id suffix - a category the backend knows, or a label of
 * the author's own with search.query beside it - so a misspelt category is not a
 * category at all, and `query` on a category id would narrow it without saying so.
 */
function validatePlacesSubject(expr, path, prefix, errors, warnings) {
  const suffix = expr.id.slice(prefix.length);
  const search = isPlainObject(expr.search) ? expr.search : null;
  const declaredQuery = declaredValue(search, 'query');

  if (suffix === '') {
    errors.push(`${path}.id '${expr.id}' has nothing after '${prefix}', so the search has no subject. The suffix is either a place category - one of ${PLACE_CATEGORY_LIST} - or a label of your own for a free-text search, which then says what to look for in search.query`);
    return;
  }

  const legacyCategory = prefix === LEGACY_PLACES_PREFIX ? (LEGACY_PLACE_TYPES[suffix] || null) : null;
  if (prefix === LEGACY_PLACES_PREFIX) {
    if (legacyCategory === null) {
      errors.push(`${path}.id '${expr.id}' names nothing the engine can ask for: '${suffix}' has no category on the MZone endpoint that replaced the Google one (the types still mapped are ${Object.keys(LEGACY_PLACE_TYPES).sort().join(', ')}). Write it as '${PLACES_PREFIX}<Category>' on MZONE - one of ${PLACE_CATEGORY_LIST} - or as a free-text search declaring search.query`);
      return;
    }
    warnings.push(`${path}.id '${expr.id}' is deprecated; the replacement is id '${PLACES_PREFIX}${legacyCategory}' on dataSource 'MZONE'. It still works: the search is sent as category '${legacyCategory}' and the response is still stored under 'External Source', so this rule's conditions and variables keep resolving`);
  }

  const category = legacyCategory || placeCategoryOf(suffix, prefix);
  if (category !== null) {
    if (declaredQuery !== undefined) {
      errors.push(`${path}.search.query is not allowed on '${expr.id}': the id already names the category '${category}', and a query would silently narrow it to something the category no longer describes. A free-text search is its own expression, with a label of your own as the suffix`);
    }
    return;
  }
  if (declaredQuery !== undefined) return;

  const suggestion = suggestPlaceCategory(suffix);
  errors.push(suggestion !== null
    ? `${path}.id '${expr.id}' is not a place category - did you mean '${PLACES_PREFIX}${suggestion}'? Categories are spelt exactly as the backend spells them, so '${suffix}' is read as a free-text label instead and would have to declare a non-blank search.query of its own`
    : `${path}.search.query is required on '${expr.id}': '${suffix}' is not one of the place categories (${PLACE_CATEGORY_LIST}), so the id is a free-text search and has to say what to search for`);
}

function validateSearchDestination(element, path, ownId, expressions, searching, errors, warnings) {
  if (!isPlainObject(element)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const field of Object.keys(element)) {
    if (!SEARCH_DESTINATION_FIELDS.includes(field)) {
      errors.push(`${path}.${field} is not supported`);
    }
  }

  for (const field of SEARCH_DESTINATION_FIELDS) {
    const value = element[field];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${path}.${field} must be a non-blank string`);
    }
  }
  const triggerId = typeof element.triggerId === 'string' && element.triggerId.trim() !== '' ? element.triggerId : null;
  if (triggerId === null) return;

  if (triggerId === ownId) {
    errors.push(`${path}.triggerId '${triggerId}' is the expression itself; the destination must be read from another trigger of the rule`);
  } else if (!expressions.some(e => e.id === triggerId)) {
    errors.push(`${path}.triggerId '${triggerId}' is not an expression of this rule (has: ${expressions.map(e => e.id).join(', ')}), so the destination could never resolve and the rule would never fire`);
  } else if (searching.has(triggerId)) {
    errors.push(`${path}.triggerId '${triggerId}' has a search block of its own; a destination cannot be read from another search`);
  } else {
    warnDestinationFields(element, path, triggerId, expressions, warnings);
  }
}

/**
 * The engine cannot see an endpoint's field catalogue, so it accepts any field names
 * and only finds out at dispatch that the destination is unreadable. The builder has
 * the catalogue and says so up front.
 */
function warnDestinationFields(element, path, triggerId, expressions, warnings) {
  const named = ['latField', 'lngField'].every(f => typeof element[f] === 'string' && element[f].trim() !== '');
  if (!named) return;
  const dataSource = expressions.find(e => e.id === triggerId)?.dataSource;
  const fields = destinationCoordinateFields(triggerId, dataSource);
  const tail = 'so the destination could never resolve and the rule would never fire';
  if (!fields) {
    if (cannotSupplyDestination(triggerId, dataSource)) {
      warnings.push(`${path}.triggerId '${triggerId}' returns no coordinates, ${tail}`);
    }
    return;
  }
  if (element.latField !== fields.lat || element.lngField !== fields.lng) {
    warnings.push(`${path} reads '${element.latField}' / '${element.lngField}' from '${triggerId}', which returns '${fields.lat}' / '${fields.lng}', ${tail}`);
  }
}

function validateSearchPoint(element, path, errors) {
  if (!isPlainObject(element)) {
    errors.push(`${path} must be an object with lat and lng`);
    return;
  }
  for (const field of Object.keys(element)) {
    if (field !== 'lat' && field !== 'lng') errors.push(`${path}.${field} is not supported`);
  }
  for (const [field, bound] of [['lat', 90], ['lng', 180]]) {
    const present = hasKey(element, field);
    const value = element[field];
    const number = typeof value === 'number' && Number.isFinite(value) ? value : null;
    if (number === null) {
      errors.push(`${path}.${field} must be a number - got ${present ? JSON.stringify(value) : 'nothing'}`);
    } else if (number < -bound || number > bound) {
      errors.push(`${path}.${field} must be between -${bound} and ${bound} - got ${JSON.stringify(value)}`);
    }
  }
}

/** RuleMapper.liftLegacyRadius parses the whole string strictly and rejects anything below 1. */
function legacyRadiusValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return null;
  const n = parseInt(value.trim(), 10);
  return n > 0 ? n : null;
}

/**
 * Mirrors RuleMapper.liftLegacyRadius: the largest legacy radius fills in an absent
 * search.radius and every legacy condition goes away. An unparseable one is left in
 * place so the validator reports it instead of the import quietly discarding it.
 */
function migrateLegacyRadius(expr) {
  if (!isPlainObject(expr)) return;
  if (Array.isArray(expr.expressions)) { expr.expressions.forEach(migrateLegacyRadius); return; }
  if (!isPlacesExpressionJSON(expr) || !Array.isArray(expr.conditions)) return;

  const legacy = expr.conditions.filter(c => isPlainObject(c) && c.type === 'Value' && c.parameter === LEGACY_RADIUS_PARAMETER);
  if (!legacy.length) return;
  const radii = legacy.map(c => legacyRadiusValue(c.value));
  if (radii.some(r => r === null)) return;

  const search = declaredValue(expr, 'search');
  expr.search = isPlainObject(search) ? search : { mode: 'nearby' };
  if (!hasKey(expr.search, 'radius') || expr.search.radius === null) {
    expr.search.radius = Math.max(...radii);
  }
  expr.conditions = expr.conditions.filter(c => !legacy.includes(c));
  if (!expr.conditions.length) delete expr.conditions;
}

/**
 * Schema 1.2.0 dropped `destination.source` before it ever shipped, so the key is
 * removed rather than translated: what is left of a 'trigger' destination is already
 * the whole contract, and an 'app' destination has no expression at all and has to be
 * pointed at a trigger by hand.
 */
function migrateSearchDestination(expr) {
  if (!isPlainObject(expr)) return;
  if (Array.isArray(expr.expressions)) { expr.expressions.forEach(migrateSearchDestination); return; }
  const destination = declaredValue(declaredValue(expr, 'search') || {}, 'destination');
  if (isPlainObject(destination)) delete destination.source;
}

/**
 * Mirrors RulesValidator.validateValueConditionShapes so the panel says what CI will.
 *
 * The shape is an error: 'in' has no set to search without an array, and no other operator can
 * compare against one. The type is only a warning - a numeral in quotes may genuinely be a string
 * identifier, and the engine matches it either way.
 */
function validateValueConditionTypes(expr, errors, warnings, prefix) {
  if (!expr) return;

  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateValueConditionTypes(e, errors, warnings, prefix));
    return;
  }

  const quotedNumber = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));

  for (const cond of expr.conditions || []) {
    if (cond.type !== 'Value' || !cond.operator || cond.value === undefined) continue;
    const where = `${prefix}"${cond.parameter}"`;

    if (cond.operator === 'in') {
      if (!Array.isArray(cond.value)) {
        errors.push(`${where}: "in" needs a list of values, not a single one`);
        continue;
      }
      const types = new Set(cond.value.map(v => typeof v));
      if (types.size > 1) {
        warnings.push(`${where}: the "in" list mixes ${[...types].join(' and ')} values \u2014 one parameter arrives as one type, so part of the list can never match`);
      } else if (cond.value.some(quotedNumber)) {
        warnings.push(`${where}: the "in" list holds quoted numbers \u2014 a numeric parameter arrives as a JSON number, so drop the quotes`);
      }
      continue;
    }

    if (Array.isArray(cond.value)) {
      errors.push(`${where}: "${cond.operator}" cannot compare against a list \u2014 only "in" takes one`);
      continue;
    }

    if (quotedNumber(cond.value)) {
      warnings.push(`${where}: the value is a quoted number \u2014 a numeric parameter arrives as a JSON number, so drop the quotes`);
    }
  }
}

/**
 * Mirrors the engine's RulesValidator.validateFollowUpOptions with the same
 * severities - an undeclared variable rejects, a variable that can never carry a
 * list only warns - plus the check the engine leaves to runtime: whether a trigger
 * in this rule delivers the variable at all. Without one the rule is held forever.
 */
function validateFollowUpOptions(rule, errors, warnings, prefix) {
  if (!rule.followUp || rule.followUp.options === undefined) return;
  const options = rule.followUp.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    errors.push(`${prefix}followUp.options must be an object`);
    return;
  }
  const fromVariable = typeof options.fromVariable === 'string' ? options.fromVariable.trim() : '';
  const declared = (rule.output?.variables || []).find(v => v.id === fromVariable);
  if (!fromVariable) {
    errors.push(`${prefix}Follow-up options need a variable to list (options.fromVariable)`);
  } else if (!declared) {
    errors.push(`${prefix}Follow-up options.fromVariable "${fromVariable}" is not one of this rule's output variables, so no option could ever be built and the rule would never fire`);
  }

  const labels = Array.isArray(options.labelFields) ? options.labelFields : null;
  if (!labels || labels.length === 0 || labels.some(l => typeof l !== 'string' || !l.trim())) {
    errors.push(`${prefix}Follow-up options need at least one label field`);
  }
  if (options.max !== undefined && (!Number.isInteger(options.max) || options.max < 1)) {
    errors.push(`${prefix}Follow-up options.max must be a whole number of at least 1`);
  }
  if (!declared) return;

  const candidate = followUpOptionCandidates(rule).find(c => c.id === fromVariable);
  if (!candidate) {
    warnings.push(`${prefix}Follow-up options variable "${fromVariable}" has no source key, so it resolves to a single value and yields no options`);
    return;
  }
  if (!candidate.backed) {
    errors.push(candidate.triggerId
      ? `${prefix}Follow-up options variable "${fromVariable}" reads trigger "${candidate.triggerId}", which is not in this rule's trigger expression. Options are built only from the rule's own triggers, so the rule would never fire`
      : `${prefix}Follow-up options variable "${fromVariable}" reads ${candidate.dataSource || 'its data source'}, but no trigger in this rule uses it. Options are built only from the rule's own triggers, so the rule would never fire`);
  }
  for (const label of labels || []) {
    if (typeof label !== 'string' || !label.trim()) continue;
    const covered = candidate.fields.some(f => label === f || label.startsWith(`${f}.`));
    if (!covered) {
      warnings.push(`${prefix}Follow-up label field "${label}" is not among the variable's fields (${candidate.fields.join(', ') || 'none'}), so the option label reads a field the prompt never sees`);
    }
  }
}

function collectTriggerIds(expr) {
  if (!expr) return [];
  if (expr.type === 'SINGLE') return expr.id ? [expr.id] : [];
  if (expr.type === 'GROUP' && expr.expressions) {
    return expr.expressions.flatMap(collectTriggerIds);
  }
  return [];
}

function validateTriggerDataSource(expr, warnings) {
  if (!expr) return;
  if (expr.type === 'SINGLE' && expr.id && expr.dataSource && placesPrefixOf(expr.id, expr.dataSource) === null) {
    const validIds = TRIGGER_IDS[expr.dataSource];
    if (validIds && validIds.length > 0 && !validIds.includes(expr.id)) {
      warnings.push(`Trigger ID "${expr.id}" is not a known ID for data source "${expr.dataSource}"`);
    }
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateTriggerDataSource(e, warnings));
  }
}

/**
 * Mojo-specific condition warnings.
 *
 * `Condition.Value` searches the whole data source and takes the newest event
 * carrying the parameter, so a parameter shared by several Mojo events resolves
 * by arrival order unless the condition names one. And parameters dropped by the
 * event split match nothing at all — the condition evaluates false forever
 * rather than failing loudly.
 */
function validateMojoConditions(expr, warnings, prefix) {
  if (!expr) return;
  if (expr.type === 'SINGLE' && expr.dataSource === 'Mojo' && expr.conditions) {
    for (const cond of expr.conditions) {
      if (cond.type !== 'Value' || !cond.parameter) continue;
      const removed = REMOVED_PARAMS[cond.parameter];
      if (removed) {
        warnings.push(`${prefix}"${cond.parameter}" no longer exists on any Mojo event, so this condition can never match. ${removed}`);
      } else if (MOJO_AMBIGUOUS_PARAMS.has(cond.parameter) && !cond.eventName) {
        warnings.push(`${prefix}"${cond.parameter}" is carried by more than one Mojo event — without "eventName" the newest one wins, whichever milestone it was`);
      }
    }
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateMojoConditions(e, warnings, prefix));
  }
}

function validateRequiredConditions(expr, errors, prefix) {
  if (!expr) return;
  if (expr.type === 'SINGLE' && expr.id) {
    const cfg = TRIGGER_CONDITION_CONFIG[expr.id];
    if (cfg?.conditionRequired) {
      const hasConditions = expr.conditions && expr.conditions.length > 0;
      if (!hasConditions) {
        errors.push(`${prefix}Trigger "${expr.id}" requires at least one condition`);
      }
    }
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateRequiredConditions(e, errors, prefix));
  }
}

function validateNoConditions(expr, errors, prefix) {
  if (!expr) return;
  if (expr.type === 'SINGLE' && expr.id) {
    const cfg = TRIGGER_CONDITION_CONFIG[expr.id];
    if (cfg?.noConditions && expr.conditions?.length > 0) {
      errors.push(`${prefix}Trigger "${expr.id}" does not support conditions — the engine matches job locations automatically`);
    }
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateNoConditions(e, errors, prefix));
  }
}

/**
 * Recursively validates condition field content for every SINGLE expression.
 * Catches missing/malformed fields that Ajv would catch but custom validation previously missed.
 */
// Parameters that must always be strings — a numeric value is always wrong for these.
const _STRING_ONLY_PARAMS = new Set([
  'poi_name', 'poi_id', 'day_of_week', 'RouteState', 'status',
  'driving_conditions', 'condition', 'closestPlaceName',
  'closestPlaceAddress', 'closestPlaceBusinessStatus'
]);

function validateConditionFields(expr, errors, prefix) {
  if (!expr) return;
  if (expr.type === 'SINGLE' && expr.conditions) {
    expr.conditions.forEach((cond, ci) => {
      const cp = `${prefix}Condition[${ci}] (${cond.type}): `;
      switch (cond.type) {
        case 'Value':
          if (!cond.parameter) errors.push(`${cp}parameter is required`);
          if (!_VALID_OPS.has(cond.operator)) errors.push(`${cp}operator "${cond.operator || ''}" is missing or invalid`);
          if (cond.value === undefined || cond.value === null) {
            errors.push(`${cp}value is required`);
          } else if (typeof cond.value === 'string' && cond.value === '') {
            errors.push(`${cp}value must not be empty`);
          } else if (typeof cond.value === 'number' && cond.parameter && _STRING_ONLY_PARAMS.has(cond.parameter)) {
            errors.push(`${cp}parameter "${cond.parameter}" expects a string value, not a number`);
          }
          break;
        case 'TimeRange':
          if (!cond.from) errors.push(`${cp}from is required`);
          else if (!_isValidTime(cond.from)) errors.push(`${cp}from must be HH:MM 24-hour (e.g. "08:00")`);
          if (!cond.to) errors.push(`${cp}to is required`);
          else if (!_isValidTime(cond.to)) errors.push(`${cp}to must be HH:MM 24-hour (e.g. "20:00")`);
          break;
        case 'Time':
          if (!_VALID_OPS.has(cond.operator)) errors.push(`${cp}operator is missing or invalid`);
          if (!cond.value) errors.push(`${cp}value is required`);
          else if (!_isValidTime(cond.value)) errors.push(`${cp}value must be HH:MM 24-hour (e.g. "08:00")`);
          break;
        case 'RelativeTimeWindow':
          if (!cond.parameter) errors.push(`${cp}parameter is required`);
          if (!cond.fromNow) errors.push(`${cp}fromNow is required`);
          else if (!_FROM_NOW_RE.test(cond.fromNow)) errors.push(`${cp}fromNow must match ±N[hdm] (e.g. "1h", "-4h", "30m")`);
          break;
        case 'EventCount':
          if (!cond.eventName) errors.push(`${cp}eventName is required`);
          if (!_VALID_OPS.has(cond.operator)) errors.push(`${cp}operator is missing or invalid`);
          if (typeof cond.value !== 'number' || !Number.isInteger(cond.value)) errors.push(`${cp}value must be an integer`);
          break;
        case 'Comparison':
          if (!cond.parameter && !cond.leaderboardId) errors.push(`${cp}parameter or leaderboardId is required`);
          if (!_VALID_OPS.has(cond.operator)) errors.push(`${cp}operator is missing or invalid`);
          if (cond.value === undefined || cond.value === null) errors.push(`${cp}value is required`);
          break;
        case 'Aggregate':
          if (!cond.eventName) errors.push(`${cp}eventName is required`);
          if (!AGGREGATE_OPS.includes(cond.op)) errors.push(`${cp}op must be one of ${AGGREGATE_OPS.join(', ')}`);
          else if (cond.op !== 'count' && !cond.field) errors.push(`${cp}field is required for op "${cond.op}"`);
          if (!NUMERIC_OPERATORS.includes(cond.operator)) errors.push(`${cp}operator is missing or invalid`);
          if (typeof cond.value !== 'number') errors.push(`${cp}value must be a number`);
          if (!cond.window) errors.push(`${cp}window is required`);
          else if (!_WINDOW_RE.test(cond.window)) errors.push(`${cp}window must be a positive N[hdm] (e.g. "7d", "12h", "30m")`);
          if (cond.scope !== undefined && cond.scope !== 'global') errors.push(`${cp}scope must be "global" or omitted`);
          break;
      }
    });
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateConditionFields(e, errors, prefix));
  }
}

/**
 * Recursively validates that every SINGLE expression has a non-empty id and dataSource.
 * Missing either field causes an engine parse error ("Single expression must have id").
 */
function validateTriggerFields(expr, errors, prefix) {
  if (!expr) return;
  if (expr.type === 'SINGLE') {
    if (!expr.id) errors.push(`${prefix}Trigger ID is required for every SINGLE expression`);
    if (!expr.dataSource) errors.push(`${prefix}Data source is required for every SINGLE expression`);
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateTriggerFields(e, errors, prefix));
  }
}

function showValidation(panel, results) {
  panel.innerHTML = '';

  if (results.errors.length === 0 && results.warnings.length === 0) {
    panel.innerHTML = '<div class="validation-status validation-valid">&#10003; Valid</div>';
    return;
  }

  if (results.errors.length > 0) {
    const div = h('div', { className: 'validation-status validation-invalid' }, `\u2717 ${results.errors.length} error(s)`);
    const list = h('ul', { className: 'validation-list' });
    for (const err of results.errors) list.append(h('li', {}, err));
    div.append(list);
    panel.append(div);
  }

  if (results.warnings.length > 0) {
    const div = h('div', { className: 'validation-status validation-warning', style: 'margin-top:8px' },
      `\u26A0 ${results.warnings.length} warning(s)`
    );
    const list = h('ul', { className: 'validation-list' });
    for (const w of results.warnings) list.append(h('li', {}, w));
    div.append(list);
    panel.append(div);
  }
}

/* =========================================================
   FIELD ERROR HIGHLIGHTING
   ========================================================= */

/**
 * Highlights form fields with red borders when their values are missing.
 * Only highlights fields for the currently active rule.
 */
function highlightErrorFields(jsonArray) {
  // Clear all existing error highlights
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  document.querySelectorAll('.card-error').forEach(el => el.classList.remove('card-error'));

  if (activeRuleIndex < 0 || activeRuleIndex >= jsonArray.length) return;
  const rule = jsonArray[activeRuleIndex];

  // Rule ID
  const ruleIdInput = document.getElementById('rule-id');
  if (ruleIdInput && !rule.id) {
    ruleIdInput.classList.add('field-error');
  }

  // Trigger expression — check if there are no configured triggers
  if (!rule.triggerExpression || (rule.triggerExpression.type === 'GROUP' && (!rule.triggerExpression.expressions || rule.triggerExpression.expressions.length === 0))) {
    document.getElementById('section-trigger')?.classList.add('card-error');
  }

  // Check individual trigger cards for missing trigger IDs
  const triggerRoot = document.getElementById('trigger-root');
  if (triggerRoot) {
    triggerRoot.querySelectorAll('[data-field="triggerId"]').forEach(el => {
      if (!el.value) el.classList.add('field-error');
    });
    triggerRoot.querySelectorAll('[data-field="dataSource"]').forEach(el => {
      if (!el.value) el.classList.add('field-error');
    });
  }

  // Output section
  const outputEnabled = document.getElementById('output-enabled');
  if (outputEnabled && !outputEnabled.checked && !rule.output) {
    document.getElementById('section-output')?.classList.add('card-error');
  }

  // Output instructions (when output is enabled but instructions empty)
  const instructionsEl = document.getElementById('output-instructions');
  if (instructionsEl && outputEnabled?.checked && !instructionsEl.value.trim()) {
    instructionsEl.classList.add('field-error');
  }

  const followUpEnabled = document.getElementById('follow-up-enabled');
  const followUpQuestion = document.getElementById('follow-up-question');
  if (followUpEnabled?.checked && !followUpQuestion?.value.trim()) {
    followUpQuestion?.classList.add('field-error');
    document.getElementById('section-follow-up')?.classList.add('card-error');
  }
  if (followUpEnabled?.checked && document.getElementById('follow-up-options-enabled')?.checked) {
    const options = rule.followUp?.options || {};
    const bad = [];
    const declared = (rule.output?.variables || []).some(v => v.id === options.fromVariable);
    const candidate = followUpOptionCandidates(rule).find(c => c.id === options.fromVariable);
    if (!declared || candidate?.backed === false) bad.push('follow-up-options-variable');
    if (!options.labelFields?.length) bad.push('follow-up-options-labels');
    if (options.max !== undefined && (!Number.isInteger(options.max) || options.max < 1)) bad.push('follow-up-options-max');
    for (const id of bad) document.getElementById(id)?.classList.add('field-error');
    if (bad.length) document.getElementById('section-follow-up')?.classList.add('card-error');
  }

  highlightSearchFieldErrors(rule);

  // Condition-required triggers: highlight trigger cards missing conditions
  if (rule.triggerExpression) {
    highlightMissingConditions(triggerRoot, rule.triggerExpression);
  }

  // Highlight individual condition inputs with invalid/missing values
  if (triggerRoot) {
    highlightConditionFieldErrors(triggerRoot);
  }
}

/**
 * Marks the search inputs the engine would reject. Read off the built JSON rather
 * than the DOM so a mode's forbidden fields, which are never emitted, stay unmarked.
 */
function highlightSearchFieldErrors(rule) {
  const boxes = singleTriggerBoxes();
  let index = 0;
  forEachSingleExpression(rule?.triggerExpression, 'triggerExpression', (expr) => {
    const box = boxes[index++];
    const searchBox = box?.querySelector('[data-field="search-container"]');
    const search = declaredValue(expr, 'search');
    if (!searchBox || searchBox.classList.contains('hidden') || !isPlainObject(search)) return;

    let bad = false;
    const mark = (field) => {
      bad = true;
      searchBox.querySelector(`[data-field="${field}"]`)?.classList.add('field-error');
    };
    const mode = SEARCH_MODES.some(m => m.id === search.mode) ? search.mode : null;
    if (!mode) mark('search-mode-group');

    if (mode === 'along_route' || mode === 'near_destination') {
      const dest = search.destination;
      if (!isPlainObject(dest) || !dest.triggerId) {
        mark('search-destination');
      }
      if (isPlainObject(dest)) {
        for (const [field, input] of [['latField', 'search-dest-lat-field'], ['lngField', 'search-dest-lng-field']]) {
          if (typeof dest[field] !== 'string' || !dest[field].trim()) mark(input);
        }
      }
    }
    if (mode === 'near_point') {
      for (const [field, input, bound] of [['lat', 'search-point-lat', 90], ['lng', 'search-point-lng', 180]]) {
        const v = search.point?.[field];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < -bound || v > bound) mark(input);
      }
    }
    if (hasKey(search, 'radius') && searchNumberError('', 'radius', search.radius)) mark('search-radius');
    if (mode === 'along_route' && (!hasKey(search, 'maxDetourMeters') || searchNumberError('', 'maxDetourMeters', search.maxDetourMeters))) {
      mark('search-detour');
    }
    if (hasKey(search, 'limit') && searchNumberError('', 'limit', search.limit)) mark('search-limit');

    const suffix = placesSuffixOf(expr.id, expr.dataSource);
    const freeText = suffix !== null && placeCategoryOf(suffix, placesPrefixOf(expr.id, expr.dataSource)) === null;
    const query = declaredValue(search, 'query');
    if (freeText ? (typeof query !== 'string' || !query.trim()) : query !== undefined) mark('search-query');

    if (bad) box.closest('.item-card')?.classList.add('field-error');
  });
}

function highlightMissingConditions(container, expr) {
  if (!container || !expr) return;

  if (expr.type === 'SINGLE' && expr.id) {
    const cfg = TRIGGER_CONDITION_CONFIG[expr.id];
    if (cfg?.conditionRequired) {
      const hasConditions = expr.conditions && expr.conditions.length > 0;
      if (!hasConditions) {
        // Find the trigger card that has this ID selected
        container.querySelectorAll('.item-card').forEach(card => {
          const tidEl = card.querySelector('[data-field="triggerId"]');
          if (tidEl && tidEl.value === expr.id) {
            card.classList.add('field-error');
          }
        });
      }
    }
  }

  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => highlightMissingConditions(container, e));
  }
}

/**
 * Highlights condition input fields that have invalid or missing values.
 * Walks all condition cards inside the trigger root.
 */
function highlightConditionFieldErrors(triggerRoot) {
  triggerRoot.querySelectorAll('[data-field="conditionType"]').forEach(typeEl => {
    const type = typeEl.value;
    const fields = typeEl.closest('.item-card')?.querySelector('.item-fields');
    if (!fields) return;

    const get = (field) => fields.querySelector(`[data-field="${field}"]`);
    const markIfEmpty = (el) => { if (el && !el.value?.trim()) el.classList.add('field-error'); };
    const markIfBadTime = (el) => { if (el && !_isValidTime(el.value)) el.classList.add('field-error'); };
    const markIfBadOp = (el) => { if (el && !_VALID_OPS.has(el.value)) el.classList.add('field-error'); };

    switch (type) {
      case 'Value':
        markIfEmpty(get('parameter'));
        markIfBadOp(get('operator'));
        { const val = get('value'); if (val && !val.value?.trim()) val.classList.add('field-error'); }
        break;
      case 'TimeRange':
        markIfBadTime(get('from'));
        markIfBadTime(get('to'));
        break;
      case 'Time':
        markIfBadOp(get('operator'));
        markIfBadTime(get('value'));
        break;
      case 'RelativeTimeWindow':
        markIfEmpty(get('parameter'));
        { const fn = get('fromNow'); if (fn && !_FROM_NOW_RE.test(fn.value)) fn.classList.add('field-error'); }
        break;
      case 'EventCount':
        markIfEmpty(get('eventName'));
        markIfBadOp(get('operator'));
        break;
      case 'Comparison':
        { const p = get('parameter'); const lb = get('leaderboardId');
          if (p && lb && !p.value?.trim() && !lb.value?.trim()) p.classList.add('field-error'); }
        markIfBadOp(get('operator'));
        break;
      case 'Aggregate':
        markIfEmpty(get('eventName'));
        if (get('op')?.value !== 'count') markIfEmpty(get('field'));
        { const w = get('window'); if (w && !_WINDOW_RE.test(w.value)) w.classList.add('field-error'); }
        break;
    }
  });
}

/* =========================================================
   IMPORT / EXPORT
   ========================================================= */

function hasSingleEditorRule() {
  if (rules.length === 1) return true;
  showToast('Export exactly one rule at a time. Start a new rule or import a single-rule file.', 5000);
  return false;
}

function copyJSON() {
  saveActiveRule();
  if (!hasSingleEditorRule()) return;
  const jsonStr = JSON.stringify(buildDocument(rules), null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    showToast('JSON copied to clipboard!');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = jsonStr;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('JSON copied to clipboard!');
  });
}

function downloadJSON() {
  saveActiveRule();
  if (!hasSingleEditorRule()) return;
  const jsonStr = JSON.stringify(buildDocument(rules), null, 2);
  const filename = (rules[0].id || 'rule') + '.json';
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`);
}

/* =========================================================
   FORM POPULATION (from JSON rule object)
   ========================================================= */

/**
 * Populates all form fields from a rule JSON object.
 */
function populateFormFromRule(rule) {
  resetForm(true); // Silent reset

  // Basics
  document.getElementById('rule-id').value = rule.id || '';
  document.getElementById('rule-description').value = rule.description || '';
  document.getElementById('rule-scope').value = rule.sessionScope || 'global';
  document.getElementById('rule-priority').value = rule.priority || 0;
  renderTopicOptions(normalizeTopic(rule.topic) || '');
  document.getElementById('rule-conversation').value =
    String(rule.conversation || '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto';
  showScopeHint();

  // Throttle
  if (rule.throttle) {
    document.getElementById('throttle-cooldown').value = rule.throttle.cooldownMinutes || '';
    document.getElementById('throttle-max').value = rule.throttle.maxTriggersPerDay || '';
  }

  // Output
  if (rule.output) {
    document.getElementById('output-enabled').checked = true;
    document.getElementById('output-instructions').value = rule.output.instructions || '';
    document.getElementById('output-tone').value = rule.output.tone || '';
    if (rule.output.variables) {
      for (const v of rule.output.variables) addVariable(v);
    }
  } else {
    document.getElementById('output-enabled').checked = false;
  }
  toggleOutputSection();

  // Trigger Expression
  const triggerRoot = document.getElementById('trigger-root');
  renderTriggerExpression(triggerRoot, 0, rule.triggerExpression);

  // Conversational follow-up - after the triggers, which decide its option candidates
  document.getElementById('follow-up-enabled').checked = !!rule.followUp;
  document.getElementById('follow-up-id').value = rule.followUp?.id || defaultFollowUpId();
  document.getElementById('follow-up-question').value = rule.followUp?.question || '';
  document.getElementById('follow-up-options-enabled').checked = !!rule.followUp?.options;
  setFollowUpOptionsForm(rule.followUp?.options || null);
  toggleFollowUpSection();

  // Open all sections
  for (const header of document.querySelectorAll('.card-header')) {
    if (!header.classList.contains('open')) header.classList.add('open');
  }

  onFormChange();
}

/**
 * Resets all form fields to empty/default state.
 */
function resetForm(silent = false) {
  document.getElementById('rule-id').value = '';
  document.getElementById('rule-description').value = '';
  document.getElementById('rule-scope').value = 'global';
  document.getElementById('rule-priority').value = 0;
  renderTopicOptions('');
  document.getElementById('rule-conversation').value = 'auto';
  document.getElementById('throttle-cooldown').value = 30;
  document.getElementById('throttle-max').value = 3;
  document.getElementById('output-enabled').checked = true;
  document.getElementById('output-instructions').value = '';
  document.getElementById('output-tone').value = '';
  document.getElementById('variables-list').innerHTML = '';
  const _ts = document.getElementById('template-select'); if (_ts) _ts.value = '';
  _varCounter = 0;

  showScopeHint();

  // Reset trigger
  const triggerRoot = document.getElementById('trigger-root');
  renderTriggerExpression(triggerRoot, 0);

  document.getElementById('follow-up-enabled').checked = false;
  document.getElementById('follow-up-id').value = defaultFollowUpId();
  document.getElementById('follow-up-question').value = '';
  document.getElementById('follow-up-options-enabled').checked = false;
  setFollowUpOptionsForm(null);
  toggleFollowUpSection();

  if (!silent) {
    rules = [{ id: '', sessionScope: 'global', triggerExpression: { type: 'GROUP', groupType: 'AND' } }];
    activeRuleIndex = 0;
    topicConfigs = {};
    renderRuleList();
    onFormChange();
    _setLoadedBadge(null);
    showToast('Rule cleared');
  }
}

/* =========================================================
   TEMPLATE SYSTEM
   ========================================================= */

/**
 * Templates are whole rules, so a Fleet template loaded into a Mojo set would
 * flip the set's product behind the author's back \u2014 and lock it there. Only
 * templates that fit the selected product are offered, which keeps the decision
 * where the author made it: at the switch.
 */
function refreshTemplateOptions() {
  const select = document.getElementById('template-select');
  if (!select) return;
  for (const opt of [...select.querySelectorAll('option')]) {
    if (opt.value) opt.remove(); // keep the empty placeholder
  }
  for (const t of TEMPLATES) {
    const owners = ruleProductIds(t);
    if (owners.size && !owners.has(selectedProduct)) continue;
    select.append(h('option', { value: t.id }, `${t.id} \u2014 ${t.description}`));
  }
  select.value = '';
}

function populateTemplateDropdown() {
  const select = document.getElementById('template-select');
  if (!select) return;
  refreshTemplateOptions();
  select.addEventListener('change', () => {
    if (!select.value) return;
    const template = TEMPLATES.find(t => t.id === select.value);
    if (template) {
      rules[activeRuleIndex] = JSON.parse(JSON.stringify(template));
      populateFormFromRule(rules[activeRuleIndex]);
      renderRuleList();
      showToast(`Template "${template.id}" loaded`);
    }
  });
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */

let _toastTimeout = null;

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

/* =========================================================
   PUBLISH
   ========================================================= */

/* --- GitHub API helpers --- */

async function _ghGet(path) {
  const res = await fetch(`${_svc}/contents/${path}`, {
    headers: { Authorization: `Bearer ${_ak}`, Accept: 'application/vnd.github+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub error: ${res.status}`);
  return await res.json();
}

async function _ghWrite(path, content, sha, message) {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body = { message, content: encoded, branch: _br };
  if (sha) body.sha = sha;
  const res = await fetch(`${_svc}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${_ak}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `GitHub write error: ${res.status}`); }
  return await res.json();
}

async function _ghDelete(path, sha, message) {
  const res = await fetch(`${_svc}/contents/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${_ak}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: _br })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `GitHub delete error: ${res.status}`); }
}

function setPublishStatus(text, type = '') {
  const el = document.getElementById('publish-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'publish-status' + (type ? ' ' + type : '');
}

/* --- Manifest helpers --- */

let _manifestCache = null;

async function fetchManifest() {
  try {
    const file = await _ghGet('rules/manifest.json');
    if (!file) return { versions: [] };
    return JSON.parse(atob(file.content.replace(/\n/g, '')));
  } catch {
    return { versions: [] };
  }
}

function _genVersionId(name) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  return `${datePart}-${timePart}-${name}`;
}

function _formatVersionLabel(v) {
  const d = new Date(v.publishedAt);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} \u2013 ${v.name}`;
}

/* --- Publish dialog --- */

function openPublishDialog() {
  saveActiveRule();
  const rulesArray = rules.filter(r => r && Object.keys(r).length > 0);
  const validation = validateRule(rulesArray);
  if (!validation.valid) {
    setPublishStatus(`\u2717 Fix ${validation.errors.length} error(s) before publishing`, 'err');
    showToast(`Cannot publish \u2014 ${validation.errors.length} validation error(s). Click Validate to see details.`, 5000);
    validateAndShow();
    return;
  }
  document.getElementById('pub-name').value = '';
  document.getElementById('pub-desc').value = '';
  document.getElementById('pub-name-error').classList.add('hidden');
  document.getElementById('pub-preview').classList.add('hidden');
  document.getElementById('pub-submit-btn').disabled = true;
  document.getElementById('publish-dialog-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('pub-name').focus(), 50);
}

function closePublishDialog() {
  document.getElementById('publish-dialog-overlay').classList.add('hidden');
}

function onPubNameInput() {
  const name = document.getElementById('pub-name').value.trim().toLowerCase();
  const errEl = document.getElementById('pub-name-error');
  const previewEl = document.getElementById('pub-preview');
  const submitBtn = document.getElementById('pub-submit-btn');

  if (!name) {
    errEl.classList.add('hidden');
    previewEl.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    errEl.textContent = 'Only lowercase letters, numbers, and hyphens. Must start/end with a letter or number.';
    errEl.classList.remove('hidden');
    previewEl.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }
  errEl.classList.add('hidden');
  previewEl.textContent = `\u2192 ${_genVersionId(name)}`;
  previewEl.classList.remove('hidden');
  submitBtn.disabled = false;
}

async function submitPublish() {
  saveActiveRule();
  if (!hasSingleEditorRule()) return;
  const name = document.getElementById('pub-name').value.trim().toLowerCase();
  const description = document.getElementById('pub-desc').value.trim();
  if (!name) return;

  const submitBtn = document.getElementById('pub-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publishing\u2026';

  try {
    const rulesArray = rules.filter(r => r && Object.keys(r).length > 0);
    const manifest = await fetchManifest();
    const duplicate = (manifest.versions || []).find(v => v.name === name);
    if (duplicate) {
      const errEl = document.getElementById('pub-name-error');
      errEl.textContent = `Name '${name}' already exists \u2014 choose a different name`;
      errEl.classList.remove('hidden');
      return;
    }

    const versionId = _genVersionId(name);
    const publishedAt = new Date().toISOString();
    const topics = _topicsBlock(rulesArray);
    const payload = {
      _meta: { versionId, name, publishedAt, ruleCount: rulesArray.length, description },
      schemaVersion: requiredSchemaVersion(rulesArray),
      ...(topics ? { topics } : {}),
      rules: rulesArray
    };

    // Write version file
    await _ghWrite(`rules/${versionId}.json`, JSON.stringify(payload, null, 2), null, `Add version: ${versionId}`);

    // Update manifest
    const manifestEntry = { id: versionId, name, publishedAt, ruleCount: rulesArray.length, description };
    const updatedVersions = [manifestEntry, ...(manifest.versions || [])];
    const manifestFile = await _ghGet('rules/manifest.json');
    await _ghWrite('rules/manifest.json', JSON.stringify({ versions: updatedVersions }, null, 2), manifestFile?.sha || null, `Update manifest: add ${versionId}`);

    closePublishDialog();
    const label = _formatVersionLabel({ publishedAt, name });
    setPublishStatus(`\u2713 Published \u00b7 ${label}`, 'ok');
    showToast(`\u2713 Published: ${versionId}`, 5000);
    _setLoadedBadge(label, versionId);
    _manifestCache = null;
    _updateVersionsCountBadge();
  } catch (e) {
    showToast(`Publish failed: ${e.message}`, 6000);
    setPublishStatus(`\u2717 ${e.message}`, 'err');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publish';
  }
}

/* --- Update existing version --- */

async function updateLoadedVersion() {
  if (!_loadedVersionId) return;
  const rulesArray = rules.filter(r => r && Object.keys(r).length > 0);
  const validation = validateRule(rulesArray);
  if (!validation.valid) {
    setPublishStatus(`\u2717 Fix ${validation.errors.length} error(s) before updating`, 'err');
    showToast(`Cannot update \u2014 ${validation.errors.length} validation error(s). Click Validate to see details.`, 5000);
    validateAndShow();
    return;
  }

  const publishBtn = document.getElementById('publish-btn');
  publishBtn.disabled = true;
  publishBtn.textContent = 'Updating\u2026';

  try {
    const existing = await _ghGet(`rules/${_loadedVersionId}.json`);
    if (!existing) throw new Error('Version not found \u2014 use Publish as New instead');
    const existingData = JSON.parse(atob(existing.content.replace(/\n/g, '')));

    const updatedAt = new Date().toISOString();
    const topics = _topicsBlock(rulesArray);
    const payload = {
      _meta: { ...existingData._meta, ruleCount: rulesArray.length, updatedAt },
      schemaVersion: requiredSchemaVersion(rulesArray),
      ...(topics ? { topics } : {}),
      rules: rulesArray
    };
    await _ghWrite(`rules/${_loadedVersionId}.json`, JSON.stringify(payload, null, 2), existing.sha, `Update version: ${_loadedVersionId}`);

    // Update manifest entry
    const manifestFile = await _ghGet('rules/manifest.json');
    if (manifestFile) {
      const manifest = JSON.parse(atob(manifestFile.content.replace(/\n/g, '')));
      const updatedVersions = (manifest.versions || []).map(v =>
        v.id === _loadedVersionId ? { ...v, ruleCount: rulesArray.length, updatedAt } : v
      );
      await _ghWrite('rules/manifest.json', JSON.stringify({ versions: updatedVersions }, null, 2), manifestFile.sha, `Update manifest: refresh ${_loadedVersionId}`);
    }

    _manifestCache = null;
    _versionsData = _versionsData.map(v =>
      v.id === _loadedVersionId ? { ...v, ruleCount: rulesArray.length, updatedAt } : v
    );
    const { name, publishedAt } = existingData._meta;
    const label = _formatVersionLabel({ publishedAt, name });
    setPublishStatus(`\u2713 Updated \u00b7 ${label}`, 'ok');
    showToast(`\u2713 Updated: ${_loadedVersionId}`, 4000);
  } catch (e) {
    showToast(`Update failed: ${e.message}`, 6000);
    setPublishStatus(`\u2717 ${e.message}`, 'err');
  } finally {
    publishBtn.disabled = false;
    publishBtn.innerHTML = '&#8593; Update';
  }
}

/* --- Loaded version state --- */

let _loadedVersionId = null;

function _setLoadedBadge(label, versionId = null) {
  _loadedVersionId = versionId;
  const el = document.getElementById('loaded-version-badge');
  if (el) {
    if (label) { el.textContent = `Loaded: ${label}`; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }
  const publishBtn = document.getElementById('publish-btn');
  const saveAsBtn  = document.getElementById('save-as-btn');
  if (!publishBtn) return;
  if (versionId) {
    publishBtn.innerHTML = '&#8593; Update';
    saveAsBtn && (saveAsBtn.style.display = '');
  } else {
    publishBtn.innerHTML = '&#8593; Publish';
    saveAsBtn && (saveAsBtn.style.display = 'none');
  }
}

function onPublishClick() {
  if (_loadedVersionId) updateLoadedVersion();
  else openPublishDialog();
}

/* --- Versions count badge --- */

async function _updateVersionsCountBadge() {
  const badge = document.getElementById('versions-count-badge');
  if (!badge) return;
  if (_manifestCache) { badge.textContent = (_manifestCache.versions || []).length; return; }
  const manifest = await fetchManifest();
  _manifestCache = manifest;
  badge.textContent = (manifest.versions || []).length;
}

/* --- Versions panel --- */

let _versionsData = [];

async function openVersionsPanel() {
  document.getElementById('versions-panel-overlay').classList.remove('hidden');
  document.getElementById('versions-list').innerHTML = '<div class="help-text" style="text-align:center;padding:24px">Loading\u2026</div>';
  document.getElementById('versions-search').value = '';
  const manifest = await fetchManifest();
  _versionsData = manifest.versions || [];
  _manifestCache = manifest;
  _updateVersionsCountBadge();
  renderVersionsList('');
}

function closeVersionsPanel() {
  document.getElementById('versions-panel-overlay').classList.add('hidden');
}

function filterVersionsList() {
  const q = document.getElementById('versions-search').value.trim().toLowerCase();
  renderVersionsList(q);
}

function _escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderVersionsList(query) {
  const container = document.getElementById('versions-list');
  const filtered = query
    ? _versionsData.filter(v => v.name.includes(query) || (v.description || '').toLowerCase().includes(query))
    : _versionsData;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="help-text" style="text-align:center;padding:24px">${query ? 'No versions match your search.' : 'No published versions yet.'}</div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach((v, idx) => {
    const isLatest = !query && idx === 0;
    const label = _formatVersionLabel(v);
    const row = document.createElement('div');
    row.className = 'version-row';
    const descPart = v.description ? ` \u00b7 ${_escHtml(v.description)}` : '';
    const editedBadge = v.updatedAt ? ' <span class="badge-edited">edited</span>' : '';
    const editedMeta = v.updatedAt ? `<div class="version-row-meta">edited: ${_escHtml(_formatVersionLabel({ publishedAt: v.updatedAt, name: '' }).split(' \u2013 ')[0])}</div>` : '';
    row.innerHTML = `
      <div class="version-row-info">
        <div class="version-row-name">
          ${_escHtml(v.name)}${isLatest ? ' <span class="badge-latest">latest</span>' : ''}${editedBadge}
        </div>
        <div class="version-row-meta">${_escHtml(label)}${descPart}</div>
        ${editedMeta}
        <div class="version-row-meta">${v.ruleCount ?? '?'} rule(s)</div>
      </div>
      <div class="version-row-actions">
        <button class="btn btn-sm" onclick="loadVersion('${_escHtml(v.id)}','${_escHtml(label)}')">Load</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDeleteVersion('${_escHtml(v.id)}','${_escHtml(v.name)}')">Delete</button>
      </div>`;
    container.appendChild(row);
  });
}

async function loadVersion(versionId, label) {
  try {
    const file = await _ghGet(`rules/${versionId}.json`);
    if (!file) throw new Error('Version not found');
    const data = JSON.parse(atob(file.content.replace(/\n/g, '')));
    const { loaded, topics } = readSingleRuleDocument(data);
    loaded.forEach(migrateRule);
    rules = loaded.map(r => JSON.parse(JSON.stringify(r)));
    activeRuleIndex = 0;
    topicConfigs = _adoptTopicConfigs(topics);
    adoptProductFromRules(); // before rendering, so dropdowns offer the version's product
    populateFormFromRule(rules[0]);
    showScopeHint();
    renderRuleList();
    updatePreview();
    closeVersionsPanel();
    _setLoadedBadge(label, versionId);
    showToast(`Loaded: ${label}`, 4000);
  } catch (e) {
    showToast(`Load failed: ${e.message}`, 5000);
  }
}

async function confirmDeleteVersion(versionId, name) {
  if (!confirm(`Delete version "${name}"?\n\nThis cannot be undone.`)) return;
  try {
    // Delete version file
    const versionFile = await _ghGet(`rules/${versionId}.json`);
    if (!versionFile) throw new Error('Version file not found');
    await _ghDelete(`rules/${versionId}.json`, versionFile.sha, `Delete version: ${versionId}`);

    // Update manifest
    const manifestFile = await _ghGet('rules/manifest.json');
    if (manifestFile) {
      const manifest = JSON.parse(atob(manifestFile.content.replace(/\n/g, '')));
      const updatedVersions = (manifest.versions || []).filter(v => v.id !== versionId);
      await _ghWrite('rules/manifest.json', JSON.stringify({ versions: updatedVersions }, null, 2), manifestFile.sha, `Update manifest: remove ${versionId}`);
    }

    _versionsData = _versionsData.filter(v => v.id !== versionId);
    _manifestCache = null;
    _updateVersionsCountBadge();
    renderVersionsList(document.getElementById('versions-search').value.trim().toLowerCase());
    showToast(`Deleted: ${name}`, 3000);
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, 5000);
  }
}

/* =========================================================
   SCOPE-AWARE TRIGGER ID REFRESH
   ========================================================= */

/**
 * Rebuilds all trigger ID dropdowns in the current rule form using the
 * current rule scope. Called whenever the scope selector changes so that
 * activity-only events are immediately removed (or restored) without the user
 * having to touch each trigger card manually.
 */
function refreshScopedTriggerIds() {
  document.querySelectorAll('[data-field="triggerList"] .item-card:not([data-is-group="true"])').forEach(card => {
    const triggerContainer = card.querySelector(':scope > div:last-child');
    if (triggerContainer?._rebuildIdInput) triggerContainer._rebuildIdInput();
  });
  onFormChange();
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

/** Renders the product switch and wires it to onProductChange(). */
function renderProductSwitch() {
  const host = document.getElementById('product-switch');
  if (!host) return;
  host.innerHTML = '';
  for (const p of PRODUCTS) {
    const btn = h('button', { type: 'button', title: `Build ${p.label} rules` }, p.label);
    btn.setAttribute('aria-pressed', String(p.id === selectedProduct));
    btn.addEventListener('click', () => onProductChange(p.id));
    host.append(btn);
  }
}

async function init() {
  _updateVersionsCountBadge();
  await loadSchema();
  populateTemplateDropdown();
  renderProductSwitch();

  rules = [blankRule()];
  activeRuleIndex = 0;

  populateFormFromRule(rules[0]);
  showScopeHint();
  renderRuleList();
  updatePreview();
}

// Start
init();
