import { filterByLength, paginatePatterns, validateConstraints } from './patterns.js';
import { patternSvg, sequenceMarkup } from './render.js';

const $ = selector => document.querySelector(selector);
const format = number => number.toLocaleString('zh-CN');
const PAGE_SIZE = 24;
const state = {
  points: Array(9).fill('neutral'), mode: 'include', minLength: 4, maxLength: 9,
  patterns: new Uint32Array(), visible: new Uint32Array(), counts: new Uint32Array(10),
  page: 1, length: 0, showNumbers: true, applied: null, elapsed: 0,
  busy: false, exporting: false, worker: null, cancel: null, detail: null, returnFocus: null,
};
let toastTimer;

function constraints() {
  return {
    included: state.points.flatMap((mode, index) => mode === 'included' ? [index + 1] : []),
    excluded: state.points.flatMap((mode, index) => mode === 'excluded' ? [index + 1] : []),
    minLength: state.minLength, maxLength: state.maxLength,
  };
}

function isDirty() {
  return state.applied && JSON.stringify(constraints()) !== JSON.stringify(state.applied);
}

function describe(query) {
  const parts = [];
  if (query.included.length) parts.push(`必含 ${query.included.join('、')}`);
  if (query.excluded.length) parts.push(`排除 ${query.excluded.join('、')}`);
  if (!parts.length) parts.push('暂无点位限制');
  parts.push(query.minLength === query.maxLength ? `${query.minLength} 个点` : `${query.minLength}–${query.maxLength} 个点`);
  return parts.join(' · ');
}

function constraintError(query) {
  if (query.included.length > query.maxLength) return `已选 ${query.included.length} 个必含点，请把最多点数调整到至少 ${query.included.length}。`;
  if (9 - query.excluded.length < query.minLength) return `只剩 ${9 - query.excluded.length} 个可用点，请减少排除点或降低最少点数。`;
  return '';
}

function renderInputs() {
  const query = constraints();
  $('#point-grid').innerHTML = state.points.map((mode, index) => {
    const label = mode === 'included' ? '必须包含' : mode === 'excluded' ? '一定排除' : '不确定';
    return `<button type="button" class="point-button ${mode}" data-point="${index + 1}" aria-label="点 ${index + 1}，${label}" aria-pressed="${mode !== 'neutral'}">${index + 1}</button>`;
  }).join('');
  $('#included-count').textContent = query.included.length;
  $('#excluded-count').textContent = query.excluded.length;
  $('#neutral-count').textContent = 9 - query.included.length - query.excluded.length;
  $('#min-length').value = state.minLength;
  $('#max-length').value = state.maxLength;
  $('#length-track').innerHTML = Array.from({ length: 9 }, (_, index) => `<span class="length-tick ${index + 1 >= state.minLength && index + 1 <= state.maxLength ? 'active' : ''}">${index + 1}</span>`).join('');
  $('#constraint-summary').textContent = describe(query);
  const error = constraintError(query);
  $('#form-error').hidden = !error;
  $('#form-error').textContent = error;
  $('#generate').disabled = !!error;
  updateStatus();
}

function updateStatus() {
  $('#export').disabled = state.busy || state.exporting || !!isDirty() || !state.patterns.length;
  $('#result-status').textContent = state.busy ? '正在列举所有符合条件的图案…' : isDirty() ? '线索已调整。点击「列举可能的图案」更新结果。' : '';
  $('#pattern-grid').classList.toggle('loading', state.busy);
  $('#pattern-grid').setAttribute('aria-busy', String(state.busy));
  $('#generate span').textContent = state.busy ? '正在列举…' : '列举可能的图案';
}

function renderFilters() {
  if (!state.applied) return;
  const filters = [0];
  for (let length = state.applied.minLength; length <= state.applied.maxLength; length++) filters.push(length);
  $('#length-filters').innerHTML = filters.map(length => `<button class="length-filter" type="button" data-length="${length}" aria-pressed="${state.length === length}" ${length && !state.counts[length] ? 'disabled' : ''} aria-label="${length ? `${length} 点，共 ${format(state.counts[length])} 个图案` : `全部，共 ${format(state.patterns.length)} 个图案`}">${length ? `${length} 点` : '全部'}</button>`).join('');
}

function renderResults({ scroll = false } = {}) {
  const pagination = paginatePatterns(state.visible, state.page, PAGE_SIZE);
  state.page = pagination.page;
  $('#total-count').textContent = format(state.patterns.length);
  if (state.applied) $('#result-description').textContent = `${describe(state.applied)}${state.length ? ` · 正在查看 ${state.length} 点图案` : ''}`;
  $('#result-time').textContent = `${Math.max(1, Math.round(state.elapsed))} ms`;
  renderFilters();
  $('#pattern-grid').innerHTML = Array.from(pagination.items, (code, index) => {
    const order = pagination.start + index + 1;
    return `<button class="pattern-card" type="button" data-pattern="${code}" aria-label="图案 ${order}，${String(code).length} 个点，顺序 ${String(code).split('').join('、')}，点击查看"><div class="card-top"><span class="card-id">#${String(order).padStart(4, '0')}</span><span class="card-length">${String(code).length} 点</span></div>${patternSvg(code, { showNumbers: state.showNumbers })}<div class="pattern-sequence">${sequenceMarkup(code)}</div></button>`;
  }).join('');
  $('#empty-state').hidden = state.visible.length !== 0;
  $('#pagination').hidden = state.visible.length === 0;
  $('#page-description').textContent = `显示 ${format(pagination.start + 1)}–${format(pagination.end)} / ${format(state.visible.length)} 个`;
  $('#page-input').value = state.page;
  $('#page-input').max = pagination.pageCount;
  $('#page-total').textContent = `/ ${format(pagination.pageCount)}`;
  $('#prev-page').disabled = state.page <= 1;
  $('#next-page').disabled = state.page >= pagination.pageCount;
  updateStatus();
  if (scroll) $('#results-title').scrollIntoView({ behavior: 'auto', block: 'start' });
}

