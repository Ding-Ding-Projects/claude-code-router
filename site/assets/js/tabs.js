/**
 * Browser-style tabbed navigation.
 *
 * - Persistent strip docking LEFT by default; dockable right/top/bottom from
 *   the strip context menu AND from Settings; persisted.
 * - Overflow surface when crowded (never silent clipping).
 * - Drag + keyboard reordering, pinning, groups (create/rename/colour/
 *   reorder/collapse/remove), move-into-group via an anchored PICKER dialog
 *   (never a menu list).
 * - Four tab-discovery searches (current strip / inside groups / groups by
 *   name / master across all site tabs), each with its own anchored regex
 *   builder and its own persisted state.
 * - Bulk close containing/not-containing text with a match-count preview;
 *   pinned AND locked tabs excluded by default with an explicit include.
 */
import * as store from './store.js';
import { el, append, clear } from './util.js';
import * as i18n from './i18n.js';
import { openMenu } from './menu.js';
import { attachSearchField, compile } from './search.js';
import { openDialog, promptDialog } from './dialog.js';

/** The whole site's tab registry — both pages. Wave-2 may append article tabs. */
export const SITE_TABS = [
  { id: 'home', labelKey: 'nav.home', page: 'index.html' },
  { id: 'docs', labelKey: 'nav.docs', page: 'index.html' },
  { id: 'changelog', labelKey: 'nav.changelog', page: 'index.html' },
  { id: 'download', labelKey: 'nav.download', page: 'index.html' },
  { id: 'settings', labelKey: 'nav.settings', page: 'settings.html' },
];

const GROUP_COLORS = ['#006b63', '#386281', '#7d5260', '#65558f', '#4b6360'];

const isIndexPage = () => !!document.getElementById('pane-home');
const currentPage = () => (isIndexPage() ? 'index.html' : 'settings.html');

function defaultOrder() {
  return SITE_TABS.map((t) => t.id);
}

export function loadState() {
  const s = store.get('tabs', {});
  return {
    order: Array.isArray(s.order) && s.order.length ? s.order.filter((id) => SITE_TABS.some((t) => t.id === id)) : defaultOrder(),
    // Append any newly registered tabs (wave-2) the visitor has never seen.
    ...(Array.isArray(s.order) ? {} : {}),
    pinned: Array.isArray(s.pinned) ? s.pinned.filter((id) => SITE_TABS.some((t) => t.id === id)) : [],
    selected: typeof s.selected === 'string' ? s.selected : 'home',
    dock: ['left', 'right', 'top', 'bottom'].includes(s.dock) ? s.dock : 'left',
    groups: s.groups && typeof s.groups === 'object' ? s.groups : {},
    groupOrder: Array.isArray(s.groupOrder) ? s.groupOrder : [],
  };
}

let state = null;

function save() {
  store.set('tabs', state);
}

/* ------------------------------------------------------------------ */

export function init() {
  if (!document.getElementById('tabstrip-region')) return null;
  state = loadState();
  // Add any tabs missing from the stored order (new registrations).
  for (const t of SITE_TABS) if (!state.order.includes(t.id)) state.order.push(t.id);
  for (const gid of Object.keys(state.groups)) {
    if (!state.groupOrder.includes(gid)) state.groupOrder.push(gid);
  }
  state.groupOrder = state.groupOrder.filter((g) => state.groups[g]);

  const hashTab = new URLSearchParams(location.hash.slice(1)).get('tab');
  if (hashTab && SITE_TABS.some((t) => t.id === hashTab && t.page === currentPage())) {
    state.selected = hashTab;
  }

  const region = document.getElementById('tabstrip-region');
  const strip = el('div', { class: 'tabstrip', attrs: { role: 'tablist' }, children: [] });
  const tools = buildTools();
  region.append(strip, tools);

  render();

  window.addEventListener('resize', debounceRender);
  if ('ResizeObserver' in globalThis) {
    try {
      new ResizeObserver(debounceRender).observe(region);
    } catch {
      /* older engines */
    }
  }

  // Cross-page navigation tabs.
  document.addEventListener('click', (e) => {
    const nav = e.target.closest?.('[data-nav-tab]');
    if (nav) {
      e.preventDefault();
      activate(nav.getAttribute('data-nav-tab'));
    }
  });

  // Initial selection honours the current page.
  const initial = SITE_TABS.find((t) => t.page === currentPage()) || SITE_TABS[0];
  activate(state.selected && tabOnPage(state.selected) ? state.selected : initial.id, { focusStrip: false });

  return api;
}

