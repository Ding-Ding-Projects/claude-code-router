/**
 * Searchable menu / context-menu / dropdown primitive.
 *
 * Every menu and dropdown on this site opens with a keyboard-focusable filter
 * field at its head and its own anchored regex builder beside that field.
 * Filtering is local: it never reorders into a different meaning, never hides
 * a destructive item while its shortcut stays live, and never changes what an
 * item does. Keyboard-first: focus on open, arrows move, Enter activates,
 * Escape clears the filter first then closes, focus returns to the opener.
 *
 * Item shape:
 *   { id?, label|labelKey, shortcut?, disabled?, danger?, checked?,
 *     separatorBefore?, submenu?: Item[], onSelect(item) }
 */
import { el, append, clear, positionPopover } from './util.js';
import * as i18n from './i18n.js';
import { attachSearchField, compile } from './search.js';

let openMenus = [];

export function closeAllMenus() {
  for (const m of [...openMenus]) m.close(false);
}

/**
 * Open a menu anchored to an element or a point ({x,y}).
 * @returns {{close:(restoreFocus?:boolean)=>void, el:HTMLElement}}
 */
export function openMenu({ anchor, point, items, onSelect, label = 'Menu', minWidth = 220 }) {
  closeAllMenus();
  const pop = el('div', { class: 'menu', attrs: { role: 'menu', 'aria-label': i18n.t(label) || label } });
  if (minWidth) pop.style.minWidth = `${minWidth}px`;

  const searchWrap = el('div', { class: 'menu-search' });
  const searchInput = el('input', {
    class: 'input',
    attrs: {
      type: 'text',
      role: 'searchbox',
      placeholder: i18n.t('menu.filter'),
      'aria-label': i18n.t('menu.filter'),
    },
  });
  attachSearchField(searchInput, { id: `menu-${Math.random().toString(36).slice(2, 8)}`, storage: false });
  append(searchWrap, searchInput);
  pop.append(searchWrap);

  const list = el('div', { attrs: { role: 'presentation' } });
  pop.append(list);

  const countLine = el('div', { class: 'body-small sr-only', attrs: { role: 'status' } });
  pop.append(countLine);

  let active = -1;
  let visible = [];

  function flatItems(list_) {
    const out = [];
    for (const it of list_ || []) {
      if (it.separatorBefore) out.push({ separator: true });
      if (it.submenu) {
        out.push({ ...it, __hasSub: true });
        out.push(...flatItems(it.submenu).map((s) => ({ ...s, __parentLabel: it.label ?? it.labelKey })));
      } else if (!it.__parentLabel) {
        out.push(it);
      }
    }
    return out;
  }

  const all = flatItems(items);

  function render() {
    clear(list);
    const c = compile({ query: searchInput.value, mode: 'plain' });
    visible = [];
    let shown = 0;
    for (const it of all) {
      if (it.separator) continue;
      const labelText = it.labelKey ? i18n.t(it.labelKey) : it.label ?? '';
      if (!c.empty && !c.test(labelText)) continue;
      shown++;
      const row = el('button', {
        class: ['list-item'],
        type: 'button',
        attrs: {
          role: 'menuitem',
          disabled: it.disabled ? true : null,
          'data-danger': it.danger ? 'true' : null,
        },
      });
      row.style.color = it.danger ? 'var(--md-sys-color-error)' : '';
      append(row, el('span', { children: [labelText] }));
      if (it.checked) append(row, el('span', { class: '', children: [' ✓'], attrs: { 'aria-hidden': 'true' } }));
      if (it.shortcut) append(row, el('kbd', { children: [it.shortcut] }));
      row.addEventListener('click', () => {
        if (it.disabled) return;
        close(true);
        if (it.onSelect) it.onSelect(it);
        else if (onSelect) onSelect(it);
      });
      list.append(row);
      visible.push(row);
    }
    if (!shown) {
      list.append(el('div', { class: 'empty-note', attrs: { role: 'status' }, children: [i18n.t('menu.noMatch')] }));
    }
    countLine.textContent = i18n.t('menu.results', { n: shown }) + ' · ' + (c.empty ? '' : '');
    active = -1;
  }

  function setActive(i) {
    active = Math.max(0, Math.min(visible.length - 1, i));
    for (let k = 0; k < visible.length; k++) {
      visible[k].classList.toggle('is-active', k === active);
      visible[k].setAttribute('aria-selected', k === active ? 'true' : 'false');
    }
    if (visible[active]) visible[active].scrollIntoView({ block: 'nearest' });
  }

  searchInput.addEventListener('input', render);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible[active]) visible[active].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (searchInput.value) {
        searchInput.value = '';
        render();
      } else close(true);
    }
  });

  function onDocPointer(e) {
    if (!pop.contains(e.target)) close(true);
  }
  function onDocKey(e) {
    if (e.key === 'Escape') {
      // handled at field level when filter has content; otherwise close
      if (!searchInput.value) close(true);
    }
  }

  const opener = anchor instanceof Element ? anchor : null;
  const api = {
    el: pop,
    close(restoreFocus = true) {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onDocKey, true);
      pop.remove();
      openMenus = openMenus.filter((m) => m !== api);
      if (restoreFocus && opener instanceof HTMLElement) opener.focus();
      if (restoreFocus && !opener && lastTrigger instanceof HTMLElement) lastTrigger.focus();
    },
  };
  let lastTrigger = document.activeElement;

  document.addEventListener('pointerdown', onDocPointer, true);
  document.addEventListener('keydown', onDocKey, true);

  document.body.appendChild(pop);
  // Position inside viewport; never cover the anchor control itself when there
  // is room beside/below it.
  if (anchor instanceof Element) positionPopover(pop, anchor);
  else if (point) {
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.style.visibility = 'hidden';
    const r = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    pop.style.left = `${Math.min(Math.max(4, point.x), Math.max(4, vw - r.width - 4))}px`;
    pop.style.top = `${Math.min(Math.max(4, point.y), Math.max(4, vh - r.height - 4))}px`;
    pop.style.visibility = '';
  } else {
    pop.style.left = '50%';
    pop.style.top = '20vh';
    pop.style.translate = '-50% 0';
  }

  render();
  searchInput.focus();
  openMenus.push(api);
  return api;
}

/** Wire an element to open a context menu on right-click AND keyboard. */
export function wireContextMenu(trigger, getItems, opts = {}) {
  trigger.addEventListener('contextmenu', (e) => {
    if (opts.allowNative && opts.allowNative(e)) return;
    e.preventDefault();
    openMenu({ point: { x: e.clientX, y: e.clientY }, items: getItems(e), ...opts });
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = trigger.getBoundingClientRect();
      openMenu({ anchor: trigger, items: getItems(e), ...opts });
      void r;
    }
  });
}
