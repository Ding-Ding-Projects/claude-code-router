/** Small DOM helpers shared by every module. Pure functions — safe to import in Node. */

/**
 * Create an element. `attrs.class` may be a string or array.
 * @param {string} tag
 * @param {{class?: string|string[], attrs?: Record<string,string|boolean>, children?: (Node|string|null|undefined)[]}} [opts]
 */
export function el(tag, opts = {}) {
  const node = document.createElement(tag);
  const cls = opts.class;
  if (cls) {
    for (const c of Array.isArray(cls) ? cls : String(cls).split(/\s+/)) {
      if (c) node.classList.add(c);
    }
  }
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === false || v == null) continue;
      if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  if (opts.children) {
    for (const child of opts.children) append(node, child);
  }
  return node;
}

/** Append a child, coercing strings to text nodes and skipping nullish values. */
export function append(parent, child) {
  if (child == null || child === false) return parent;
  parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** Debounce a function. */
export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/**
 * Position an absolutely-positioned popover near an anchor, keeping it inside
 * the viewport and never covering its anchor when space allows. Returns the
 * applied rect.
 */
export function positionPopover(pop, anchor, { margin = 8 } = {}) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  pop.style.left = '0px';
  pop.style.top = '0px';
  pop.style.visibility = 'hidden';
  pop.style.display = '';
  const rect = pop.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  let left = a.left;
  let top = a.bottom + margin;
  if (top + rect.height > vh - margin) {
    // Try above; if it fits better above than below, flip.
    const above = a.top - rect.height - margin;
    top = above > margin ? Math.max(margin, above) : Math.max(margin, vh - rect.height - margin);
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - rect.width - margin));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.visibility = '';
  return { left, top, width: rect.width, height: rect.height };
}

/** WCAG contrast ratio between two CSS colors via computed rgb parsing. */
export function parseRgb(cssColor) {
  const m = cssColor.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

export function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
