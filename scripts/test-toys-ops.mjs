#!/usr/bin/env node
/**
 * Logic unit runs for site/assets/js/toys-ops.js — no browser needed.
 * Covers: bounded-schema validation, time-window semantics (normal /
 * cross-midnight / equal bounds), weekday vs every-day, date windows,
 * deterministic later-rule-wins precedence, nextActivation, journal
 * append-only immutability, restore/undo round-trips, retention policies,
 * redaction, field diffs, and a COPY audit (every L('key') used resolves).
 *
 * Run: node scripts/test-toys-ops.mjs   (exit 0 = all green)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(path.join(here, '..', 'site', 'assets', 'js', 'toys-ops.js')).href);

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ok  ${name}`);
}

/* ---------------- schema validation ---------------- */
{
  const bad = [
    null,
    {},
    { version: 2, rules: [] },
    { version: 1 },
    { version: 1, rules: 'nope' },
    { version: 1, rules: Array.from({ length: 101 }, () => rule()) },
    ruleDoc({ label: '' }),
    ruleDoc({ id: 'nope' }),
    ruleDoc({ enabled: 'yes' }),
    ruleDoc({ target: 'volume' }),
    ruleDoc({ target: 'language', value: 'fr' }),
    ruleDoc({ target: 'rainbow', value: '9' }),
    ruleDoc({ startTime: '24:00' }),
    ruleDoc({ startTime: '9:00' }), // partial/incomplete time fails closed
    ruleDoc({ startDate: '2026-02-30' }),
    ruleDoc({ endDate: '2026-01-01', startDate: '2026-02-01' }),
    ruleDoc({ days: [] }),
    ruleDoc({ days: [7] }),
    ruleDoc({ days: [1, 1] }),
    ruleDoc({ mystery: true }),
  ];
  let rejected = 0;
  for (const doc of bad) {
    const v = T.validateSchedule(doc);
    if (!v.ok) rejected++;
    else console.error('      SHOULD HAVE REJECTED:', JSON.stringify(doc).slice(0, 90));
  }
  assert.equal(rejected, bad.length, `expected all ${bad.length} invalid docs rejected`);
  ok(`schema validation rejects ${bad.length} malformed/bounded-schema violations`);

  const good = T.validateSchedule({
    version: 1,
    rules: [rule()],
  });
  assert.ok(good.ok);
  assert.equal(good.schedule.rules[0].days, 'every');
  ok('valid minimal rule normalizes with defaults');
}
function rule(over = {}) {
  return {
    id: 'sch-test0001',
    label: 'Night theme',
    enabled: true,
    target: 'theme',
    value: 'dark',
    startDate: null,
    endDate: null,
    startTime: '22:00',
    endTime: '06:00',
    days: 'every',
    ...over,
  };
}
function ruleDoc(over = {}) {
  return { version: 1, rules: [rule(over)] };
}

/* ---------------- time windows ---------------- */
{
  assert.equal(T.timeActive(22 * 60, 6 * 60, 23 * 60), true, 'cross-midnight late side');
  assert.equal(T.timeActive(22 * 60, 6 * 60, 5 * 60), true, 'cross-midnight early side');
  assert.equal(T.timeActive(22 * 60, 6 * 60, 12 * 60), false, 'cross-midnight midday');
  assert.equal(T.timeActive(9 * 60, 17 * 60, 9 * 60), true, 'start minute inclusive');
  assert.equal(T.timeActive(9 * 60, 17 * 60, 17 * 60), false, 'end minute exclusive');
  assert.equal(T.timeActive(600, 600, 600), false, 'equal bounds are zero-length');
  assert.equal(T.timeActive(NaN, 10, 5), false, 'non-finite fails closed');
  ok('timeActive: half-open, cross-midnight wrap, equal-bounds zero-length');
}

/* ---------------- matching: weekday / date window / disabled ---------------- */
{
  // 2026-08-19 is a Wednesday.
  const wedNoon = new Date(2026, 7, 19, 12, 0);
  const weekdaysOnly = rule({ startTime: '00:00', endTime: '23:59', days: [1, 3] }); // Mon+Wed
  assert.equal(T.ruleMatchesAt(weekdaysOnly, wedNoon), true, 'Wednesday in Mon/Wed set');
  assert.equal(
    T.ruleMatchesAt(rule({ startTime: '00:00', endTime: '23:59', days: [6] }), wedNoon),
    false,
    'Wednesday not in Sat set',
  );
  const inWindow = rule({ startDate: '2026-08-01', endDate: '2026-08-31', startTime: '00:00', endTime: '23:59' });
  assert.equal(T.ruleMatchesAt(inWindow, wedNoon), true, 'inside inclusive date window');
  assert.equal(
    T.ruleMatchesAt(inWindow, new Date(2026, 8, 1, 12, 0)),
    false,
    'day after endDate excluded (inclusive both ends inside)',
  );
  assert.equal(T.ruleMatchesAt(rule({ enabled: false }), wedNoon), false, 'disabled never matches');
  ok('matching: explicit weekday set vs every-day, inclusive date window, disabled gate');
}

