/**
 * Settings page builder: real tabs, every control from the hand-written
 * registry, explanation-on-demand behind an info affordance, and a truthful
 * default-provenance line under every element. A coverage guard compares the
 * rendered DOM against the registry in BOTH directions and fails visibly.
 */
import { el, append, clear } from './util.js';
import * as i18n from './i18n.js';
import * as store from './store.js';
import { TABS } from './settings-registry.js';

let rows = [];

export function init(bridge) {
  const tabsBar = document.getElementById('settings-tabs');
  if (!tabsBar) return;
  rows = bridge.registry;

  for (const tab of TABS) {
    // Reuse the statically-shipped tab button when present (progressive
    // enhancement); create one only if a future registry entry lacks its stub.
    const existing = document.getElementById(`stab-${tab.id}`);
    const btn =
      existing ??
      el('button', { class: 'm3-tab', type: 'button', attrs: { role: 'tab', id: `stab-${tab.id}`, 'aria-controls': `spane-${tab.id}` }, children: [] });
    btn.dataset.tab = tab.id;
    if (!existing) tabsBar.append(btn);
    const paint = () => {
      clear(btn);
      append(btn, document.createTextNode(i18n.t(tab.labelKey)));
      if (getLang() === 'bi') {
        // compact secondary label
        const sec = el('span', { class: 'bi-sub' });
        sec.textContent = i18n.tSecondary(tab.labelKey);
        btn.append(sec);
      }
    };
    function getLang() {
      return i18n.getLang();
    }
    paint();
    btn.addEventListener('click', () => showTab(tab.id));
    btn.addEventListener('keydown', (e) => {
      const idx = TABS.findIndex((t) => t.id === tab.id);
      if (e.key === 'ArrowRight') showTab(TABS[(idx + 1) % TABS.length].id, true);
      else if (e.key === 'ArrowLeft') showTab(TABS[(idx - 1 + TABS.length) % TABS.length].id, true);
      else if (e.key === 'Home') showTab(TABS[0].id, true);
      else if (e.key === 'End') showTab(TABS[TABS.length - 1].id, true);
      else return;
      e.preventDefault();
    });
    tabsBar.append(btn);

    const pane = document.getElementById(`spane-${tab.id}`);
    if (!pane) continue;
    pane.setAttribute('aria-labelledby', `stab-${tab.id}`);
    for (const row of bridge.registry.filter((r) => r.tab === tab.id)) {
      pane.append(buildRow(row, bridge));
    }
  }

  showTab('appearance');
  runCoverageGuard(bridge);
}

