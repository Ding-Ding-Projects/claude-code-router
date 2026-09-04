/**
 * toys-security.js — toy locks, unlock ladder, support tickets, authenticator.
 *
 * Lane owner: feat/site-toys-security. Everything in this file is local-only:
 * zero network calls, zero telemetry, no remote assets. Secrets (TOTP seeds,
 * lock credentials) never leave this browser and are excluded from the site's
 * ordinary settings export — see EXPORT_OMISSION_NOTE below.
 *
 * INTEGRATION NOTE (single wiring point, owned by the app.js lane):
 *   import './toys-security.js';   // add to site/assets/js/app.js imports
 * The module self-boots when a page carries #lock-layer-slot /
 * #authenticator-slot, and security.html loads it directly as its module
 * entry, so the surfaces below are live on this branch either way.
 *
 * PART A (this first section) is pure logic with NO DOM access: it imports
 * cleanly under Node for unit runs (`node --input-type=module -e "import(...)"`).
 */

import * as store from './store.js';
import * as i18n from './i18n.js';
import { el, append, clear } from './util.js';
import { openMenu, wireContextMenu } from './menu.js';
import { attachSearchField, compile as compileQuery } from './search.js';
import { openDialog } from './dialog.js';
import { superConfirm } from './superconfirm.js';

/* ========================================================================== */
/* PART A — PURE CORE (Node-importable; browser code starts at PART B)        */
/* ========================================================================== */

/** Ordinary export omits these by design; the omission itself must be stated. */
export const EXPORT_OMISSION_NOTE =
  'TOTP secrets and lock credentials are intentionally omitted from ordinary exports.';

/* ------------------------------ base32 ---------------------------------- */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[=\s-]/g, '');
  if (!clean.length) throw new Error('empty secret');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (!out.length) throw new Error('empty secret');
  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/* ------------------------------ TOTP / HOTP ------------------------------ */

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto unavailable');
  return s;
};

const WEBCRYPT_HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

async function hmacBytes(secretBytes, counter, algo) {
  const name = WEBCRYPT_HASH[algo] || 'SHA-1';
  const key = await subtle().importKey('raw', secretBytes, { name: 'HMAC', hash: name }, false, ['sign']);
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  // RFC 4226 moving factor: unsigned 64-bit big-endian.
  dv.setUint32(0, Math.floor(counter / 0x100000000));
  dv.setUint32(4, counter >>> 0);
  return new Uint8Array(await subtle().sign('HMAC', key, buf));
}

function truncate(mac) {
  const off = mac[mac.length - 1] & 0x0f;
  return (((mac[off] & 0x7f) << 24) | ((mac[off + 1] & 0xff) << 16) | ((mac[off + 2] & 0xff) << 8) | (mac[off + 3] & 0xff)) >>> 0;
}

/**
 * HOTP per RFC 4226. Returns the decimal string padded to `digits`.
 * @param {Uint8Array} secretBytes
 */
export async function hotp(secretBytes, counter, { algo = 'SHA1', digits = 6 } = {}) {
  const mac = await hmacBytes(secretBytes, counter, algo);
  return String(truncate(mac) % 10 ** digits).padStart(digits, '0');
}

/**
 * TOTP per RFC 6238.
 * @param {string|Uint8Array} secret base32 string or raw bytes
 * @param {{algo?:'SHA1'|'SHA256'|'SHA512', digits?:number, period?:number, now?:number, driftSteps?:number}} [p]
 */
export async function totp(secret, p = {}) {
  const bytes = secret instanceof Uint8Array ? secret : base32Decode(String(secret));
  const period = p.period > 0 ? p.period : 30;
  const nowMs = p.now ?? Date.now();
  const drift = Number.isInteger(p.driftSteps) ? p.driftSteps : 0;
  const counter = Math.floor(nowMs / 1000 / period) - drift;
  return hotp(bytes, counter, { algo: p.algo || 'SHA1', digits: p.digits || 6 });
}

/** Remaining seconds of the current TOTP window (text countdown source). */
export function secondsRemaining(period = 30, now = Date.now()) {
  return period - Math.floor(now / 1000) % period;
}

/** Group digits for display: 3+3 for six digits, 4+4 for eight, else chunks of 4. */
export function groupDigits(code) {
  const c = String(code);
  if (c.length === 6) return `${c.slice(0, 3)} ${c.slice(3)}`;
  if (c.length === 8) return `${c.slice(0, 4)} ${c.slice(4)}`;
  return c.replace(/(.{4})(?=.)/g, '$1 ');
}

/* --------------------------- RFC 6238 self-test --------------------------- */
/**
 * Appendix B of RFC 6238. Seeds are the ASCII string '1234567890…' at
 * 20/32/64 bytes per algorithm; times are seconds; codes are 8-digit.
 */
