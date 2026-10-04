import en from './locales/en.js';
import zhCN from './locales/zh-CN.js';
import zhTW from './locales/zh-TW.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import fr from './locales/fr.js';
import es from './locales/es.js';
import hi from './locales/hi.js';
import ar from './locales/ar.js';
import bn from './locales/bn.js';
import pt from './locales/pt.js';
import ru from './locales/ru.js';
import ur from './locales/ur.js';
import id from './locales/id.js';

export const languages = [
  { code: 'en', name: 'English' }, { code: 'zh-CN', name: '简体中文' }, { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' }, { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }, { code: 'hi', name: 'हिन्दी' }, { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'bn', name: 'বাংলা' }, { code: 'pt', name: 'Português' }, { code: 'ru', name: 'Русский' },
  { code: 'ur', name: 'اردو', dir: 'rtl' }, { code: 'id', name: 'Bahasa Indonesia' },
];
export const catalogs = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko, fr, es, hi, ar, bn, pt, ru, ur, id };
const storageKey = 'pattern-recall.language';
let current = 'en';
const formatters = new Map();
export const getLanguage = () => current;
export const direction = (locale = current) => languages.find(language => language.code === locale)?.dir || 'ltr';
export function formatNumber(value, locale = current) {
  if (!formatters.has(locale)) formatters.set(locale, new Intl.NumberFormat(locale, { numberingSystem: 'latn', maximumFractionDigits: 0 }));
  return formatters.get(locale).format(value);
}
export function t(key, values = {}, locale = current) {
  const template = catalogs[locale]?.[key] ?? en[key];
  if (template === undefined) throw new Error(`Unknown translation key: ${key}`);
  const translated = template.replace(/\{(\w+)\}/g, (_, name) => typeof values[name] === 'number' ? formatNumber(values[name], locale) : String(values[name] ?? `{${name}}`));
  // Isolate numeric sequences so RTL text never reverses a connection such as 1 → 8.
  return direction(locale) === 'rtl' ? translated.replace(/\d+(?:\s*(?:→|–|×|\/|,)\s*\d+)*/g, '\u2066$&\u2069') : translated;
}
export function setLanguage(locale, { persist = true } = {}) {
  current = Object.hasOwn(catalogs, locale) ? locale : 'en';
  if (persist) { try { globalThis.localStorage?.setItem(storageKey, current); } catch { /* Storage can be disabled. */ } }
  return current;
}
export function restoreLanguage() {
  let saved;
  try { saved = globalThis.localStorage?.getItem(storageKey); } catch { /* English remains the default. */ }
  return setLanguage(saved, { persist: false });
}
export function applyTranslations(root = document) {
  root.documentElement.lang = current;
  root.documentElement.dir = direction();
  root.title = `${t('tagline')} · Pattern Recall`;
  root.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
  for (const attribute of ['aria-label', 'title', 'content']) {
    root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`))));
  }
}
export function html(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
