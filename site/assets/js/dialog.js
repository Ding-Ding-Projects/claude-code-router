/**
 * Dialog helper on native <dialog>: focus is trapped by the platform, Escape
 * cancels, and focus returns to the opener on close. Every overlay paints its
 * own surface (.dialog-card) and is bounded by the viewport with internal
 * scrolling.
 */
import { el, append } from './util.js';
import * as i18n from './i18n.js';

/**
 * Open a dialog. Returns {dialog, body, close}.
 * @param {string} title
 * @param {{opener?: HTMLElement|null, wide?: boolean, onClose?: ()=>void}} [opts]
 */
export function openDialog(title, opts = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  const card = el('div', { class: ['dialog-card', opts.wide ? 'wide' : ''].filter(Boolean) });

  const head = el('div', { attrs: { role: 'heading', 'aria-level': '2' }, class: 'title-large', children: [title] });
  const body = el('div', { class: 'dialog-scroll', attrs: { tabindex: '-1' } });
  const actions = el('div', { class: 'dialog-actions' });

  const closeBtn = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('common.close')] });
  closeBtn.addEventListener('click', () => dlg.close());
  actions.append(closeBtn);

  card.append(head, body, actions);
  dlg.append(card);
  document.body.appendChild(dlg);

  let restoreTo = opts.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault(); // we close explicitly so Escape always means "cancel"
    dlg.close('cancel');
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (restoreTo instanceof HTMLElement) {
      try {
        restoreTo.focus();
      } catch {
        /* detached opener */
      }
    }
    opts.onClose?.();
  });

  dlg.showModal();
  body.focus();
  return { dialog: dlg, body, actions, close: () => dlg.close() };
}

/** Prompt for a line of text. Resolves null on cancel/Escape/close. */
export function promptDialog(title, initial = '') {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const { body, close } = openDialog(title, {
      onClose: () => finish(null),
    });
    const input = el('input', { class: 'input', attrs: { type: 'text', 'aria-label': i18n.t('common.name') } });
    input.value = initial;
    const row = el('div', { class: 'dialog-actions' });
    const cancel = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('common.cancel')] });
    const ok = el('button', { class: 'btn btn--filled', type: 'button', children: [i18n.t('common.ok')] });
    cancel.addEventListener('click', () => close());
    ok.addEventListener('click', () => {
      finish(input.value);
      close();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
    });
    row.append(cancel, ok);
    append(body, input, row);
    input.focus();
    input.select();
  });
}
