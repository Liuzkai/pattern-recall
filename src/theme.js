/* Run before first paint, independently of calculation and language state. */
(() => {
  const key = 'pattern-recall.theme';
  const normalize = value => value === 'warm' ? 'warm' : 'console';
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'console' ? '#0b0c09' : '#0e0a0b');
    return theme;
  }
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Private browsing may block storage. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('theme');
    picker.value = document.documentElement.dataset.theme;
    picker.addEventListener('change', () => {
      const theme = apply(picker.value);
      try { localStorage.setItem(key, theme); } catch { /* Switching still works in memory. */ }
    });
  });
})();
