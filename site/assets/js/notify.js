/**
 * Non-blocking notifications: corner snackbars (bottom-right) plus a
 * reviewable notification centre / history.
 *
 * - Info/success auto-dismiss on a sensible timeout.
 * - Errors and warnings PERSIST until dismissed — they never time out.
 * - Snackbars stack without overlapping and never block the page.
 * - Every notification is recorded in a local history (capped) so dismissed
 *   ones stay reviewable. The centre supports bulk select-all (this list),
 *   inverse selection, bulk dismiss, bulk export honouring the active filter,
 *   and bulk delete behind the destructive super confirmation.
 */
import * as store from './store.js';
import { el, append, clear } from './util.js';
import * as i18n from './i18n.js';
import { attachSearchField } from './search.js';
import { openDialog } from './dialog.js';
import { superConfirm } from './superconfirm.js';

const HISTORY_CAP_DEFAULT = 200;
let history = store.get('notify.history', []);
if (!Array.isArray(history)) history = [];

function cap() {
  const c = Number(store.get('notify.historyCap', HISTORY_CAP_DEFAULT));
  return Number.isFinite(c) && c >= 10 ? Math.min(1000, c) : HISTORY_CAP_DEFAULT;
}

function saveHistory() {
  const c = cap();
  if (history.length > c) history = history.slice(-c);
  store.set('notify.history', history);
}

/** Push one notification. Returns its id. */
export function push({ kind = 'info', title, body = '', timeoutMs }) {
  const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = {
    id,
    kind,
    title: String(title),
    body: String(body),
    at: new Date().toISOString(),
    read: false,
  };
  history.push(rec);
  saveHistory();
  const autoMs = timeoutMs ?? store.get('notify.infoTimeoutMs', 5200);
  showSnackbar(rec, kind === 'error' || kind === 'warning' ? null : autoMs);
  return id;
}

export const info = (title, body) => push({ kind: 'info', title, body });
export const success = (title, body) => push({ kind: 'success', title, body });
export const warn = (title, body) => push({ kind: 'warning', title, body });
export const error = (title, body) => push({ kind: 'error', title, body });

/* ------------------------------ snackbars ------------------------------ */

function region() {
  return document.getElementById('snackbar-region');
}

function showSnackbar(rec, timeoutMs) {
  const reg = region();
  if (!reg) return;
  const emoji = i18n.deco(rec.kind === 'error' ? '❌' : rec.kind === 'warning' ? '⚠️' : rec.kind === 'success' ? '✅' : 'ℹ️');
  const card = el('div', { class: ['snackbar'], attrs: { role: rec.kind === 'error' ? 'alert' : 'status', 'data-kind': rec.kind } });
  const textCol = el('div', { class: '', style: 'min-width:0' });
  append(textCol, el('div', { class: 'label-large', children: [emoji + rec.title] }));
  if (rec.body) append(textCol, el('div', { class: 'body-small', children: [rec.body] }));
  card.append(textCol);

  const actions = el('div', { class: 'snackbar-actions' });
  const dismiss = el('button', { class: 'snackbar-text-btn', type: 'button', children: [i18n.t('notify.dismiss')] });
  dismiss.addEventListener('click', () => hide());
  actions.append(dismiss);
  card.append(actions);

  function hide() {
    if (!card.isConnected) return;
    card.setAttribute('data-leaving', 'true');
    setTimeout(() => card.remove(), 180);
  }

  reg.append(card);
  // Stack guard: never let the pile grow past the viewport height.
  while (reg.children.length > 5) reg.firstElementChild?.remove();
  if (timeoutMs != null) setTimeout(hide, timeoutMs);
}

/* --------------------------- notification centre --------------------------- */