export function showTab(id, focus = false) {
  if (![...TABS.map((t) => t.id)].includes(id)) id = 'appearance';
  const bar = document.getElementById('settings-tabs');
  for (const b of bar.querySelectorAll('[role=tab]')) {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
  for (const pane of document.querySelectorAll('.settings-pane')) {
    pane.hidden = pane.id !== `spane-${id}`;
  }
}

function buildRow(row, bridge) {
  const wrap = el('div', { class: ['setting-row'], attrs: { 'data-setting-id': row.id } });
  if (row.danger) wrap.style.borderColor = 'var(--md-sys-color-error)';
  const main = el('div', { class: 'setting-main' });
  append(main, el('div', { class: 'setting-label', children: [i18n.t(row.labelKey)] }));

  // Explanation on demand.
  const descId = `desc-${row.id}`;
  const infoBtn = el('button', { class: 'info-btn', type: 'button', attrs: { 'aria-expanded': 'false', 'aria-controls': descId, 'aria-label': i18n.t('settings.explain.show') }, children: ['?'] });
  const desc = el('p', { class: ['setting-desc'], attrs: { id: descId, hidden: true } });
  infoBtn.addEventListener('click', () => {
    const open = desc.hidden;
    desc.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
    if (open) desc.textContent = describe(row);
  });

  // Truthful provenance line.
  const prov = el('span', { class: 'provenance', attrs: { role: 'note' } });
  const paintProv = () => {
    let current;
    try {
      current = row.get();
    } catch {
      current = null;
    }
    let isDefault = false;
    try {
      isDefault = String(current) === String(row.getDefault());
    } catch {
      isDefault = false;
    }
    const defText = safeDefault(row);
    prov.textContent = isDefault
      ? i18n.t('settings.provenance.default', { value: defText })
      : i18n.t('settings.provenance.custom');
  };

  main.append(desc, prov);
  const ctlCol = el('div', { class: 'setting-control' });
  const control = buildControl(row, bridge, paintProv);
  if (control) ctlCol.append(control, infoBtn);
  else ctlCol.append(infoBtn);

  wrap.append(main, ctlCol);
  paintProv();
  return wrap;
}

function describe(row) {
  const base = i18n.t(row.descKey);
  if (row.control === 'slider') return `${base} (${i18n.t('common.level')} ${row.min ?? ''}–${row.max ?? ''})`;
  return base;
}

function safeDefault(row) {
  try {
    return row.format ? row.format(row.getDefault()) : String(row.getDefault());
  } catch {
    return '—';
  }
}

function buildControl(row, bridge, repaintProvenance) {
  switch (row.control) {
    case 'switch': {
      const cb = el('input', { attrs: { type: 'checkbox' } });
      cb.checked = !!row.get();
      cb.id = row.id + '-ctl';
      cb.addEventListener('change', () => {
        row.set(cb.checked);
        repaintProvenance();
        bridge.afterSettingChange(row);
      });
      return el('label', { class: 'switch', attrs: { for: cb.id }, children: [cb] });
    }
    case 'select': {
      const sel = el('select', { class: 'select', style: 'width:auto;min-width:160px', attrs: { id: row.id + '-ctl' } });
      for (const [v, key] of row.options) {
        sel.append(el('option', { attrs: { value: v }, children: [key.startsWith('tabs.') || key.startsWith('theme.') || key.startsWith('common.') ? i18n.t(key) : key] }));
      }
      sel.value = String(row.get());
      sel.addEventListener('change', () => {
        row.set(sel.value);
        repaintProvenance();
        bridge.afterSettingChange(row);
      });
      return sel;
    }
    case 'slider': {
      const rng = el('input', { class: 'slider', attrs: { type: 'range', min: String(row.min), max: String(row.max), step: String(row.step), id: row.id + '-ctl' }, style: 'width:min(240px,60vw)' });
      rng.value = String(row.get());
      const out = el('output', { class: 'body-small', children: [String(row.get())] });
      const paintFill = () => {
        const pct = ((Number(rng.value) - row.min) / (row.max - row.min)) * 100;
        rng.style.setProperty('--ccr-slider-fill', pct + '%');
        out.textContent = row.format ? row.format(Number(rng.value)) : rng.value;
      };
      paintFill();
      rng.addEventListener('input', () => {
        row.set(Number(rng.value));
        paintFill();
        repaintProvenance();
        bridge.afterSettingChange(row);
      });
      const box = el('span', { class: 'swatch-row', children: [rng, out] });
      if (row.labels) {
        const minL = el('span', { class: 'body-small', children: [i18n.t(row.labels.minKey)] });
        const maxL = el('span', { class: 'body-small', children: [i18n.t(row.labels.maxKey)] });
        box.prepend(minL);
        box.append(maxL);
      }
      return box;
    }
    case 'action': {
      const b = el('button', { class: ['btn', row.danger ? 'btn--danger' : 'btn--tonal'], type: 'button', children: [i18n.t(row.actionLabelKey)] });
      b.addEventListener('click', async () => {
        await row.run();
        repaintProvenance();
      });
      return b;
    }
    case 'file': {
      const input = el('input', { class: 'input', attrs: { type: 'file', accept: row.accept || 'application/json' } });
      input.style.maxWidth = '260px';
      input.setAttribute('aria-label', i18n.t(row.labelKey));
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (f) await row.run(f);
        repaintProvenance();
      });
      return input;
    }
    case 'static':
      return el('code', { class: 'chip', children: [String(row.get())] });
    default:
      return null;
  }
}

/* ------------------------------ coverage guard ------------------------------ */

/**
 * Both-direction guard against the hand-written inventory:
 * - every registered id renders exactly once;
 * - no rendered settings row exists that the inventory does not name.
 * Failures are visible (banner + console), never silent.
 */
export function runCoverageGuard(bridge) {
  const problems = [];
  const seen = new Map();
  for (const node of document.querySelectorAll('[data-setting-id]')) {
    const id = node.getAttribute('data-setting-id');
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  for (const r of bridge.registry) {
    const n = seen.get(r.id) || 0;
    if (n !== 1) problems.push(`registered but rendered ${n}x: ${r.id}`);
    seen.delete(r.id);
  }
  for (const leftover of seen.keys()) problems.push(`rendered but NOT in hand-written inventory: ${leftover}`);
  const banner = document.getElementById('coverage-warn');
  if (problems.length) {
    console.warn('[ccr-site][coverage]', problems.join('\n'));
    if (banner) {
      banner.textContent = i18n.t('settings.coverage.warn');
      banner.hidden = false;
    }
  } else if (banner) {
    banner.hidden = true;
  }
  return problems;
}
