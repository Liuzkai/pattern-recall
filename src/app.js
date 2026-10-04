import { filterByLength, paginatePatterns, validateConstraints } from './patterns.js';
import { patternSvg, sequenceMarkup } from './render.js';
import { createSketchTool } from './sketch.js';
import { t, html, languages, formatNumber, getLanguage, setLanguage, restoreLanguage, applyTranslations } from './i18n.js';

const $ = selector => document.querySelector(selector);
const format = formatNumber;
restoreLanguage();
applyTranslations();
const PAGE_SIZE = 24;
const state = {
  points: Array(9).fill('neutral'), mode: 'include', minLength: 4, maxLength: 9, startPoint: 0, endPoint: 0,
  excludeLongDiagonal: true, excludeLongStraight: true,
  patterns: new Uint32Array(), visible: new Uint32Array(), counts: new Uint32Array(10),
  remaining: new Uint32Array(), remainingCounts: new Uint32Array(10), active: new Uint32Array(), activeCounts: new Uint32Array(10),
  dismissed: new Set(), dismissedCount: 0, hideDismissed: false,
  page: 1, length: 0, showNumbers: true, applied: null, elapsed: 0,
  busy: false, computeFailed: false, exporting: false, worker: null, cancel: null, detail: null, returnFocus: null,
};
let toastTimer, toastMessage;
function connectionRules() { return { excludeLongDiagonal: state.excludeLongDiagonal, excludeLongStraight: state.excludeLongStraight }; }
const sketch = createSketchTool({ getConnectionRules: connectionRules });

function constraints() {
  return {
    included: state.points.flatMap((mode, index) => mode === 'included' ? [index + 1] : []),
    excluded: state.points.flatMap((mode, index) => mode === 'excluded' ? [index + 1] : []),
    minLength: state.minLength, maxLength: state.maxLength,
    startPoint: state.startPoint, endPoint: state.endPoint,
    ...connectionRules(),
  };
}

function isDirty() {
  return state.applied && JSON.stringify(constraints()) !== JSON.stringify(state.applied);
}

function describe(query) {
  const parts = [];
  if (query.included.length) parts.push(t('includeSummary', { dots: query.included.join(', ') }));
  if (query.excluded.length) parts.push(t('excludeSummary', { dots: query.excluded.join(', ') }));
  if (!parts.length && !query.startPoint && !query.endPoint) parts.push(t('unrestricted'));
  if (query.startPoint) parts.push(t('startSummary', { point: query.startPoint }));
  if (query.endPoint) parts.push(t('endSummary', { point: query.endPoint }));
  if (query.excludeLongDiagonal) parts.push(t('excludeDiagonal'));
  if (query.excludeLongStraight) parts.push(t('excludeStraight'));
  parts.push(t('dotCount', { count: query.minLength === query.maxLength ? query.minLength : `${query.minLength}–${query.maxLength}` }));
  return parts.join(' · ');
}

function constraintError(query) {
  if (query.startPoint && query.excluded.includes(query.startPoint)) return t('endpointExcluded', { endpoint: t('first'), point: query.startPoint });
  if (query.endPoint && query.excluded.includes(query.endPoint)) return t('endpointExcluded', { endpoint: t('last'), point: query.endPoint });
  if (query.startPoint && query.startPoint === query.endPoint && query.minLength > 1) return t('sameEndpoints');
  const required = new Set([...query.included, query.startPoint, query.endPoint].filter(Boolean));
  if (required.size > query.maxLength) return t('requiredCount', { count: required.size });
  if (9 - query.excluded.length < query.minLength) return t('availableCount', { count: 9 - query.excluded.length });
  return '';
}