export function openCentre() {
  const dlg = openDialog(i18n.t('notify.centre.title'), { wide: true });
  const body = dlg.body;

  const toolbar = el('div', { class: 'notify-toolbar' });
  const qInput = el('input', { class: 'input', attrs: { type: 'text', placeholder: i18n.t('menu.filter') } });
  attachSearchField(qInput, { id: 'notify-centre', storage: true, onChange: render });

  const selectAllBtn = chipBtn(i18n.t('notify.selectAll'), () => {
    for (const cb of list.querySelectorAll('input[type=checkbox]:not([disabled])')) cb.checked = true;
    updateCounts();
  });
  const invertBtn = chipBtn(i18n.t('notify.selectInverse'), () => {
    for (const cb of list.querySelectorAll('input[type=checkbox]')) cb.checked = !cb.checked;
    updateCounts();
  });
  const clearFiltersBtn = chipBtn(i18n.t('notify.clearFilters'), () => {
    qInput.value = '';
    qInput.dispatchEvent(new Event('input'));
    kindSel.value = 'all';
    render();
  });

  const kindSel = el('select', { class: 'select', attrs: { 'aria-label': 'kind' }, style: 'width:auto' });
  for (const [v, label] of [['all', '—'], ['error', 'error'], ['warning', 'warning'], ['info', 'info'], ['success', 'success']]) {
    kindSel.append(el('option', { attrs: { value: v }, children: [label] }));
  }
  kindSel.addEventListener('change', render);

  toolbar.append(qInput, kindSel, selectAllBtn, invertBtn, clearFiltersBtn);
  body.append(toolbar);

  const counts = el('div', { class: 'body-small', attrs: { role: 'status' } });
  body.append(counts);

  const list = el('div', { class: 'result-list' });
  body.append(list);

  const bulkBar = el('div', { class: 'dialog-actions' });
  const dismissBulk = el('button', { class: 'btn btn--tonal', type: 'button', children: [i18n.t('notify.bulkDismiss')] });
  const exportBulk = el('button', { class: 'btn btn--tonal', type: 'button', children: [i18n.t('notify.bulkExport')] });
  const deleteBulk = el('button', { class: 'btn btn--danger', type: 'button', children: [i18n.t('notify.bulkDelete')] });
  bulkBar.append(dismissBulk, exportBulk, deleteBulk);
  body.append(bulkBar);

  function visibleRecords() {
    const c = qInput.ccrSearch.compile();
    const kind = kindSel.value;
    return [...history].reverse().filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (c.empty) return true;
      return c.test(r.title) || c.test(r.body);
    });
  }

  function selectedIds() {
    return [...list.querySelectorAll('input[data-id]:checked')].map((cb) => cb.dataset.id);
  }

  function updateCounts() {
    const vis = visibleRecords();
    counts.textContent =
      `${i18n.t('results.count', { n: vis.length })} · ` +
      `${i18n.t('notify.selectAll')} → ${selectedIds().length}`;
  }

  function render() {
    clear(list);
    const vis = visibleRecords();
    if (!vis.length) {
      list.append(el('div', { class: 'empty-note', children: [i18n.t('notify.centre.empty')] }));
    }
    for (const r of vis) {
      const row = el('div', { class: 'list-item', style: 'cursor:default' });
      const cb = el('input', { attrs: { type: 'checkbox', 'data-id': r.id, 'aria-label': r.title } });
      cb.addEventListener('change', updateCounts);
      const col = el('div', { style: 'flex:1;min-width:0' });
      append(col, el('div', { class: 'n-title', children: [`${r.kind === 'error' ? '❌' : r.kind === 'warning' ? '⚠️' : '·'} ${r.title}`] }));
      if (r.body) append(col, el('div', { class: 'body-small', children: [r.body] }));
      append(col, el('div', { class: 'n-time', children: [new Date(r.at).toLocaleString()] }));
      const rm = el('button', { class: 'snackbar-text-btn', type: 'button', children: [i18n.t('notify.dismiss')] });
      rm.addEventListener('click', () => {
        history = history.filter((x) => x.id !== r.id);
        saveHistory();
        render();
      });
      row.append(cb, col, rm);
      list.append(row);
    }
    updateCounts();
  }

  dismissBulk.addEventListener('click', () => {
    const ids = selectedIds();
    for (const id of ids) {
      const r = history.find((x) => x.id === id);
      if (r) r.read = true;
    }
    saveHistory();
    render();
    info(`${ids.length} marked read`);
  });

  exportBulk.addEventListener('click', () => {
    const ids = selectedIds();
    const sel = ids.length ? history.filter((r) => ids.includes(r.id)) : visibleRecords();
    downloadJson(
      `ccr-site-notifications-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), encoding: 'UTF-8', count: sel.length, notifications: sel }, null, 2),
    );
    info(i18n.t('notify.exported', { n: sel.length }));
  });

  deleteBulk.addEventListener('click', async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const ok = await superConfirm({
      title: i18n.t('notify.super.delete.title', { n: ids.length }),
      body: i18n.t('notify.super.delete.body'),
      phrase: 'DELETE',
    });
    if (!ok) return;
    history = history.filter((r) => !ids.includes(r.id));
    saveHistory();
    render();
    info(i18n.t('notify.deleted', { n: ids.length }));
  });

  render();
}

function chipBtn(label, fn) {
  const b = el('button', { class: 'chip', type: 'button', children: [label], attrs: { role: 'button' } });
  b.style.cursor = 'pointer';
  b.addEventListener('click', fn);
  return b;
}

function downloadJson(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { attrs: { href: url, download: filename } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function init() {
  const bell = document.getElementById('notify-bell');
  if (bell) {
    bell.addEventListener('click', openCentre);
    bell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault(), openCentre();
    });
  }
}