export const RFC6238_VECTORS = [
  { t: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { t: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { t: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { t: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { t: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { t: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

const VECTOR_SEEDS = {
  SHA1: '12345678901234567890',
  SHA256: '12345678901234567890123456789012',
  SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
};

/** Run every vector × algorithm. Returns rows so UI can print a table. */
export async function runTotpSelfTest() {
  const rows = [];
  for (const v of RFC6238_VECTORS) {
    for (const algo of ['SHA1', 'SHA256', 'SHA512']) {
      const seed = new TextEncoder().encode(VECTOR_SEEDS[algo]);
      const got = await hotp(seed, Math.floor(v.t / 30), { algo, digits: 8 });
      rows.push({ label: `RFC6238 ${algo} t=${v.t}`, expected: v[algo.toLowerCase()], got, pass: got === v[algo.toLowerCase()] });
    }
  }
  // A couple of base32 round-trips keep the parser honest too.
  const rt1 = base32Encode(base32Decode('JBSWY3DPEHPK3PXP'));
  rows.push({ label: 'base32 round-trip JBSWY3DPEHPK3PXP', expected: 'JBSWY3DPEHPK3PXP', got: rt1, pass: rt1 === 'JBSWY3DPEHPK3PXP' });
  const rt2 = base32Encode(base32Decode('MFRGGZDFMZTWQ2LK'));
  rows.push({ label: 'base32 round-trip MFRGGZDFMZTWQ2LK', expected: 'MFRGGZDFMZTWQ2LK', got: rt2, pass: rt2 === 'MFRGGZDFMZTWQ2LK' });
  return rows;
}

/* ---------------------------- otpauth:// URIs ---------------------------- */

/**
 * Parse an otpauth:// URI, honouring carried parameters instead of overwriting
 * them with defaults. Throws Error with an honest message when invalid.
 */
export function parseOtpauthUri(uri) {
  let u;
  try {
    u = new URL(String(uri).trim());
  } catch {
    throw new Error('not a valid URI');
  }
  if (u.protocol !== 'otpauth:') throw new Error('scheme must be otpauth:');
  const type = (u.host || '').toLowerCase();
  if (type !== 'totp' && type !== 'hotp') throw new Error('unsupported otpauth type (want totp)');
  const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  const sep = label.lastIndexOf(':');
  const issuerFromLabel = sep > -1 ? label.slice(0, sep) : '';
  const account = sep > -1 ? label.slice(sep + 1) : label;
  const secret = u.searchParams.get('secret');
  if (!secret) throw new Error('missing secret parameter');
  base32Decode(secret); // validates charset eagerly
  const algoRaw = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  const algo = ['SHA1', 'SHA256', 'SHA512'].includes(algoRaw) ? algoRaw : null;
  if (!algo) throw new Error(`unsupported algorithm: ${algoRaw}`);
  const digitsRaw = u.searchParams.get('digits');
  const digits = digitsRaw ? parseInt(digitsRaw, 10) : 6;
  if (!(digits >= 6 && digits <= 8)) throw new Error(`digits out of range 6..8: ${digitsRaw}`);
  const periodRaw = u.searchParams.get('period');
  const period = periodRaw ? parseInt(periodRaw, 10) : 30;
  if (!(period >= 1 && period <= 3600)) throw new Error(`period out of range: ${periodRaw}`);
  const issuerParam = u.searchParams.get('issuer') || '';
  return {
    type,
    issuer: issuerParam || issuerFromLabel || 'Entry',
    account: account || issuerParam || 'account',
    secret: String(secret).toUpperCase().replace(/[=\s]/g, ''),
    algo,
    digits,
    period,
  };
}

/** Build an otpauth:// URI (used by the QR we draw and by copy actions). */
export function buildOtpauthUri({ issuer, account, secret, algo = 'SHA1', digits = 6, period = 30 }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: String(secret).replace(/\s/g, ''),
    issuer,
    algorithm: algo,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* --------------------------- credential hashing -------------------------- */

function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export { randomBytes };

function bufToB64(buf) {
  let s = '';
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (const byte of u8) s += String.fromCharCode(byte);
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export { bufToB64, b64ToBuf };

const PBKDF2_ITERATIONS = 150000;

async function pbkdf2Bits(password, saltBytes, iterations = PBKDF2_ITERATIONS, bits = 256) {
  const material = new TextEncoder().encode(String(password));
  const base = await subtle().importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, base, bits));
}

/** Hash a toy-lock password. Only salt+hash are stored — never the password. */
export async function hashLockPassword(password, saltB64) {
  const salt = saltB64 ? b64ToBuf(saltB64) : randomBytes(16);
  const bits = await pbkdf2Bits(password, salt);
  return { saltB64: bufToB64(salt), hashB64: bufToB64(bits) };
}

export function constantTimeEqual(aStr, bStr) {
  const a = new TextEncoder().encode(String(aStr));
  const b = new TextEncoder().encode(String(bStr));
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/* ------------------------------ vault crypto ----------------------------- */

/** Derive the AES-GCM vault key from a passphrase. Never persisted anywhere. */
export async function deriveVaultKey(passphrase, saltB64, iterations = 210000) {
  const raw = await pbkdf2Bits(passphrase, b64ToBuf(saltB64), iterations, 256);
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(key, obj) {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: bufToB64(iv), ct: bufToB64(ct) };
}

export async function decryptVault(key, { iv, ct }) {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ------------------------------ unlock ladder ----------------------------- */

/**
 * School-mode-style suppression hook. ONE function decides the starting rung
 * so a future mode can hide the dim-sum rung entirely (ladder then starts at
 * the sums). No toggle ships yet; exported so that mode only has to flip the
 * stored flag through this single decision point.
 * @returns {1|2|3} starting rung number
 */
export function decideStartRung({ suppressDimSum } = {}) {
  const suppressed = suppressDimSum ?? store.get('toys.suppressDimSumRung', false) === true;
  return suppressed ? 2 : 1;
}

/** Exponential, capped wait escalation from consecutive wrong attempts. */
export function waitSecondsForAttempts(attempts) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(15 * 60, 15 * 2 ** (n - 1));
}

const LADDER_BUDGET_WINDOW_MS = 3600_000;
const LADDER_BUDGET_MAX = 3;

/**
 * Rolling-hour budget: at most LADDER_BUDGET_MAX ladder waits may be skipped
 * per hour; after that the clock is the only way through for everyone.
 * Pure functions so the cap is testable without a DOM.
 */
export function countWaitsInWindow(timestamps, nowMs) {
  return (Array.isArray(timestamps) ? timestamps : []).filter(
    (t) => typeof t === 'number' && nowMs - t < LADDER_BUDGET_WINDOW_MS,
  ).length;
}
export function ladderAvailable(timestamps, nowMs) {
  return countWaitsInWindow(timestamps, nowMs) < LADDER_BUDGET_MAX;
}
export function recordLadderWait(timestamps, nowMs) {
  const next = (Array.isArray(timestamps) ? timestamps.filter((t) => typeof t === 'number') : []).concat([nowMs]);
  return next.slice(-20); // bounded history; window math above does the rest
}
export const LADDER_LIMITS = { windowMs: LADDER_BUDGET_WINDOW_MS, maxPerHour: LADDER_BUDGET_MAX };

/** Deterministic RNG (mulberry32) so rounds can be regenerated from a nonce. */
export function makeRng(seedU32) {
  let a = seedU32 >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ten easy sums: single/double digit add/subtract/small-multiply. All must pass. */
export function makeSums(count = 10, rng = Math.random) {
  const ops = ['+', '-', '×'];
  const sums = [];
  let guard = 0;
  while (sums.length < count && guard++ < count * 40) {
    const op = ops[Math.floor(rng() * ops.length)];
    let a;
    let b;
    let answer;
    if (op === '+') {
      a = 2 + Math.floor(rng() * 89);
      b = 2 + Math.floor(rng() * 89);
      answer = a + b;
    } else if (op === '-') {
      a = 10 + Math.floor(rng() * 80);
      b = 1 + Math.floor(rng() * (a - 1));
      answer = a - b;
    } else {
      a = 2 + Math.floor(rng() * 11);
      b = 2 + Math.floor(rng() * 9);
      answer = a * b;
    }
    if (!sums.some((s) => s.text === `${a} ${op} ${b}`)) sums.push({ text: `${a} ${op} ${b}`, answer });
  }
  return sums;
}

/**
 * Whack-a-mole schedule. Moles are born and die within the round; each mole id
 * appears exactly once so it can be graded once.
 */
export function makeMoleSchedule({ durationMs = 30000, moleCount = 14, cells = 9, quota = 10, rng = Math.random } = {}) {
  const moles = [];
  for (let i = 0; i < moleCount; i++) {
    const slot = durationMs / moleCount;
    const born = Math.round(i * slot + rng() * slot * 0.5);
    const life = Math.round(slot * (0.55 + rng() * 0.35));
    moles.push({ id: `m${i}`, cell: Math.floor(rng() * cells), bornMs: born, dieMs: Math.min(durationMs, born + life) });
  }
  return { durationMs, cells, quota, moles };
}

/** Reject submissions arriving before the round's own duration has elapsed. */
export function submissionTooEarly(startedAtRel, submittedAtRel, durationMs) {
  return !(submittedAtRel >= startedAtRel + durationMs);
}

/**
 * Grade one hit against the schedule. Each MOLE may be graded once — repeat
 * taps on the same mole (or on an empty cell, or outside its life window)
 * contribute nothing.
 */
export function gradeMoleHit(schedule, hitSet, hit) {
  const mole = schedule.moles.find((m) => m.id === hit.moleId);
  if (!mole) return { counted: false, reason: 'unknown-mole' };
  if (hitSet.has(mole.id)) return { counted: false, reason: 'already-graded' };
  hitSet.add(mole.id); // consumed before verdict, so retries cannot re-grade
  if (hit.cell !== mole.cell) return { counted: false, reason: 'wrong-cell' };
  if (hit.tMs < mole.bornMs || hit.tMs > mole.dieMs) return { counted: false, reason: 'outside-window' };
  return { counted: true, reason: 'ok' };
}

export function tallyRound(schedule, hits, { startedAtRel = 0, submittedAtRel } = {}) {
  if (typeof submittedAtRel !== 'number' || submissionTooEarly(startedAtRel, submittedAtRel, schedule.durationMs)) {
    return { accepted: false, validHits: 0, quota: schedule.quota, reason: 'too-early' };
  }
  const hitSet = new Set();
  let valid = 0;
  for (const h of Array.isArray(hits) ? hits : []) {
    const r = gradeMoleHit(schedule, hitSet, h);
    if (r.counted) valid++;
  }
  return { accepted: valid >= schedule.quota, validHits: valid, quota: schedule.quota, reason: valid >= schedule.quota ? 'quota-met' : 'quota-short' };
}

/* ========================================================================== */
/* PART A2 — QR ENCODER + DECODER (pure; drawn in-page, decoded in-page.      */
/* No network, no third-party module: a minimal byte-mode QR stack.)          */
/* ========================================================================== */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);
const gfDiv = (a, b) => (b === 0 ? NaN : a === 0 ? 0 : GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255]);
const gfPow = (a, n) => GF_EXP[(GF_LOG[a] * n) % 255];
function gfInv(a) {
  return GF_EXP[(255 - GF_LOG[a]) % 255];
}
/** Evaluate a low-degree-first polynomial at x (GF(256)). */
function polyEval(poly, x) {
  let v = 0;
  let xp = 1;
  for (const coef of poly) {
    v ^= gfMul(coef, xp);
    xp = gfMul(xp, x);
  }
  return v;
}

/** Reed–Solomon generator polynomial (degree n, roots α^0..α^(n-1)). */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], gfPow(2, i));
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse(); // highest degree first
}

/** RS error-correction codewords for one data block. */
export function rsEncodeBlock(data, ecLen) {
  const gen = rsGenerator(ecLen); // high-degree-first, monic (gen[0] === 1)
  const rem = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return Uint8Array.from(rem);
}

/* Block structure per version/ECC: {ecPerBlock, numBlocks, totalData}.
 * Derived from the QR specification tables (cross-checked against Nayuki's
 * QR-Code-generator ECC_CODEWORDS_PER_BLOCK / NUM_ERROR_CORRECTION_BLOCKS and
 * getNumRawDataModules); the dev-time unit run asserts the totals add up. */
const QR_BLOCKS = {
  1: { L: [7, 1, 19], M: [10, 1, 16], Q: [13, 1, 13], H: [17, 1, 9] },
  2: { L: [10, 1, 34], M: [16, 1, 28], Q: [22, 1, 22], H: [28, 1, 16] },
  3: { L: [15, 1, 55], M: [26, 1, 44], Q: [18, 2, 34], H: [22, 2, 26] },
  4: { L: [20, 1, 80], M: [18, 2, 64], Q: [26, 2, 48], H: [16, 4, 36] },
  5: { L: [26, 1, 108], M: [24, 2, 86], Q: [18, 4, 62], H: [22, 4, 46] },
  6: { L: [18, 2, 136], M: [16, 4, 108], Q: [24, 4, 76], H: [28, 4, 60] },
  7: { L: [20, 2, 156], M: [18, 4, 124], Q: [18, 6, 88], H: [26, 5, 66] },
  8: { L: [24, 2, 194], M: [22, 4, 154], Q: [22, 6, 110], H: [26, 6, 86] },
  9: { L: [30, 2, 232], M: [22, 5, 182], Q: [20, 8, 132], H: [24, 8, 100] },
  10: { L: [18, 4, 274], M: [26, 5, 216], Q: [24, 8, 154], H: [28, 8, 122] },
};
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_BY_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

function blocksFor(version, ecc) {
  const [ecPerBlock, numBlocks, totalData] = QR_BLOCKS[version][ecc];
  // Spec block split: SHORT blocks come FIRST, longer blocks last carry the
  // extra data codeword (mirrors ISO/IEC 18004 and qrcodegen's interleave).
  const rawCodewords = totalData + ecPerBlock * numBlocks;
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const shortDataLen = shortBlockLen - ecPerBlock;
  return { ecPerBlock, numBlocks, totalData, numShort, shortDataLen };
}
function totalDataCw(version, ecc) {
  return blocksFor(version, ecc).totalData;
}
function totalCodewords(version, ecc) {
  const { ecPerBlock, numBlocks, totalData } = blocksFor(version, ecc);
  return totalData + ecPerBlock * numBlocks;
}

/**
 * Encode UTF-8 text into a byte-mode QR matrix (versions 1..10, all ECC
 * levels). Masks 0..7 are evaluated with the standard penalties.
 * @returns {{version:number,size:number,ecc:string,mask:number,modules:boolean[][]}}
 */
export function qrEncode(text, ecc = 'M') {
  const bytes = new TextEncoder().encode(String(text));
  if (!bytes.length || bytes.length > 271) throw new Error('text length outside supported range');
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const ccBits = v < 10 ? 8 : 16;
    if (Math.ceil((4 + ccBits + bytes.length * 8) / 8) <= totalDataCw(v, ecc)) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('text too long for supported versions');

  /* ---- data bit stream ---- */
  const bits = [];
  const pushBits = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(4, 4); // byte mode
  pushBits(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const capBits = totalDataCw(version, ecc) * 8;
  pushBits(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < capBits) pushBits(pads[padIdx++ % 2], 8);
  const dataCw = new Uint8Array(bits.length / 8);
  for (let i = 0; i < dataCw.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    dataCw[i] = v;
  }

  /* ---- per-block RS + interleaving (short blocks first, spec order) ---- */
  const { ecPerBlock, numBlocks, numShort, shortDataLen } = blocksFor(version, ecc);
  const blocks = [];
  let off = 0;
  for (let b = 0; b < numBlocks; b++) {
    const dlen = shortDataLen + (b < numShort ? 0 : 1);
    let dat = Array.from(dataCw.slice(off, off + dlen));
    off += dlen;
    if (b < numShort) dat.push(0); // placeholder slot skipped during interleave
    blocks.push({ dat, ec: rsEncodeBlock(dat.slice(0, dlen), ecPerBlock) });
  }
  if (off !== dataCw.length) throw new Error('block split mismatch');
  const blockLen = shortDataLen + 1 + ecPerBlock;
  const final = [];
  for (let i = 0; i < blockLen; i++)
    for (let j = 0; j < numBlocks; j++) {
      const blk = blocks[j];
      if (i === shortDataLen && j < numShort) continue; // placeholder slot in short blocks
      if (i < blk.dat.length) final.push(blk.dat[i]);
      else if (i - blk.dat.length < ecPerBlock) final.push(blk.ec[i - blk.dat.length]);
    }

  /* ---- function patterns ---- */
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (r, c, dark) => {
    modules[r][c] = !!dark;
    isFn[r][c] = true;
  };
  const drawFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const ring = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(rr, cc, ring || core);
      }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  for (const r of ALIGNMENT[version])
    for (const c of ALIGNMENT[version]) {
      // Spec guard: no alignment pattern overlaps a finder corner. Centres on
      // the timing lines BETWEEN finders are real patterns and must be drawn
      // (they overlay the timing, per spec).
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) setFn(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  for (let i = 0; i <= 8; i++) if (i !== 6) { setFn(8, i, false); setFn(i, 8, false); }
  for (let i = 0; i < 8; i++) { setFn(8, size - 1 - i, false); setFn(size - 1 - i, 8, false); }
  setFn(size - 8, 8, true); // always-dark module
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) & 1 ? 0x1f25 : 0);
    const vi = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vi >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      setFn(a, size - 11 + b, bit);
      setFn(size - 11 + b, a, bit);
    }
  }

  // Base (unmasked) data layer; masks are XORed on top for scoring/display.
  let base = null;
  const maskDark = (r, c, m) => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };
  const applyMask = (m) => {
    if (!base) throw new Error('placeZigzag must run before masking');
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        if (isFn[r][c]) continue;
        modules[r][c] = base[r][c] !== maskDark(r, c, m);
      }
  };

  /* ---- place data codeword bits on every mask, keep lowest penalty ---- */
  const cwBits = [];
  for (const cw of final) for (let i = 7; i >= 0; i--) cwBits.push((cw >>> i) & 1);

  function placeZigzag() {
    base = Array.from({ length: size }, () => new Array(size).fill(false));
    let bi = 0;
    let col = size - 1;
    let upward = true;
    while (col > 0) {
      if (col === 6) col--;
      for (let k = 0; k < size; k++) {
        const r = upward ? size - 1 - k : k;
        for (const c of [col, col - 1]) {
          if (isFn[r][c]) continue;
          const bit = bi < cwBits.length ? cwBits[bi++] === 1 : false;
          base[r][c] = bit;
          modules[r][c] = bit;
        }
      }
      upward = !upward;
      col -= 2;
    }
    if (bi !== cwBits.length) throw new Error(`bit placement mismatch (${bi}/${cwBits.length})`);
  }

  function penalty() {
    let p = 0;
    const runScore = (lineArr) => {
      let run = 1;
      for (let j = 1; j <= lineArr.length; j++) {
        if (j < lineArr.length && lineArr[j] === lineArr[j - 1]) run++;
        else {
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
    };
    for (let i = 0; i < size; i++) {
      runScore(modules[i]);
      runScore(modules.map((row) => row[i]));
    }
    for (let r = 0; r < size - 1; r++)
      for (let c = 0; c < size - 1; c++) {
        const v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) p += 3;
      }
    const needles = ['10111010000', '00001011101'];
    for (let r = 0; r < size; r++) {
      const s = modules[r].map((v) => (v ? '1' : '0')).join('');
      for (const nd of needles) {
        let idx = s.indexOf(nd);
        while (idx !== -1) {
          p += 40;
          idx = s.indexOf(nd, idx + 1);
        }
      }
    }
    for (let c = 0; c < size; c++) {
      const s = modules.map((row) => (row[c] ? '1' : '0')).join('');
      for (const nd of needles) {
        let idx = s.indexOf(nd);
        while (idx !== -1) {
          p += 40;
          idx = s.indexOf(nd, idx + 1);
        }
      }
    }
    let darkCount = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) darkCount++;
    p += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10;
    return p;
  }

  placeZigzag();
  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    const score = penalty();
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
    }
  }
  applyMask(bestMask);

  /* ---- format info (BCH(15,5)), both copies, per-spec placement ----
   * Cell layout follows the QR specification exactly: copy 1 runs down
   * column 8 then along row 8; copy 2 runs along row 8 (from the right)
   * then up column 8 (from the bottom). */
  const fmtData = (ECC_BITS[ecc] << 3) | bestMask;
  let fmtRem = fmtData;
  for (let i = 0; i < 10; i++) fmtRem = (fmtRem << 1) ^ ((fmtRem >>> 9) & 1 ? 0x537 : 0);
  const fmt = ((fmtData << 10) | fmtRem) ^ 0x5412;
  const fb = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = fb(i);
  modules[7][8] = fb(6);
  modules[8][8] = fb(7);
  modules[8][7] = fb(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = fb(i);
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = fb(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = fb(i);
  modules[size - 8][8] = true;

  return { version, size, ecc, mask: bestMask, modules };
}

/* ------------------------------ QR decoding ------------------------------ */

export function binarize(luma, w, h) {
  // Adaptive threshold via integral image so gradient-lit photos survive.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += luma[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  // The window must exceed the largest solid QR feature (a finder core, three
  // modules wide) so no sampling window sits wholly inside one colour —
  // otherwise a uniform dark interior classifies as light.
  const win = Math.max(13, (Math.floor(Math.min(w, h) / 6) | 1));
  const half = win >> 1;
  const out = new Uint8Array(w * h);
  let darkCount = 0;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const A = integral[y0 * (w + 1) + x0];
      const B = integral[y0 * (w + 1) + (x1 + 1)];
      const C = integral[(y1 + 1) * (w + 1) + x0];
      const D = integral[(y1 + 1) * (w + 1) + (x1 + 1)];
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const mean = (D - B - C + A) / area;
      const dark = luma[y * w + x] < mean - 4 ? 1 : 0;
      out[y * w + x] = dark;
      darkCount += dark;
    }
  }
  if (darkCount === 0 || darkCount === w * h) throw new Error('image has no usable contrast');
  return out;
}