function renderInputs({ preserveSketchMessage = false } = {}) {
  if (!preserveSketchMessage) state.computeFailed = false;
  const query = constraints();
  $('#point-grid').innerHTML = state.points.map((mode, index) => {
    const label = t(mode === 'included' ? 'include' : mode === 'excluded' ? 'exclude' : 'unknown');
    return `<button type="button" class="point-button ${mode}" data-point="${index + 1}" aria-label="${html(t('pointLabel', { point: index + 1, state: label }))}" aria-pressed="${mode !== 'neutral'}">${index + 1}</button>`;
  }).join('');
  $('#included-count').textContent = query.included.length;
  $('#excluded-count').textContent = query.excluded.length;
  $('#neutral-count').textContent = 9 - query.included.length - query.excluded.length;
  $('#min-length').value = state.minLength;
  $('#max-length').value = state.maxLength;
  $('#start-point').value = state.startPoint;
  $('#end-point').value = state.endPoint;
  $('#exclude-long-diagonal').checked = state.excludeLongDiagonal;
  $('#exclude-long-straight').checked = state.excludeLongStraight;
  if (preserveSketchMessage) sketch.refreshLabels();
  else sketch.refreshRule();
  $('#length-track').innerHTML = Array.from({ length: 9 }, (_, index) => `<span class="length-tick ${index + 1 >= state.minLength && index + 1 <= state.maxLength ? 'active' : ''}">${index + 1}</span>`).join('');
  $('#constraint-summary').textContent = describe(query);
  const error = constraintError(query);
  $('#form-error').hidden = !error;
  $('#form-error').textContent = error;
  $('#generate').disabled = !!error;
  updateStatus();
}

function updateStatus() {
  $('#export').disabled = state.busy || state.exporting || !!isDirty() || !state.active.length;
  $('#result-status').textContent = state.busy ? t('busy') : state.computeFailed ? t('computeFailed') : isDirty() ? t('dirty') : state.applied ? `${t('computed', { count: state.patterns.length })}${state.hideDismissed && state.dismissedCount ? ` ${t('hiddenCount', { count: state.dismissedCount })}` : ''}` : '';
  $('#pattern-grid').classList.toggle('loading', state.busy);
  $('#pattern-grid').setAttribute('aria-busy', String(state.busy));
  $('#generate span').textContent = t(state.busy ? 'busy' : 'generate');
}

function refreshCandidates() {
  const remainingCounts = state.counts.slice();
  state.remaining = state.dismissed.size ? state.patterns.filter(code => {
    if (!state.dismissed.has(code)) return true;
    remainingCounts[String(code).length]--;
    return false;
  }) : state.patterns;
  state.remainingCounts = remainingCounts;
  state.dismissedCount = state.patterns.length - state.remaining.length;
  state.active = state.hideDismissed ? state.remaining : state.patterns;
  state.activeCounts = state.hideDismissed ? remainingCounts : state.counts;
  state.visible = filterByLength(state.active, state.length);
}

function renderFilters() {
  if (!state.applied) return;
  const filters = [0];
  for (let length = state.applied.minLength; length <= state.applied.maxLength; length++) filters.push(length);
  $('#length-filters').innerHTML = filters.map(length => {
    const label = length ? t('dotCount', { count: length }) : t('all');
    const count = length ? state.activeCounts[length] : state.active.length;
    return `<button class="length-filter" type="button" data-length="${length}" aria-pressed="${state.length === length}" ${length && !state.counts[length] ? 'disabled' : ''} aria-label="${html(`${label}. ${t('computed', { count })}`)}">${html(label)}</button>`;
  }).join('');
}

