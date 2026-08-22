/**
 * Infinite colour picker + bidirectional colour translator.
 *
 * Continuous 2D saturation/value field + hue rail (never a finite
 * swatch-only chooser). Numeric entry in HEX, RGB, HSL, HSV, HWB, CMYK, LAB
 * (D65) and OKLCH with live preview, copyable values, and a WCAG contrast
 * readout against the page background.
 *
 * Animated rainbow is ONE of the choices here, stored as the sentinel marker
 * string '@@rainbow@@' — never as a colour value, and it NEVER joins the
 * swatch palette (a sentinel inside a palette array would silently produce
 * `rainbow33`-style garbage where call sites append alpha). The animation is
 * stylesheet-driven (see tokens.css / m3.css): no JS timer repaints anything,
 * ONE duration is published globally so every rainbow turns together, speed
 * is stored as a LEVEL (documented mapping below), and reduced motion
 * settles on ONE fixed hue rather than merely slowing down.
 */
import { el, append, clear, positionPopover, parseRgb, contrastRatio } from './util.js';
import * as store from './store.js';
import * as i18n from './i18n.js';

export const RAINBOW = '@@rainbow@@';
export const isRainbow = (v) => typeof v === 'string' && v === RAINBOW;

/** Level 1..10 -> seconds per full cycle. Documented once, read everywhere. */
export function rainbowDurationSec(level) {
  const n = Math.min(10, Math.max(1, Math.round(Number(level) || 3)));
  return 66 - 6 * n; // L1=60s .. L10=6s
}
export function rainbowLevelFromDuration(sec) {
  return Math.min(10, Math.max(1, Math.round((66 - sec) / 6)));
}

/** Publish the global duration + reduced-motion settlement once, app-wide. */
export function publishRainbowGlobals() {
  const root = document.documentElement;
  const level = store.get('appearance.rainbowSpeed', 4);
  root.style.setProperty('--ccr-rainbow-duration', `${rainbowDurationSec(level)}s`);
}

/* ------------------------------- conversions ------------------------------- */

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    ...(h.length === 8 ? { a: parseInt(h.slice(6, 8), 16) / 255 } : {}),
  };
}
const byte = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
export function rgbToHex({ r, g, b }) {
  return '#' + byte(r) + byte(g) + byte(b);
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
export function hslToRgb({ h, s, l }) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

export function rgbToHsv({ r, g, b }) {
  const hsl = rgbToHsl({ r, g, b });
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  return { h: hsl.h, s: max === 0 ? 0 : (max - min) / max * 100, v: max * 100 };
}
export function hsvToRgb({ h, s, v }) {
  s /= 100; v /= 100;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
}

export function rgbToHwb({ r, g, b }) {
  const hsv = rgbToHsv({ r, g, b });
  return { h: hsv.h, w: (100 - hsv.s) * (hsv.v / 100), b: 100 - hsv.v };
}
export function hwbToRgb({ h, w, b }) {
  // Normalise so w+b <= 100 like CSS does.
  let W = w, B = b;
  if (W + B >= 100) { W = (W / (W + B)) * 100; B = (B / (W + B)) * 100; }
  const rgb = hsvToRgb({ h, s: 100, v: 100 });
  const mix = (c) => (c / 255) * (1 - W / 100 - B / 100) + W / 100;
  return { r: mix(rgb.r) * 255, g: mix(rgb.g) * 255, b: mix(rgb.b) * 255 };
}

export function rgbToCmyk({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - R - k) / (1 - k)) * 100,
    m: ((1 - G - k) / (1 - k)) * 100,
    y: ((1 - B - k) / (1 - k)) * 100,
    k: k * 100,
  };
}
export function cmykToRgb({ c, m, y, k }) {
  const K = k / 100;
  return {
    r: 255 * (1 - c / 100) * (1 - K),
    g: 255 * (1 - m / 100) * (1 - K),
    b: 255 * (1 - y / 100) * (1 - K),
  };
}

/* sRGB <-> linear */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}