/** Finder candidates via a sliding 5-run window matching 1:1:3:1:1. */
export function findFinders(bin, w, h) {
  const cands = [];
  const addCandidate = (cx, cy, unit) => {
    for (const p of cands) if (Math.hypot(p.x - cx, p.y - cy) < unit * 2.5) return;
    cands.push({ x: cx, y: cy, unit });
  };
  for (let y = 0; y < h; y++) {
    let color = bin[y * w];
    let runStart = 0;
    const win = []; // {color,start,end}
    for (let x = 0; x <= w; x++) {
      const v = x < w ? bin[y * w + x] : 1 - color; // flush at end
      if (v !== color) {
        win.push({ color, start: runStart, end: x - 1 });
        if (win.length > 5) win.shift();
        if (win.length === 5) {
          const lens = win.map((s) => s.end - s.start + 1);
          const unit = lens.reduce((a, b) => a + b, 0) / 7;
          if (
            unit >= 2 &&
            win[0].color === 1 &&
            Math.abs(lens[0] - unit) <= unit * 0.55 &&
            Math.abs(lens[1] - unit) <= unit * 0.55 &&
            Math.abs(lens[2] - unit * 3) <= unit * 0.55 &&
            Math.abs(lens[3] - unit) <= unit * 0.55 &&
            Math.abs(lens[4] - unit) <= unit * 0.55
          ) {
            const cx = win[0].start + lens[0] + lens[1] + lens[2] / 2;
            addCandidate(cx, y, unit);
          }
        }
        color = v;
        runStart = x;
      }
    }
  }
  // Vertical verification: cross each candidate centre and require the ratio.
  const verified = [];
  for (const p of cands) {
    const xi = Math.round(p.x);
    const yi = Math.round(p.y);
    const reach = Math.ceil(p.unit * 5);
    let top = yi;
    while (top > 0 && bin[(top - 1) * w + xi] === 1) top--;
    let coreEnd = yi;
    while (coreEnd < h - 1 && bin[(coreEnd + 1) * w + xi] === 1) coreEnd++;
    const core = coreEnd - top + 1;
    if (Math.abs(core - p.unit * 3) > p.unit) continue;
    let l0 = top;
    let guard = top;
    while (guard > 0 && bin[(guard - 1) * w + xi] === 0 && yi - guard < reach) guard--;
    const lightAbove = top - guard;
    guard = coreEnd;
    while (guard < h - 1 && bin[(guard + 1) * w + xi] === 0 && guard - coreEnd < reach) guard++;
    const lightBelow = guard - coreEnd;
    if (Math.abs(lightAbove - lightBelow) > p.unit) continue;
    // Centre of the INCLUSIVE pixel span [top..coreEnd].
    verified.push({ x: p.x, y: (top + coreEnd + 1) / 2, unit: p.unit });
  }
  return verified;
}

