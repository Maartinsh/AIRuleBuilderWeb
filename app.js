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

/* =========================================================
   SCHEMA & VALIDATION
   ========================================================= */

let schema = null;
let ajvInstance = null;
let schemaValidator = null;

const _TIME_RE = /^\d{1,2}:\d{2}$/;
const _FROM_NOW_RE = /^[+-]?\d+[hdm]$/;
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
  } catch (e) {
    console.warn('Could not fetch rule-schema.json, validation disabled:', e.message);
    showToast('Schema not loaded — validation unavailable. Serve via HTTP for full features.');
    return;
  }

  // Load Ajv from CDN
  try {
    if (typeof Ajv === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/ajv@8/dist/ajv7.min.js');
    }
    ajvInstance = new Ajv({ allErrors: true, strict: false });
    schemaValidator = ajvInstance.compile(schema);
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

  // Data Source
  const dsSelect = createSelect(DATA_SOURCES, { id: uid(), onInput: 'onFormChange()' });
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
    if (old) old.remove();
    const oldList = idContainer.querySelector('datalist');
    if (oldList) oldList.remove();

    const isApi = API_DATA_SOURCES.includes(ds);
    idLabel.textContent = isApi ? 'API Endpoint' : 'Trigger ID';

    if (isApi) {
      // API source — show endpoints from API_ENDPOINTS
      const endpoints = API_ENDPOINTS[ds] || [];
      const sel = h('select', {});
      sel.dataset.field = 'triggerId';
      sel.append(h('option', { value: '' }, '\u2014 Select API endpoint \u2014'));
      for (const ep of endpoints) {
        sel.append(h('option', { value: ep.id }, `${ep.label} \u2014 ${ep.description}`));
      }
      if (prevValue) sel.value = prevValue;
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
          const isTripOnly = scope !== 'trip' && TRIP_ONLY_EVENTS.includes(id);
          const opt = h('option', { value: id }, isTripOnly ? `${id} (trip scope only)` : id);
          if (isTripOnly) opt.disabled = true;
          sel.append(opt);
        }
        if (prevValue) sel.value = prevValue;
        sel.addEventListener('change', onFormChange);
        idContainer.append(sel);
      }
    }
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

    if (cfg?.mhubFlagEvent) {
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
    if (e.target.dataset?.field === 'triggerId') updateConditionsVisibility();
  });
  container.addEventListener('input', (e) => {
    if (e.target.dataset?.field === 'triggerId') updateConditionsVisibility();
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
    [{ value: '', label: 'Default (1 day)' }, { value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }],
    { onInput: 'onFormChange()' }
  );
  dateRangeSelect.dataset.field = 'dateRangeInDays';
  if (data?.dateRangeInDays) dateRangeSelect.value = String(data.dateRangeInDays);
  dateRangeContainer.append(createField('Date Range', dateRangeSelect));
  container.append(dateRangeContainer);

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

/**
 * Updates parameter datalist hints for condition fields.
 */
function updateParameterHints(triggerContainer, dataSource) {
  const params = PARAMETERS[dataSource] || [];
  const datalists = triggerContainer.querySelectorAll('[data-param-hints]');
  for (const dl of datalists) {
    dl.innerHTML = '';
    for (const p of params) dl.append(h('option', { value: p }));
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
 * Renders the appropriate fields for a condition type.
 */
function renderConditionFields(container, type, dataSource, data = null, triggerConfig = null, filterFieldsOverride = null) {
  container.innerHTML = '';
  const rawParams = filterFieldsOverride || PARAMETERS[dataSource] || [];
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
      for (const p of params) paramList.append(h('option', { value: p }));

      const availableOps = triggerConfig?.validOperators || OPERATORS;
      const opSelect = createSelect(availableOps, { onInput: 'onFormChange()' });
      opSelect.dataset.field = 'operator';
      if (data?.operator) opSelect.value = data.operator;

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
        const typeHint = fieldInfo ? ` (${fieldInfo.label})` : '';
        const baseHint = triggerConfig?.valueHint || (isBool ? 'true or false' : isNumeric ? 'number' : 'value');

        if (op === 'in' && paramName === 'day_of_week') {
          // Day-of-week chip selector
          const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
          const selected = new Set(data?.value && Array.isArray(data.value) ? data.value : []);
          const hiddenInput = h('input', { type: 'hidden' });
          hiddenInput.dataset.field = 'value';
          hiddenInput.dataset.valueType = 'array';
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
        } else if (op === 'in') {
          const tagInput = h('input', { type: 'text', placeholder: 'Comma-separated values', onInput: 'onFormChange()' });
          tagInput.dataset.field = 'value';
          tagInput.dataset.valueType = 'array';
          if (data?.value && Array.isArray(data.value)) tagInput.value = data.value.join(', ');
          valueContainer.append(h('label', {}, 'Values (comma-separated)'), tagInput);
        } else {
          const inputType = isNumeric ? 'number' : 'text';
          const valInput = h('input', { type: inputType, placeholder: baseHint, onInput: 'onFormChange()' });
          valInput.dataset.field = 'value';
          valInput.dataset.valueType = isNumeric ? 'auto' : isBool ? 'bool' : 'auto';
          if (data?.value !== undefined && !Array.isArray(data.value)) valInput.value = String(data.value);
          const label = fieldInfo ? `Value${typeHint}` : 'Value';
          valueContainer.append(h('label', {}, label), valInput);
        }
      }
      // Re-render value input when parameter changes (to update type hints)
      paramInput.addEventListener('change', () => renderValueInput(opSelect.value));
      opSelect.addEventListener('change', () => renderValueInput(opSelect.value));
      renderValueInput(opSelect.value);

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
        createField('Event Name', enInput),
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
    const sources = cat === 'api' ? API_DATA_SOURCES : cat === 'event' ? EVENT_DATA_SOURCES : [];
    _updateSelectOptions(dsSelect, [{ value: '', label: '\u2014 Select data source \u2014' }, ...sources.map(s => ({ value: s, label: s }))]);
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
    categorySelect.dispatchEvent(new Event('change'));

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
   SCOPE WARNING SYSTEM
   Checks for incompatibilities between rule scope and
   variable data sources or trigger events.
   Scope hierarchy: trip < daily < global
   Trip can access all data; daily/global cannot access trip data.
   ========================================================= */

/**
 * Checks all variable cards and trigger cards for scope incompatibilities.
 * Shows inline warnings when trip-scoped data is used in daily/global rules.
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
    if (req === 'trip' && scope !== 'trip') {
      const warn = h('div', { className: 'scope-warning' },
        `${ds} data is trip-scoped \u2014 the buffer is cleared when the trip ends. ` +
        `This variable won\u2019t have data in \u201C${scope}\u201D scope. Consider using \u201Ctrip\u201D scope for this rule.`
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
      if (tid && TRIP_ONLY_EVENTS.includes(tid) && scope !== 'trip') {
        const warn = h('div', { className: 'scope-warning' },
          `\u201C${tid}\u201D is a trip-only event \u2014 it won\u2019t fire in \u201C${scope}\u201D scope. ` +
          `Use \u201Ctrip\u201D scope for rules with this trigger.`
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
  }

  return cond;
}

/**
 * Parses a condition value based on its type annotation.
 */
function parseConditionValue(el) {
  const raw = el.value;
  const vtype = el.dataset.valueType;

  if (vtype === 'array') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (vtype === 'integer') {
    return parseInt(raw) || 0;
  }
  if (vtype === 'string') {
    return raw;
  }
  // Auto-detect
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (raw !== '' && !isNaN(num)) return num;
  return raw;
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

/* =========================================================
   MULTI-RULE MANAGEMENT
   ========================================================= */

function saveActiveRule() {
  if (activeRuleIndex >= 0 && activeRuleIndex < rules.length) {
    rules[activeRuleIndex] = buildRuleJSON();
  }
}

function switchToRule(index) {
  if (index === activeRuleIndex || index < 0 || index >= rules.length) return;
  saveActiveRule();
  activeRuleIndex = index;
  populateFormFromRule(rules[activeRuleIndex]);
  renderRuleList();
  updatePreview();
}

function addNewRule() {
  saveActiveRule();
  rules.push({ id: `rule_${rules.length + 1}`, sessionScope: 'global', triggerExpression: { type: 'GROUP', groupType: 'AND' } });
  activeRuleIndex = rules.length - 1;
  populateFormFromRule(rules[activeRuleIndex]);
  renderRuleList();
  updatePreview();
  showToast(`Added rule #${rules.length}`);
}

function deleteRule(index) {
  if (rules.length <= 1) { showToast('Cannot delete the last rule'); return; }
  const deletedId = rules[index]?.id || `#${index + 1}`;
  rules.splice(index, 1);
  if (activeRuleIndex >= rules.length) activeRuleIndex = rules.length - 1;
  else if (activeRuleIndex > index) activeRuleIndex--;
  populateFormFromRule(rules[activeRuleIndex]);
  renderRuleList();
  updatePreview();
  showToast(`Deleted "${deletedId}"`);
}

function renderRuleList() {
  const list = document.getElementById('rule-list');
  list.innerHTML = '';
  rules.forEach((rule, i) => {
    const item = h('div', {
      className: `rule-list-item${i === activeRuleIndex ? ' active' : ''}`,
      onClick: (e) => { if (!e.target.closest('.rule-list-delete')) switchToRule(i); }
    },
      h('span', { className: 'rule-list-id' }, rule.id || `(untitled #${i + 1})`),
      h('span', { className: 'rule-list-scope' }, rule.sessionScope || 'global'),
      h('button', { className: 'rule-list-delete', title: 'Delete rule',
        onClick: (e) => { e.stopPropagation(); deleteRule(i); } }, '\u00D7')
    );
    list.append(item);
  });
  document.getElementById('rule-count-badge').textContent = rules.length;
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
  const jsonStr = JSON.stringify(rules, null, 2);
  const highlighted = syntaxHighlight(jsonStr);

  document.getElementById('preview-body').innerHTML = highlighted;

  // Meta info
  const bytes = new Blob([jsonStr]).size;
  const lines = jsonStr.split('\n').length;
  document.getElementById('preview-meta').textContent =
    `${rules.length} rule(s), ${lines} lines, ${bytes} bytes`;

  // Live validation (non-blocking)
  liveValidate(rules);
  renderRuleList();
  checkScopeWarnings();
  _updateVariableVisibility();
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
 * Handles JSON file upload. Parses the file, validates it, then loads all
 * rules into the editor and shows validation results in the preview panel.
 */
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

    // Normalise: accept a single rule object or an array of rules
    const loaded = Array.isArray(parsed) ? parsed : (parsed.rules ? parsed.rules : [parsed]);
    if (!loaded.length) {
      showToast('No rules found in uploaded file.', 4000);
      return;
    }

    // Validate using the existing validation pipeline
    const results = validateRule(loaded);
    const panel = document.getElementById('preview-validation');
    showValidation(panel, results);

    // Load into editor regardless of errors so the user can fix them
    rules = loaded.map(r => JSON.parse(JSON.stringify(r)));
    activeRuleIndex = 0;
    populateFormFromRule(rules[0]);
    showScopeHint();
    renderRuleList();
    updatePreview();
    highlightErrorFields(rules);

    if (results.valid) {
      showToast(`Loaded ${rules.length} rule(s) — validation passed!`, 4000);
    } else {
      showToast(`Loaded with ${results.errors.length} error(s) — see validation panel.`, 5000);
    }
  };
  reader.readAsText(file);
}

/**
 * Validates rule JSON. Returns { valid, errors[], warnings[] }.
 */
function validateRule(jsonArray) {
  const errors = [];
  const warnings = [];

  // Schema validation (if available)
  if (schemaValidator) {
    const valid = schemaValidator(jsonArray);
    if (!valid && schemaValidator.errors) {
      for (const err of schemaValidator.errors) {
        errors.push(`${err.instancePath || '/'}: ${err.message}`);
      }
    }
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

    // Scope-event warnings
    const scope = rule.sessionScope || 'global';
    if (scope !== 'trip') {
      const triggerIds = collectTriggerIds(rule.triggerExpression);
      for (const tid of triggerIds) {
        if (TRIP_ONLY_EVENTS.includes(tid)) {
          warnings.push(`${prefix}"${tid}" only fires in trip scope, but rule scope is "${scope}"`);
        }
      }
    }

    // Trigger ID vs data source warnings
    validateTriggerDataSource(rule.triggerExpression, warnings);

    // Required fields on every SINGLE expression (blocks publish/copy/download)
    validateTriggerFields(rule.triggerExpression, errors, prefix);

    // Required conditions check
    validateRequiredConditions(rule.triggerExpression, errors, prefix);

    // Condition field content validation (format, required fields per type)
    validateConditionFields(rule.triggerExpression, errors, prefix);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
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
  if (expr.type === 'SINGLE' && expr.id && expr.dataSource) {
    const validIds = TRIGGER_IDS[expr.dataSource];
    if (validIds && validIds.length > 0 && !validIds.includes(expr.id)) {
      warnings.push(`Trigger ID "${expr.id}" is not a known ID for data source "${expr.dataSource}"`);
    }
  }
  if (expr.type === 'GROUP' && expr.expressions) {
    expr.expressions.forEach(e => validateTriggerDataSource(e, warnings));
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

/**
 * Recursively validates condition field content for every SINGLE expression.
 * Catches missing/malformed fields that Ajv would catch but custom validation previously missed.
 */
// Parameters that must always be strings — a numeric value is always wrong for these.
const _STRING_ONLY_PARAMS = new Set([
  'poi_name', 'poi_id', 'day_of_week', 'RouteState', 'status',
  'driving_conditions', 'closestFuelStation', 'closestPlaceName',
  'closestPlaceAddress'
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

  // Condition-required triggers: highlight trigger cards missing conditions
  if (rule.triggerExpression) {
    highlightMissingConditions(triggerRoot, rule.triggerExpression);
  }

  // Highlight individual condition inputs with invalid/missing values
  if (triggerRoot) {
    highlightConditionFieldErrors(triggerRoot);
  }
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
    }
  });
}

/* =========================================================
   IMPORT / EXPORT
   ========================================================= */

function copyJSON() {
  saveActiveRule();
  const results = validateRule(rules);
  if (!results.valid) {
    showToast('Fix validation errors before copying');
    return;
  }
  const jsonStr = JSON.stringify(rules, null, 2);
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
  const results = validateRule(rules);
  if (!results.valid) {
    showToast('Fix validation errors before downloading');
    return;
  }
  const jsonStr = JSON.stringify(rules, null, 2);
  const filename = rules.length === 1 ? (rules[0].id || 'rule') + '.json' : 'rules.json';
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

  if (!silent) {
    rules = [{ id: '', sessionScope: 'global', triggerExpression: { type: 'GROUP', groupType: 'AND' } }];
    activeRuleIndex = 0;
    renderRuleList();
    onFormChange();
    showToast('All rules cleared');
  }
}

/* =========================================================
   TEMPLATE SYSTEM
   ========================================================= */

function populateTemplateDropdown() {
  const select = document.getElementById('template-select');
  if (!select) return;
  for (const t of TEMPLATES) {
    select.append(h('option', { value: t.id }, `${t.id} \u2014 ${t.description}`));
  }
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
    const payload = {
      _meta: { versionId, name, publishedAt, ruleCount: rulesArray.length, description },
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
    const payload = {
      _meta: { ...existingData._meta, ruleCount: rulesArray.length, updatedAt },
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
    const loaded = data.rules || (Array.isArray(data) ? data : null);
    if (!loaded || !loaded.length) throw new Error('No rules found in version');
    rules = loaded.map(r => JSON.parse(JSON.stringify(r)));
    activeRuleIndex = 0;
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
 * trip-only events are immediately removed (or restored) without the user
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

async function init() {
  _updateVersionsCountBadge();
  await loadSchema();
  populateTemplateDropdown();

  rules = [{ id: 'rule_1', sessionScope: 'global', triggerExpression: { type: 'GROUP', groupType: 'AND' } }];
  activeRuleIndex = 0;

  populateFormFromRule(rules[0]);
  showScopeHint();
  renderRuleList();
  updatePreview();
  _refreshDot();
}

// Start
init();