function renderResults({ scroll = false } = {}) {
  const pagination = paginatePatterns(state.visible, state.page, PAGE_SIZE);
  state.page = pagination.page;
  $('#total-count').textContent = format(state.active.length);
  $('#remaining-count').textContent = format(state.length ? state.remainingCounts[state.length] : state.remaining.length);
  if (state.applied) $('#result-description').textContent = `${describe(state.applied)}${state.length ? ` · ${t('showingLength', { count: state.length })}` : ''}`;
  $('#dismissed-summary').textContent = t('dismissedCount', { count: state.dismissedCount });
  $('#hide-dismissed').checked = state.hideDismissed;
  $('#restore-all').disabled = !state.dismissed.size;
  $('#result-time').textContent = `${Math.max(1, Math.round(state.elapsed))} ms`;
  renderFilters();
  $('#pattern-grid').innerHTML = Array.from(pagination.items, code => {
    const order = state.patterns.indexOf(code) + 1;
    const dismissed = state.dismissed.has(code);
    const sequence = String(code).split('').join(' → ');
    const label = t('patternLabel', { order, count: String(code).length, sequence, status: dismissed ? t('excluded') : '' });
    const dismissLabel = t(dismissed ? 'restoreLabel' : 'dismissLabel', { order, sequence });
    return `<article class="pattern-card ${dismissed ? 'is-dismissed' : ''}"><button class="pattern-preview" type="button" data-pattern="${code}" aria-label="${html(label)}"><div class="card-top"><span class="card-id">#${String(order).padStart(4, '0')}</span><span class="card-length">${html(t('dotCount', { count: String(code).length }))}</span></div>${patternSvg(code, { showNumbers: state.showNumbers })}<div class="pattern-sequence">${sequenceMarkup(code)}</div></button><button class="pattern-dismiss" type="button" data-dismiss="${code}" aria-pressed="${dismissed}" aria-label="${html(dismissLabel)}"><svg viewBox="0 0 24 24" aria-hidden="true">${dismissed ? '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>' : '<circle cx="12" cy="12" r="8"/><path d="m6 6 12 12"/>'}</svg><span>${html(t(dismissed ? 'restorePattern' : 'dismissPattern'))}</span></button></article>`;
  }).join('');
  const allHidden = state.hideDismissed && state.visible.length === 0 && filterByLength(state.patterns, state.length).length > 0;
  $('#empty-title').textContent = t(allHidden ? 'hiddenTitle' : 'emptyTitle');
  $('#empty-description').textContent = t(allHidden ? 'hiddenHelp' : 'emptyHelp');
  $('#empty-reset').textContent = t(allHidden ? 'restoreAll' : 'reset');
  $('#empty-state').hidden = state.visible.length !== 0;
  $('#pagination').hidden = state.visible.length === 0;
  $('#page-description').textContent = t('pageStatus', { start: state.visible.length ? pagination.start + 1 : 0, end: pagination.end, total: state.visible.length });
  $('#page-input').value = state.page;
  $('#page-input').max = pagination.pageCount;
  $('#page-total').textContent = `/ ${format(pagination.pageCount)}`;
  $('#prev-page').disabled = state.page <= 1;
  $('#next-page').disabled = state.page >= pagination.pageCount;
  updateStatus();
  if (scroll) $('#results-title').scrollIntoView({ behavior: 'auto', block: 'start' });
}

async function generatePatterns({ revealResults = false } = {}) {
  const query = constraints();
  const error = constraintError(query);
  if (error) { renderInputs(); return null; }
  if (state.cancel) state.cancel();
  state.worker?.terminate();
  state.busy = true;
  state.computeFailed = false;
  updateStatus();
  let worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    state.worker = worker;
    const data = await new Promise((resolve, reject) => {
      state.cancel = () => resolve(null);
      worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
      worker.onerror = () => reject(new Error('Worker failed to start'));
      worker.postMessage(query);
    });
    if (!data || state.worker !== worker) return null;
    state.patterns = data.patterns;
    state.counts = data.counts;
    state.length = 0;
    state.page = 1;
    state.applied = query;
    state.elapsed = data.elapsed;
    state.busy = false;
    refreshCandidates();
    renderResults();
    if (revealResults && window.matchMedia?.('(max-width: 760px)').matches) {
      $('#results-panel').scrollIntoView({ behavior: 'auto', block: 'start' });
      $('#results-panel').focus({ preventScroll: true });
    }
    return { total: state.active.length, enumeratedTotal: data.total, dismissed: state.dismissedCount, counts: Array.from(state.activeCounts), page: 1, pageCount: Math.max(1, Math.ceil(state.active.length / PAGE_SIZE)), firstPage: Array.from(state.active.subarray(0, PAGE_SIZE), String) };
  } catch {
    if (!worker || state.worker === worker) {
      state.busy = false;
      state.computeFailed = true;
      updateStatus();
    }
    return null;
  } finally {
    worker?.terminate();
    if (state.worker === worker) { state.worker = null; state.cancel = null; }
  }
}