/** Pick the three finders forming the corner triangle (TL/TR/BL). */
function pickTriangle(cands) {
  let best = null;
  let bestScore = -Infinity;
  const n = Math.min(cands.length, 12);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const pts = [cands[i], cands[j], cands[k]];
        let tlIdx = 0;
        let minD = Infinity;
        for (let q = 0; q < 3; q++) {
          const d = Math.hypot(pts[q].x, pts[q].y);
          if (d < minD) {
            minD = d;
            tlIdx = q;
          }
        }
        const others = [0, 1, 2].filter((q) => q !== tlIdx);
        const tl = pts[tlIdx];
        const a = pts[others[0]];
        const b = pts[others[1]];
        const da = Math.hypot(a.x - tl.x, a.y - tl.y);
        const db = Math.hypot(b.x - tl.x, b.y - tl.y);
        const tr = da >= db ? a : b;
        const bl = da >= db ? b : a;
        const side = (da + db) / 2;
        if (side < 14) continue;
        const squareness = 1 - Math.abs(da - db) / Math.max(da, db);
        const angle =
          ((tr.x - tl.x) * (bl.x - tl.x) + (tr.y - tl.y) * (bl.y - tl.y)) / Math.max(side * side, 1);
        const score = side * squareness * (1 - Math.abs(angle));
        if (score > bestScore) {
          bestScore = score;
          best = { tl, tr, bl, side };
        }
      }
  return best;
}