const debounceRender = (() => {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(render, 60);
  };
})();

function tabOnPage(id) {
  const t = SITE_TABS.find((x) => x.id === id);
  return t && t.page === currentPage() ? t : null;
}

function tabDef(id) {
  return SITE_TABS.find((x) => x.id === id);
}

/* ------------------------------ rendering ------------------------------ */

function orderedIds() {
  return state.order.slice();
}

function pinnedIds() {
  return orderedIds().filter((id) => state.pinned.includes(id));
}

function looseIds() {
  return orderedIds().filter((id) => !state.pinned.includes(id) && !memberOfAnyGroup(id));
}

function memberOfAnyGroup(id) {
  return state.groupOrder.find((g) => state.groups[g]?.members?.includes(id));
}

function render() {
  const app = document.querySelector('.app-shell');
  if (app) app.setAttribute('data-dock', state.dock);
  const strip = document.querySelector('#tabstrip-region .tabstrip');
  if (!strip) return;
  clear(strip);

  const vertical = state.dock === 'left' || state.dock === 'right';
  strip.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');

  // Pinned region
  for (const id of pinnedIds()) strip.append(tabButton(id));
  // Loose tabs
  for (const id of looseIds()) strip.append(tabButton(id));
  // Groups
  for (const gid of state.groupOrder) {
    const g = state.groups[gid];
    if (!g) continue;
    const members = (g.members || []).filter((id) => !state.pinned.includes(id));
    if (vertical) {
      const head = el('button', {
        class: 'tab-group-header',
        type: 'button',
        attrs: { 'data-group': gid, 'aria-expanded': g.collapsed ? 'false' : 'true', title: i18n.t('tabs.collapseGroup') },
      });
      const dot = el('span', { class: 'dot' });
      dot.style.background = g.color || GROUP_COLORS[0];
      append(head, el('span', { class: '', children: ['▾'] , attrs: {'aria-hidden':'true'}}));
      append(head, dot);
      append(head, el('span', { class: '', children: [g.name] }));
      append(head, el('span', { class: 'count', children: [String(members.length)] }));
      wireContextMenu(head, () => groupMenu(gid), {});
      head.addEventListener('click', () => toggleCollapse(gid));
      strip.append(head);
      if (!g.collapsed) for (const id of members) strip.append(tabButton(id));
    } else {
      for (const id of members) strip.append(tabButton(id));
    }
  }

  markOverflow(strip);
}