function reset() {
  state.points.fill('neutral');
  state.minLength = 4;
  state.maxLength = 9;
  state.startPoint = 0;
  state.endPoint = 0;
  state.excludeLongDiagonal = true;
  state.excludeLongStraight = true;
  setMode('include');
  renderInputs();
  void generatePatterns();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
}

function setPage(page) {
  state.page = page;
  renderResults({ scroll: true });
}

function restoreAll() {
  state.dismissed.clear();
  refreshCandidates();
  renderResults();
}

function toggleDismissed(code) {
  if (state.busy || !state.patterns.includes(code)) return;
  const current = paginatePatterns(state.visible, state.page, PAGE_SIZE);
  const position = Array.from(current.items).indexOf(code);
  if (state.dismissed.has(code)) state.dismissed.delete(code);
  else state.dismissed.add(code);
  refreshCandidates();
  renderResults();
  const page = paginatePatterns(state.visible, state.page, PAGE_SIZE);
  const focusCode = state.visible.includes(code) ? code : page.items[Math.min(Math.max(0, position), page.items.length - 1)];
  const target = focusCode ? $(`[data-dismiss="${focusCode}"]`) : $('#hide-dismissed');
  target?.focus();
}

function notify(key, values = {}) {
  clearTimeout(toastTimer);
  toastMessage = { key, values };
  $('#toast').textContent = t(key, values);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
}

function openPattern(code, button) {
  state.detail = code;
  state.returnFocus = button;
  renderDetailLabels();
  $('#detail-pattern').innerHTML = patternSvg(code, { animated: true });
  $('#detail-sequence').innerHTML = sequenceMarkup(code, true);
  $('#pattern-dialog').showModal();
}

function renderDetailLabels() {
  if (!state.detail) return;
  $('#dialog-title').textContent = t('detailPoints', { count: String(state.detail).length });
  $('#detail-caption').textContent = t('detailCaption', { start: String(state.detail)[0], end: String(state.detail).at(-1) });
}

async function exportPatterns() {
  if (!state.applied || state.busy || state.exporting || isDirty() || !state.active.length) return;
  state.exporting = true;
  const snapshot = state.active;
  const hideDismissed = state.hideDismissed;
  const query = state.applied;
  const locale = getLanguage();
  const button = $('#export');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    // Yield between chunks while preparing the complete CSV export.
    const header = ['csvIndex', 'csvLength', 'csvSequence'].map(key => `"${t(key, {}, locale).replaceAll('"', '""')}"`).join(',');
    const parts = [`\uFEFF${header}\r\n`];
    for (let start = 0; start < snapshot.length; start += 10000) {
      const end = Math.min(start + 10000, snapshot.length);
      const lines = [];
      for (let index = start; index < end; index++) {
        const code = String(snapshot[index]);
        lines.push(`${index + 1},${code.length},${code}\r\n`);
      }
      parts.push(lines.join(''));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pattern-recall_${locale}_${query.minLength}-${query.maxLength}_include-${query.included.join('') || 'none'}_exclude-${query.excluded.join('') || 'none'}${query.startPoint ? `_start-${query.startPoint}` : ''}${query.endPoint ? `_end-${query.endPoint}` : ''}${query.excludeLongDiagonal ? '_no-diagonal' : ''}${query.excludeLongStraight ? '_no-straight' : ''}${hideDismissed ? '_undismissed' : ''}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('exported', { count: snapshot.length });
  } catch {
    notify('exportFailed');
  } finally {
    state.exporting = false;
    button.removeAttribute('aria-busy');
    updateStatus();
  }
}