function sampleGrid(bin, w, h, dim, tri) {
  // Finder centres sit at module (3.5, 3.5); map from there to symbol origin.
  const ux = { x: (tri.tr.x - tri.tl.x) / (dim - 7), y: (tri.tr.y - tri.tl.y) / (dim - 7) };
  const uy = { x: (tri.bl.x - tri.tl.x) / (dim - 7), y: (tri.bl.y - tri.tl.y) / (dim - 7) };
  const grid = [];
  for (let r = 0; r < dim; r++) {
    const row = new Array(dim);
    for (let c = 0; c < dim; c++) {
      let votes = 0;
      let samples = 0;
      for (const [dr, dc] of [
        [-0.3, -0.3], [0, -0.3], [0.3, -0.3],
        [-0.3, 0], [0, 0], [0.3, 0],
        [-0.3, 0.3], [0, 0.3], [0.3, 0.3],
      ]) {
        const rr = r + 0.5 + dr - 3.5;
        const cc = c + 0.5 + dc - 3.5;
        const fx = tri.tl.x + cc * ux.x + rr * uy.x;
        const fy = tri.tl.y + cc * ux.y + rr * uy.y;
        const xi = Math.round(fx);
        const yi = Math.round(fy);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
        votes += bin[yi * w + xi];
        samples++;
      }
      row[c] = votes * 2 >= samples;
    }
    grid.push(row);
  }
  return grid;
}