function tabButton(id) {
  const def = tabDef(id);
  if (!def) return document.createComment('');
  const onThisPage = def.page === currentPage();
  const btn = el('button', {
    class: ['tab'],
    type: 'button',
    attrs: {
      role: 'tab',
      id: `tab-${id}`,
      'aria-selected': String(state.selected === id && onThisPage),
      'aria-controls': `pane-${id}`,
      'data-tab-id': id,
      title: i18n.t(def.labelKey) + (state.pinned.includes(id) ? ' · 📌' : ''),
      draggable: 'true',
    },
  });
  if (state.pinned.includes(id)) append(btn, el('span', { class: 'tab-pin', attrs: { 'aria-hidden': 'true' }, children: ['📌'] }));
  append(btn, el('span', { class: 'tab-label', children: [i18n.t(def.labelKey)] }));

  btn.addEventListener('click', () => activate(id));
  btn.addEventListener('keydown', tabKeydown);

  wireContextMenu(btn, () => tabMenu(id), {});

  // Keyboard shortcut hints shown in the context menu come from the same
  // bindings registered here.
  btn.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/ccr-tab', id);
    e.dataTransfer.effectAllowed = 'move';
    btn.classList.add('is-dragging');
  });
  btn.addEventListener('dragend', () => btn.classList.remove('is-dragging'));
  btn.addEventListener('dragover', (e) => {
    e.preventDefault();
    const r = btn.getBoundingClientRect();
    const before =
      state.dock === 'left' || state.dock === 'right'
        ? e.clientY < r.top + r.height / 2
        : e.clientX < r.left + r.width / 2;
    btn.classList.toggle('drop-before', before);
    btn.classList.toggle('drop-after', !before);
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drop-before', 'drop-after'));
  btn.addEventListener('drop', (e) => {
    e.preventDefault();
    const srcId = e.dataTransfer.getData('text/ccr-tab');
    btn.classList.remove('drop-before', 'drop-after');
    if (!srcId || srcId === id) return;
    const r = btn.getBoundingClientRect();
    const before =
      state.dock === 'left' || state.dock === 'right'
        ? e.clientY < r.top + r.height / 2
        : e.clientX < r.left + r.width / 2;
    moveRelative(srcId, id, before);
  });

  return btn;
}

function markOverflow(strip) {
  const region = document.getElementById('tabstrip-region');
  const overflowBtn = document.getElementById('tab-overflow-btn');
  if (!region || !overflowBtn) return;
  const fits = (node) =>
    state.dock === 'left' || state.dock === 'right'
      ? node.offsetTop + node.offsetHeight <= region.clientHeight
      : node.offsetLeft + node.offsetWidth <= region.clientWidth;
  let hiddenCount = 0;
  for (const tab of [...strip.querySelectorAll('.tab')]) {
    const ok = fits(tab);
    tab.style.display = ok ? '' : 'none';
    if (!ok) hiddenCount++;
  }
  overflowBtn.setAttribute('data-count', hiddenCount > 0 ? String(hiddenCount) : '');
  overflowBtn.setAttribute('aria-label', `${i18n.t('tabs.overflow.open')}${hiddenCount ? ` (${hiddenCount})` : ''}`);
}

/* ------------------------------ activation ------------------------------ */

function activate(id, { focusStrip = true } = {}) {
  const def = tabDef(id);
  if (!def) return;
  state.selected = id;
  save();

  if (def.page !== currentPage()) {
    location.href = `${def.page}#tab=${encodeURIComponent(id)}`;
    return;
  }

  for (const pane of document.querySelectorAll('[role="tabpanel"]')) {
    const match = pane.id === `pane-${id}`;
    pane.hidden = !match;
    if (match) pane.focus({ preventScroll: true });
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tabId === id));
  }
  if (focusStrip) document.getElementById(`tab-${id}`)?.focus();
}

/* ------------------------------ mutations ------------------------------ */

function moveRelative(srcId, targetId, before) {
  const order = state.order.filter((x) => x !== srcId);
  const idx = order.indexOf(targetId);
  order.splice(before ? idx : idx + 1, 0, srcId);
  state.order = order;
  save();
  render();
}

function togglePin(id) {
  if (state.pinned.includes(id)) {
    state.pinned = state.pinned.filter((x) => x !== id);
    i18n.deco('📌');
    notifyInfo(i18n.t('tabs.unpinned'));
  } else {
    state.pinned.push(id);
    notifyInfo(i18n.t('tabs.pinned'));
  }
  save();
  render();
}

function toggleCollapse(gid) {
  const g = state.groups[gid];
  if (!g) return;
  g.collapsed = !g.collapsed;
  save();
  render();
}

function createGroup(name, memberIds = []) {
  const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  state.groups[gid] = {
    name: name || `Group ${state.groupOrder.length + 1}`,
    color: GROUP_COLORS[state.groupOrder.length % GROUP_COLORS.length],
    collapsed: false,
    members: memberIds.filter((id) => !state.pinned.includes(id)),
  };
  state.groupOrder.push(gid);
  save();
  render();
  return gid;
}