function renderSelectOptions() {
  const points = Array.from({ length: 9 }, (_, index) => index + 1);
  for (const id of ['min-length', 'max-length']) $(`#${id}`).innerHTML = points.map(point => `<option value="${point}">${html(t('dotCount', { count: point }))}</option>`).join('');
  for (const id of ['start-point', 'end-point']) $(`#${id}`).innerHTML = `<option value="0">${html(t('unsure'))}</option>` + points.map(point => `<option value="${point}">${html(t('dotName', { point }))}</option>`).join('');
}
$('#language').innerHTML = languages.map(({ code, name }) => `<option value="${code}" lang="${code}">${name}</option>`).join('');
$('#language').value = getLanguage();
$('#language').addEventListener('change', event => {
  setLanguage(event.target.value);
  applyTranslations();
  renderSelectOptions();
  renderInputs({ preserveSketchMessage: true });
  renderResults();
  renderDetailLabels();
  if (toastMessage && !$('#toast').hidden) $('#toast').textContent = t(toastMessage.key, toastMessage.values);
  // Result cards were re-rendered; restore dialog focus to the corresponding new button.
  if (state.detail) state.returnFocus = $(`[data-pattern="${state.detail}"]`) || $('#results-title');
});
renderSelectOptions();
$('.mode-switch').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (button) setMode(button.dataset.mode);
});
$('#point-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-point]');
  if (!button) return;
  const index = Number(button.dataset.point) - 1;
  const desired = state.mode === 'include' ? 'included' : state.mode === 'exclude' ? 'excluded' : 'neutral';
  state.points[index] = state.points[index] === desired ? 'neutral' : desired;
  renderInputs();
  $(`[data-point="${index + 1}"]`).focus();
});
$('#min-length').addEventListener('change', event => {
  state.minLength = Number(event.target.value);
  if (state.minLength > state.maxLength) state.maxLength = state.minLength;
  renderInputs();
});
$('#max-length').addEventListener('change', event => {
  state.maxLength = Number(event.target.value);
  if (state.maxLength < state.minLength) state.minLength = state.maxLength;
  renderInputs();
});
$('#start-point').addEventListener('change', event => { state.startPoint = Number(event.target.value); renderInputs(); });
$('#end-point').addEventListener('change', event => { state.endPoint = Number(event.target.value); renderInputs(); });
$('#exclude-long-diagonal').addEventListener('change', event => { state.excludeLongDiagonal = event.target.checked; renderInputs(); });
$('#exclude-long-straight').addEventListener('change', event => { state.excludeLongStraight = event.target.checked; renderInputs(); });
$('#clue-form').addEventListener('submit', event => { event.preventDefault(); void generatePatterns({ revealResults: true }); });
$('#mobile-nav').addEventListener('click', event => {
  const link = event.target.closest('[data-section]');
  if (link?.dataset.section === 'sketch-tool') $('#sketch-tool').open = true;
});
$('#reset').addEventListener('click', reset);
$('#empty-reset').addEventListener('click', () => {
  const allHidden = state.hideDismissed && state.visible.length === 0 && filterByLength(state.patterns, state.length).length > 0;
  if (allHidden) { restoreAll(); $('#hide-dismissed').focus(); }
  else { reset(); $('#generate').focus(); }
});
$('#length-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-length]');
  if (!button || button.disabled) return;
  state.length = Number(button.dataset.length);
  state.visible = filterByLength(state.active, state.length);
  state.page = 1;
  renderResults();
  $(`[data-length="${state.length}"]`)?.focus();
});
$('#show-numbers').addEventListener('change', event => { state.showNumbers = event.target.checked; renderResults(); });
$('#hide-dismissed').addEventListener('change', event => {
  state.hideDismissed = event.target.checked;
  state.page = 1;
  refreshCandidates();
  renderResults();
});
$('#restore-all').addEventListener('click', () => {
  restoreAll();
  $('#hide-dismissed').focus();
});
$('#prev-page').addEventListener('click', () => setPage(state.page - 1));
$('#next-page').addEventListener('click', () => setPage(state.page + 1));
$('#page-input').addEventListener('change', event => setPage(Number(event.target.value)));
$('#page-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); setPage(Number(event.target.value)); }
});
$('#pattern-grid').addEventListener('click', event => {
  const dismiss = event.target.closest('[data-dismiss]');
  if (dismiss) { toggleDismissed(Number(dismiss.dataset.dismiss)); return; }
  const button = event.target.closest('[data-pattern]');
  if (button) openPattern(Number(button.dataset.pattern), button);
});
$('#close-dialog').addEventListener('click', () => $('#pattern-dialog').close());
$('#pattern-dialog').addEventListener('click', event => {
  if (event.target !== $('#pattern-dialog')) return;
  const bounds = $('#pattern-dialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('#pattern-dialog').close();
});
$('#pattern-dialog').addEventListener('close', () => state.returnFocus?.focus());
$('#replay-pattern').addEventListener('click', () => { if (state.detail) $('#detail-pattern').innerHTML = patternSvg(state.detail, { animated: true }); });
$('#copy-pattern').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(String(state.detail).split('').join(' → '));
    notify('copied');
  } catch {
    notify('copyFailed');
  }
});
$('#export').addEventListener('click', () => { void exportPatterns(); });