/* OKLab / OKLCH */
export function rgbToOklab({ r, g, b }) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b2: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
export function oklabToRgb({ L, a, b: b2 }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b2;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b2;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b2;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return {
    r: linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}
export function rgbToOkLch(rgb) {
  const { L, a, b: b2 } = rgbToOklab(rgb);
  const C = Math.hypot(a, b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: L * 100, C, H };
}
export function oklchToRgb({ L, C, H }) {
  const rad = (H * Math.PI) / 180;
  return oklabToRgb({ L: L / 100, a: C * Math.cos(rad), b: C * Math.sin(rad) });
}

/* LAB (D65) */
export function rgbToLab({ r, g, b }) {
  const f = srgbToLinear;
  const R = f(r), G = f(g), B = f(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = g2(X), fy = g2(Y), fz = g2(Z);
  return { L: 116 * fy - 16, A: 500 * (fx - fy), B: 200 * (fy - fz) };
}
export function labToRgb({ L, A, B }) {
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const g = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = g(fx) * 0.95047, Y = g(fy), Z = g(fz) * 1.08883;
  const lin = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
  return { r: linearToSrgb(lin[0]), g: linearToSrgb(lin[1]), b: linearToSrgb(lin[2]) };
}

export function formatAll(rgb) {
  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const hwb = rgbToHwb(rgb);
  const cmyk = rgbToCmyk(rgb);
  const lab = rgbToLab(rgb);
  const ok = rgbToOkLch(rgb);
  const r = Math.round, f = (n) => String(Math.round(n * 10) / 10);
  return {
    HEX: hex,
    RGB: `${r(rgb.r)}, ${r(rgb.g)}, ${r(rgb.b)}`,
    HSL: `${f(hsl.h)}, ${f(hsl.s)}%, ${f(hsl.l)}%`,
    HSV: `${f(hsv.h)}, ${f(hsv.s)}%, ${f(hsv.v)}%`,
    HWB: `${f(hwb.h)}, ${f(hwb.w)}%, ${f(hwb.b)}%`,
    CMYK: `${f(cmyk.c)}%, ${f(cmyk.m)}%, ${f(cmyk.y)}%, ${f(cmyk.k)}%`,
    LAB: `${f(lab.L)}, ${f(lab.A)}, ${f(lab.B)}`,
    OKLCH: `${f(ok.L)}%, ${f(ok.C)}, ${f(ok.H)}`,
  };
}

/** Parse any single-format input back to rgb, best effort. Returns null if unparseable. */
export function parseAny(format, text) {
  const nums = String(text).split(/[\s,/]+/).filter(Boolean).map(Number);
  try {
    switch (format) {
      case 'HEX': return hexToRgb(text);
      case 'RGB': if (nums.length >= 3) return { r: nums[0], g: nums[1], b: nums[2] }; return null;
      case 'HSL': if (nums.length >= 3) return hslToRgb({ h: nums[0], s: nums[1], l: nums[2] }); return null;
      case 'HSV': if (nums.length >= 3) return hsvToRgb({ h: nums[0], s: nums[1], v: nums[2] }); return null;
      case 'HWB': if (nums.length >= 3) return hwbToRgb({ h: nums[0], w: nums[1], b: nums[2] }); return null;
      case 'CMYK': if (nums.length >= 4) return cmykToRgb({ c: nums[0], m: nums[1], y: nums[2], k: nums[3] }); return null;
      case 'LAB': if (nums.length >= 3) return clampGamut(labToRgb({ L: nums[0], A: nums[1], B: nums[2] })); return null;
      case 'OKLCH': if (nums.length >= 3) return clampGamut(oklchToRgb({ L: nums[0], C: nums[1], H: nums[2] })); return null;
      default: return null;
    }
  } catch {
    return null;
  }
}

/** Clamp out-of-gamut conversions into sRGB honestly (used by LAB/OKLCH). */
export function clampGamut(rgb) {
  return { r: Math.min(255, Math.max(0, rgb.r)), g: Math.min(255, Math.max(0, rgb.g)), b: Math.min(255, Math.max(0, rgb.b)) };
}

/* ------------------------------ picker popover ------------------------------ */

/**
 * Open the infinite colour picker near an anchor.
 * @param {{value?: string, opener?: HTMLElement|null, onPick:(value:string)=>void}} opts
 *   `value` may be a hex OR the rainbow sentinel.
 */
export function pickColor(opts = {}) {
  const pop = el('div', { class: ['color-pop'], attrs: { role: 'dialog', 'aria-label': i18n.t('color.pick') } });
  document.body.appendChild(pop);

  let current = opts.value && !isRainbow(opts.value) ? hexToRgb(opts.value) || { r: 0, g: 107, b: 99 } : { r: 0, g: 107, b: 99 };
  let rainbowMode = isRainbow(opts.value);

  // Canvas: continuous saturation/value field for the active hue.
  const canvas = el('canvas', { class: 'color-canvas', attrs: { width: '280', height: '140', role: 'application', 'aria-label': i18n.t('color.pick') } });
  const hue = el('input', { class: 'color-hue', attrs: { type: 'range', min: '0', max: '360', step: '1', 'aria-label': 'hue' } });

  const preview = el('div', { class: 'color-preview', attrs: { role: 'img', 'aria-label': 'preview' } });
  const contrast = el('div', { class: 'contrast-readout', attrs: { role: 'status' } });

  // Formats grid
  const fmtInputs = {};
  const formatsGrid = el('div', { class: 'color-formats' });
  for (const fmt of ['HEX', 'RGB', 'HSL', 'HSV', 'HWB', 'CMYK', 'LAB', 'OKLCH']) {
    append(formatsGrid, el('span', { class: 'fmt-label', children: [fmt] }));
    const inp = el('input', { class: 'input', attrs: { 'data-fmt': fmt, spellcheck: 'false', 'aria-label': fmt } });
    inp.addEventListener('change', () => {
      const rgb = parseAny(fmt, inp.value);
      if (rgb) {
        current = rgb;
        sync();
        emit();
      } else {
        inp.setAttribute('aria-invalid', 'true');
        setTimeout(() => inp.removeAttribute('aria-invalid'), 900);
        sync(); // restore truthful values
      }
    });
    fmtInputs[fmt] = inp;
    append(formatsGrid, inp);
  }

  // Rainbow choice + speed-as-level (never part of the swatch palette).
  const rainbowCb = el('input', { attrs: { type: 'checkbox', id: 'rainbow-opt-' + Math.random().toString(36).slice(2, 6) } });
  const rainbowRow = el('label', { class: ['switch', 'rainbow-option'], attrs: { for: rainbowCb.id }, children: [rainbowCb, document.createTextNode(i18n.t('color.rainbow'))] });
  const speedLabel = el('label', { class: 'body-small' });
  const speed = el('input', { class: 'slider', attrs: { type: 'range', min: '1', max: '10', step: '1' } });
  speed.value = String(store.get('appearance.rainbowSpeed', 4));
  const durationNote = el('div', { class: 'body-small', attrs: { role: 'status' } });
  function refreshSpeedCopy() {
    const lvl = Number(speed.value);
    speedLabel.textContent = i18n.t('color.rainbow.speed', { n: lvl });
    durationNote.textContent = i18n.t('color.rainbow.durationNote', { s: rainbowDurationSec(lvl) });
  }
  speed.addEventListener('input', () => {
    store.set('appearance.rainbowSpeed', Number(speed.value));
    publishRainbowGlobals();
    refreshSpeedCopy();
    emit(); // rainbow surfaces restyle instantly via the global duration
  });
  rainbowCb.addEventListener('change', () => {
    rainbowMode = rainbowCb.checked;
    [canvas, hue, ...Object.values(fmtInputs)].forEach((n) => (n.disabled = rainbowCb.checked));
    emit();
  });

  // Swatches: shipped M3 roles + recent colours. The rainbow sentinel is
  // deliberately NOT here — it has its own dedicated checkbox above.
  const swatchRow = el('div', { class: 'swatch-row' });
  const presets = ['#006b63', '#7ed6cc', '#386281', '#b52521', '#65558f', '#181c1c', '#dee4e3'];
  for (const p of presets) {
    const b = el('button', { class: 'swatch', type: 'button', attrs: { title: p, 'aria-label': p } });
    b.style.background = p;
    b.addEventListener('click', () => {
      current = hexToRgb(p);
      rainbowMode = false;
      rainbowCb.checked = false;
      sync();
      emit();
    });
    swatchRow.append(b);
  }

  function drawField() {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    const base = hsvToRgb({ h: Number(hue.value), s: 100, v: 100 });
    const gradX = ctx.createLinearGradient(0, 0, w, 0);
    gradX.addColorStop(0, '#fff');
    gradX.addColorStop(1, rgbToHex(clampGamut(base)));
    ctx.fillStyle = gradX;
    ctx.fillRect(0, 0, w, h);
    const gradY = ctx.createLinearGradient(0, 0, 0, h);
    gradY.addColorStop(0, 'rgba(0,0,0,0)');
    gradY.addColorStop(1, '#000');
    ctx.fillStyle = gradY;
    ctx.fillRect(0, 0, w, h);
  }

  function sync() {
    drawField();
    const hex = rgbToHex(current);
    if (rainbowMode) {
      preview.style.background = '';
      preview.classList.add('rainbow-bg');
    } else {
      preview.classList.remove('rainbow-bg');
      preview.style.background = hex;
    }
    const all = formatAll(current);
    for (const [fmt, inp] of Object.entries(fmtInputs)) {
      if (document.activeElement !== inp) inp.value = all[fmt];
    }
    hue.value = String(Math.round(rgbToHsl(current).h));
    const bg = getComputedStyle(document.body).backgroundColor;
    const bgRgb = parseRgb(bg) || { r: 245, g: 250, b: 250 };
    const ratio = contrastRatio(current, bgRgb);
    contrast.textContent = i18n.t('contrast.vs', { ratio: String(Math.round(ratio * 100) / 100) });
    contrast.style.color = ratio >= 3 ? '' : 'var(--md-sys-color-error)';
    refreshSpeedCopy();
  }

  function emit() {
    if (opts.onPick) opts.onPick(rainbowMode ? RAINBOW : rgbToHex(current));
  }

  function pickFromCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left)) / rect.width;
    const y = Math.min(rect.height, Math.max(0, e.clientY - rect.top)) / rect.height;
    const rgb = hsvToRgb({ h: Number(hue.value), s: x * 100, v: (1 - y) * 100 });
    current = clampGamut(rgb);
    rainbowMode = false;
    rainbowCb.checked = false;
    sync();
    emit();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture?.(e.pointerId);
    pickFromCanvas(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && pickFromCanvas(e));
  canvas.addEventListener('pointerup', () => (dragging = false));
  hue.addEventListener('input', () => {
    drawField();
    pickFromCanvasSilent();
    emit();
  });
  function pickFromCanvasSilent() {
    // Re-express current colour under the new hue, keeping s/v.
    const hsv = rgbToHsv(current);
    current = clampGamut(hsvToRgb({ h: Number(hue.value), s: hsv.s, v: hsv.v }));
    sync();
  }

  const closeBtn = el('button', { class: 'btn btn--text', type: 'button', children: [i18n.t('common.close')] });
  closeBtn.addEventListener('click', close);
  const actions = el('div', { class: 'dialog-actions', children: [closeBtn] });

  pop.append(
    preview,
    contrast,
    swatchRow,
    canvas,
    el('div', { children: [el('span', { class: 'sr-only', children: ['hue'] }), hue] }),
    formatsGrid,
    rainbowRow,
    el('div', { class: 'field', children: [speedLabel, speed, durationNote] }),
    actions,
  );

  function close() {
    document.removeEventListener('pointerdown', outside, true);
    pop.remove();
    (opts.opener instanceof HTMLElement) && opts.opener.focus();
  }
  function outside(e) {
    if (!pop.contains(e.target)) close();
  }
  document.addEventListener('pointerdown', outside, true);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  positionPopover(pop, opts.opener instanceof Element ? opts.opener : document.body);
  rainbowCb.checked = rainbowMode;
  sync();
  return { close, setValue(v) { rainbowMode = isRainbow(v); rainbowCb.checked = rainbowMode; if (!rainbowMode) current = hexToRgb(v) || current; sync(); emit(); } };
}