async function generatePatterns() {
  const query = constraints();
  const error = constraintError(query);
  if (error) { renderInputs(); return null; }
  if (state.cancel) state.cancel();
  state.worker?.terminate();
  state.busy = true;
  updateStatus();
  let worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    state.worker = worker;
    const data = await new Promise((resolve, reject) => {
      state.cancel = () => resolve(null);
      worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
      worker.onerror = () => reject(new Error('无法启动本地计算。请通过本地服务打开页面，并重试。'));
      worker.postMessage(query);
    });
    if (!data || state.worker !== worker) return null;
    state.patterns = data.patterns;
    state.counts = data.counts;
    state.visible = state.patterns;
    state.length = 0;
    state.page = 1;
    state.applied = query;
    state.elapsed = data.elapsed;
    state.busy = false;
    renderResults();
    if (!isDirty()) $('#result-status').textContent = `已列举 ${format(data.total)} 个符合线索的图案。`;
    return { total: data.total, counts: Array.from(data.counts), page: 1, pageCount: Math.max(1, Math.ceil(data.total / PAGE_SIZE)), firstPage: Array.from(state.patterns.subarray(0, PAGE_SIZE), String) };
  } catch (error) {
    if (!worker || state.worker === worker) {
      state.busy = false;
      updateStatus();
      $('#result-status').textContent = error.message;
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

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
}

function openPattern(code, button) {
  state.detail = code;
  state.returnFocus = button;
  $('#dialog-title').textContent = `${String(code).length} 个点，一条线`;
  $('#detail-pattern').innerHTML = patternSvg(code, { animated: true });
  $('#detail-sequence').innerHTML = sequenceMarkup(code, true);
  $('#detail-caption').textContent = `从 ${String(code)[0]} 开始，在 ${String(code).at(-1)} 结束`;
  $('#pattern-dialog').showModal();
}

async function exportPatterns() {
  if (!state.applied || state.busy || state.exporting || isDirty() || !state.patterns.length) return;
  state.exporting = true;
  const snapshot = state.patterns;
  const query = state.applied;
  const button = $('#export');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    // Yield between chunks while preparing the complete CSV export.
    const parts = ['\uFEFF序号,点数,点序列\r\n'];
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
    link.download = `图案候选_${query.minLength}-${query.maxLength}点_包含${query.included.join('') || '无'}_排除${query.excluded.join('') || '无'}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify(`已导出全部 ${format(snapshot.length)} 个图案`);
  } catch {
    notify('导出未完成，请重试');
  } finally {
    state.exporting = false;
    button.removeAttribute('aria-busy');
    updateStatus();
  }
}

for (let point = 1; point <= 9; point++) {
  for (const id of ['min-length', 'max-length']) $(`#${id}`).insertAdjacentHTML('beforeend', `<option value="${point}">${point} 个点</option>`);
}
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
$('#clue-form').addEventListener('submit', event => { event.preventDefault(); void generatePatterns(); });
$('#reset').addEventListener('click', reset);
$('#empty-reset').addEventListener('click', reset);
$('#length-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-length]');
  if (!button || button.disabled) return;
  state.length = Number(button.dataset.length);
  state.visible = filterByLength(state.patterns, state.length);
  state.page = 1;
  renderResults();
  $(`[data-length="${state.length}"]`)?.focus();
});
$('#show-numbers').addEventListener('change', event => { state.showNumbers = event.target.checked; renderResults(); });
$('#prev-page').addEventListener('click', () => setPage(state.page - 1));
$('#next-page').addEventListener('click', () => setPage(state.page + 1));
$('#page-input').addEventListener('change', event => setPage(Number(event.target.value)));
$('#page-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); setPage(Number(event.target.value)); }
});
$('#pattern-grid').addEventListener('click', event => {
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
    notify('点序列已复制');
  } catch {
    notify('复制不可用，可按详情中的数字手动记录');
  }
});
$('#export').addEventListener('click', () => { void exportPatterns(); });

// Optional browser-native tool shares the UI's state and generation action.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tool = {
    name: 'enumerate_pattern_candidates',
    title: '按线索列举图案密码',
    description: '设置必含点、排除点和点数范围，在当前页面列举符合 Android 九宫格规则的全部图案。返回总数和第一页点序列。',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        included: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 9 }, uniqueItems: true },
        excluded: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 9 }, uniqueItems: true },
        minLength: { type: 'integer', minimum: 1, maximum: 9 },
        maxLength: { type: 'integer', minimum: 1, maximum: 9 },
      },
      required: ['included', 'excluded', 'minLength', 'maxLength'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!input || typeof input !== 'object') throw new TypeError('请提供有效线索');
      for (const key of ['included', 'excluded', 'minLength', 'maxLength']) if (!(key in input)) throw new TypeError(`缺少 ${key}`);
      const checked = validateConstraints(input);
      if (checked.required & checked.forbidden) throw new RangeError('同一个点不能同时必含和排除');
      const query = { included: input.included, excluded: input.excluded, minLength: checked.minLength, maxLength: checked.maxLength };
      const error = constraintError(query);
      if (error) throw new RangeError(error);
      state.points = Array.from({ length: 9 }, (_, i) => checked.required & (1 << i) ? 'included' : checked.forbidden & (1 << i) ? 'excluded' : 'neutral');
      state.minLength = checked.minLength;
      state.maxLength = checked.maxLength;
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