function removeGroup(gid) {
  delete state.groups[gid];
  state.groupOrder = state.groupOrder.filter((g) => g !== gid);
  save();
  render();
}

async function setGroupColor(gid) {
  const g = state.groups[gid];
  const mod = await import('./color.js');
  mod.pickColor({
    value: g.color,
    onPick(hex) {
      g.color = hex;
      save();
      render();
    },
  });
}

function moveIntoGroupPicker(tabId) {
  const openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const groups = state.groupOrder.map((gid) => ({ gid, ...state.groups[gid] }));
  const dlg = openDialog(i18n.t('tabs.groupPicker.title', { tab: i18n.t(tabDef(tabId)?.labelKey || '') }), { opener: openerEl });
  const body = dlg.body;

  const searchInput = el('input', { class: 'input', attrs: { type: 'text', placeholder: i18n.t('menu.filter'), 'aria-label': i18n.t('menu.filter') } });
  attachSearchField(searchInput, { id: 'group-picker', storage: false });
  body.append(searchInput);

  const listWrap = el('div', { class: 'result-list', attrs: { role: 'listbox', 'aria-label': i18n.t('tabs.moveIntoGroup') } });
  body.append(listWrap);
  const status = el('div', { class: 'body-small', attrs: { role: 'status' } });
  body.append(status);

  let rows = [];
  function renderList() {
    clear(listWrap);
    rows = [];
    const c = compile({ query: searchInput.value, mode: 'plain' });
    if (!groups.length) {
      listWrap.append(el('div', { class: 'body-small', children: [i18n.t('tabs.groupPicker.empty')] }));
    }
    for (const g of groups) {
      if (!c.empty && !c.test(g.name)) continue;
      const row = el('button', { class: 'list-item', type: 'button', attrs: { role: 'option' } });
      const dot = el('span', { class: 'dot', style: 'width:10px;height:10px;border-radius:50%;display:inline-block;background:' + (g.color || '#777') });
      row.append(dot, el('span', { children: [g.name] }), el('span', { class: 'result-meta', children: [i18n.t('tabs.groupPicker.members', { n: (g.members || []).length })] }));
      row.addEventListener('click', () => {
        moveToGroup(tabId, g.gid);
        dlg.close();
        notifyInfo(i18n.t('tabs.movedToGroup', { group: g.name }));
      });
      listWrap.append(row);
      rows.push(row);
    }
    const n = rows.length;
    status.textContent = i18n.t('results.count', { n });
    if (!groups.length) status.textContent += '';
  }

  const newBtn = el('button', { class: 'btn btn--tonal', type: 'button', children: [i18n.t('tabs.groupPicker.newGroup')] });
  newBtn.addEventListener('click', async () => {
    const name = await promptDialog(i18n.t('tabs.newGroup'), '');
    if (name == null) return;
    const gid = createGroup(name, []);
    moveToGroup(tabId, gid);
    dlg.close();
    notifyInfo(i18n.t('tabs.movedToGroup', { group: name }));
  });
  body.append(el('div', { class: 'dialog-actions', children: [newBtn] }));

  searchInput.addEventListener('input', renderList);
  listWrap.addEventListener('keydown', (e) => {
    const idx = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (rows[Math.min(rows.length - 1, idx + 1)] || rows[0])?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (rows[Math.max(0, idx - 1)] || rows[0])?.focus();
    }
  });

  renderList();
  searchInput.focus();
}

function moveToGroup(tabId, gid) {
  for (const g of Object.values(state.groups)) {
    g.members = (g.members || []).filter((x) => x !== tabId);
  }
  state.groups[gid].members.push(tabId);
  save();
  render();
}

