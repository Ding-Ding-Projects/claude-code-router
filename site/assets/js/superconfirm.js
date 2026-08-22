/**
 * Destructive-action super confirmation, native to this site's own UI layer.
 *
 * Two independently operated keys must complete before the full-range
 * confirmation slider unlocks: typing an exact phrase, and holding the second
 * control until it fills. A visible progress bar tracks the hold; completing
 * plays a distinct completion flash. An Emergency exit is present the whole
 * time, Escape cancels from anywhere inside, and focus returns to the opener.
 */
import { el, append } from './util.js';
import * as i18n from './i18n.js';
import { openDialog } from './dialog.js';

/**
 * @param {{title: string, body?: string, phrase?: string, confirmLabel?: string,
 *          opener?: HTMLElement|null}} opts
 * @returns {Promise<boolean>}
 */
export function superConfirm(opts) {
  const phrase = opts.phrase || 'DELETE';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
        close();
      }
    };

    const { body, close, actions, dialog } = openDialog(opts.title, { opener: opts.opener });
    dialog.querySelector('.dialog-card').classList.add('super-card');

    if (opts.body) body.append(el('p', { class: 'body-medium', children: [opts.body] }));

    let key1 = false;
    let key2 = false;

    // ---- Key 1: type the exact phrase -------------------------------------
    const k1Wrap = el('div', { class: 'field' });
    k1Wrap.append(el('label', { children: [i18n.t('super.key1', { phrase })] }));
    const k1Input = el('input', { class: 'input', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' } });
    k1Input.addEventListener('input', () => {
      key1 = k1Input.value === phrase;
      update();
    });
    k1Wrap.append(k1Input);
    body.append(k1Wrap);

    // ---- Key 2: hold until filled ------------------------------------------
    const HOLD_MS = 1200;
    const k2Btn = el('button', { class: 'btn btn--outlined', type: 'button', children: [i18n.t('super.key2')] });
    const prog = el('div', { class: 'super-progress', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': i18n.t('super.key2') }, children: [el('div')] });
    const progFill = prog.firstChild;
    let raf = null;
    let startTs = 0;

    function tick(ts) {
      const pct = Math.min(100, ((ts - startTs) / HOLD_MS) * 100);
      progFill.style.width = pct + '%';
      prog.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (pct >= 100) {
        key2 = true;
        k2Btn.textContent = i18n.t('common.on');
        update();
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function startHold(e) {
      e.preventDefault();
      if (key2) return;
      startTs = performance.now();
      k2Btn.textContent = i18n.t('super.key2.holding');
      raf = requestAnimationFrame(tick);
    }
    function endHold() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (!key2) {
        progFill.style.width = '0%';
        prog.setAttribute('aria-valuenow', '0');
        k2Btn.textContent = i18n.t('super.key2');
      }
    }
    k2Btn.addEventListener('pointerdown', startHold);
    k2Btn.addEventListener('pointerup', endHold);
    k2Btn.addEventListener('pointerleave', endHold);
    k2Btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') startHold(e);
    });
    k2Btn.addEventListener('keyup', endHold);
    const k2Wrap = el('div', { class: 'field', children: [el('span', { class: 'body-small', children: [i18n.t('super.key2')] }), k2Btn, prog] });
    body.append(k2Wrap);

    // ---- Slider -------------------------------------------------------------
    const slider = el('input', { class: 'slider', attrs: { type: 'range', min: '0', max: '100', value: '0', step: '5', 'aria-label': i18n.t('super.slider'), disabled: true } });
    const hint = el('div', { class: 'body-small', attrs: { role: 'status' }, children: [i18n.t('super.blocked')] });

    function update() {
      const ready = key1 && key2;
      slider.disabled = !ready;
      hint.textContent = ready ? '' : i18n.t('super.blocked');
    }

    slider.addEventListener('input', () => {
      // Fill visual follows the thumb via --ccr-slider-fill.
      slider.style.setProperty('--ccr-slider-fill', slider.value + '%');
      if (!slider.disabled && Number(slider.value) >= 100) {
        const card = dialog.querySelector('.dialog-card');
        card.classList.add('super-done');
        setTimeout(() => finish(true), 350);
      }
    });
    body.append(el('div', { class: 'field', children: [el('label', { children: [i18n.t('super.slider')] }), slider, hint] }));

    // ---- Actions: emergency exit always available ---------------------------
    const exit = el('button', { class: 'btn btn--danger', type: 'button', children: ['🛑 ' + i18n.t('super.exit')] });
    exit.addEventListener('click', () => finish(false));
    actions.prepend(exit);

    dialog.addEventListener('cancel', () => finish(false), { once: true });

    k1Input.focus();
  });
}
