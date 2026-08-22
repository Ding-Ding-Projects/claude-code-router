/**
 * Search component + anchored full regex builder.
 *
 * Every search surface on the site uses attachSearchField(): a plain-text
 * default query with an adjacent anchored builder button that opens the full
 * builder popover (pattern, flags, sample text, live match count). Query,
 * pattern, flags, validation and mode stay bidirectionally synchronised:
 * - Plain mode: the field's value is the literal query.
 * - Regex mode: the field's value is the pattern; the builder edits it live.
 *
 * Engine: JavaScript RegExp (ECMAScript) — stated honestly in the builder.
 */
import * as store from './store.js';
import { el, append, clear, positionPopover } from './util.js';
import * as i18n from './i18n.js';

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile a field state into a matcher. Returns {re?, error?, count(text)}. */
export function compile(state) {
  if (!state || !state.query) return { empty: true, test: () => true };
  if (state.mode !== 'regex') {
    const needle = state.caseSensitive ? state.query : state.query.toLowerCase();
    return {
      empty: false,
      error: null,
      test: (text) => (state.caseSensitive ? String(text) : String(text).toLowerCase()).includes(needle),
    };
  }
  let flags = '';
  if (state.flags.includes('i')) flags += 'i';
  try {
    const re = new RegExp(state.query, flags);
    return {
      empty: false,
      error: null,
      re,
      test: (text) => re.test(String(text)),
    };
  } catch (err) {
    return { empty: false, error: err && err.message ? err.message : 'invalid', test: () => false };
  }
}

/** Count non-overlapping matches of a compiled state against text. */
export function countMatches(compiled, text) {
  if (!compiled || compiled.empty || !compiled.re) return compiled && compiled.test(String(text)) ? 1 : 0;
  const re = new RegExp(compiled.re.source, compiled.re.flags.includes('g') ? compiled.re.flags : compiled.re.flags + 'g');
  let n = 0;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    n++;
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    if (n > 9999) break; // bounded evaluation
  }
  return n;
}

/**
 * Upgrade an <input class="search-input"> into a full search field with its
 * own anchored builder. Options: {id, onChange(state), caseToggle?, storage?}
 */