// Optional browser-native tool shares the UI's state and generation action.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tool = {
    name: 'enumerate_pattern_candidates',
    title: '按线索列举图案密码',
    description: '设置必含点、排除点、点数范围、起终点，独立排除斜线和直线的跨格连接，在当前页面列举图案。默认两项均排除。返回当前隐藏设置下的总数和第一页点序列。',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        included: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 9 }, uniqueItems: true },
        excluded: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 9 }, uniqueItems: true },
        minLength: { type: 'integer', minimum: 1, maximum: 9 },
        maxLength: { type: 'integer', minimum: 1, maximum: 9 },
        startPoint: { type: 'integer', minimum: 0, maximum: 9, description: '0 表示不确定' },
        endPoint: { type: 'integer', minimum: 0, maximum: 9, description: '0 表示不确定' },
        adjacentOnly: { type: 'boolean', default: true, description: '兼容选项，同时设置两项跨格排除；显式的独立选项优先' },
        excludeLongDiagonal: { type: 'boolean', description: '排除斜线跨行或列，如 1→8、1→9；允许 1→5' },
        excludeLongStraight: { type: 'boolean', description: '排除直线跨行或列，如 1→7、1→3；允许 1→4' },
      },
      required: ['included', 'excluded', 'minLength', 'maxLength'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!input || typeof input !== 'object') throw new TypeError('请提供有效线索');
      for (const key of ['included', 'excluded', 'minLength', 'maxLength']) if (!(key in input)) throw new TypeError(`缺少 ${key}`);
      const checked = validateConstraints({ ...input, adjacentOnly: input.adjacentOnly === undefined ? true : input.adjacentOnly });
      if (checked.required & checked.forbidden) throw new RangeError('同一个点不能同时必含和排除');
      const query = { included: input.included, excluded: input.excluded, minLength: checked.minLength, maxLength: checked.maxLength, startPoint: checked.startPoint, endPoint: checked.endPoint, excludeLongDiagonal: checked.excludeLongDiagonal, excludeLongStraight: checked.excludeLongStraight };
      const error = constraintError(query);
      if (error) throw new RangeError(error);
      state.points = Array.from({ length: 9 }, (_, i) => input.included.includes(i + 1) ? 'included' : input.excluded.includes(i + 1) ? 'excluded' : 'neutral');
      state.minLength = checked.minLength;
      state.maxLength = checked.maxLength;
      state.startPoint = checked.startPoint;
      state.endPoint = checked.endPoint;
      state.excludeLongDiagonal = checked.excludeLongDiagonal;
      state.excludeLongStraight = checked.excludeLongStraight;
      renderInputs();
      const result = await generatePatterns();
      if (!result) throw new Error('计算未完成或已被新的请求取消');
      return result;
    },
  };
  try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional support must not interrupt the page. */ }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}

renderInputs();
void generatePatterns();