function readFormat(grid) {
  const size = grid.length;
  const readMsbFirst = (cells) => {
    let v = 0;
    for (const [r, c] of cells) v = (v << 1) | (grid[r][c] ? 1 : 0);
    return v;
  };
  const copy1 = readMsbFirst([
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]);
  const copy2 = readMsbFirst([
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ]);
  const bchRemainderBits = (f) => {
    let r = f;
    for (let i = 0; i < 15; i++) r = (r << 1) ^ ((r >>> 14) & 1 ? 0x537 : 0);
    let n = 0;
    for (let i = 0; i < 15; i++) n += (r >>> i) & 1;
    return n;
  };
  const f1 = copy1 ^ 0x5412;
  const f2 = copy2 ^ 0x5412;
  const pick = bchRemainderBits(f1) <= bchRemainderBits(f2) ? f1 : f2;
  return { eccBits: (pick >>> 13) & 3, mask: (pick >>> 10) & 7 };
}

function buildSkipGrid(dim) {
  const size = dim;
  const skip = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      if (
        (r < 9 && c < 9) ||
        (r < 9 && c >= size - 8) ||
        (r >= size - 8 && c < 9) ||
        r === 6 ||
        c === 6
      )
        skip[r][c] = true;
    }
  const version = (size - 17) / 4;
  for (const cr of ALIGNMENT[version])
    for (const cc of ALIGNMENT[version]) {
      // Mirrors the encoder's guard: no alignment box overlaps a finder corner.
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const r = cr + dr;
          const c = cc + dc;
          if (r >= 0 && r < size && c >= 0 && c < size) skip[r][c] = true;
        }
    }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = i % 3;
      skip[a][size - 11 + b] = true;
      skip[size - 11 + b][a] = true;
    }
  }
  return skip;
}

