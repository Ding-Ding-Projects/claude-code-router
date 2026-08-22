/**
 * Command palette on Ctrl+Shift+F (plus the topbar button).
 *
 * Lists every page, tab, command and settings element with rich rows —
 * switch/slider/select controls render INLINE for settings and operate
 * through the same store/persistence path as the settings surface. Selecting
 * a teleport item lands on the EXACT element: right page, right tab/section,
 * scrolled into view, focused, briefly flashed. Bounded card by default with
 * a persisted full-window option. The palette's own search is wired to the
 * same anchored regex builder as every other search field.
 */
import { el, append, clear } from './util.js';
import * as i18n from './i18n.js';
import * as store from './store.js';
import { attachSearchField } from './search.js';

let items = [];
let layer = null;
let input = null;
let list = null;
let countLine = null;
let filtered = [];
let activeIdx = 0;
let sizePref = () => store.get('palette.size', 'bounded');
let bridgeRef = null;

/** Register the item source (app.js passes the assembled list factory). */
export function init(bridge) {
  bridgeRef = bridge;
  items = buildItems(bridge);
  const btn = document.getElementById('palette-btn');
  btn?.addEventListener('click', () => open());
  document.addEventListener('keydown', onGlobalKeydown);
}

function onGlobalKeydown(e) {
  if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    open();
    return;
  }
  if (!layer) return;
  if (e.key === 'Escape') {
    close();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(activeIdx + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(activeIdx - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    activateItem(activeIdx);
  }
}

export function isOpen() {
  return !!layer;
}

function buildItems(bridge) {
  const out = [];
  // Pages/tabs
  for (const t of bridge.tabs.listTabs()) {
    out.push({
      id: `tab:${t.id}`,
      kind: 'page',
      title: t.label,
      sub: t.page + (t.pinned ? ' · 📌' : ''),
      run: () => bridge.tabs.reopenTab(t.id),
    });
  }
  // Commands
  out.push(
    {
      id: 'cmd:theme',
      kind: 'command',
      title: i18n.t('theme.toggle'),
      sub: i18n.t('settings.section.appearance'),
      run: () => document.getElementById('theme-toggle')?.click(),
    },
    {
      id: 'cmd:notif',
      kind: 'command',
      title: i18n.t('notify.centre.open'),
      sub: i18n.t('settings.section.notifications'),
      run: () => document.getElementById('notify-bell')?.click(),
    },
    ...['left', 'right', 'top', 'bottom'].map((d) => ({
      id: `cmd:dock-${d}`,
      kind: 'command',
      title: `${i18n.t('tabs.dock')} → ${i18n.t(`tabs.dock.${d}`)}`,
      sub: i18n.t('settings.section.tabs'),
      run: () => bridge.tabs.setDock(d),
    })),
    ...[['strip', 'tabs.searchStrip'], ['group', 'tabs.searchGroup'], ['groups', 'tabs.searchGroupsByName'], ['master', 'tabs.searchMaster']].map(([k, key]) => ({
      id: `cmd:find-${k}`,
      kind: 'command',
      title: i18n.t(key),
      sub: i18n.t('tabs.bulk.title'),
      run: () => bridge.tabs.openDiscovery(k),
    })),
    {
      id: 'cmd:palette-size',
      kind: 'command',
      title: sizePref() === 'bounded' ? i18n.t('palette.size.full') : i18n.t('palette.size.bounded'),
      sub: i18n.t('palette.hint'),
      run: () => {
        store.set('palette.size', sizePref() === 'bounded' ? 'full' : 'bounded');
        if (layer) open(); // reopen at new size
      },
    },
  );
  // Settings elements — rich rows + teleport
  for (const s of bridge.settingsRows()) {
    const item = {
      id: `setting:${s.id}`,
      kind: 'setting',
      title: i18n.t(s.labelKey),
      sub: i18n.t(s.tabLabelKey || '') || s.tab,
      settingId: s.id,
      teleport: () => bridge.teleportToSetting(s),
      row: s,
    };
    out.push(item);
  }
  return out;
}

/* ------------------------------ rendering ------------------------------ */

export function open() {
  close();
  if (!items.length && bridgeRef) items = buildItems(bridgeRef);

  layer = el('div', { class: ['palette-layer'], attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': i18n.t('palette.open'), 'data-size': sizePref() } });
  const card = el('div', { class: ['dialog-card', 'palette-card'] });

  const head = el('div', { class: 'palette-head' });
  input = el('input', { attrs: { type: 'text', role: 'searchbox', placeholder: i18n.t('palette.placeholder'), 'aria-label': i18n.t('palette.placeholder'), 'aria-controls': 'palette-list', autocomplete: 'off' } });
  attachSearchField(input, { id: 'palette', storage: false, onChange: renderList });
  head.append(input);

  const sizeBtn = el('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': i18n.t(sizePref() === 'bounded' ? 'palette.size.full' : 'palette.size.bounded') } });
  append(sizeBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: [sizePref() === 'bounded' ? '⤢' : '⤡'] }));
  sizeBtn.addEventListener('click', () => {
    store.set('palette.size', sizePref() === 'bounded' ? 'full' : 'bounded');
    open();
  });
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': i18n.t('palette.close') } });
  append(closeBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: ['✕'] }));
  closeBtn.addEventListener('click', close);
  head.append(sizeBtn, closeBtn);
  card.append(head);

  countLine = el('div', { class: 'body-small', style: 'padding:0 20px 4px', attrs: { role: 'status' } });
  card.append(countLine);
  list = el('div', { class: 'palette-list', attrs: { id: 'palette-list', role: 'listbox' } });
  card.append(list);
  card.append(el('div', { class: 'body-small', style: 'padding:6px 20px 12px;color:var(--md-sys-color-on-surface-variant)', children: [i18n.t('palette.hint')] }));

  layer.append(card);
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) close();
  });
  document.body.appendChild(layer);

  renderList();
  input.focus();
}