/* ---------------- precedence: later rule wins ---------------- */
{
  const at = new Date(2026, 7, 19, 23, 0); // Wed 23:00 — inside both windows below
  const sched = {
    version: 1,
    rules: [
      rule({ id: 'sch-a0000001', target: 'theme', value: 'dark', startTime: '22:00', endTime: '06:00' }),
      rule({ id: 'sch-b0000002', target: 'theme', value: 'light', startTime: '20:00', endTime: '23:30', enabled: true }),
      rule({ id: 'sch-c0000003', target: 'language', value: 'zh', startTime: '00:00', endTime: '23:59' }),
    ],
  };
  const winners = T.resolveWinners(sched, at);
  assert.equal(winners.get('theme').value, 'light', 'LATER matching theme rule wins');
  assert.equal(winners.get('language').value, 'zh');
  // Disabled later rule must NOT steal precedence: at 22:30 only rule A matches.
  sched.rules[1].enabled = false;
  assert.equal(T.resolveWinners(sched, at).get('theme').value, 'dark', 'disabled rule drops out of precedence');
  // At noon only the all-day language rule matches — no theme override.
  const noonWinners = T.resolveWinners(sched, new Date(2026, 7, 19, 12, 0));
  assert.equal(noonWinners.has('theme'), false, 'no theme winner at noon');
  assert.equal(noonWinners.get('language').value, 'zh', 'all-day language rule still wins its target');
  ok('precedence: last enabled+matching rule wins per target; none otherwise');
}

/* ---------------- nextActivation (bounded scan) ---------------- */
{
  const noon = new Date(2026, 7, 19, 12, 0);
  const nightly = rule({ startTime: '22:00', endTime: '23:00' });
  const nx = T.nextActivation(nightly, noon, 14);
  assert.ok(nx, 'found next activation');
  assert.equal(nx.getHours(), 22, 'lands on start hour');
  assert.equal(nx.getDate(), 19, 'same evening');
  const never = rule({ startTime: '03:00', endTime: '03:00', days: 'every' }); // zero-length
  assert.equal(T.nextActivation(never, noon), null, 'zero-length window never activates');
  const off = rule({ startTime: '03:00', endTime: '04:00' });
  const nxOff = T.nextActivation(off, noon);
  assert.equal(nxOff.getDate(), 20, 'rolls to following day');
  ok('nextActivation: same-evening, rollover, and never cases');
}

/* ---------------- journal: append-only + immutable ---------------- */
{
  const j0 = T.emptyJournal();
  const t0 = new Date('2026-08-19T10:00:00Z');
  const a = T.commitEntry(j0, { action: 'created', subject: 'setting:lang', after: 'en' }, t0);
  assert.equal(a.journal.entries.length, 1);
  assert.deepEqual(j0.entries, [], 'input journal NEVER mutated (append-only via new object)');
  assert.equal(a.entry.seq, 1);

  const b = T.commitEntry(a.journal, { action: 'updated', subject: 'setting:lang', before: 'en', after: 'zh' }, new Date(t0.getTime() + 1000));
  assert.equal(b.entry.seq, 2);
  assert.equal(b.journal.entries.length, 2);
  assert.equal(b.journal.entries[0].id, a.entry.id, 'history preserved');

  assert.throws(() => T.commitEntry(j0, { action: 'exploded', subject: 'x' }), /unknown-action/, 'unknown action rejected');
  assert.throws(() => T.commitEntry(j0, { action: 'created', subject: '' }), /bad-subject/, 'empty subject rejected');

  // Snapshot bounding: oversized values stored truncated and marked unreplayable.
  const big = { blob: 'x'.repeat(9000) };
  const c = T.commitEntry(b.journal, { action: 'updated', subject: 'setting:big', before: big, after: big });
  assert.equal(c.entry.before.__truncated, true);
  assert.equal(T.snapIsReplayable(c.entry.before), false);
  ok('journal: immutable appends, seq order, action/subject guards, snapshot bounding');
}

