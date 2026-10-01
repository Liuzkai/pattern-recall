import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { Worker as NodeWorker } from 'node:worker_threads';

// An offline DOM harness tests state transitions without launching a browser.
class Element {
  constructor(selector) {
    this.selector = selector;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = true;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    };
  }
  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }
  async dispatch(event, data = {}) {
    for (const handler of this.listeners.get(event) || []) await handler({ target: this, preventDefault() {}, ...data });
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  insertAdjacentHTML(_, content) { this.innerHTML += content; }
  focus() { focused = this.selector; }
  scrollIntoView() {}
  setPointerCapture(id) { this.capturedPointer = id; }
  releasePointerCapture() { this.capturedPointer = null; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch('close'); }
  getBoundingClientRect() { return { left: 0, right: 440, top: 0, bottom: 440 }; }
}

let focused;
const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, new Element(selector));
  return elements.get(selector);
}
const modeButtons = ['include', 'exclude', 'clear'].map(mode => {
  const button = element(`[data-mode="${mode}"]`);
  button.dataset.mode = mode;
  return button;
});
const registered = [];
const downloads = [];
const blobUrls = new Map();
const workerURL = new URL('../src/worker.js', import.meta.url).href;
let failNextWorker = false;
class BrowserWorker {
  constructor() {
    this.worker = new NodeWorker(`
      const { parentPort } = require('node:worker_threads');
      global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
      import(${JSON.stringify(workerURL)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
    `, { eval: true });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) {
    if (failNextWorker) {
      failNextWorker = false;
      queueMicrotask(() => this.onerror?.(new Error('deliberate test failure')));
    } else this.worker.postMessage(data);
  }
  terminate() { void this.worker.terminate(); }
}