function closeTab(id) {
  if (state.pinned.includes(id)) {
    notifyWarn(i18n.t('tabs.protected', { tab: i18n.t(tabDef(id)?.labelKey || id) }));
    return false;
  }
  if (document.getElementById(`tab-${id}`)?.dataset.locked === 'true') {
    notifyWarn(i18n.t('tabs.protected', { tab: i18n.t(tabDef(id)?.labelKey || id) }));
    return false;
  }
  // Site tabs are structural: "close" removes them from the strip until
  // re-opened via the palette ("Open …") or the overflow menu.
  state.order = state.order.filter((x) => x !== id);
  for (const g of Object.values(state.groups)) g.members = (g.members || []).filter((x) => x !== id);
  state.pinned = state.pinned.filter((x) => x !== id);
  if (state.selected === id) {
    const next = state.order[0] || 'home';
    state.selected = next;
    activate(next, { focusStrip: false });
  }
  save();
  render();
  return true;
}

function reopenTab(id) {
  if (!state.order.includes(id)) state.order.push(id);
  save();
  render();
  activate(id);
}

function closeOthers(id) {
  let closed = 0;
  for (const tid of [...state.order]) {
    if (tid !== id && closeTab(tid)) closed++;
  }
}
function closeRight(id) {
  const idx = state.order.indexOf(id);
  let closed = 0;
  for (const tid of state.order.slice(idx + 1)) if (closeTab(tid)) closed++;
}

/* ------------------------------ bulk close ------------------------------ */

function bulkCloseDialog() {
  const dlg = openDialog(i18n.t('tabs.bulk.title'), {});
  const body = dlg.body;

  const modeSel = el('select', { class: 'select', attrs: { 'aria-label': i18n.t('tabs.bulk.title') } });
  modeSel.append(
    el('option', { attrs: { value: 'containing' }, children: [i18n.t('tabs.bulk.containing')] }),
    el('option', { attrs: { value: 'notContaining' }, children: [i18n.t('tabs.bulk.notContaining')] }),
  );

  const qInput = el('input', { class: 'input', attrs: { type: 'text' } });
  attachSearchField(qInput, { id: 'bulk-close', storage: false, onChange: renderPreview });

  const includePinned = el('input', { attrs: { type: 'checkbox' } });
  const ipLabel = el('label', { class: 'switch', children: [includePinned, document.createTextNode(i18n.t('tabs.bulk.includePinned'))] });
  includePinned.addEventListener('change', renderPreview);

  const preview = el('div', { class: 'result-list', attrs: { role: 'list', 'aria-live': 'polite' } });
  const countLine = el('div', { class: 'body-small', attrs: { role: 'status' } });
  const confirmBtn = el('button', { class: 'btn btn--danger', type: 'button' });

  function matchingIds() {
    const raw = qInput.value.trim();
    if (!raw) return [];
    const c = compile({ query: raw, mode: qInput.ccrSearch.getState().mode, flags: qInput.ccrSearch.getState().flags });
    if (!c.empty && c.error) return [];
    return state.order.filter((id) => {
      const protectedTab = state.pinned.includes(id) || document.getElementById(`tab-${id}`)?.dataset.locked === 'true';
      if (protectedTab && !includePinned.checked) return false;
      const label = i18n.t(tabDef(id)?.labelKey || id);
      const hit = c.empty ? true : c.test(label);
      return modeSel.value === 'containing' ? hit : !hit;
    });
  }

  function renderPreview() {
    clear(preview);
    const ids = matchingIds();
    countLine.textContent = ids.length
      ? i18n.t('tabs.bulk.preview', { n: ids.length })
      : i18n.t('tabs.bulk.none');
    for (const id of ids.slice(0, 50)) {
      preview.append(el('div', { class: 'list-item', attrs: { role: 'listitem' }, children: [`· ${i18n.t(tabDef(id)?.labelKey || id)}`] }));
    }
    if (ids.length > 50) preview.append(el('div', { class: 'body-small', children: [`+${ids.length - 50} …`] }));
    confirmBtn.textContent = i18n.t('tabs.bulk.confirm', { n: ids.length });
    confirmBtn.disabled = !ids.length;
  }

  modeSel.addEventListener('change', renderPreview);

  confirmBtn.addEventListener('click', () => {
    const ids = matchingIds();
    let closed = 0;
    let skipped = 0;
    for (const id of ids) {
      if (state.pinned.includes(id) || document.getElementById(`tab-${id}`)?.dataset.locked === 'true') skipped++;
      else if (closeTab(id)) closed++;
    }
    dlg.close();
    notifyInfo(i18n.t('tabs.bulk.done', { n: closed, m: skipped }));
  });

  body.append(
    el('div', { class: 'field', children: [el('label', { children: [i18n.t('tabs.bulk.title')] }), modeSel] }),
    qInput,
    ipLabel,
    countLine,
    preview,
    el('div', { class: 'dialog-actions', children: [
      (() => { const b = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('common.cancel')] }); b.addEventListener('click', () => dlg.close()); return b; })(),
      confirmBtn,
    ] }),
  );
  renderPreview();
  qInput.focus();
}