function extractCodewords(grid, maskId, skip) {
  const size = grid.length;
  const unmasked = grid.map((row, r) =>
    row.map((v, c) => {
      let dark = v;
      switch (maskId) {
        case 0: dark ^= (r + c) % 2 === 0; break;
        case 1: dark ^= r % 2 === 0; break;
        case 2: dark ^= c % 3 === 0; break;
        case 3: dark ^= (r + c) % 3 === 0; break;
        case 4: dark ^= (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: dark ^= ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: dark ^= (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        default: dark ^= (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      }
      return !!dark;
    }),
  );
  const bits = [];
  let col = size - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (skip[r][c]) continue;
        bits.push(unmasked[r][c] ? 1 : 0);
      }
    }
    upward = !upward;
    col -= 2;
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out[i] = v;
  }
  return out;
}

function deinterleave(cwAll, version, ecc) {
  const { ecPerBlock, numBlocks, numShort, shortDataLen } = blocksFor(version, ecc);
  const datLens = [];
  for (let b = 0; b < numBlocks; b++) datLens.push(shortDataLen + (b < numShort ? 0 : 1));
  const dataParts = datLens.map((len) => []);
  const ecParts = datLens.map(() => []);
  const blockLen = shortDataLen + 1 + ecPerBlock;
  let idx = 0;
  for (let i = 0; i < blockLen; i++)
    for (let b = 0; b < numBlocks; b++) {
      if (i === shortDataLen && b < numShort) continue; // placeholder slot in short blocks
      const byte = cwAll[idx++];
      if (i < datLens[b]) dataParts[b][i] = byte;
      else ecParts[b].push(byte);
    }
  return dataParts.map((d, i) => ({ data: d, ec: ecParts[i] }));
}

/**
 * Reed–Solomon decode/correct one block (fcr=0, prim=1, generator α²).
 * Returns the corrected data portion; throws when errors exceed capacity.
 */
export function rsDecodeBlock(block, ecLen) {
  const msg = Uint8Array.from(block);
  const syndromes = new Array(ecLen);
  let nonzero = false;
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    for (const b of msg) s = gfMul(s, gfPow(2, i)) ^ b;
    syndromes[i] = s;
    if (s) nonzero = true;
  }
  if (!nonzero) return msg.slice(0, msg.length - ecLen);

  /* Berlekamp–Massey: find error locator Λ (low-degree-first). */
  let sigma = [1];
  let prevSigma = [1];
  let L = 0;
  let shift = 1;
  let bPrev = 1;
  for (let n = 0; n < ecLen; n++) {
    // Δ = S_n ⊕ Σ_{j≥1} σ_j · S_{n−j}
    let delta = syndromes[n];
    for (let j = 1; j < sigma.length; j++) {
      if (n - j < 0) break;
      delta ^= gfMul(sigma[j], syndromes[n - j]);
    }
    if (delta === 0) {
      shift++;
      continue;
    }
    const scale = gfMul(delta, gfInv(bPrev));
    const updated = sigma.slice();
    for (let i = 0; i < prevSigma.length; i++) {
      const pos = i + shift;
      while (updated.length <= pos) updated.push(0);
      updated[pos] ^= gfMul(scale, prevSigma[i]);
    }
    if (2 * L <= n) {
      prevSigma = sigma;
      sigma = updated;
      L = n + 1 - L;
      bPrev = delta;
      shift = 1;
    } else {
      sigma = updated;
      shift++;
    }
  }

  const deg = sigma.length - 1;
  if (deg === 0 || deg > ecLen) throw new Error('unrecoverable block');

  /* Chien search: error positions counted from the END of the codeword. */
  const positions = [];
  for (let pos = 0; pos < msg.length; pos++) {
    if (polyEval(sigma, gfPow(2, (255 - (pos % 255)) % 255)) === 0) positions.push(pos);
  }
  if (positions.length !== deg) throw new Error('chien mismatch');

  /* Forney syndromes Ω = S·Λ (truncated to 2t terms), then magnitudes. */
  const twoT = ecLen;
  const omega = new Array(twoT).fill(0);
  for (let i = 0; i < twoT; i++)
    for (let j = 0; j < Math.min(sigma.length, twoT - i); j++) omega[i + j] ^= gfMul(syndromes[i] ?? 0, sigma[j]);

  const corrected = Uint8Array.from(msg);
  for (const pos of positions) {
    const xInv = gfPow(2, (255 - (pos % 255)) % 255);
    let num = polyEval(omega, xInv);
    let den = 0;
    let xp = 1;
    for (let i = 1; i < sigma.length; i += 2) {
      den ^= gfMul(sigma[i], xp);
      xp = gfMul(xp, gfMul(xInv, xInv));
    }
    if (den === 0) throw new Error('forney denominator zero');
    const mag = gfDiv(gfMul(gfPow(2, pos % 255), num), den);
    corrected[msg.length - 1 - pos] ^= mag;
  }
  return corrected.slice(0, corrected.length - ecLen);
}