export function attachSearchField(input, opts = {}) {
  const id = opts.id || input.id || 'search';
  const wrap = el('span', { class: 'search-field' });
  input.parentNode.insertBefore(wrap, input);
  wrap.append(input);

  const state = Object.assign(
    { query: input.value || '', mode: 'plain', flags: [], caseSensitive: false },
    opts.storage ? store.get(`search.${id}`, {}) : {},
  );
  if (state.mode !== 'regex') state.mode = 'plain';

  function persist() {
    if (opts.storage) store.set(`search.${id}`, state);
  }

  const builderBtn = el('button', {
    class: 'builder-btn',
    type: 'button',
    attrs: { title: i18n.t('search.builder.open'), 'aria-label': i18n.t('search.builder.open'), 'aria-expanded': 'false' },
    children: ['.*'],
  });
  wrap.append(builderBtn);

  let popover = null;

  function emit() {
    persist();
    if (opts.onChange) opts.onChange({ ...state });
  }

  input.addEventListener('input', () => {
    state.query = input.value;
    emit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Escape first clears, then closes/clears focus back to the surface.
      if (input.value) {
        input.value = '';
        state.query = '';
        emit();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  function syncFromState() {
    if (document.activeElement !== input) input.value = state.query;
    builderBtn.style.color = state.error ? 'var(--md-sys-color-error)' : state.mode === 'regex' ? '' : 'var(--md-sys-color-outline)';
  }

  function openBuilder() {
    closeBuilder();
    popover = buildPopover();
    document.body.appendChild(popover);
    positionPopover(popover, wrap);
    builderBtn.setAttribute('aria-expanded', 'true');
    const patInput = popover.querySelector('[data-role=pattern]');
    patInput.focus();
    patInput.select();
    popover.addEventListener('ccr-close', () => {
      builderBtn.setAttribute('aria-expanded', 'false');
    });
  }

  function closeBuilder() {
    if (popover) {
      popover.dispatchEvent(new CustomEvent('ccr-close'));
      popover.remove();
      popover = null;
      builderBtn.focus();
    }
  }

  function buildPopover() {
    const pop = el('div', { class: 'color-pop menu', attrs: { role: 'dialog', 'aria-label': i18n.t('builder.title') } });

    const titleRow = el('div', { class: '', children: [el('strong', { children: [i18n.t('builder.title')] })] });
    pop.append(titleRow);

    // Mode toggle
    const modeSel = el('select', { class: 'select', attrs: { 'aria-label': i18n.t('search.mode.plain') } });
    for (const [v, key] of [['plain', 'search.mode.plain'], ['regex', 'search.mode.regex']]) {
      const o = el('option', { attrs: { value: v }, children: [i18n.t(key)] });
      modeSel.append(o);
    }
    modeSel.value = state.mode;
    modeSel.addEventListener('change', () => {
      state.mode = modeSel.value;
      if (state.mode === 'regex') state.flags = state.flags.length ? state.flags : ['i'];
      else state.flags = [];
      syncPatternToField();
      render();
      emit();
    });

    // Pattern
    const patInput = el('input', { class: 'input', attrs: { 'data-role': 'pattern', spellcheck: 'false' } });
    patInput.value = state.query;
    patInput.addEventListener('input', () => {
      state.query = patInput.value;
      input.value = state.query;
      render();
      emit();
    });

    // Flags (only meaningful in regex mode)
    const flagBox = el('div', { attrs: { 'data-role': 'flags' } });
    for (const f of ['g', 'i', 'm', 's', 'u']) {
      const cbId = `flag-${id}-${f}`;
      const lab = el('label', { class: 'switch', attrs: { for: cbId } });
      const cb = el('input', { attrs: { type: 'checkbox', id: cbId } });
      cb.checked = state.flags.includes(f);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!state.flags.includes(f)) state.flags.push(f);
        } else state.flags = state.flags.filter((x) => x !== f);
        render();
        emit();
      });
      lab.append(cb, document.createTextNode(' /' + f + '/'));
      flagBox.append(lab);
    }

    // Insert tokens
    const tokenRow = el('div', { class: 'swatch-row', attrs: { 'data-role': 'tokens' } });
    for (const tok of ['\\d', '\\w', '\\s', '.', '+', '*', '?', '[abc]', '(…)', '^', '$']) {
      const b = el('button', {
        class: 'chip',
        type: 'button',
        attrs: { 'aria-label': `${i18n.t('builder.insert')}: ${tok}` },
        children: [tok],
      });
      b.addEventListener('click', () => {
        const s = patInput.selectionStart ?? patInput.value.length;
        patInput.value = patInput.value.slice(0, s) + tok + patInput.value.slice(patInput.selectionEnd ?? s);
        patInput.dispatchEvent(new Event('input'));
        patInput.focus();
        patInput.setSelectionRange(s + tok.length, s + tok.length);
      });
      tokenRow.append(b);
    }

    // Sample + match count
    const sample = el('textarea', { class: 'input', attrs: { rows: '2', 'aria-label': i18n.t('builder.sample') } });
    sample.value = store.get(`search.${id}.sample`, '');
    const countLine = el('div', { class: 'body-small', attrs: { role: 'status' } });

    function render() {
      modeSel.setAttribute('aria-label', state.mode === 'regex' ? i18n.t('search.mode.regex') : i18n.t('search.mode.plain'));
      flagBox.hidden = state.mode !== 'regex';
      tokenRow.hidden = state.mode !== 'regex';
      const c = compile({ ...state, sample: undefined });
      const target = sample.value;
      if (c.empty) {
        countLine.textContent = i18n.t('results.count', { n: 0 });
        countLine.style.color = '';
      } else if (c.error) {
        countLine.textContent = i18n.t('builder.invalid', { err: c.error });
        countLine.style.color = 'var(--md-sys-color-error)';
      } else {
        const n = countMatches(c, target);
        countLine.textContent = i18n.t('builder.matches', { n });
        countLine.style.color = '';
      }
      syncFromState();
    }

    sample.addEventListener('input', () => {
      store.set(`search.${id}.sample`, sample.value.slice(0, 400));
      render();
    });

    const engineNote = el('p', { class: 'body-small', children: [i18n.t('builder.engine')] });

    pop.append(
      el('div', { class: 'field', children: [el('label', { children: [i18n.t('search.mode.plain')] }), modeSel] }),
      el('div', { class: 'field', children: [el('label', { children: [i18n.t('builder.pattern')] }), patInput] }),
      flagBox,
      tokenRow,
      el('div', { class: 'field', children: [el('label', { children: [i18n.t('builder.sample')] }), sample] }),
      countLine,
      engineNote,
      (() => {
        const row = el('div', { class: 'dialog-actions' });
        const closeBtn = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('common.close')] });
        closeBtn.addEventListener('click', closeBuilder);
        row.append(closeBtn);
        return row;
      })(),
    );

    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeBuilder();
      }
    });

    render();
    return pop;
  }

  builderBtn.addEventListener('click', () => (popover ? closeBuilder() : openBuilder()));

  /** Programmatic API used by tests/palette teleport. */
  wrap.ccrSearch = {
    getState: () => ({ ...state }),
    setState(next) {
      Object.assign(state, next);
      syncPatternToField();
      emit();
    },
    openBuilder,
    closeBuilder,
    compile: () => compile(state),
  };

  function syncPatternToField() {
    input.value = state.query;
    syncFromState();
  }

  return wrap;
}

/** Convenience: run a state against a list of items via selector fn. */
export function filterItems(items, getText, state) {
  const c = compile(state);
  if (c.empty) return items.slice();
  return items.filter((it) => c.test(getText(it)));
}