/* --------------------------- discovery searches --------------------------- */

/**
 * One dialog per discovery kind, each with its OWN field instance and its OWN
 * persisted query/pattern/flags/mode state.
 */
function openDiscovery(kind) {
  const titles = {
    strip: 'tabs.discovery.strip.title',
    group: 'tabs.discovery.group.title',
    groups: 'tabs.discovery.groups.title',
    master: 'tabs.discovery.master.title',
  };
  const dlg = openDialog(i18n.t(titles[kind]), {});
  const body = dlg.body;
  const qInput = el('input', { class: 'input', attrs: { type: 'text' } });
  attachSearchField(qInput, { id: `discovery-${kind}`, storage: true, onChange: renderResults });

  const list = el('div', { class: 'result-list', attrs: { role: 'listbox' } });
  const countLine = el('div', { class: 'body-small', attrs: { role: 'status' } });
  body.append(qInput, countLine, list);

  let rows = [];

  function rowsFor(kind_) {
    if (kind_ === 'groups') {
      return state.groupOrder.map((gid) => ({
        key: gid,
        label: state.groups[gid].name,
        meta: i18n.t('tabs.groupPicker.members', { n: (state.groups[gid].members || []).length }),
        run: () => {
          const g = state.groups[gid];
          const wasCollapsed = g.collapsed;
          if (wasCollapsed) {
            g.collapsed = false;
            save();
            render();
            setTimeout(() => {
              g.collapsed = wasCollapsed; // reveal without destroying preference
              save();
              render();
            }, 1600);
          }
          document.querySelector(`[data-group="${gid}"]`)?.scrollIntoView({ block: 'nearest' });
        },
      }));
    }
    const source =
      kind_ === 'strip'
        ? state.order
        : kind_ === 'group'
          ? state.groupOrder.flatMap((gid) => (state.groups[gid].members || []).map((id) => ({ id, gid })))
          : SITE_TABS.map((t) => ({ id: t.id }));
    const items = kind_ === 'group'
      ? source.map(({ id, gid }) => ({ id, groupName: state.groups[gid]?.name }))
      : source.map((s) => ({ id: typeof s === 'string' ? s : s.id, groupName: undefined }));
    return items.map(({ id, groupName }) => ({
      key: id + (groupName ? ':' + groupName : ''),
      label: i18n.t(tabDef(id)?.labelKey || id),
      meta: [
        state.pinned.includes(id) ? '📌' : '',
        document.getElementById(`tab-${id}`)?.dataset.locked === 'true' ? `🔒 ${i18n.t('tabs.lockedTag')}` : '',
        groupName || '',
        tabDef(id)?.page !== currentPage() ? tabDef(id)?.page : '',
      ].filter(Boolean).join(' · '),
      run: () => {
        if (!state.order.includes(id)) reopenTabKeepClosed(id);
        else activate(id, { focusStrip: false });
      },
    }));
  }

  function reopenTabKeepClosed(id) {
    // Master search can reach a tab that was closed from the strip; opening it
    // restores it (it is a real site tab, not a session artifact).
    reopenTab(id);
  }

  function renderResults() {
    clear(list);
    rows = [];
    const c = qInput.ccrSearch.compile();
    const all = rowsFor(kind);
    const shown = c.empty ? all : all.filter((r) => c.test(r.label) || c.test(r.meta));
    countLine.textContent = i18n.t('results.count', { n: shown.length });
    if (!shown.length) {
      list.append(el('div', { class: 'empty-note', children: [i18n.t('results.none')] }));
      return;
    }
    for (const r of shown) {
      const row = el('button', { class: 'list-item', type: 'button', attrs: { role: 'option' }, children: [] });
      row.append(el('span', { children: [r.label] }));
      if (r.meta) row.append(el('span', { class: 'result-meta', children: [r.meta] }));
      row.addEventListener('click', () => {
        r.run();
      });
      list.append(row);
      rows.push(row);
    }
  }

  list.addEventListener('keydown', (e) => {
    const idx = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (rows[Math.min(rows.length - 1, idx + 1)] || rows[0])?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (rows[Math.max(0, idx - 1)] || rows[0])?.focus();
    }
  });

  renderResults();
  qInput.focus();
}