export function close() {
  if (!layer) return;
  layer.remove();
  layer = null;
  input = null;
  list = null;
}

function rowControlFor(s) {
  // Inline rich controls mirroring the settings surface.
  try {
    if (s.control === 'switch') {
      const cb = el('input', { attrs: { type: 'checkbox' } });
      cb.checked = !!s.get();
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        s.set(cb.checked);
        refreshProvenanceInPlace();
      });
      return el('label', { class: 'switch', children: [cb] });
    }
    if (s.control === 'slider') {
      const rng = el('input', { class: 'slider', attrs: { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), 'aria-label': i18n.t(s.labelKey) } });
      rng.value = String(s.get());
      setFill(rng);
      rng.addEventListener('click', (e) => e.stopPropagation());
      rng.addEventListener('input', () => {
        s.set(Number(rng.value));
        setFill(rng);
      });
      return rng;
    }
    if (s.control === 'select') {
      const sel = el('select', { class: 'select', style: 'width:auto;min-height:36px' });
      for (const [v] of s.options) sel.append(el('option', { attrs: { value: v }, children: [v] }));
      sel.value = String(s.get());
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => s.set(sel.value));
      return sel;
    }
  } catch {
    /* setting not available on this page — teleport instead */
  }
  return null;
}

function setFill(rng) {
  const pct = ((Number(rng.value) - Number(rng.min)) / (Number(rng.max) - Number(rng.min))) * 100;
  rng.style.setProperty('--ccr-slider-fill', pct + '%');
}

function renderList() {
  clear(list);
  const c = input.ccrSearch.compile();
  filtered = c.empty ? items.slice() : items.filter((it) => c.test(it.title) || c.test(it.sub));
  countLine.textContent = i18n.t('palette.results', { n: filtered.length });
  if (!filtered.length) {
    list.append(el('div', { class: 'palette-empty', attrs: { role: 'status' }, children: [i18n.t('palette.noMatch')] }));
    return;
  }
  activeIdx = Math.min(activeIdx, filtered.length - 1);
  filtered.forEach((it, i) => {
    const rowEl = el('button', { class: ['palette-row'], type: 'button', attrs: { role: 'option', 'aria-selected': String(i === activeIdx), 'data-id': it.id } });
    const bodyCol = el('div', { class: 'row-body' });
    append(bodyCol, el('span', { class: 'row-title', children: [(it.kind === 'setting' ? '⚙ ' : it.kind === 'page' ? '📄 ' : '⌘ ') + it.title] }));
    if (it.sub) append(bodyCol, el('span', { class: 'row-sub', children: [it.sub] }));
    rowEl.append(bodyCol);
    const ctl = it.kind === 'setting' ? rowControlFor(items.find((x) => x.id === it.id)?.row || {}) : null;
    if (ctl) rowEl.append(el('span', { class: 'row-control', children: [ctl] }));
    rowEl.addEventListener('click', () => activateItem(i));
    list.append(rowEl);
  });
  setActive(0);
}

function setActive(i) {
  activeIdx = Math.max(0, Math.min(filtered.length - 1, i));
  [...list.querySelectorAll('.palette-row')].forEach((r, k) => {
    r.setAttribute('aria-selected', String(k === activeIdx));
    r.classList.toggle('is-active', k === activeIdx);
    if (k === activeIdx) r.scrollIntoView({ block: 'nearest' });
  });
}

function activateItem(i) {
  const it = filtered[i];
  if (!it) return;
  close();
  if (it.kind === 'setting') it.teleport?.();
  else it.run?.();
}

function refreshProvenanceInPlace() {
  /* values persist through the store; provenance re-renders next open */
}
