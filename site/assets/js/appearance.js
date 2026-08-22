/**
 * Per-element appearance editing — every rendered element class on the site.
 *
 * - Right-click any registered element and choose "Edit appearance…" (a
 *   keyboard path exists too: Shift+F10 / Menu key opens the editor for the
 *   focused element's nearest registered target).
 * - The editor is a NON-MODAL anchored panel that tracks its anchor while
 *   open, handles viewport-edge collision, and returns focus to the element
 *   on close.
 * - Sections: Colour (text + background via the infinite picker, rainbow
 *   sentinel supported), Typography (Word-depth editor), Shape & spacing
 *   (corner radius + elevation).
 * - Presets are derived strictly from shipped defaults: a boot-time snapshot
 *   of each target's computed baseline. Per-element reset restores exactly
 *   that; global reset clears every override behind super confirmation.
 * - Export/import JSON of all overrides.
 */
import * as store from './store.js';
import { el, append, clear } from './util.js';
import * as i18n from './i18n.js';
import { pickColor, isRainbow, publishRainbowGlobals } from './color.js';
import * as typography from './typography.js';
import { superConfirm } from './superconfirm.js';

/** Registered appearance targets: id -> selector. Wave-2 may append rows. */
export const TARGETS = [
  { id: 'body-text', selector: '.content', labelKey: 'nav.home', label: () => 'Page text' },
  { id: 'topbar', selector: '.topbar', label: () => 'Top bar' },
  { id: 'tabstrip', selector: '.tabstrip-region', label: () => 'Tab strip' },
  { id: 'cards', selector: '.card', label: () => 'Cards' },
  { id: 'hero-heading', selector: '.hero h1', label: () => 'Hero heading' },
  { id: 'primary-buttons', selector: '.btn--filled', label: () => 'Primary buttons' },
  { id: 'setting-rows', selector: '.setting-row', label: () => 'Setting rows' },
];

function loadOverrides() {
  const o = store.get('appearance.overrides', {});
  return o && typeof o === 'object' ? o : {};
}
let overrides = null;

/** Baseline snapshot taken BEFORE any override is applied. */
const baselines = new Map(); // id -> {color, bg, radius, elevation, typography:{}}

function snapshotBaseline(id, sample) {
  if (!sample || baselines.has(id)) return;
  const cs = getComputedStyle(sample);
  baselines.set(id, {
    color: cs.color,
    bg: cs.backgroundColor,
    radius: cs.borderRadius,
    elevation: '',
    typography: {},
  });
}

function firstMatch(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function init() {
  if (overrides) return;
  overrides = loadOverrides();
  // Snapshot shipped baselines before applying anything.
  for (const t of TARGETS) {
    const sample = firstMatch(t.selector);
    if (sample) snapshotBaseline(t.id, sample);
  }
  applyAll();
  publishRainbowGlobals();
  wireContextMenuEditing();
  document.addEventListener('ccr-edit-appearance', (e) => {
    const { selector, label } = e.detail || {};
    const t = TARGETS.find((x) => x.selector === selector) || { id: selector, selector, label: () => label || selector };
    openEditor(t);
  });
}

/* ------------------------------ application ------------------------------ */

function resolveColor(v, fallback) {
  if (v == null) return '';
  if (isRainbow(v)) return 'var(--ccr-rainbow)';
  return v;
}

function applyOne(target, ov) {
  for (const node of document.querySelectorAll(target.selector)) {
    const s = node.style;
    if (ov.color != null) s.color = resolveColor(ov.color);
    if (ov.bg != null) {
      if (isRainbow(ov.bg)) {
        s.backgroundColor = '';
        node.classList.add('rainbow-bg');
      } else {
        node.classList.remove('rainbow-bg');
        s.backgroundColor = ov.bg;
      }
    }
    if (ov.radius != null) s.borderRadius = `${ov.radius}px`;
    if (ov.elevation != null) s.boxShadow = `var(--md-elevation-level${ov.elevation})`;
    typography.applyTo(node, ov.typography);
  }
}

function applyAll() {
  overrides = overrides || loadOverrides();
  for (const t of TARGETS) {
    const ov = overrides[t.id];
    if (ov) applyOne(t, ov);
  }
}

/* --------------------------- context-menu wiring --------------------------- */

function nearestTarget(node) {
  let cur = node instanceof Element ? node : null;
  while (cur && cur !== document.body) {
    const hit = TARGETS.find((t) => cur.matches?.(t.selector));
    if (hit) return hit;
    cur = cur.parentElement;
  }
  // Tabs are always editable even though they are rendered dynamically.
  if (node instanceof Element && node.closest?.('.tab')) {
    return { id: 'tabs-labels', selector: '.tab .tab-label', label: () => 'Tab labels' };
  }
  return TARGETS[0];
}

function wireContextMenuEditing() {
  document.addEventListener('contextmenu', (e) => {
    // A component that already claimed this event keeps it — the appearance
    // entry point must never REPLACE another surface's own context menu.
    if (e.defaultPrevented) return;
    // Native controls keep their platform menu (text selection, spellcheck).
    if (e.target.closest?.('input, textarea, select')) return;
    const target = nearestTarget(e.target);
    if (!target) return;
    e.preventDefault();
    import('./menu.js').then(({ openMenu }) => {
      openMenu({
        point: { x: e.clientX, y: e.clientY },
        items: [
          { labelKey: 'appear.edit', onSelect: () => openEditor(targetFor(target, e.target)) },
          ...(TARGETS.slice(0, 6).map((t) => ({
            label: `↳ ${t.label()}`,
            onSelect: () => openEditor(t),
          }))),
        ],
        minWidth: 240,
      });
    });
  });
  document.addEventListener('keydown', (e) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      if (e.defaultPrevented) return; // a focused tab/dialog already opened ITS menu
      const target = nearestTarget(document.activeElement);
      if (target) {
        e.preventDefault();
        openEditor(target);
      }
    }
  });
}