/* ------------------------------ context menus ------------------------------ */

function tabMenu(id) {
  const pinned = state.pinned.includes(id);
  return [
    { labelKey: pinned ? 'tab.unpin' : 'tab.pin', shortcut: 'Alt+P', onSelect: () => togglePin(id) },
    { labelKey: 'tabs.moveIntoGroup', onSelect: () => moveIntoGroupPicker(id) },
    { separatorBefore: true, labelKey: 'tab.editAppearance', onSelect: () => document.dispatchEvent(new CustomEvent('ccr-edit-appearance', { detail: { selector: `.tab[data-tab-id="${id}"]`, label: i18n.t(tabDef(id)?.labelKey || id) } })) },
    { separatorBefore: true, labelKey: 'tab.closeOthers', danger: true, disabled: state.order.length < 2, onSelect: () => closeOthers(id) },
    { labelKey: 'tab.closeRight', danger: true, onSelect: () => closeRight(id) },
    { labelKey: 'tab.close', shortcut: 'Ctrl+W', danger: true, onSelect: () => closeTab(id) },
  ];
}

function groupMenu(gid) {
  const g = state.groups[gid];
  return [
    { labelKey: g?.collapsed ? 'tabs.expandGroup' : 'tabs.collapseGroup', onSelect: () => toggleCollapse(gid) },
    { labelKey: 'tabs.renameGroup', onSelect: async () => {
        const name = await promptDialog(i18n.t('tabs.renameGroup'), g.name);
        if (name) {
          g.name = name;
          save();
          render();
        }
      } },
    { labelKey: 'tabs.colorGroup', onSelect: () => setGroupColor(gid) },
    { separatorBefore: true, labelKey: 'tabs.removeGroup', danger: true, onSelect: () => removeGroup(gid) },
  ];
}

function stripMenu(e) {
  return [
    { labelKey: 'tabs.newGroup', onSelect: async () => {
        const name = await promptDialog(i18n.t('tabs.newGroup'), '');
        if (name != null) createGroup(name);
      } },
    { separatorBefore: true, labelKey: 'tabs.searchStrip', onSelect: () => openDiscovery('strip') },
    { labelKey: 'tabs.searchGroup', onSelect: () => openDiscovery('group') },
    { labelKey: 'tabs.searchGroupsByName', onSelect: () => openDiscovery('groups') },
    { labelKey: 'tabs.searchMaster', onSelect: () => openDiscovery('master') },
    { separatorBefore: true, labelKey: 'tabs.bulkClose', danger: true, onSelect: bulkCloseDialog },
    { separatorBefore: true, labelKey: 'tabs.dock' },
    ...['left', 'right', 'top', 'bottom'].map((d) => ({
      labelKey: `tabs.dock.${d}`,
      checked: state.dock === d,
      onSelect: () => setDock(d),
    })),
  ];
}

