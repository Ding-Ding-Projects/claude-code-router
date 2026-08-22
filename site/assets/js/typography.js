/**
 * Word-depth typography editor with live preview.
 *
 * Honest platform boundary, stated in-page: browsers cannot enumerate the
 * fonts installed on the operating system, so this editor offers a bundled
 * web-safe family list (each name rendered in its own face) instead of
 * pretending to detect installed fonts. Everything else is real: family,
 * size (stepper + free entry), weight, style, underline style/colour,
 * single/double strikethrough, overline, capitalization, small caps,
 * superscript/subscript baseline offset, highlight, outline, shadow, glow,
 * character and word spacing, line height, baseline offset, direction and
 * alignment.
 */
import { el, append } from './util.js';
import * as i18n from './i18n.js';
import { pickColor, isRainbow, RAINBOW } from './color.js';

/** Bundled web-safe families. `css` is the full stack applied at runtime. */
export const FAMILIES = [
  { name: 'System UI', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { name: 'Segoe UI', css: "'Segoe UI', system-ui, sans-serif" },
  { name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { name: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { name: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { name: 'Georgia', css: 'Georgia, serif' },
  { name: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { name: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
  { name: 'Trebuchet MS', css: "'Trebuchet MS', sans-serif" },
  { name: 'Courier New', css: "'Courier New', monospace" },
  { name: 'Consolas', css: 'Consolas, monospace' },
  { name: 'Microsoft JhengHei', css: "'Microsoft JhengHei', 'PingFang TC', sans-serif" },
  { name: 'Microsoft JhengHei UI', css: "'Microsoft JhengHei UI', 'Microsoft JhengHei', sans-serif" },
  { name: 'PingFang TC', css: "'PingFang TC', 'Microsoft JhengHei', sans-serif" },
  { name: 'Noto Sans', css: "'Noto Sans', system-ui, sans-serif" },
];

export function defaultValue() {
  return {
    family: null, // null = inherit shipped
    size: null,
    weight: null,
    italic: false,
    underline: false,
    underlineColor: '',
    strike: 'none', // none | single | double
    overline: false,
    caps: 'none', // none | uppercase | lowercase | capitalize
    smallCaps: false,
    baseline: 'normal', // normal | super | sub
    highlight: '',
    outlineWidth: 0,
    outlineColor: '#181c1c',
    shadow: false,
    glow: false,
    glowColor: '#7ed6cc',
    charSpacing: 0,
    wordSpacing: 0,
    lineHeight: null,
    direction: 'ltr',
    align: 'start',
  };
}

const CSS_FAMILIES = new Set(FAMILIES.map((f) => f.css));

/**
 * Map an override value onto inline styles for one element. Values that are
 * null/false stay untouched so shipped defaults show through.
 */
export function applyTo(target, v) {
  if (!target || !v) return;
  const s = target.style;
  if (v.family) {
    const fam = FAMILIES.find((f) => f.name === v.family) || FAMILIES[0];
    s.fontFamily = fam.css;
  }
  if (v.size != null) s.fontSize = `${v.size}px`;
  if (v.weight != null) s.fontWeight = String(v.weight);
  s.fontStyle = v.italic ? 'italic' : '';
  const lines = [];
  let decoStyle = '';
  let decoColor = '';
  if (v.underline) lines.push('underline');
  if (v.overline) lines.push('overline');
  if (v.strike === 'single') lines.push('line-through');
  if (v.strike === 'double') {
    lines.push('line-through');
    decoStyle = 'double';
  }
  if (lines.length) {
    s.textDecorationLine = lines.join(' ');
    if (decoStyle) s.textDecorationStyle = decoStyle;
    if (v.underlineColor && !isRainbow(v.underlineColor)) s.textDecorationColor = v.underlineColor;
    else if (isRainbow(v.underlineColor)) {
      target.classList.add('rainbow-text');
      s.textDecorationColor = '';
    }
  } else {
    s.textDecorationLine = '';
    s.textDecorationStyle = '';
  }
  s.textTransform = v.caps === 'none' ? '' : v.caps;
  s.fontVariantCaps = v.smallCaps ? 'small-caps' : '';
  s.verticalAlign = v.baseline === 'normal' ? '' : v.baseline;
  if (v.highlight) {
    if (isRainbow(v.highlight)) {
      s.backgroundColor = '';
      target.classList.add('rainbow-bg');
    } else {
      target.classList.remove('rainbow-bg');
      s.backgroundColor = v.highlight;
    }
  } else {
    s.backgroundColor = '';
  }
  s.webkitTextStrokeWidth = v.outlineWidth ? `${v.outlineWidth}px` : '';
  if (v.outlineWidth) {
    s.webkitTextStrokeColor = isRainbow(v.outlineColor) ? 'hsl(var(--rainbow-hue,174) 70% 42%)' : v.outlineColor;
    s.paintOrder = 'stroke fill';
  }
  const shadows = [];
  if (v.shadow) shadows.push('1px 2px 3px color-mix(in srgb, currentColor 45%, transparent)');
  if (v.glow) shadows.push(`0 0 8px ${isRainbow(v.glowColor) ? 'hsl(var(--rainbow-hue,174) 70% 55%)' : v.glowColor}`);
  s.textShadow = shadows.join(', ');
  s.letterSpacing = v.charSpacing ? `${v.charSpacing}px` : '';
  s.wordSpacing = v.wordSpacing ? `${v.wordSpacing}px` : '';
  if (v.lineHeight != null) s.lineHeight = String(v.lineHeight);
  s.direction = v.direction || '';
  s.textAlign = v.align === 'start' ? '' : v.align;
}

function row(labelText, control) {
  return el('div', { class: 'field', children: [el('label', { class: 'body-small', children: [labelText] }), control] });
}

function select(optsList, value, onChange) {
  const s = el('select', { class: 'select' });
  for (const [v, label] of optsList) {
    const o = el('option', { attrs: { value: v }, children: [label] });
    if (String(value) === String(v)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/**
 * Build the full editor.
 * @param {{value: object, onChange:(v:object)=>void}} opts
 */
export function buildEditor(opts) {
  const value = { ...defaultValue(), ...opts.value };
  const root = el('div', { class: 'appear-section', attrs: { role: 'group', 'aria-label': i18n.t('appear.tab.type') } });

  function update(patch) {
    Object.assign(value, patch);
    opts.onChange({ ...value });
    paintPreview();
  }

  // Family list — every name rendered in its own face; honest boundary note.
  const note = el('p', { class: 'body-small', children: [i18n.t('type.family.note')] });
  const famBtn = el('button', { class: 'btn btn--tonal', type: 'button', children: [value.family || '—'] });
  const famList = el('div', { class: ['font-face-list'], hidden: true, attrs: { role: 'listbox', 'aria-label': i18n.t('type.family') } });
  for (const f of FAMILIES) {
    const item = el('button', { class: 'list-item', type: 'button', attrs: { role: 'option' }, children: [] });
    item.style.fontFamily = f.css;
    append(item, el('span', { children: [f.name] }));
    item.addEventListener('click', () => {
      famList.hidden = true;
      famBtn.textContent = f.name;
      update({ family: f.name });
    });
    famList.append(item);
  }
  famBtn.addEventListener('click', () => {
    famList.hidden = !famList.hidden;
  });

  const sizeStepper = el('input', { class: 'input', attrs: { type: 'number', min: '9', max: '72', step: '1', style: 'width:90px' } });
  sizeStepper.value = value.size ?? '';
  sizeStepper.addEventListener('change', () => update({ size: sizeStepper.value === '' ? null : Number(sizeStepper.value) }));
  const sizeRange = el('input', { class: 'slider', attrs: { type: 'range', min: '9', max: '48', step: '1', 'aria-label': i18n.t('type.size') } });
  sizeRange.value = value.size ?? 16;
  sizeRange.addEventListener('input', () => {
    sizeStepper.value = sizeRange.value;
    update({ size: Number(sizeRange.value) });
  });

  root.append(
    note,
    row(i18n.t('type.family'), el('div', { children: [famBtn, famList] })),
    row(i18n.t('type.size'), el('div', { class: 'swatch-row', children: [sizeStepper, sizeRange] })),
    row(i18n.t('type.weight'), select([['', 'inherit'], ['300', '300 light'], ['400', '400 regular'], ['500', '500 medium'], ['600', '600 semibold'], ['700', '700 bold']], value.weight ?? '', (v) => update({ weight: v === '' ? null : Number(v) }))),
    row(i18n.t('type.style'), (() => {
      const cb = el('input', { attrs: { type: 'checkbox', id: 'ty-italic-' + Math.random().toString(36).slice(2, 6) } });
      cb.checked = !!value.italic;
      cb.addEventListener('change', () => update({ italic: cb.checked }));
      return el('label', { class: 'switch', attrs: { for: cb.id }, children: [cb, document.createTextNode('italic')] });
    })()),
    decorationsRow(),
    row(i18n.t('type.caps'), select([['none', '—'], ['uppercase', 'ABC'], ['lowercase', 'abc'], ['capitalize', 'Abc']], value.caps, (v) => update({ caps: v }))),
    toggleRow(i18n.t('type.smallCaps'), value.smallCaps, (on) => update({ smallCaps: on })),
    row(i18n.t('type.superSub'), select([['normal', '—'], ['super', 'x² super'], ['sub', 'x₂ sub']], value.baseline, (v) => update({ baseline: v }))),
    highlightRow(),
    outlineRow(),
    toggleRow(i18n.t('type.shadow'), value.shadow, (on) => update({ shadow: on })),
    glowRow(),
    numericRow(i18n.t('type.charSpacing'), value.charSpacing, (n) => update({ charSpacing: n }), -4, 12),
    numericRow(i18n.t('type.wordSpacing'), value.wordSpacing, (n) => update({ wordSpacing: n }), -6, 24),
    numericRow(i18n.t('type.lineHeight'), value.lineHeight ?? '', (n) => update({ lineHeight: n === '' ? null : n }), 1, 3, 0.05),
    row(i18n.t('type.direction'), select([['ltr', 'LTR →'], ['rtl', '← RTL']], value.direction, (v) => update({ direction: v }))),
    row(i18n.t('type.align'), select([['start', 'start'], ['center', 'center'], ['end', 'end'], ['justify', 'justify']], value.align, (v) => update({ align: v }))),
    previewBlock(),
  );
  return root;

  /* ---- sub-builders ---- */
  function toggleRow(label, checked, fn) {
    const cb = el('input', { attrs: { type: 'checkbox' } });
    cb.checked = !!checked;
    cb.addEventListener('change', () => fn(cb.checked));
    return row(label, el('label', { class: 'switch', children: [cb, document.createTextNode(cb.checked ? i18n.t('common.on') : i18n.t('common.off'))] }));
  }

  function numericRow(label, val, fn, min, max, step = 1) {
    const inp = el('input', { class: 'input', attrs: { type: 'number', min: String(min), max: String(max), step: String(step), style: 'width:110px' } });
    inp.value = val === null ? '' : String(val);
    inp.addEventListener('change', () => fn(inp.value === '' ? 0 : Number(inp.value)));
    return row(label, inp);
  }

  function decorationsRow() {
    const wrap = el('div', { class: 'swatch-row' });
    const mk = (label, key, kind) => {
      const cb = el('input', { attrs: { type: 'checkbox' } });
      cb.checked = key === 'strike' ? value.strike !== 'none' : !!value[key];
      cb.addEventListener('change', () => {
        if (key === 'underline') update({ underline: cb.checked });
        else if (key === 'overline') update({ overline: cb.checked });
        else update({ strike: cb.checked ? (kind === 'double' ? 'double' : 'single') : 'none' });
      });
      const lab = el('label', { class: 'switch', children: [cb, document.createTextNode(label)] });
      wrap.append(lab);
    };
    mk(i18n.t('type.underline'), 'underline');
    mk(i18n.t('type.overline'), 'overline');
    mk(i18n.t('type.strikeSingle'), 'strike', 'single');
    mk(i18n.t('type.strikeDouble'), 'strike', 'double');
    const colBtn = el('button', { class: 'chip', type: 'button', children: [i18n.t('color.pick')] });
    colBtn.addEventListener('click', (e) => {
      pickColor({ opener: e.currentTarget, value: value.underlineColor || undefined, onPick: (hex) => update({ underline: true, underlineColor: hex }) });
    });
    wrap.append(colBtn);
    return row(i18n.t('type.decoration'), wrap);
  }

  function highlightRow() {
    const btn = el('button', { class: 'chip', type: 'button', children: [i18n.t('type.highlight') + ': ' + (value.highlight || '—')] });
    btn.addEventListener('click', (e) =>
      pickColor({
        opener: e.currentTarget,
        value: value.highlight || undefined,
        onPick(hex) {
          value.highlight = hex;
          btn.textContent = i18n.t('type.highlight') + ': ' + (isRainbow(hex) ? '🌈' : hex);
          update({});
          // Rainbow reaches the preview via the .rainbow-* classes in applyTo.
        },
      }),
    );
    const clearBtn = el('button', { class: 'chip', type: 'button', children: ['✕'] });
    clearBtn.setAttribute('aria-label', 'clear highlight');
    clearBtn.addEventListener('click', () => {
      value.highlight = '';
      btn.textContent = i18n.t('type.highlight') + ': —';
      update({});
    });
    return row(i18n.t('type.highlight'), el('div', { class: 'swatch-row', children: [btn, clearBtn] }));
  }

  function outlineRow() {
    const range = el('input', { class: 'slider', attrs: { type: 'range', min: '0', max: '3', step: '0.25' } });
    range.value = value.outlineWidth || 0;
    range.style.maxWidth = '160px';
    range.addEventListener('input', () => update({ outlineWidth: Number(range.value) }));
    const colBtn = el('button', { class: 'chip', type: 'button', children: [i18n.t('color.pick')] });
    colBtn.addEventListener('click', (e) => pickColor({ opener: e.currentTarget, value: value.outlineColor, onPick: (hex) => update({ outlineColor: hex }) }));
    return row(i18n.t('type.outline'), el('div', { class: 'swatch-row', children: [range, colBtn] }));
  }

  function glowRow() {
    const cb = el('input', { attrs: { type: 'checkbox' } });
    cb.checked = !!value.glow;
    cb.addEventListener('change', () => update({ glow: cb.checked }));
    const colBtn = el('button', { class: 'chip', type: 'button', children: [i18n.t('color.pick')] });
    colBtn.addEventListener('click', (e) => pickColor({ opener: e.currentTarget, value: value.glowColor, onPick: (hex) => update({ glowColor: hex }) }));
    return row(i18n.t('type.glow'), el('div', { class: 'swatch-row', children: [el('label', { class: 'switch', children: [cb, document.createTextNode(i18n.t('common.on'))] }), colBtn] }));
  }

  function previewBlock() {
    const box = el('div', { class: 'font-sample', attrs: { role: 'img', 'aria-label': i18n.t('type.previewLabel') } });
    const label = el('span', { class: 'body-small', children: [i18n.t('type.previewLabel')] });
    const sample = el('div', {});
    box.append(sample);
    function paintPreview() {
      sample.textContent = 'Aa 瀏 123 — The quick brown fox jumps over the lazy dog.';
      applyTo(sample, value);
    }
    paintPreview();
    // keep label outside the styled sample
    const outer = el('div', { class: 'field', children: [label, box] });
    outer.dataset.ccrPreview = 'true';
    return outer;
  }
}