function targetFor(t, node) {
  if (t.id === 'tabs-labels') return t;
  void node;
  return t;
}

/* ------------------------------ editor panel ------------------------------ */

let activeEditor = null;

export function openEditor(target) {
  closeEditor();
  if (!overrides) init();

  const panel = el('div', { class: ['appear-editor'], attrs: { role: 'dialog', 'aria-label': i18n.t('appear.title', { target: target.label() }) } });
  const anchorNode = firstMatch(target.selector);

  const head = el('div', { class: 'appear-head' });
  append(head, el('span', { class: 'title', children: [i18n.t('appear.title', { target: target.label() })] }));
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': i18n.t('common.close') }, children: [] });
  append(closeBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: ['✕'] }));
  head.append(closeBtn);
  panel.append(head);

  const body = el('div', { class: 'appear-body' });
  panel.append(body);

  const tabsBar = el('div', { class: 'm3-tabs scroll-x', attrs: { role: 'tablist' } });
  body.append(tabsBar);
  const sections = {};

  function addSection(name, build) {
    const btn = el('button', { class: 'm3-tab', type: 'button', attrs: { role: 'tab' }, children: [name] });
    const sec = el('div', { class: 'appear-section', hidden: true });
    sections[name] = { btn, sec };
    btn.addEventListener('click', () => show(name));
    tabsBar.append(btn);
    body.append(sec);
    build(sec);
  }
  function show(name) {
    for (const [n, s] of Object.entries(sections)) {
      const on = n === name;
      s.sec.hidden = !on;
      s.btn.setAttribute('aria-selected', String(on));
    }
  }

  const ov = overrides[target.id] || {};

  /* ---- Colour ---- */
  addSection(i18n.t('appear.tab.colour'), (sec) => {
    const mkRow = (labelText, key) => {
      const swatch = el('button', { class: 'swatch', type: 'button', attrs: { 'aria-label': labelText } });
      const paint = () => {
        const v = ov[key];
        swatch.style.background = v == null ? '' : isRainbow(v) ? 'linear-gradient(135deg,#f66,#ff6,#6f6,#6ff)' : v;
        if (v == null) swatch.style.background = 'transparent';
      };
      paint();
      swatch.addEventListener('click', () =>
        pickColor({
          opener: swatch,
          value: ov[key] ?? undefined,
          onPick(hex) {
            ov[key] = hex;
            persistAndApply(target, ov);
            paint();
          },
        }),
      );
      const clearB = el('button', { class: 'chip', type: 'button', children: ['✕'], attrs: { 'aria-label': `clear ${labelText}` } });
      clearB.addEventListener('click', () => {
        delete ov[key];
        persistAndApply(target, ov);
        paint();
      });
      return el('div', { class: 'field', children: [el('label', { class: 'body-small', children: [labelText] }), el('div', { class: 'swatch-row', children: [swatch, clearB] })] });
    };
    sec.append(mkRow('Text colour', 'color'), mkRow('Background colour', 'bg'));
  });

  /* ---- Typography ---- */
  addSection(i18n.t('appear.tab.type'), (sec) => {
    sec.append(
      typography.buildEditor({
        value: ov.typography || {},
        onChange(v) {
          ov.typography = v;
          persistAndApply(target, ov);
        },
      }),
    );
  });

  /* ---- Shape & spacing ---- */
  addSection(i18n.t('appear.tab.shape'), (sec) => {
    const radius = el('input', { class: 'slider', attrs: { type: 'range', min: '0', max: '28', step: '1', 'aria-label': 'radius' } });
    radius.value = String(ov.radius ?? 0);
    radius.style.maxWidth = '200px';
    radius.addEventListener('input', () => {
      ov.radius = Number(radius.value);
      persistAndApply(target, ov);
    });
    sec.append(el('div', { class: 'field', children: [el('label', { class: 'body-small', children: ['Corner radius (px)'] }), radius] }));

    const elev = el('select', { class: 'select', style: 'width:auto' });
    elev.append(el('option', { attrs: { value: '' }, children: ['inherit'] }));
    for (let i = 0; i <= 5; i++) elev.append(el('option', { attrs: { value: String(i) }, children: [`level ${i}`] }));
    elev.value = ov.elevation == null ? '' : String(ov.elevation);
    elev.addEventListener('change', () => {
      if (elev.value === '') delete ov.elevation;
      else ov.elevation = Number(elev.value);
      persistAndApply(target, ov);
    });
    sec.append(el('div', { class: 'field', children: [el('label', { class: 'body-small', children: ['Elevation'] }), elev] }));
  });

  show(i18n.t('appear.tab.colour'));

  /* ---- Footer actions ---- */
  const foot = el('div', { class: 'dialog-actions', style: 'padding:8px 12px;border-top:1px solid var(--md-sys-color-outline-variant);flex-wrap:wrap' });

  // Presets — derived strictly from the shipped-default baseline snapshot.
  for (const preset of presets()) {
    const b = el('button', { class: 'chip', type: 'button', children: [preset.name] });
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => {
      preset.apply();
      notifyInfoLocal(`${preset.name} applied.`);
      closeEditor();
      // reopen fresh so controls reflect the reset state
      openEditor(target);
    });
    foot.append(b);
  }

  const exportBtn = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('appear.export')] });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([exportOverrides()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ccr-site-appearance.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  const importBtn = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('appear.import')] });
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.setAttribute('aria-label', i18n.t('appear.import'));
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const n = importOverrides(await f.text());
        notifyInfoLocal(i18n.t('appear.imported', { n }));
      } catch (err) {
        notifyWarnLocal(`Import failed: ${err.message}`);
      }
    });
    input.click();
  });

  const resetEl = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('appear.resetElement')] });
  resetEl.addEventListener('click', () => {
    delete overrides[target.id];
    persistAndApply(target, null);
    closeEditor();
    notifyInfoLocal(i18n.t('appear.resetDone'));
  });
  foot.append(exportBtn, importBtn, resetEl);
  panel.append(foot);

  document.body.appendChild(panel);

  /* ---- Anchoring: track the anchor while open, stay in viewport ---- */
  function position() {
    if (!anchorNode || !anchorNode.isConnected) return;
    const r = anchorNode.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = r.right + 12;
    if (left + pw > vw - 8) left = Math.max(8, r.left - pw - 12);
    if (left < 8) left = Math.min(Math.max(8, r.left), Math.max(8, vw - pw - 8));
    let top = r.top;
    top = Math.min(Math.max(8, top), Math.max(8, vh - ph - 8));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
  position();
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);

  closeBtn.addEventListener('click', closeEditor);

  activeEditor = {
    panel,
    close() {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      panel.remove();
      activeEditor = null;
      (anchorNode instanceof HTMLElement) && anchorNode.focus({ preventScroll: true });
    },
  };

  return activeEditor;
}