async function settle(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await immediate();
  }
}
function target(dataset) {
  const button = new Element('event-target');
  button.dataset = dataset;
  return { closest: selector => {
    const key = selector.match(/^\[data-([a-z-]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return key && key in dataset ? button : null;
  } };
}
function runQuery(input) { return registered[0].execute({ adjacentOnly: false, ...input }); }
async function setConnectionRules(diagonal, straight) {
  for (const [id, checked] of [['exclude-long-diagonal', diagonal], ['exclude-long-straight', straight]]) {
    element(`#${id}`).checked = checked;
    await element(`#${id}`).dispatch('change');
  }
}
async function selectPoint(point) {
  await element('#point-grid').dispatch('click', { target: target({ point: String(point) }) });
}

// All tests run as one sequential journey because the application has one page state.
test('offline UI journey exercises real Worker, filters, ranges, details, export, failures, and optional tool', async () => {
  const saved = {
    document: globalThis.document, window: globalThis.window, Worker: globalThis.Worker,
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  };
  const timers = new Set();
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) => {
    const timer = nativeSetTimeout(fn, delay, ...args);
    if (delay > 100) { timer.unref(); timers.add(timer); }
    return timer;
  };
  globalThis.document = {
    querySelector: element, querySelectorAll: () => modeButtons,
    createElement: () => {
      const link = new Element('download');
      link.click = () => downloads.push({ filename: link.download, blob: blobUrls.get(link.href) });
      return link;
    },
    modelContext: { registerTool: tool => registered.push(tool) },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.Worker = BrowserWorker;
  URL.createObjectURL = blob => { const id = `blob:test-${blobUrls.size}`; blobUrls.set(id, blob); return id; };
  URL.revokeObjectURL = id => blobUrls.delete(id);

  try {
    await import('../src/app.js');
    await settle(() => element('#total-count').textContent === '10,096', 'default adjacent enumeration');
    assert.equal(element('#exclude-long-diagonal').checked, true);
    assert.equal(element('#exclude-long-straight').checked, true);
    assert.equal(element('#remaining-count').textContent, '10,096');
    await setConnectionRules(false, true);
    assert.match(element('#result-status').textContent, /线索已调整/);
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '189,744', 'straight-only crossing exclusion');
    assert.match(element('#result-description').textContent, /排除直线跨格/);
    assert.doesNotMatch(element('#result-description').textContent, /排除斜线跨格/);
    await setConnectionRules(true, false);
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '29,312', 'diagonal-only crossing exclusion');
    assert.match(element('#result-description').textContent, /排除斜线跨格/);
    assert.doesNotMatch(element('#result-description').textContent, /排除直线跨格/);
    const mixedTool = await runQuery({ included: [], excluded: [], minLength: 4, maxLength: 9, adjacentOnly: true, excludeLongDiagonal: false });
    assert.equal(mixedTool.enumeratedTotal, 189744, 'explicit individual option overrides the legacy combined default');
    assert.equal(element('#exclude-long-diagonal').checked, false);
    assert.equal(element('#exclude-long-straight').checked, true);
    await setConnectionRules(true, true);
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '10,096', 'restore both crossing exclusions');
    const sketchPoints = () => [...element('#sketch-sequence').innerHTML.matchAll(/class="seq-number">(\d)/g)].map(match => Number(match[1]));
    const sketchClick = point => element('#sketch-pad').dispatch('click', { detail: 0, target: target({ sketchPoint: String(point) }) });
    const pointer = (point, pointerId = 1) => {
      const x = 32 + ((point - 1) % 3) * 48;
      const y = 32 + Math.floor((point - 1) / 3) * 48;
      return { pointerId, isPrimary: true, button: 0, clientX: x * 440 / 160, clientY: y * 440 / 160, target: target({ sketchPoint: String(point) }) };
    };
    await sketchClick(1);
    await sketchClick(5);
    await sketchClick(9);
    assert.deepEqual(sketchPoints(), [1, 5, 9]);
    const drawing = element('#sketch-lines').innerHTML;
    element('#sketch-show-numbers').checked = false;
    await element('#sketch-show-numbers').dispatch('change');
    assert.ok(element('#sketch-points').classList.contains('is-dot-mode'));
    for (let point = 1; point <= 9; point++) assert.equal(element(`[data-sketch-point="${point}"]`).textContent, '');
    assert.equal(element('[data-sketch-point="5"]').attributes.get('aria-label'), '试画点 5，第 2 个点');
    assert.equal(element('#sketch-lines').innerHTML, drawing, 'changing point appearance preserves the drawing');
    assert.deepEqual(sketchPoints(), [1, 5, 9]);
    assert.equal(element('#show-numbers').checked, true, 'sketch appearance is independent of result point labels');
    assert.equal(element('#included-count').textContent, 0, 'practice drawing leaves memory clues independent');
    assert.equal(element('#total-count').textContent, '10,096');
    await element('#sketch-undo').dispatch('click');
    assert.deepEqual(sketchPoints(), [1, 5]);
    await element('#sketch-clear').dispatch('click');
    assert.equal(element('#sketch-undo').disabled, true);
    assert.equal(focused, '[data-sketch-point="1"]', 'clear leaves keyboard focus on an available point');
    await sketchClick(1);
    await sketchClick(8);
    assert.deepEqual(sketchPoints(), [1]);
    assert.equal(element('[data-sketch-point="1"]').textContent, '', 'drawing and clearing retain the dot preference');
    element('#sketch-show-numbers').checked = true;
    await element('#sketch-show-numbers').dispatch('change');
    assert.equal(element('#sketch-points').classList.contains('is-dot-mode'), false);
    for (let point = 1; point <= 9; point++) assert.equal(element(`[data-sketch-point="${point}"]`).textContent, String(point));
    assert.match(element('#sketch-status').textContent, /1 → 8/);
    await element('#sketch-undo').dispatch('click');
    assert.equal(focused, '[data-sketch-point="1"]', 'undoing the last point preserves usable focus');
    await element('#sketch-clear').dispatch('click');
    await element('#sketch-pad').dispatch('pointerdown', pointer(1));
    await element('#sketch-pad').dispatch('pointermove', pointer(3));
    await element('#sketch-pad').dispatch('pointerup', pointer(3));
    assert.deepEqual(sketchPoints(), [1, 2, 3], 'fast drag includes the crossed midpoint');
    assert.equal(element('#sketch-pad').capturedPointer, null);
    assert.doesNotMatch(element('#sketch-lines').innerHTML, /sketch-guide/);
    await element('#sketch-pad').dispatch('click', { detail: 1, target: target({ sketchPoint: '3' }) });
    assert.deepEqual(sketchPoints(), [1, 2, 3], 'synthetic pointer click does not add a second point');
    assert.doesNotMatch(element('#sketch-status').textContent, /已经使用/);
    await element('#sketch-clear').dispatch('click');
    await element('#sketch-pad').dispatch('pointerdown', { ...pointer(1), isPrimary: false });
    assert.deepEqual(sketchPoints(), [], 'secondary pointers are ignored');
    await element('#sketch-pad').dispatch('pointerdown', pointer(1, 2));
    await element('#sketch-pad').dispatch('pointermove', pointer(5, 2));
    await element('#sketch-pad').dispatch('pointercancel', pointer(5, 2));
    assert.deepEqual(sketchPoints(), [1, 5]);
    assert.equal(element('#sketch-pad').capturedPointer, null);
    await element('#sketch-clear').dispatch('click');
    await setConnectionRules(false, false);
    assert.match(element('#result-status').textContent, /线索已调整/);
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '389,112', 'initial enumeration');
    await sketchClick(1);
    await sketchClick(3);
    assert.deepEqual(sketchPoints(), [1, 2, 3], 'Android point clicks insert unvisited midpoint');
    await element('#sketch-clear').dispatch('click');
    await sketchClick(2);
    await sketchClick(1);
    await sketchClick(3);
    assert.deepEqual(sketchPoints(), [2, 1, 3]);
    await setConnectionRules(false, true);
    assert.deepEqual(sketchPoints(), [2, 1, 3], 'rule changes preserve the drawing');
    assert.match(element('#sketch-status').textContent, /已有连线包含跨格连接/);
    await setConnectionRules(true, false);
    assert.doesNotMatch(element('#sketch-status').textContent, /已有连线包含跨格连接/, 'straight drawing is unaffected by diagonal exclusion');
    await setConnectionRules(false, false);
    await element('#sketch-clear').dispatch('click');
    await sketchClick(1);
    await sketchClick(8);
    assert.deepEqual(sketchPoints(), [1, 8]);
    await setConnectionRules(false, true);
    assert.doesNotMatch(element('#sketch-status').textContent, /已有连线包含跨格连接/, 'diagonal drawing is unaffected by straight exclusion');
    await setConnectionRules(true, false);
    assert.match(element('#sketch-status').textContent, /已有连线包含跨格连接/);
    await setConnectionRules(false, false);
    await element('#sketch-clear').dispatch('click');
    assert.equal(element('#remaining-count').textContent, '389,112');
    assert.equal((element('#pattern-grid').innerHTML.match(/data-pattern=/g) || []).length, 24);
    assert.equal(element('#page-input').max, 16213);
    assert.equal(registered[0].name, 'enumerate_pattern_candidates');

    await selectPoint(1);
    await selectPoint(5);
    assert.equal(element('#included-count').textContent, 2);
    assert.match(element('#result-status').textContent, /线索已调整/);
    assert.equal(element('#export').disabled, true);
    await element('.mode-switch').dispatch('click', { target: target({ mode: 'exclude' }) });
    await selectPoint(9);
    element('#max-length').value = '6';
    await element('#max-length').dispatch('change');
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '7,778', 'filtered enumeration');
    assert.equal(element('#export').disabled, false);

    await element('#length-filters').dispatch('click', { target: target({ length: '4' }) });
    assert.match(element('#page-description').textContent, /242 个/);
    assert.equal(focused, '[data-length="4"]');
    element('#page-input').value = '999';
    await element('#page-input').dispatch('change');
    assert.equal(element('#page-input').value, 11);
    assert.equal((element('#pattern-grid').innerHTML.match(/data-pattern=/g) || []).length, 2);

    const code = element('#pattern-grid').innerHTML.match(/data-pattern="(\d+)"/)[1];
    await element('#pattern-grid').dispatch('click', { target: target({ pattern: code }) });
    assert.equal(element('#pattern-dialog').open, true);
    assert.match(element('#detail-pattern').innerHTML, /animated-segment/);
    await element('#close-dialog').dispatch('click');
    assert.equal(element('#pattern-dialog').open, false);

    await element('#export').dispatch('click');
    element('#show-numbers').checked = false;
    await element('#show-numbers').dispatch('change');
    assert.equal(element('#export').disabled, true, 'rendering must not re-enable an active export');
    await element('#export').dispatch('click');
    await settle(() => downloads.length === 1 && !element('#export').disabled, 'complete export');
    const csv = await downloads[0].blob.text();
    assert.equal(csv.trim().split('\r\n').length, 7779, 'export includes every length, regardless of display filter');
    assert.match(downloads[0].filename, /包含15_排除9/);
    assert.doesNotMatch(element('#pattern-grid').innerHTML, /<text /);

    const before = element('#constraint-summary').textContent;
    await assert.rejects(() => runQuery({ included: [1], excluded: [1], minLength: 4, maxLength: 6 }), /同时必含和排除/);
    assert.equal(element('#constraint-summary').textContent, before, 'invalid tool input must not change page state');
    const toolResult = await runQuery({ included: [1, 3], excluded: [2, 4, 5, 6, 7, 8, 9], minLength: 2, maxLength: 2 });
    assert.equal(toolResult.total, 0);
    assert.equal(element('#empty-state').hidden, false);

    element('#min-length').value = '7';
    await element('#min-length').dispatch('change');
    assert.equal(element('#max-length').value, 7, 'crossing ranges synchronize');
    assert.equal(element('#generate').disabled, true);
    assert.match(element('#form-error').textContent, /可用点/);

    failNextWorker = true;
    await element('#reset').dispatch('click');
    await settle(() => element('#result-status').textContent.includes('无法启动'), 'worker failure');
    assert.equal(element('#exclude-long-diagonal').checked, true);
    assert.equal(element('#exclude-long-straight').checked, true);
    await setConnectionRules(false, false);
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '389,112', 'worker retry');
    assert.equal(element('#empty-state').hidden, true);

    const first = runQuery({ included: [], excluded: [], minLength: 9, maxLength: 9 });
    const second = runQuery({ included: [2], excluded: [], minLength: 1, maxLength: 1 });
    await assert.rejects(first, /取消/);
    const newest = await second;
    assert.equal(newest.total, 1);
    assert.equal(element('#total-count').textContent, '1');
    assert.match(element('#pattern-grid').innerHTML, /data-pattern="2"/);

    const endpoints = { included: [], excluded: [], minLength: 4, maxLength: 6, startPoint: 1, endPoint: 9 };
    const endpointResult = await runQuery(endpoints);
    assert.equal(endpointResult.total, 462);
    assert.equal(element('#remaining-count').textContent, '462');
    assert.deepEqual(endpointResult.counts.slice(4, 7), [18, 92, 352]);
    assert.ok(endpointResult.firstPage.every(code => code.startsWith('1') && code.endsWith('9')));
    assert.match(element('#result-description').textContent, /起点 1 · 终点 9/);
    const dismissed = endpointResult.firstPage[0];
    await element('#pattern-grid').dispatch('click', { target: target({ dismiss: dismissed }) });
    assert.equal(element('#pattern-dialog').open, false, 'dismiss must not open details');
    assert.match(element('#pattern-grid').innerHTML, /class="pattern-card is-dismissed"/);
    assert.match(element('#pattern-grid').innerHTML, new RegExp(`data-dismiss="${dismissed}" aria-pressed="true"`));
    assert.match(element('#pattern-grid').innerHTML, /<\/button><button class="pattern-dismiss"/, 'view and dismiss controls are siblings');
    assert.match(element('#dismissed-summary').textContent, /1 个/);
    assert.equal(element('#total-count').textContent, '462', 'dimmed candidates remain visible until hiding is enabled');
    assert.equal(element('#remaining-count').textContent, '461', 'remaining excludes dimmed candidates even with hiding off');

    element('#hide-dismissed').checked = true;
    await element('#hide-dismissed').dispatch('change');
    assert.equal(element('#total-count').textContent, '461');
    assert.equal(element('#remaining-count').textContent, '461', 'hiding does not change the remaining count');
    assert.doesNotMatch(element('#pattern-grid').innerHTML, new RegExp(`data-pattern="${dismissed}"`));
    assert.match(element('#pattern-grid').innerHTML, /#0002/, 'source numbering remains stable after hiding');
    const regenerated = await runQuery(endpoints);
    assert.equal(regenerated.total, 461, 'exclusions survive regeneration');
    assert.equal(regenerated.enumeratedTotal, 462);
    await element('#export').dispatch('click');
    element('#hide-dismissed').checked = false;
    await element('#hide-dismissed').dispatch('change');
    await element('#restore-all').dispatch('click');
    await settle(() => downloads.length === 2 && !element('#export').disabled, 'filtered export snapshot');
    const filteredCsv = await downloads[1].blob.text();
    assert.equal(filteredCsv.trim().split('\r\n').length, 462, 'snapshot retains the 461 candidates at export start');
    assert.ok(!filteredCsv.includes(`,${dismissed}\r\n`));
    assert.match(downloads[1].filename, /起点1_终点9_已过滤排除图案/);
    assert.equal(element('#total-count').textContent, '462');
    assert.equal(element('#remaining-count').textContent, '462', 'restoring all updates remaining');
    await element('#length-filters').dispatch('click', { target: target({ length: '5' }) });
    assert.equal(element('#remaining-count').textContent, '92', 'remaining follows the selected length');
    const fivePointCode = element('#pattern-grid').innerHTML.match(/data-pattern="(\d+)"/)[1];
    await element('#pattern-grid').dispatch('click', { target: target({ dismiss: fivePointCode }) });
    assert.equal(element('#remaining-count').textContent, '91');
    element('#hide-dismissed').checked = true;
    await element('#hide-dismissed').dispatch('change');
    assert.equal(element('#remaining-count').textContent, '91');
    await element('#restore-all').dispatch('click');
    assert.equal(element('#remaining-count').textContent, '92');
    await element('#length-filters').dispatch('click', { target: target({ length: '0' }) });
    assert.equal(element('#remaining-count').textContent, '462');

    element('#start-point').value = '9';
    await element('#start-point').dispatch('change');
    assert.equal(element('#generate').disabled, true);
    assert.match(element('#form-error').textContent, /起点和终点不能相同/);
    element('#start-point').value = '1';
    await element('#start-point').dispatch('change');
    assert.equal(element('#generate').disabled, false);
    const unchanged = element('#constraint-summary').textContent;
    await assert.rejects(() => runQuery({ ...endpoints, excluded: [1] }), /同时必含和排除/);
    assert.equal(element('#constraint-summary').textContent, unchanged);
    await assert.rejects(() => runQuery({ ...endpoints, maxLength: 1, minLength: 1 }), /2 个不同点/);

    await runQuery({ included: [], excluded: [], minLength: 1, maxLength: 9, startPoint: 5, endPoint: 5 });
    assert.equal(element('#total-count').textContent, '1');
    assert.match(element('#pattern-grid').innerHTML, /data-pattern="5"/);
    await element('#pattern-grid').dispatch('click', { target: target({ dismiss: '5' }) });
    element('#hide-dismissed').checked = true;
    await element('#hide-dismissed').dispatch('change');
    assert.equal(element('#total-count').textContent, '0');
    assert.equal(element('#remaining-count').textContent, '0');
    assert.equal(element('#export').disabled, true);
    assert.match(element('#empty-title').textContent, /都已被排除/);
    await element('#empty-reset').dispatch('click');
    assert.equal(element('#total-count').textContent, '1');
    assert.equal(element('#empty-state').hidden, true);
    assert.equal(focused, '#hide-dismissed', 'restoring hidden candidates must leave focus on a visible control');

    await runQuery({ included: [], excluded: [], minLength: 2, maxLength: 2 });
    element('#page-input').value = '3';
    await element('#page-input').dispatch('change');
    const tail = [...element('#pattern-grid').innerHTML.matchAll(/data-pattern="(\d+)"/g)].map(match => match[1]);
    assert.equal(tail.length, 8);
    for (const code of tail) await element('#pattern-grid').dispatch('click', { target: target({ dismiss: code }) });
    assert.equal(element('#page-input').value, 2, 'hiding a complete tail page clamps to the previous page');
    assert.equal(element('#total-count').textContent, '48');

    await runQuery({ included: [], excluded: [], minLength: 1, maxLength: 2 });
    await element('#length-filters').dispatch('click', { target: target({ length: '1' }) });
    const singlePoints = [...element('#pattern-grid').innerHTML.matchAll(/data-pattern="(\d+)"/g)].map(match => match[1]);
    for (const code of singlePoints) await element('#pattern-grid').dispatch('click', { target: target({ dismiss: code }) });
    assert.equal(element('#empty-state').hidden, false);
    assert.equal(element('#total-count').textContent, '48', 'other lengths remain available when one length is entirely hidden');
    assert.equal(element('#remaining-count').textContent, '0', 'the selected length has no remaining candidates');
    assert.equal(element('#export').disabled, false);
    await element('#export').dispatch('click');
    await settle(() => downloads.length === 3 && !element('#export').disabled, 'export other lengths');
    assert.equal((await downloads[2].blob.text()).trim().split('\r\n').length, 49);
    await element('#empty-reset').dispatch('click');
    assert.equal(element('#total-count').textContent, '65');
    assert.equal(element('#empty-state').hidden, true);

    // Old-query exclusions must not reduce a new query's unrelated result count.
    await element('#pattern-grid').dispatch('click', { target: target({ dismiss: '1' }) });
    const different = await runQuery({ included: [2], excluded: [], minLength: 1, maxLength: 1 });
    assert.equal(different.total, 1);
    assert.equal(element('#remaining-count').textContent, '1', 'old-query exclusions do not affect remaining');
    assert.match(element('#dismissed-summary').textContent, /0 个/);
    await element('#reset').dispatch('click');
    assert.equal(element('#start-point').value, 0);
    assert.equal(element('#end-point').value, 0);
    assert.equal(element('#exclude-long-diagonal').checked, true);
    assert.equal(element('#exclude-long-straight').checked, true);
    await settle(() => element('#total-count').textContent === '10,096', 'reset restores adjacency and preserves unrelated single-point exclusion');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.Worker = saved.Worker;
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
  }
});
