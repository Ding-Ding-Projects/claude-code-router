/**
 * Per-visitor persistence layer. Everything is namespaced under `ccr-site.*`
 * in localStorage, JSON-encoded, version-checked, and resettable per key or
 * wholesale. No value ever leaves this browser.
 */

const NS = 'ccr-site.';
const SCHEMA_VERSION_KEY = 'schema-version';
const SCHEMA_VERSION = 1;

const listeners = new Map(); // key -> Set<fn>

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode etc. */
  }
  return null;
}

function fullKey(key) {
  return NS + key;
}

export function get(key, fallback = undefined) {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(fullKey(key));
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'v' in parsed &&
      'value' in parsed
    ) {
      if (parsed.v !== SCHEMA_VERSION) return fallback;
      return parsed.value;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(fullKey(key), JSON.stringify({ v: SCHEMA_VERSION, value }));
    const subs = listeners.get(key);
    if (subs) for (const fn of [...subs]) fn(value);
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to changes of one key (fires only through this module's set()). */
export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

export function remove(key) {
  storage()?.removeItem(fullKey(key));
  const subs = listeners.get(key);
  if (subs) for (const fn of [...subs]) fn(undefined);
}

/** Reset one key to absent. Returns true when something existed. */
export function reset(key) {
  const ls = storage();
  if (!ls) return false;
  const had = ls.getItem(fullKey(key)) !== null;
  remove(key);
  return had;
}

/** List every site key currently stored (without the namespace prefix). */
export function keys() {
  const ls = storage();
  if (!ls) return [];
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && k.startsWith(NS)) out.push(k.slice(NS.length));
  }
  return out.sort();
}

/** Wipe everything the site owns. Returns the number of keys removed. */
export function resetAll() {
  const ks = keys();
  for (const k of ks) remove(k);
  return ks.length;
}

/** Dump of all stored site state (for export). Values are plain data. */
export function dumpAll() {
  const out = {};
  for (const k of keys()) out[k] = get(k);
  out[SCHEMA_VERSION_KEY] = SCHEMA_VERSION;
  return out;
}

/** Import a dump produced by dumpAll(). Skips unknown schema versions. */
export function importAll(dump) {
  if (!dump || typeof dump !== 'object') return 0;
  if (dump[SCHEMA_VERSION_KEY] !== SCHEMA_VERSION) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(dump)) {
    if (k === SCHEMA_VERSION_KEY) continue;
    if (typeof k !== 'string' || !k) continue;
    set(k, v);
    n++;
  }
  return n;
}

export const NAMESPACE = NS;