function buildTools() {
  const tools = el('div', { class: 'tabstrip-tools' });

  const overflowBtn = el('button', {
    class: ['icon-btn', 'tab-overflow-btn'],
    type: 'button',
    attrs: { id: 'tab-overflow-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    children: [],
  });
  append(overflowBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: ['⋯'] }));
  overflowBtn.addEventListener('click', () => {
    const strip = document.querySelector('#tabstrip-region .tabstrip');
    const hiddenTabs = [...strip.querySelectorAll('.tab')]
      .filter((t) => t.style.display === 'none')
      .map((t) => t.dataset.tabId);
    const items = hiddenTabs.map((id) => ({ labelKey: tabDef(id)?.labelKey || id, onSelect: () => activate(id) }));
    items.push({ separatorBefore: true, labelKey: 'tabs.searchMaster', onSelect: () => openDiscovery('master') });
    items.push({ labelKey: 'tabs.bulkClose', onSelect: bulkCloseDialog });
    openMenu({ anchor: overflowBtn, items, minWidth: 240 });
  });

  const searchBtn = el('button', { class: ['icon-btn'], type: 'button', attrs: { title: i18n.t('tabs.searchMaster'), 'aria-label': i18n.t('tabs.searchMaster') } });
  append(searchBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: ['🔍'] }));
  searchBtn.addEventListener('click', () => openDiscovery('master'));

  const moreBtn = el('button', { class: ['icon-btn'], type: 'button', attrs: { title: i18n.t('tabs.dock'), 'aria-label': i18n.t('tabs.dock') } });
  append(moreBtn, el('span', { class: 'glyph', attrs: { 'aria-hidden': 'true' }, children: ['⇔'] }));
  moreBtn.addEventListener('click', () => openMenu({ anchor: moreBtn, items: stripMenu(), minWidth: 230 }));

  tools.append(overflowBtn, searchBtn, moreBtn);

  // Strip background context menu (right-click empty area of the strip).
  const region = document.getElementById('tabstrip-region');
  region.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tab, .tab-group-header, .tabstrip-tools')) return;
    e.preventDefault();
    openMenu({ point: { x: e.clientX, y: e.clientY }, items: stripMenu(e), minWidth: 240 });
  });

  return tools;
}

function setDock(dock) {
  if (!['left', 'right', 'top', 'bottom'].includes(dock)) return;
  state.dock = dock;
  save();
  render();
  notifyInfo(i18n.t(`tabs.dock.${dock}`));
}

function tabKeydown(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.tabId;
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const vertical = state.dock === 'left' || state.dock === 'right';
    const forward = vertical ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
    const order = state.order;
    const idx = order.indexOf(id);
    const target = order[idx + (forward ? 1 : -1)];
    if (target) moveRelative(id, target, forward);
    document.getElementById(`tab-${id}`)?.focus();
    return;
  }
  if (e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    togglePin(id);
    return;
  }
  if (e.altKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    moveIntoGroupPicker(id);
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    closeTab(id);
  }
}

/* ------------------------------ notifications glue ------------------------------ */

let notifyInfo = () => {};
let notifyWarn = () => {};
export function _wireNotify(fns) {
  notifyInfo = fns.info;
  notifyWarn = fns.warn;
}

/* ------------------------------ public API ------------------------------ */

const api = {
  setDock,
  getDock: () => state?.dock ?? 'left',
  getState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
  openDiscovery,
  openBulkClose: bulkCloseDialog,
  reopenTab,
  /** Palette support: list every site tab with its page + protection state. */
  listTabs: () =>
    SITE_TABS.map((t) => ({
      id: t.id,
      label: i18n.t(t.labelKey),
      page: t.page,
      open: state ? state.order.includes(t.id) : true,
      pinned: state ? state.pinned.includes(t.id) : false,
    })),
};
void api;

export { api as TabsAPI };
