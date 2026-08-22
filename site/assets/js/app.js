/**
 * Site bootstrap. Wires every module together through one `bridge` object so
 * settings, palette, tabs and appearance all share a single persistence and
 * i18n path. Guarded so importing this module in Node stays side-effect free.
 */
import * as util from './util.js';
import * as store from './store.js';
import * as i18n from './i18n.js';
import * as theme from './theme.js';
import { attachSearchField } from './search.js';
import { openMenu, closeAllMenus } from './menu.js';
import * as notifyMod from './notify.js';
import * as tabsMod from './tabs.js';
import * as appearanceMod from './appearance.js';
import * as colorMod from './color.js';
import { superConfirm } from './superconfirm.js';
import * as paletteMod from './palette.js';
import * as settingsPage from './settings-page.js';
import { registry } from './settings-registry.js';

const inBrowser = typeof document !== 'undefined';

const TAB_LABELS = {
  appearance: 'settings.section.appearance',
  language: 'settings.section.language',
  notifications: 'settings.section.notifications',
  tabs: 'settings.section.tabs',
  accessibility: 'settings.section.accessibility',
  data: 'settings.section.data',
  about: 'settings.section.about',
};

if (!inBrowser) {
  // Node-side import (smoke tests): exports only, no DOM work.
} else {
  boot();
}

function boot() {
  globalThis.__ccrI18n = i18n;

  /* Motion + focus-ring overrides (site-level accessibility controls). */
  const styleEl = document.createElement('style');
  styleEl.textContent =
    'html[data-motion="reduced"] *,html[data-motion="reduced"] *::before,html[data-motion="reduced"] *::after{animation:none!important;transition:none!important}' +
    'html[data-motion="reduced"]{--ccr-rainbow-duration:0s;--rainbow-hue:174}';
  document.head.appendChild(styleEl);

  const motionApi = {
    applyOverride(v) {
      store.set('motion.override', v);
      const mode = v === 'reduced' || v === 'full' ? v : 'auto';
      if (mode === 'auto') delete document.documentElement.dataset.motion;
      else document.documentElement.setAttribute('data-motion', mode);
    },
    setFocusWidth(px) {
      const n = Math.min(4, Math.max(1, Number(px) || 2));
      store.set('a11y.focusWidth', n);
      document.documentElement.style.setProperty('--ccr-focus-width', `${n}px`);
    },
  };

  /* Notify wiring into modules that need it. */
  tabsMod._wireNotify({ info: notifyMod.info, warn: notifyMod.warn });
  appearanceMod._wireNotify(notifyMod.info);

  theme.init();
  colorMod.publishRainbowGlobals();
  motionApi.applyOverride(store.get('motion.override', 'auto'));
  motionApi.setFocusWidth(store.get('a11y.focusWidth', 2));

  /* Language selector. */
  const langSel = document.getElementById('lang-select');
  function paintLangOptions() {
    if (!langSel) return;
    langSel.textContent = '';
    for (const [v, label] of Object.entries(i18n.LANGS)) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if (i18n.getLang() === v) o.selected = true;
      langSel.append(o);
    }
  }
  function onLanguageChange(v) {
    i18n.setLang(v);
    paintLangOptions();
    i18n.apply(document);
    notifyMod.info(i18n.t('theme.changed'));
  }
  paintLangOptions();
  langSel?.addEventListener('change', () => onLanguageChange(langSel.value));
  i18n.apply(document);

  /* Tabs first (they own the shell layout). */
  tabsMod.init();

  /* Appearance engine + rainbow globals. */
  appearanceMod.init();

  /* Notifications centre bell. */
  notifyMod.init();

  const siteVersion =
    document.querySelector('meta[name="ccr-site-version"]')?.getAttribute('content') || 'dev';

  /* Settings bridge. */
  const bridge = {
    store,
    i18n,
    theme,
    color: colorMod,
    tabs: tabsMod.TabsAPI,
    superConfirm,
    notify: notifyMod,
    siteVersion,
    registry: [],
    settingsRows() {
      return bridge.registry.map((r) => ({
        ...r,
        tabLabelKey: TAB_LABELS[r.tab] || r.tab,
      }));
    },
    teleportToSetting,
    afterSettingChange(row) {
      if (row.id === 'language-mode') {
        paintLangOptions();
        i18n.apply(document);
      } else if (row.id.startsWith('funny-level')) {
        i18n.apply(document);
      } else if (row.id === 'appearance-rainbow-speed') {
        colorMod.publishRainbowGlobals();
      }
    },
    onLanguageChange,
    exportSettings,
    importSettings,
    resetAll,
    appearance: appearanceMod,
    motion: motionApi,
  };
  bridge.registry = registry(bridge);

  settingsPage.init(bridge);
  paletteMod.init(bridge);

  /* Cross-page teleport handoff. */
  const pendingTeleport = sessionStorage.getItem('ccr.teleportSetting');
  if (pendingTeleport && document.getElementById('pane-settings')) {
    sessionStorage.removeItem('ccr.teleportSetting');
    requestAnimationFrame(() => {
      const row = bridge.registry.find((r) => r.id === pendingTeleport);
      if (row) teleportToSetting(row, { alreadyOnSettingsPage: true });
    });
  }

  function TAB_LABELS_get(id) {
    return TAB_LABELS[id];
  }
  void TAB_LABELS_get;
}

/** Land on the EXACT setting element: page → section tab → scroll → flash. */
function teleportToSetting(row, { alreadyOnSettingsPage = false } = {}) {
  const onSettings = !!document.getElementById('pane-settings');
  if (!onSettings && !alreadyOnSettingsPage) {
    try {
      sessionStorage.setItem('ccr.teleportSetting', row.id);
    } catch {
      /* storage unavailable */
    }
    location.href = `settings.html#tab=settings`;
    return;
  }
  settingsPage.showTab(row.tab);
  const node = document.querySelector(`[data-setting-id="${row.id}"]`);
  if (node) {
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('teleport-flash');
    setTimeout(() => node.classList.remove('teleport-flash'), 950);
    const ctl = node.querySelector('input,select,button.btn,button.chip');
    if (ctl instanceof HTMLElement) ctl.focus({ preventScroll: true });
  }
}

/* ------------------------------ data ops ------------------------------ */

function download(filename, text, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportSettings() {
  download(
    `ccr-site-settings-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(store.dumpAll(), null, 2),
  );
  notifyMod.info('Exported all local settings.');
}

async function importSettings(file) {
  try {
    const text = await file.text();
    const n = store.importAll(JSON.parse(text));
    notifyMod.success(n ? `Imported ${n} key(s). Reloading…` : 'Nothing imported — schema mismatch.');
    if (n) setTimeout(() => location.reload(), 900);
  } catch (err) {
    notifyMod.error(`Import failed: ${err.message}`);
  }
}

async function resetAll() {
  const count = store.keys().length;
  const ok = await superConfirm({
    title: i18n.t('data.resetAll.title'),
    body: i18n.t('data.resetAll.body'),
    phrase: 'RESET',
  });
  if (!ok) return;
  const n = store.resetAll();
  notifyMod.info(i18n.t('data.resetAll.done', { n }));
  void count;
  setTimeout(() => location.reload(), 700);
}