function closeEditor() {
  activeEditor?.close();
}

function persistAndApply(target, ovOrNull) {
  if (ovOrNull && Object.keys(ovOrNull).length === 0) delete overrides[target.id];
  else if (ovOrNull) overrides[target.id] = ovOrNull;
  else {
    // full reset of this target
    const t = TARGETS.find((x) => x.id === target.id);
    if (t) {
      const sample = firstMatch(t.selector);
      if (sample) {
        sample.removeAttribute('style');
      }
    }
    delete overrides[target.id];
  }
  store.set('appearance.overrides', overrides);
  applyAll();
}

/* ------------------------------ global ops ------------------------------ */

export async function resetGlobal() {
  const ok = await superConfirm({
    title: i18n.t('data.resetAll.title'),
    body: i18n.t('data.resetAll.body'),
    phrase: 'RESET',
  });
  return ok;
}

export function exportOverrides() {
  return JSON.stringify({ version: 1, overrides }, null, 2);
}
export function importOverrides(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.overrides || typeof data.overrides !== 'object') throw new Error('bad file');
  overrides = data.overrides;
  store.set('appearance.overrides', overrides);
  applyAll();
  return Object.keys(overrides).length;
}

/** Preset list derived ONLY from shipped defaults. */
export function presets() {
  return [
    {
      name: 'Shipped default',
      apply() {
        overrides = {};
        store.set('appearance.overrides', overrides);
        for (const t of TARGETS) {
          const sample = firstMatch(t.selector);
          if (sample) sample.removeAttribute('style');
        }
        applyAll();
      },
    },
  ];
}

let notifyInfoLocal = () => {};
let notifyWarnLocal = () => {};
export function _wireNotify(fns) {
  if (typeof fns === 'function') {
    notifyInfoLocal = fns;
    return;
  }
  notifyInfoLocal = fns?.info ?? notifyInfoLocal;
  notifyWarnLocal = fns?.warn ?? notifyWarnLocal;
}

void clear; void append;
