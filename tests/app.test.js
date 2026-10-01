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
    this.classList = { toggle() {} };
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
  return { closest: () => button };
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
    await settle(() => element('#total-count').textContent === '389,112', 'initial enumeration');
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
    await assert.rejects(() => registered[0].execute({ included: [1], excluded: [1], minLength: 4, maxLength: 6 }), /同时必含和排除/);
    assert.equal(element('#constraint-summary').textContent, before, 'invalid tool input must not change page state');
    const toolResult = await registered[0].execute({ included: [1, 3], excluded: [2, 4, 5, 6, 7, 8, 9], minLength: 2, maxLength: 2 });
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
    await element('#clue-form').dispatch('submit');
    await settle(() => element('#total-count').textContent === '389,112', 'worker retry');
    assert.equal(element('#empty-state').hidden, true);

    const first = registered[0].execute({ included: [], excluded: [], minLength: 9, maxLength: 9 });
    const second = registered[0].execute({ included: [2], excluded: [], minLength: 1, maxLength: 1 });
    await assert.rejects(first, /取消/);
    const newest = await second;
    assert.equal(newest.total, 1);
    assert.equal(element('#total-count').textContent, '1');
    assert.match(element('#pattern-grid').innerHTML, /data-pattern="2"/);
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
