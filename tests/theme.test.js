import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8');
function boot(saved, blocked = false) {
  const events = {}, changes = {}, writes = [];
  const meta = {};
  const picker = { value: '', addEventListener: (name, fn) => { changes[name] = fn; } };
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => ({ setAttribute: (key, value) => { meta[key] = value; } }),
    addEventListener: (name, fn) => { events[name] = fn; },
    getElementById: () => picker,
  };
  runInNewContext(source, { document, localStorage: {
    getItem: () => { if (blocked) throw Error('blocked'); return saved; },
    setItem: (...args) => { if (blocked) throw Error('blocked'); writes.push(args); },
  } });
  const initial = document.documentElement.dataset.theme;
  events.DOMContentLoaded();
  return { document, initial, picker, changes, writes, meta };
}
test('theme restored before DOM ready, invalid preferences safely use console', () => {
  assert.equal(boot('warm').initial, 'warm');
  assert.equal(boot('console').initial, 'console');
  assert.equal(boot('invalid').initial, 'console');
  assert.equal(boot(null).initial, 'console');
});
test('switch saves only theme preference and updates browser chrome', () => {
  const app = boot('warm');
  app.picker.value = 'console'; app.changes.change();
  assert.equal(app.document.documentElement.dataset.theme, 'console');
  assert.equal(app.meta.content, '#0b0c09');
  assert.deepEqual(app.writes, [['pattern-recall.theme', 'console']]);
});
test('blocked storage still allows switching both directions', () => {
  const app = boot(null, true);
  for (const value of ['warm', 'console']) {
    app.picker.value = value; app.changes.change();
    assert.equal(app.document.documentElement.dataset.theme, value);
  }
});