/* ---------------- restore semantics: undo-of-undo ---------------- */
/*
 * Model state as a variable; each helper mimics journalApply's
 * read-commit-write against one revision snapshot.
 *   restoreState(rev): make rev.AFTER current ("Restore this state")
 *   undoChange(rev):   make rev.BEFORE current ("Undo this change")
 * Round trip: create(en) -> update(zh) -> undo(update)=en -> undo(undo)=zh.
 */
{
  let live = undefined; // absent
  let j = T.emptyJournal();

  function record(action, before, after) {
    const r = T.commitEntry(j, { action, subject: 'setting:lang', before, after });
    j = r.journal;
    return r.entry;
  }
  function restoreState(rev) {
    record('restored', live, rev.after ?? null);
    live = rev.after ?? null;
  }
  function undoChange(rev) {
    record('restored', live, rev.before ?? null);
    live = rev.before ?? null;
  }

  record('created', undefined, 'en');
  live = 'en';
  record('updated', 'en', 'zh');
  live = 'zh';
  const updateRev = j.entries.at(-1);

  undoChange(updateRev); // undo the update -> back to 'en'
  assert.equal(live, 'en', 'undo returns previous state as a NEW revision');
  const undoRev = j.entries.at(-1);
  assert.equal(undoRev.action, 'restored');

  undoChange(undoRev); // undo the UNDO -> its before-state 'zh' again
  assert.equal(live, 'zh', 'undo of undo restores forward state');
  assert.equal(j.entries.length, 4, 'every step appended; nothing rewritten');
  assert.equal(j.entries[1].after, 'zh', 'original revisions untouched by restores');

  restoreState(updateRev); // explicit "Restore this state" also lands on 'zh'
  assert.equal(live, 'zh');

  // Restoring a DELETED revision's after-state (null) re-deletes.
  record('deleted', 'zh', null);
  live = null;
  const delRev = j.entries.at(-1);
  restoreState(delRev); // after is null -> applying it removes again
  assert.equal(live, null, 'restoring an absent after-state re-deletes (documented)');
  ok('restore semantics: new-revision restore, undo-of-undo, absent-state handling');
}

/* ---------------- retention policies ---------------- */
{
  const now = new Date('2026-08-19T12:00:00Z');
  let j = T.emptyJournal();
  for (let i = 0; i < 30; i++) {
    j = T.commitEntry(j, { action: 'updated', subject: `s${i}`, after: i }, new Date(now.getTime() - (29 - i) * 86400000)).journal;
  }
  const keepCount = T.applyPolicy(j, { mode: 'keep-count', count: 10 }, now);
  assert.equal(keepCount.removedCount, 20);
  assert.equal(keepCount.journal.entries.length, 10);
  assert.equal(keepCount.journal.entries[0].subject, 's20', 'keeps the NEWEST');

  const keepDays = T.applyPolicy(j, { mode: 'keep-days', days: 7 }, now);
  assert.equal(keepDays.journal.entries.length, 8, 'entries strictly newer than cutoff kept (7d boundary)');
  assert.equal(T.applyPolicy(j, { mode: 'keep-all' }).removedCount, 0);
  ok('retention: keep-count keeps newest N; keep-days uses day cutoff; keep-all prunes nothing');
}

/* ---------------- redaction + diffs ---------------- */
{
  const red = T.redactValue({ apiKey: 'sk-123', password: 'hunter2', nested: { authToken: 't', note: 'fine' }, keep: 'visible' });
  assert.equal(red.apiKey, '[redacted]');
  assert.equal(red.password, '[redacted]');
  assert.equal(red.nested.authToken, '[redacted]');
  assert.equal(red.nested.note, 'fine');
  assert.equal(red.keep, 'visible');

  const lines = T.diffSnapshots({ lang: 'en', theme: 'light', gone: 1 }, { lang: 'zh', theme: 'light' });
  const kinds = Object.fromEntries(lines.map((l) => [l.path, l.kind]));
  assert.equal(kinds['lang'], 'changed');
  assert.equal(kinds['gone'], 'removed');
  assert.ok(!lines.some((l) => l.path === 'theme'), 'unchanged fields produce NO diff line');
  ok('redaction of credential-shaped keys; field-level diff only where changed');
}

/* ---------------- COPY audit: every L() key used resolves ---------------- */
{
  const src = fs.readFileSync(path.join(here, '..', 'site', 'assets', 'js', 'toys-ops.js'), 'utf8');
  const staticKeys = new Set();
  for (const m of src.matchAll(/\bL\('([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) staticKeys.add(m[1]);
  const shared = (await import(pathToFileURL(path.join(here, '..', 'site', 'assets', 'js', 'i18n.js')).href)).DICT;
  const missing = [...staticKeys].filter((k) => !(k in T.COPY) && !(k in shared));
  assert.equal(missing.length, 0, `missing COPY keys: ${missing.join(', ')}`);
  // Dynamic prefixes used via template literals:
  const dynamic = ['hist.action.', 'sched.target.', 'common.level'];
  for (const k of Object.keys(T.COPY)) {
    if (dynamic.some((p) => k.startsWith(p))) continue;
    assert.ok(T.COPY[k].en && T.COPY[k].zh, `COPY.${k} needs BOTH languages`);
  }
  ok(`COPY audit: ${staticKeys.size} statically referenced keys resolve; bilingual pairs complete`);
}

/* ---------------- L()/L2() behaviour through i18n defaults ---------------- */
{
  // Default language is 'en' with funny level 5 -> spice prefix expected.
  const plain = T.L('hist.tab');
  assert.match(plain, /Version history/, 'English primary text present');
  const zh = T.L2('hist.tab'); // other-language line in EN mode is zh
  assert.ok(zh && zh !== plain, 'bilingual secondary differs from primary');
  ok('localized resolution + bilingual secondary line behave');
}

console.log(`\ntest-toys-ops: ${passed} checks passed`);
