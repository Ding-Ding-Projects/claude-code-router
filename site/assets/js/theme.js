/**
 * Light/dark theming over data-md-theme with prefers-color-scheme default.
 * The visitor's explicit choice is persisted; 'auto' follows the system live.
 */
import * as store from './store.js';

let media = null;

export function getMode() {
  const v = store.get('theme.mode', 'auto');
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function resolvedTheme() {
  const mode = getMode();
  if (mode !== 'auto') return mode;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function apply() {
  const r = resolvedTheme();
  document.documentElement.setAttribute('data-md-theme', r);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    const m = document.createElement('meta');
    m.name = 'color-scheme';
    m.content = 'light dark';
    document.head.appendChild(m);
  }
}

export function setMode(mode) {
  store.set('theme.mode', ['light', 'dark'].includes(mode) ? mode : 'auto');
  apply();
  watch();
}

function watch() {
  if (!globalThis.matchMedia) return;
  media?.removeEventListener?.('change', onChange);
  media = globalThis.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
}
function onChange() {
  if (getMode() === 'auto') apply();
}

export function init() {
  apply();
  watch();
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      setMode(resolvedTheme() === 'dark' ? 'light' : 'dark');
    });
  }
}