/**
 * Decode a byte-mode QR from a luma buffer.
 * @returns {{text:string, version:number, ecc:string, mask:number}}
 */
/** Remove isolated single pixels (photo grain / compression speckle). */
function despeckle(bin, w, h) {
  const out = new Uint8Array(bin);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          if (bin[i + dy * w + dx] === bin[i]) same++;
        }
      if (same <= 1) out[i] = bin[i] ^ 1; // 0 or 1 neighbours agree → flip
    }
  return out;
}

export function decodeQrFromLuma(luma, w, h) {
  let bin = binarize(luma, w, h);
  bin = despeckle(bin, w, h);
  let cands = findFinders(bin, w, h);
  if (cands.length < 3) throw new Error('finder patterns not found');
  // De-duplicate detections of the same finder before trio selection.
  const uniq = [];
  for (const p of cands) {
    if (!uniq.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < p.unit * 1.5)) uniq.push(p);
  }
  cands = uniq;
  if (cands.length < 3) throw new Error('finder patterns not found');
  const tri = pickTriangle(cands);
  if (!tri) throw new Error('could not isolate three finder patterns');
  // Module size comes from the finder run width, not the centre distance.
  const unit = (tri.tl.unit + tri.tr.unit + tri.bl.unit) / 3;
  const span =
    (Math.hypot(tri.tr.x - tri.tl.x, tri.tr.y - tri.tl.y) + Math.hypot(tri.bl.x - tri.tl.x, tri.bl.y - tri.tl.y)) / 2;
  let version = Math.round((span / unit + 7 - 17) / 4);
  version = Math.min(10, Math.max(1, version));
  const dim = version * 4 + 17;
  const grid = sampleGrid(bin, w, h, dim, tri);
  if (!grid) throw new Error('symbol extends beyond image bounds');
  // Try the format-declared (ecc, mask) first; on failure sweep the remaining
  // masks and ECC levels — cheap insurance when a couple of format cells
  // misread off a photo.
  const fmt = readFormat(grid);
  const primaryEcc = ECC_BY_BITS[fmt.eccBits] || 'M';
  const attempts = [[primaryEcc, fmt.mask]];
  for (const ecc of ['L', 'M', 'Q', 'H'])
    for (let m = 0; m < 8; m++) {
      if (ecc === primaryEcc && m === fmt.mask) continue;
      attempts.push([ecc, m]);
    }
  let lastErr = null;
  for (const [ecc, maskId] of attempts) {
    const cwAll = extractCodewords(grid, maskId, buildSkipGrid(dim));
    for (let v = 1; v <= 10; v++) {
      if (totalCodewords(v, ecc) !== cwAll.length) continue;
      try {
        const blocks = deinterleave(cwAll, v, ecc);
        const data = [];
        const ecl = blocksFor(v, ecc).ecPerBlock;
        for (const blk of blocks) data.push(...rsDecodeBlock(Uint8Array.from([...blk.data, ...blk.ec]), ecl));
        return { text: parseSegments(Uint8Array.from(data), v), version: v, ecc, mask: maskId };
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('decoding failed');
}

function parseSegments(dataCw, version) {
  const bits = [];
  for (const b of dataCw) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  let pos = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (bits[pos++] ?? 0);
    return v;
  };
  const bytesOut = [];
  let text = '';
  const countBits = (mode) =>
    mode === 4 ? (version < 10 ? 8 : 16) : mode === 1 ? (version < 10 ? 10 : version < 27 ? 12 : 14) : version <= 9 ? 9 : 11;
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  while (pos + 4 <= bits.length) {
    const mode = take(4);
    if (mode === 0) break; // terminator / padding
    if (mode === 1) {
      // Numeric
      const len = take(countBits(1));
      let s = '';
      let n = len;
      while (n >= 3) {
        s += String(take(10)).padStart(3, '0');
        n -= 3;
      }
      if (n === 2) s += String(take(7)).padStart(2, '0');
      else if (n === 1) s += String(take(4));
      text += s;
    } else if (mode === 2) {
      // Alphanumeric
      const len = take(countBits(2));
      let s = '';
      let n = len;
      while (n >= 2) {
        const v = take(11);
        s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
        n -= 2;
      }
      if (n === 1) s += ALNUM[take(6)];
      text += s;
    } else if (mode === 4) {
      const len = take(countBits(4));
      for (let i = 0; i < len; i++) bytesOut.push(take(8));
    } else {
      throw new Error(`unsupported segment mode ${mode}`);
    }
  }
  if (bytesOut.length) text += new TextDecoder().decode(Uint8Array.from(bytesOut));
  if (!text.length && !bytesOut.length) throw new Error('no payload decoded');
  return text;
}
