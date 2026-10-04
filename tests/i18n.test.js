import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogs, languages, t, setLanguage, restoreLanguage, getLanguage, direction, formatNumber, applyTranslations, html } from '../src/i18n.js';

test('all 14 catalogs translate every message and preserve interpolation parameters', async () => {
  assert.equal(languages.length, 14);
  const keys = Object.keys(catalogs.en).sort();
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const { code } of languages) {
    assert.deepEqual(Object.keys(catalogs[code]).sort(), keys, code);
    for (const key of keys) {
      assert.equal(typeof catalogs[code][key], 'string', `${code}.${key}`);
      assert.ok(catalogs[code][key].trim(), `${code}.${key} is not empty`);
      assert.deepEqual(placeholders(catalogs[code][key]), placeholders(catalogs.en[key]), `${code}.${key}`);
    }
    if (code !== 'en') assert.notEqual(catalogs[code].heading, catalogs.en.heading);
  }
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /<html lang="en" dir="ltr">/);
  for (const match of page.matchAll(/data-i18n(?:-aria-label|-title|-content)?="([^"]+)"/g)) assert.ok(keys.includes(match[1]), match[1]);
  assert.doesNotMatch(page, /\p{Script=Han}/u, 'HTML fallbacks use English');
});

test('English is the default; only the language preference is saved, with safe storage fallback', () => {
  const previous = globalThis.localStorage;
  const saved = new Map();
  try {
    globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    assert.equal(restoreLanguage(), 'en');
    assert.equal(saved.size, 0);
    setLanguage('ja');
    assert.deepEqual([...saved], [['pattern-recall.language', 'ja']]);
    setLanguage('en', { persist: false });
    assert.equal(restoreLanguage(), 'ja');
    saved.set('pattern-recall.language', 'unsupported');
    assert.equal(restoreLanguage(), 'en');
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(restoreLanguage(), 'en');
    assert.doesNotThrow(() => setLanguage('fr'));
    assert.equal(getLanguage(), 'fr');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
    setLanguage('en', { persist: false });
  }
});

test('locale formatting and RTL preserve physical dot identities and directed connections', () => {
  for (const { code } of languages) {
    assert.equal(direction(code), ['ar', 'ur'].includes(code) ? 'rtl' : 'ltr');
    assert.match(formatNumber(9, code), /^9$/);
    assert.equal(t('computed', { count: 10096 }, code).includes(formatNumber(10096, code)), true);
    assert.doesNotMatch(t('patternLabel', { order: 2, count: 4, sequence: '1 → 2 → 5 → 8', status: '' }, code), /\{\w+\}/);
  }
  for (const locale of ['ar', 'ur']) assert.ok(t('diagonalHint', {}, locale).includes('\u20661 → 8\u2069'));
  assert.equal(html('<a title="x">&\''), '&lt;a title=&quot;x&quot;&gt;&amp;&#39;');
});

test('static text, accessibility attributes, document language and direction change together', () => {
  const heading = { dataset: { i18n: 'heading' }, textContent: '' };
  const attrs = new Map([['data-i18n-aria-label', 'language']]);
  const label = { getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) };
  const root = {
    documentElement: {},
    querySelectorAll: selector => selector === '[data-i18n]' ? [heading] : selector === '[data-i18n-aria-label]' ? [label] : [],
  };
  for (const { code } of languages) {
    setLanguage(code, { persist: false });
    applyTranslations(root);
    assert.equal(root.documentElement.lang, code);
    assert.equal(root.documentElement.dir, direction(code));
    assert.equal(root.title, `${t('tagline')} · Pattern Recall`);
    assert.equal(heading.textContent, t('heading'));
    assert.equal(attrs.get('aria-label'), t('language'));
  }
  setLanguage('en', { persist: false });
});
