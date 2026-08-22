/**
 * TOYS II — Scheduled settings · Local version history · Bulk actions ·
 * Super-confirmation integration.
 *
 * Everything here is local-only: localStorage through store.js (ccr-site.*),
 * zero network, zero telemetry. External schedule sources (validated HTTPS
 * APIs, Home Assistant entities) are OUT OF SCOPE for a fully static offline
 * site and are documented as such in the scheduled surface instead of being
 * faked.
 *
 * Structure:
 *   COPY            localized copy table ({en, zh, spice?}), same contract as
 *                   i18n.DICT; L()/L2() resolve language + funny level without
 *                   touching the shared dictionary (this module stays mergeable).
 *   Schedule engine pure: parse/validate (versioned, bounded schema),
 *                   timeActive (half-open windows, cross-midnight wrap,
 *                   equal-bounds = zero length), ruleMatchesAt (local
 *                   wall-clock incl. DST), resolveWinners (later rule wins),
 *                   summarizeRule, nextActivation (bounded scan).
 *   Journal pure:   append-only commits (immutable updates), action counts
 *                   derived from the journal itself, filtering, field-level
 *                   diffs, retention policies, redaction for exports.
 *   UI:             createBulkList (multi-select, shift-click, keyboard,
 *                   pagination, THIS PAGE vs EVERY MATCH, chunked cancellable
 *                   progress), dateRangePicker (calendar + typed dates),
 *                   scheduled panel, history panel, override applier.
 *
 * Guarded for Node import: pure logic exports cleanly, DOM work happens only
 * inside init functions.
 */
import * as store from './store.js';
import * as i18n from './i18n.js';
import * as theme from './theme.js';
import { publishRainbowGlobals } from './color.js';
import { el, append, clear, positionPopover } from './util.js';
import { attachSearchField } from './search.js';
import { openDialog, promptDialog } from './dialog.js';
import { superConfirm } from './superconfirm.js';

const inBrowser = typeof document !== 'undefined';

/** Small pill button shared by every panel (module scope so all can use it). */
function chipBtn(label, fn) {
  const b = el('button', { class: 'chip', type: 'button', children: [label] });
  b.style.cursor = 'pointer';
  b.addEventListener('click', fn);
  return b;
}

/* ========================================================================== *
 * Localized copy. Facts identical across languages; spice adds flavour only.
 * ========================================================================== */
export const COPY = {
  'ops.title': { en: 'Scheduled settings & version history', zh: '排程設定同版本歷史' },
  'ops.lede': {
    en: 'Schedule this site\'s language, theme and appearance values, and browse an append-only local history of every change you make. All state lives in this browser.',
    zh: '排程呢個網站嘅語言、主題同外觀數值，並且瀏覽你每一次改動嘅只加不減本機歷史。所有狀態都只存喺呢個瀏覽器。',
  },
  'ops.openFull': { en: 'Open the full operations page', zh: '開啟完整操作頁' },
  'brand.aria2': { en: 'Claude Code Router home', zh: 'Claude Code Router 主頁' },
  'notify.centre.short': { en: 'Notification centre', zh: '通知中心' },
  'palette.cmds': { en: 'Commands', zh: '指令' },
  'ops.tabsAria': { en: 'Operations sections', zh: '操作分區' },
  'ops.storageNote': {
    en: 'Everything on this page is stored only in this browser. There are no accounts, no network calls and no sync — clearing this site\'s storage resets all of it.',
    zh: '呢一頁嘅所有嘢都只存喺呢個瀏覽器。冇帳戶、冇網絡請求、冇同步——清走呢個網站嘅儲存就全部重設。',
  },

  'sched.tab': { en: 'Scheduled settings', zh: '排程設定' },
  'hist.tab': { en: 'Version history', zh: '版本歷史' },
  'guide.tab': { en: 'How it works', zh: '運作說明' },
  'guide.title': { en: 'Semantics, precedence and boundaries', zh: '語義、優先次序同邊界' },
  'guide.sched.h': { en: 'Schedule semantics', zh: '排程語義' },
  'guide.sched.items': {
    en: 'Time windows are half-open: the start minute is included, the end minute is not. A window whose start equals its end is zero-length and never activates — stated here rather than hidden. A window whose start is later than its end wraps past midnight into the following day. Dates are inclusive on both ends. "Every day" covers every day inside the date window; it never expands into duplicated per-weekday rules. All matching uses your device\'s local wall-clock time: during daylight-saving shifts a repeated hour simply matches twice and a skipped hour never matches — no UTC conversion happens anywhere.',
    zh: '時間窗係半開：開始嗰分鐘計，結束嗰分鐘唔計。開始等如結束嘅窗係零長度、永遠唔會啟動——寫到明，唔會收收埋埋。開始遲過結束就係過午夜，伸延到第二日。日期兩端都計在內。「每日」涵蓋日期窗內嘅每一日，絕對唔會拆做重複嘅逐日規則。全部匹配都用你部機嘅本地時鐘：夏令時間撥慢嗰個鐘會匹配兩次、撥快跳過嗰個鐘就一次都唔會——成個引擎零 UTC 換算。',
  },
  'guide.precedence.h': { en: 'Precedence', zh: '優先次序' },
  'guide.precedence.items': {
    en: 'Rules live in an ordered list with stable ids. At any moment, among the ENABLED rules that currently match, the LAST one in the list wins for its target. Move a rule up or down to re-prioritize; the ordering is deterministic and survives reloads. When no rule matches, your base settings come straight back — the pre-override value is captured once, restored exactly, and the capture is cleared.',
    zh: '規則存喺有序清單入面，每條都有穩定 ID。任何一刻，喺「已啟用而且當前匹配」嘅規則之中，排最後嗰條就係佢目標嘅贏家。想重排優先次序就上移落移；次序明確，重新載入都唔會變。冇規則匹配時，基礎設定即刻返嚟——覆寫前嘅數值只捕獲一次、原原本本還原，然後清走捕獲。',
  },
  'guide.sources.h': { en: 'Sources — what is honestly out of scope', zh: '資料來源——老實講清楚邊啲做唔到' },
  'guide.sources.items': {
    en: 'A fully static offline site cannot safely poll a Home Assistant boolean or a remote settings API, so those sources are NOT simulated here — a fake toggle would be worse than no toggle. Every rule on this site reads its value from the local value you type below. If you need external sources, that belongs to a runtime with a privileged network boundary.',
    zh: '一個純靜態離線網站冇得安全咁輪詢 Home Assistant 布林值或者遠端設定 API，所以呢度絕不假裝支援——假的開關比冇開關更衰。本站每條規則都只用你下面輸入嘅本地數值。想要外部來源，嗰個要交俾有特權網絡邊界嘅運行時先做得。',
  },
  'guide.hist.h': { en: 'History semantics', zh: '歷史語義' },
  'guide.hist.items': {
    en: 'History is append-only: restoring records a NEW revision and never rewrites old ones, so undoing an undo is always possible. Pruning follows your explicit retention policy and is itself recorded. Exports redact credential-shaped values and say so. Deleting history revisions permanently is the one operation nothing can bring back.',
    zh: '歷史係只加不減：還原會記錄一筆全新修訂，舊修訂永不被改寫，所以「還原個還原」永遠都得。清理跟足你明確設定嘅保留政策，而清理本身都會被記錄。匯出會遮走憑證形狀嘅數值並且講明。永久刪除歷史修訂係唯一冇人救得返嘅操作。',
  },
  'guide.bulk.h': { en: 'Bulk actions', zh: '批量操作' },
  'guide.bulk.items': {
    en: 'Every list on the operations page supports multi-select (click, Shift-click ranges, keyboard), select-all that says plainly whether it means THIS PAGE or EVERY MATCH, inverse selection, bulk export honouring the active filters, and bulk delete behind the destructive super confirmation with honest partial results when you cancel mid-run. The notification centre ships the same contract; other surfaces can import createBulkList from this module.',
    zh: '操作頁上每個清單都支援多選（click、Shift 範圍揀、鍵盤操作），全揀會講清楚係「呢一頁」定「所有符合」，仲有反轉揀法、跟足現行篩選嘅批量匯出，以及行超級確認先准嘅批量刪除——中途取消都會老實匯報部分結果。通知中心已經有同一套合約；其他界面可以直接由本模組 import createBulkList。',
  },

  'sched.tz.note': {
    en: 'Times use this device\'s local timezone: {tz} (UTC{off}). Wall-clock matching follows DST shifts — see How it works.',
    zh: '時間用呢部機嘅本地時區：{tz}（UTC{off}）。牆上鐘匹配會跟夏令時間——詳細睇「運作說明」。',
  },
  'sched.active.now': { en: 'Active right now', zh: '此刻生效' },
  'sched.none.now': { en: 'No override active — your base settings are in effect.', zh: '目前冇覆寫——你嘅基礎設定生效中。', spice: { en: '(the site is exactly as you left it)', zh: '（個網站跟你上次留低嘅一模一樣）' } },
  'sched.rules.h': { en: 'Rules', zh: '規則' },
  'sched.addRule': { en: 'Add rule', zh: '加入規則' },
  'sched.refresh': { en: 'Re-check now', zh: '即刻再查' },
  'sched.empty': { en: 'No rules yet. Add one to schedule a language, theme or rainbow-speed change.', zh: '仲未有規則。加一條去排程語言、主題或者彩虹速度嘅變化。' },
  'sched.rule.enabled': { en: 'Enabled', zh: '已啟用' },
  'sched.rule.disabledTag': { en: 'disabled', zh: '停用中' },
  'sched.rule.next': { en: 'Next active: {when}', zh: '下次生效：{when}' },
  'sched.rule.never': { en: 'Not active within the next 14 days', zh: '未來 14 日都唔會生效' },
  'sched.everyday': { en: 'Every day', zh: '每日' },
  'sched.days': { en: 'Days', zh: '星期幾' },
  'sched.editRule': { en: 'Edit rule', zh: '編輯規則' },
  'sched.newRule': { en: 'New rule', zh: '新規則' },
  'sched.f.label': { en: 'Label', zh: '名稱' },
  'sched.f.target': { en: 'Setting to schedule', zh: '要排程嘅設定' },
  'sched.f.value': { en: 'Value while active', zh: '生效期間嘅數值' },
  'sched.f.startDate': { en: 'Start date (optional)', zh: '開始日期（可選）' },
  'sched.f.endDate': { en: 'End date (optional)', zh: '結束日期（可選）' },
  'sched.f.startTime': { en: 'Start time', zh: '開始時間' },
  'sched.f.endTime': { en: 'End time', zh: '結束時間' },
  'sched.preview': { en: 'Summary', zh: '摘要' },
  'sched.err.label': { en: 'Give the rule a name (1–80 characters).', zh: '幫規則改個名（1 至 80 字元）。' },
  'sched.err.date': { en: 'Complete the date as YYYY-MM-DD.', zh: '日期要補完，格式 YYYY-MM-DD。' },
  'sched.err.dateOrder': { en: 'Start date must not be after the end date.', zh: '開始日期唔可以遲過結束日期。' },
  'sched.err.time': { en: 'Complete the time as HH:MM (24-hour).', zh: '時間要補完，24 小時制 HH:MM。' },
  'sched.err.days': { en: 'Pick at least one weekday, or choose "Every day".', zh: '至少揀一個星期幾，或者揀「每日」。' },
  'sched.err.value': { en: 'Pick a value for the chosen setting.', zh: '為所選設定揀一個數值。' },
  'sched.err.maxRules': { en: 'The schedule already holds the maximum of {n} rules — delete one first.', zh: '排程已經有最多 {n} 條規則——先刪一條。' },
  'sched.zeroLen': { en: 'Zero-length window (start equals end) — this rule never activates.', zh: '零長度時間窗（開始等如結束）——呢條規則永遠唔會啟動。' },
  'sched.crossMid': { en: 'Crosses midnight — active from the start time through the end time on the following day.', zh: '跨午夜——由開始時間一直生效到第二日嘅結束時間。' },
  'sched.target.language': { en: 'Language mode', zh: '語言模式' },
  'sched.target.theme': { en: 'Theme', zh: '主題' },
  'sched.target.rainbow': { en: 'Rainbow speed (level)', zh: '彩虹速度（級別）' },
  'sched.moveUp': { en: 'Move up (lower precedence)', zh: '上移（優先次序較低）' },
  'sched.moveDown': { en: 'Move down (higher precedence — wins ties)', zh: '下移（優先次序較高——撞車時贏）' },
  'sched.deleteRule': { en: 'Delete rule', zh: '刪除規則' },
  'sched.resetAll': { en: 'Delete ALL rules', zh: '刪除所有規則' },
  'sched.super.reset.title': { en: 'Delete all {n} schedule rule(s)?', zh: '刪除全部 {n} 條排程規則？' },
  'sched.super.reset.body': {
    en: 'Base settings return immediately. Deleted rules stay recoverable through Version history (restore the revision).',
    zh: '基礎設定即刻還原。刪走嘅規則可以喺版本歷史救返（還原嗰筆修訂）。',
  },
  'sched.saved': { en: 'Rule saved. {n} active rule(s) now.', zh: '規則已儲存。現在 {n} 條生效規則。' },
  'sched.deleted': { en: 'Deleted {n} rule(s). Base settings restored where they applied.', zh: '刪除咗 {n} 條規則。受影響嘅基礎設定已還原。' },
  'sched.applied': { en: 'Override applied: {target} → {value}', zh: '已套用覆寫：{target} → {value}' },
  'sched.restoredBase': { en: 'Override ended — base settings restored.', zh: '覆寫完結——基礎設定已還原。' },

  'hist.empty': { en: 'Nothing recorded yet. Changes you make on this site appear here automatically.', zh: '仲未有記錄。你喺呢個網站嘅改動會自動出現喺度。' },
  'hist.title': { en: 'Local version history', zh: '本機版本歷史' },
  'hist.appendOnlyNote': {
    en: 'Append-only: restores become new revisions; nothing is rewritten. Views and exports redact credential-shaped values — restore always uses the untouched local copy.',
    zh: '只加不減：還原會變成一筆新修訂；乜都唔會被改寫。檢視同匯出都會遮走憑證形狀嘅數值——還原永遠用未經修改嘅本機副本。',
  },
  'hist.action.created': { en: 'created', zh: '新建' },
  'hist.action.updated': { en: 'updated', zh: '更新' },
  'hist.action.deleted': { en: 'deleted', zh: '刪除' },
  'hist.action.restored': { en: 'restored', zh: '還原' },
  'hist.action.labeled': { en: 'labeled', zh: '標註' },
  'hist.action.pruned': { en: 'pruned', zh: '清理' },
  'hist.actions.all': { en: 'All actions', zh: '全部動作' },
  'hist.search': { en: 'Search revisions…', zh: '搜尋修訂…' },
  'hist.page': { en: 'Page {p} of {P}', zh: '第 {p} 頁，共 {P} 頁' },
  'hist.scope.page': { en: 'this page', zh: '呢一頁' },
  'hist.scope.all': { en: 'the whole list', zh: '整個清單' },
  'hist.counts': {
    en: '{shown} shown · {sel} selected · select-all applies to {scope} · page {p}/{P}',
    zh: '顯示 {shown} 筆 · 已揀 {sel} 筆 · 全揀範圍係{scope} · 第 {p}/{P} 頁',
  },
  'hist.sel.page': { en: 'Select all — THIS PAGE', zh: '全揀——呢一頁' },
  'hist.sel.match': { en: 'Select EVERY MATCH ({n})', zh: '揀晒所有符合（{n}）' },
  'hist.sel.invert': { en: 'Invert selection', zh: '反轉揀法' },
  'hist.sel.clear': { en: 'Clear selection', zh: '清空所選' },
  'hist.deleting': { en: 'Deleting', zh: '正在刪除' },
  'hist.from': { en: 'From date', zh: '由邊日' },
  'hist.to': { en: 'To date', zh: '到邊日' },
  'hist.date.any': { en: 'Any time', zh: '任何時間' },
  'hist.date.pick': { en: 'Date range…', zh: '日期範圍…' },
  'hist.date.invalid': { en: 'That date could not be read. Use YYYY-MM-DD or your locale format — your typing is kept so you can finish it.', zh: '睇唔明呢個日期。用 YYYY-MM-DD 或者你慣用格式——你打嘅字會保留俾你補完。' },
  'hist.cal.prevMonth': { en: 'Previous month', zh: '上一個月' },
  'hist.cal.nextMonth': { en: 'Next month', zh: '下一個月' },
  'hist.cal.prevYear': { en: 'Previous year', zh: '上一年' },
  'hist.cal.nextYear': { en: 'Next year', zh: '下一年' },
  'hist.presets.today': { en: 'Today', zh: '今日' },
  'hist.presets.d7': { en: 'Last 7 days', zh: '最近 7 日' },
  'hist.presets.d30': { en: 'Last 30 days', zh: '最近 30 日' },
  'hist.presets.any': { en: 'Any time', zh: '任何時間' },
  'hist.policy.count': { en: 'Keep newest N revisions', zh: '保留最新 N 筆修訂' },
  'hist.policy.days': { en: 'Keep newer than N days', zh: '保留最近 N 日' },
  'hist.detail': { en: 'Revision detail', zh: '修訂詳情' },
  'hist.diff.vsPrev': { en: 'Diff vs previous revision of "{subject}"', zh: '同「{subject}」上一筆修訂嘅差異' },
  'hist.diff.none': { en: 'First revision of this record — nothing earlier to diff against.', zh: '呢個記錄嘅第一筆修訂——之前冇嘢可比。' },
  'hist.restore': { en: 'Restore this state', zh: '還原至此狀態' },
  'hist.undo': { en: 'Undo this change', zh: '復原此改動' },
  'hist.restoreAbsent': { en: 'This revision\'s resulting state is "absent", so restoring re-deletes the record.', zh: '呢筆修訂之後嘅狀態係「不存在」，還原即係再次刪除該記錄。' },
  'hist.beforeAbsent': { en: 'This revision\'s previous state is "absent" (the record was created), so undo removes it again.', zh: '呢筆修訂之前嘅狀態係「不存在」（即係新建），復原即係再刪一次。' },
  'hist.truncatedSnap': { en: 'Snapshot too large to replay — stored truncated, restore disabled for this revision.', zh: '快照太大無法重放——只儲存咗截斷版，呢筆修訂停用還原。' },
  'hist.restoredDone': { en: 'Recorded as a new revision (#{seq}).', zh: '已記錄為新修訂（#{seq}）。' },
  'hist.label.rev': { en: 'Label this revision…', zh: '標註呢筆修訂…' },
  'hist.labeled': { en: 'Label recorded as a new revision.', zh: '標註已記錄為新修訂。' },
  'hist.retention': { en: 'Retention policy', zh: '保留政策' },
  'hist.policy.keepAll': { en: 'Keep everything', zh: '全部保留' },
  'hist.policy.keepCount': { en: 'Keep the newest {n} revisions', zh: '保留最新 {n} 筆修訂' },
  'hist.policy.keepDays': { en: 'Keep revisions newer than {n} days', zh: '保留最近 {n} 日內嘅修訂' },
  'hist.prune.run': { en: 'Prune now', zh: '即刻清理' },
  'hist.prune.super.title': { en: 'Permanently remove {n} old revision(s)?', zh: '永久移除 {n} 筆舊修訂？' },
  'hist.prune.super.body': {
    en: 'Pruned revisions cannot be recovered — this is the one delete with no undo. The prune itself is recorded as a new revision.',
    zh: '被清理嘅修訂救唔返——呢個係唯一冇得復原嘅刪除。清理本身會記錄為一筆新修訂。',
  },
  'hist.pruned': { en: 'Pruned {n} revision(s); kept {m}. Recorded as revision #{seq}.', zh: '清理咗 {n} 筆修訂；保留 {m} 筆。已記錄為修訂 #{seq}。' },
  'hist.export': { en: 'Export (redacted JSON)', zh: '匯出（已遮蔽 JSON）' },
  'hist.exported': { en: 'Exported {n} revision(s). Credential-shaped values replaced with [redacted].', zh: '已匯出 {n} 筆修訂。憑證形狀嘅數值已換成 [redacted]。' },
  'hist.bulk.delete': { en: 'Delete selected permanently', zh: '永久刪除所選' },
  'hist.bulk.export': { en: 'Export selected', zh: '匯出所選' },
  'hist.super.delete.title': { en: 'Permanently delete {n} revision(s)?', zh: '永久刪除 {n} 筆修訂？' },
  'hist.super.delete.body': {
    en: 'History deletions are permanent — unlike restores, nothing records them and nothing can bring them back.',
    zh: '歷史刪除係永久嘅——同還原唔同，冇記錄、冇得救。',
  },
  'hist.deleted': { en: 'Deleted {n} revision(s).', zh: '刪除咗 {n} 筆修訂。' },
  'hist.cancelledAfter': { en: 'Cancelled — {done} deleted, {left} left untouched.', zh: '已取消——刪咗 {done} 筆，{left} 筆原封不動。' },
};

/** Resolve one COPY entry honouring language + funny level (same shape as i18n).
 *  Keys missing from this module's table fall through to the shared i18n
 *  dictionary, so common.* strings are reused rather than duplicated. */
export function L(key, vars) {
  const entry = COPY[key];
  if (!entry && typeof i18n.DICT === 'object' && i18n.DICT[key]) return i18n.t(key, vars);
  if (!entry) return key;
  const lang = i18n.getLang() === 'zh' ? 'zh' : 'en';
  let out = lang === 'zh' ? entry.zh ?? entry.en : entry.en;
  const level = i18n.funnyLevel(lang);
  if (level >= 4 && entry.spice) {
    const sp = lang === 'zh' ? entry.spice.zh ?? entry.spice.en : entry.spice.en;
    if (sp) out = `${sp} ${out}`;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
/** Secondary (other-language) line for bilingual mode. */
export function L2(key) {
  const entry = COPY[key];
  if (!entry) return '';
  const primaryZh = i18n.getLang() === 'zh';
  return primaryZh ? entry.en : entry.zh ?? '';
}

/* ========================================================================== *
 * Schedule engine — pure functions.
 * ========================================================================== */
export const SCHEDULE_VERSION = 1;
export const MAX_RULES = 100;
export const LABEL_MAX = 80;
export const SCHEDULE_STORE_KEY = 'ops.schedule.v1';

export const SCHED_TARGETS = ['language', 'theme', 'rainbow'];
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // 0 = Sunday, matches Date.getDay()

export function emptySchedule() {
  return { version: SCHEDULE_VERSION, rules: [] };
}

/** Strict HH:MM (24h) -> minutes since midnight, or null. Partial input fails. */
export function parseTime(t) {
  if (typeof t !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Strict real-calendar YYYY-MM-DD, or null. Partial input fails. */
export function parseDateStr(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return s;
}

/**
 * Half-open time-window membership. Documented semantics:
 *  - start <  end : start <= t < end          (normal)
 *  - start >  end : t >= start || t < end     (cross-midnight wrap)
 *  - start === end: false                     (zero-length, never active)
 */
export function timeActive(startMin, endMin, tMin) {
  if (![startMin, endMin, tMin].every(Number.isFinite)) return false;
  if (startMin === endMin) return false;
  if (startMin < endMin) return tMin >= startMin && tMin < endMin;
  return tMin >= startMin || tMin < endMin;
}

function isoDateOf(at) {
  const p = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/**
 * Validate + normalize a schedule document against the versioned bounded
 * schema. Unknown fields, unknown versions, oversized arrays and bad enums are
 * REJECTED (fail closed), never silently dropped.
 * @returns {{ok: true, schedule: object}|{ok: false, errors: string[]}}
 */
export function validateSchedule(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: ['not-an-object'] };
  if (doc.version !== SCHEDULE_VERSION) return { ok: false, errors: [`unsupported-version:${String(doc.version)}`] };
  if (!Array.isArray(doc.rules)) return { ok: false, errors: ['rules-not-array'] };
  if (doc.rules.length > MAX_RULES) return { ok: false, errors: [`too-many-rules:${doc.rules.length}`] };
  const seenIds = new Set();
  const rules = [];
  doc.rules.forEach((r, i) => {
    const where = `rule[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return errors.push(`${where}:not-object`);
    const ALLOWED = ['id', 'label', 'enabled', 'target', 'value', 'startDate', 'endDate', 'startTime', 'endTime', 'days'];
    for (const k of Object.keys(r)) if (!ALLOWED.includes(k)) return errors.push(`${where}:unknown-field:${k}`);
    if (typeof r.id !== 'string' || !/^sch-[a-z0-9]{4,16}$/.test(r.id)) return errors.push(`${where}:bad-id`);
    if (seenIds.has(r.id)) return errors.push(`${where}:duplicate-id:${r.id}`);
    seenIds.add(r.id);
    if (typeof r.label !== 'string' || r.label.length < 1 || r.label.length > LABEL_MAX) return errors.push(`${where}:bad-label`);
    if (typeof r.enabled !== 'boolean') return errors.push(`${where}:bad-enabled`);
    if (!SCHED_TARGETS.includes(r.target)) return errors.push(`${where}:bad-target`);
    if (r.target === 'language' && !['en', 'zh', 'bi'].includes(r.value)) return errors.push(`${where}:bad-value`);
    if (r.target === 'theme' && !['light', 'dark', 'auto'].includes(r.value)) return errors.push(`${where}:bad-value`);
    if (r.target === 'rainbow') {
      const n = Number(r.value);
      if (!Number.isInteger(n) || n < 1 || n > 5) return errors.push(`${where}:bad-value`);
    }
    if (typeof r.value !== 'string' || r.value.length > 40) return errors.push(`${where}:bad-value-type`);
    let startDate = null;
    let endDate = null;
    if (r.startDate != null) {
      startDate = parseDateStr(r.startDate);
      if (!startDate) return errors.push(`${where}:bad-startDate`);
    }
    if (r.endDate != null) {
      endDate = parseDateStr(r.endDate);
      if (!endDate) return errors.push(`${where}:bad-endDate`);
    }
    if (startDate && endDate && startDate > endDate) return errors.push(`${where}:inverted-date-window`);
    const startMin = parseTime(r.startTime ?? '00:00');
    const endMin = parseTime(r.endTime ?? '00:00');
    if (startMin == null) return errors.push(`${where}:bad-startTime`);
    if (endMin == null) return errors.push(`${where}:bad-endTime`);
    let days = 'every';
    if (r.days !== 'every') {
      if (!Array.isArray(r.days) || r.days.length < 1 || r.days.length > 7) return errors.push(`${where}:bad-days`);
      const uniq = [...new Set(r.days)];
      if (uniq.length !== r.days.length) return errors.push(`${where}:duplicate-days`);
      if (!uniq.every((d) => Number.isInteger(d) && WEEKDAYS.includes(d))) return errors.push(`${where}:bad-day-value`);
      days = [...uniq].sort((a, b) => a - b);
    }
    rules.push({
      id: r.id,
      label: r.label,
      enabled: r.enabled,
      target: r.target,
      value: r.value,
      startDate,
      endDate,
      startTime: r.startTime ?? '00:00',
      endTime: r.endTime ?? '00:00',
      days,
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, schedule: { version: SCHEDULE_VERSION, rules } };
}

/** Does the rule's optional date window include this local date (inclusive)? */
export function ruleCoversDate(rule, isoDate) {
  if (rule.startDate && isoDate < rule.startDate) return false;
  if (rule.endDate && isoDate > rule.endDate) return false;
  return true;
}

/**
 * Full local-wall-clock match (date window + weekday + time window).
 * Disabled rules never match here; callers decide how to report them.
 */
export function ruleMatchesAt(rule, at) {
  if (!rule.enabled) return false;
  const iso = isoDateOf(at);
  if (!ruleCoversDate(rule, iso)) return false;
  if (rule.days !== 'every' && !rule.days.includes(at.getDay())) return false;
  const tMin = at.getHours() * 60 + at.getMinutes();
  return timeActive(parseTime(rule.startTime), parseTime(rule.endTime), tMin);
}

/**
 * Deterministic precedence: scan rules in ORDER; among enabled+matching rules
 * the LAST one for each target wins. Returns Map(target -> rule).
 */
export function resolveWinners(schedule, at = new Date()) {
  const winners = new Map();
  for (const rule of schedule.rules) {
    if (ruleMatchesAt(rule, at)) winners.set(rule.target, rule);
  }
  return winners;
}

export function newRuleId(now = Date.now()) {
  return 'sch-' + now.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Human-readable summary of one rule (localized). */
export function summarizeRule(rule) {
  const days =
    rule.days === 'every'
      ? L('sched.everyday')
      : rule.days.map((d) => weekdayName(d)).join(' ');
  return `${days} ${rule.startTime}–${rule.endTime}` +
    `${rule.startDate ? ` ≥ ${rule.startDate}` : ''}${rule.endDate ? ` ≤ ${rule.endDate}` : ''}`;
}

export function weekdayName(d) {
  // Sunday-first index -> localized narrow name via a fixed reference week.
  const ref = new Date(2023, 0, 1 + d); // 2023-01-01 was a Sunday
  return new Intl.DateTimeFormat(i18n.getLang() === 'zh' ? 'zh-HK' : 'en', { weekday: 'short' }).format(ref);
}

/**
 * Bounded look-ahead: the next instant the rule is active, stepping in
 * 30-minute increments across `horizonDays`. Coarse by design and labelled as
 * an approximation wherever shown. Returns Date | null.
 */
export function nextActivation(rule, from = new Date(), horizonDays = 14) {
  if (!rule.enabled) return null;
  const stepMs = 30 * 60 * 1000;
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  const limit = horizonDays * 24 * 2;
  for (let i = 1; i <= limit; i++) {
    const t = new Date(start.getTime() + i * stepMs);
    if (ruleMatchesAt(rule, t)) return t;
  }
  return null;
}

/* ------------------------------ storage ------------------------------ */

export function loadSchedule() {
  const doc = store.get(SCHEDULE_STORE_KEY, emptySchedule());
  const v = validateSchedule(doc);
  return v.ok ? v.schedule : emptySchedule();
}
export function saveSchedule(schedule) {
  const v = validateSchedule(schedule);
  if (!v.ok) return { ok: false, errors: v.errors };
  store.set(SCHEDULE_STORE_KEY, v.schedule);
  return { ok: true };
}

/* ========================================================================== *
 * Journal — append-only, immutable updates, pure core.
 * ========================================================================== */
export const JOURNAL_VERSION = 1;
export const JOURNAL_STORE_KEY = 'journal'; // persisted as ccr-site.journal via store.js
export const JOURNAL_MAX_ENTRIES = 5000;
export const SNAP_MAX_CHARS = 4000;

export const JOURNAL_ACTIONS = ['created', 'updated', 'deleted', 'restored', 'labeled', 'pruned'];

export function emptyJournal() {
  return {
    version: JOURNAL_VERSION,
    seq: 0,
    policy: { mode: 'keep-all', count: 500, days: 90 },
    entries: [],
  };
}

function capSnapshot(value) {
  if (value === undefined) return undefined;
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return { __circular: true };
  }
  if (json === undefined) return { __unserializable: true };
  if (json.length <= SNAP_MAX_CHARS) return value;
  return { __truncated: true, preview: json.slice(0, SNAP_MAX_CHARS) };
}

export function snapIsReplayable(snapshot) {
  return snapshot !== undefined && !(snapshot && typeof snapshot === 'object' && snapshot.__truncated);
}

/**
 * Append one entry. Pure: returns a NEW journal; the input is never mutated.
 * Unknown actions are rejected; payload sizes are bounded.
 */
export function commitEntry(journal, { action, subject, before, after, label, meta }, now = new Date()) {
  if (!JOURNAL_ACTIONS.includes(action)) throw new Error(`unknown-action:${action}`);
  if (typeof subject !== 'string' || !subject || subject.length > 200) throw new Error('bad-subject');
  const entry = {
    seq: journal.seq + 1,
    id: 'rev-' + (journal.seq + 1).toString(36) + '-' + now.getTime().toString(36),
    at: now.toISOString(),
    action,
    subject,
    before: capSnapshot(before),
    after: capSnapshot(after),
  };
  if (label != null) entry.label = String(label).slice(0, 120);
  if (meta != null) entry.meta = meta;
  const next = { ...journal, seq: entry.seq, entries: [...journal.entries, entry] };
  return { journal: enforceCap(next), entry };
}

function enforceCap(journal) {
  if (journal.entries.length <= JOURNAL_MAX_ENTRIES) return journal;
  return { ...journal, entries: journal.entries.slice(-JOURNAL_MAX_ENTRIES) };
}

/**
 * Retention policy. mode 'keep-all' prunes nothing; 'keep-count' keeps the
 * newest N; 'keep-days' keeps entries newer than N days. Pure.
 */
export function applyPolicy(journal, policy, now = new Date()) {
  const p = policy || journal.policy;
  if (p.mode === 'keep-all') return { journal, removed: [], removedCount: 0 };
  let keepFromIdx = 0;
  if (p.mode === 'keep-count') {
    const n = Math.max(10, Math.min(JOURNAL_MAX_ENTRIES, Number(p.count) || 500));
    keepFromIdx = Math.max(0, journal.entries.length - n);
  } else if (p.mode === 'keep-days') {
    const days = Math.max(7, Math.min(3650, Number(p.days) || 90));
    const cutoff = now.getTime() - days * 86400000;
    keepFromIdx = journal.entries.findIndex((e) => new Date(e.at).getTime() >= cutoff);
    if (keepFromIdx === -1) keepFromIdx = journal.entries.length;
  } else {
    return { journal, removed: [], removedCount: 0 };
  }
  const removed = journal.entries.slice(0, keepFromIdx);
  return {
    journal: { ...journal, entries: journal.entries.slice(keepFromIdx) },
    removed,
    removedCount: removed.length,
  };
}

/** Action types + counts DERIVED FROM THE JOURNAL (never a fixed list). */
export function actionCounts(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(e.action, (counts.get(e.action) || 0) + 1);
  return counts;
}

/**
 * Filter entries by free query state (search.js compile), a Set of allowed
 * actions (empty/null = all) and an inclusive date range.
 */
export function filterEntries(entries, compiled, actionsSet, fromIso, toIso) {
  return entries.filter((e) => {
    if (actionsSet && actionsSet.size && !actionsSet.has(e.action)) return false;
    if (fromIso && e.at < fromIso) return false;
    if (toIso && e.at > toIso) return false;
    if (compiled && !compiled.empty) {
      const hay = `${e.subject} ${e.action} ${e.label || ''} ${JSON.stringify(e.after ?? '')}`;
      if (!compiled.test(hay)) return false;
    }
    return true;
  });
}

/* ------------------------------ flatten + diff ------------------------------ */

/** Flatten a JSON-ish value to dot-path leaves. Bounded depth/breadth. */
export function flatten(value, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || out.__count > 400) return out;
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    out[prefix || '.'] = value;
    return out;
  }
  if (Array.isArray(value)) {
    if (!value.length) out[prefix || '.'] = [];
    value.slice(0, 100).forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
    out.__count = (out.__count || 0) + Math.min(value.length, 100);
    return out;
  }
  const keys = Object.keys(value).slice(0, 200);
  if (!keys.length) out[prefix || '.'] = {};
  for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out, depth + 1);
  out.__count = (out.__count || 0) + keys.length;
  return out;
}

const REDACT_RE = /pass|token|secret|credential|api[_-]?key|auth/i;

/** Deep-redact credential-SHAPED keys. Display/export only; local data intact. */
export function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[REDACT_RE.test(k) ? k : k] = REDACT_RE.test(k) ? '[redacted]' : redactValue(v);
    }
    return out;
  }
  return value;
}

/** Field-level diff lines between two snapshots: [{path, kind, before, after}] */
export function diffSnapshots(before, after) {
  const a = flatten(before == null ? {} : before);
  const b = flatten(after == null ? {} : after);
  delete a.__count;
  delete b.__count;
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const lines = [];
  for (const p of paths) {
    const had = Object.prototype.hasOwnProperty.call(a, p);
    const has = Object.prototype.hasOwnProperty.call(b, p);
    const bv = had ? JSON.stringify(redactValue(a[p])) : undefined;
    const av = has ? JSON.stringify(redactValue(b[p])) : undefined;
    if (!had && has) lines.push({ path: p, kind: 'added', after: av });
    else if (had && !has) lines.push({ path: p, kind: 'removed', before: bv });
    else if (bv !== av) lines.push({ path: p, kind: 'changed', before: bv, after: av });
  }
  return lines;
}

/* ------------------------------ storage-backed journal ------------------------------ */

let journalCache = null;

export function loadJournal() {
  if (journalCache) return journalCache;
  const j = store.get(JOURNAL_STORE_KEY, emptyJournal());
  journalCache =
    j && typeof j === 'object' && j.version === JOURNAL_VERSION && Array.isArray(j.entries)
      ? j
      : emptyJournal();
  return journalCache;
}

export function saveJournal(j) {
  journalCache = j;
  return store.set(JOURNAL_STORE_KEY, j);
}

/** Record a mutation through the append-only path. Returns the new entry. */
export function journalCommit(fields, now = new Date()) {
  const { journal, entry } = commitEntry(loadJournal(), fields, now);
  saveJournal(journal);
  return entry;
}

/** Apply a snapshot to a subject (settings key or schedule rule) and record it. */
export function journalApply(subject, value, now = new Date()) {
  const before = readSubject(subject);
  journalCommit({ action: 'restored', subject, before, after: value }, now);
  writeSubject(subject, value);
}

export function readSubject(subject) {
  if (subject.startsWith('setting:')) return store.get(subject.slice('setting:'.length));
  if (subject.startsWith('rule:')) {
    const id = subject.slice('rule:'.length);
    return loadSchedule().rules.find((r) => r.id === id) ?? null;
  }
  return undefined;
}

export function writeSubject(subject, value) {
  if (subject.startsWith('setting:')) {
    const key = subject.slice('setting:'.length);
    if (value === null || value === undefined) store.remove(key);
    else store.set(key, value);
    return true;
  }
  if (subject.startsWith('rule:')) {
    const id = subject.slice('rule:'.length);
    const sched = loadSchedule();
    const idx = sched.rules.findIndex((r) => r.id === id);
    if (value === null || value === undefined) {
      if (idx !== -1) sched.rules.splice(idx, 1);
    } else if (idx !== -1) sched.rules[idx] = value;
    else sched.rules.push(value);
    saveSchedule(sched);
    scheduleChangedCallbacks.forEach((fn) => fn());
    return true;
  }
  return false;
}

const scheduleChangedCallbacks = new Set();
export function onScheduleChanged(fn) {
  scheduleChangedCallbacks.add(fn);
  return () => scheduleChangedCallbacks.delete(fn);
}

/* ========================================================================== *
 * Override applier — captures base once, restores exactly when rules end.
 * ========================================================================== */
const APPLY_TARGETS = {
  language: {
    get: () => store.get('lang', 'en'),
    apply: (v) => {
      i18n.setLang(v);
      applierHooks.onLanguage?.();
    },
  },
  theme: {
    get: () => theme.getMode(),
    apply: (v) => {
      theme.setMode(v);
      applierHooks.onTheme?.();
    },
  },
  rainbow: {
    get: () => String(store.get('appearance.rainbowSpeed', 4)),
    apply: (v) => {
      store.set('appearance.rainbowSpeed', Number(v));
      if (inBrowser) publishRainbowGlobals();
    },
  },
};
const applierHooks = {};

export function baseKeyFor(target) {
  return `schedule.base.${target}`;
}

/** One reconciliation pass. Returns {applied:[], restored:[]} for reporting. */
export function reconcileOverrides(now = new Date()) {
  const sched = loadSchedule();
  const winners = resolveWinners(sched, now);
  const applied = [];
  const restored = [];
  for (const target of SCHED_TARGETS) {
    const api = APPLY_TARGETS[target];
    const win = winners.get(target);
    const bk = baseKeyFor(target);
    if (win) {
      if (store.get(bk) === undefined) store.set(bk, api.get());
      if (String(api.get()) !== String(win.value)) {
        api.apply(win.value);
        applied.push({ target, value: win.value });
      }
    } else if (store.get(bk) !== undefined) {
      api.apply(store.get(bk));
      store.remove(bk);
      restored.push(target);
    }
  }
  return { applied, restored };
}

let ticker = null;
export function startTicker(intervalMs = 30000) {
  if (!inBrowser || ticker) return;
  ticker = setInterval(() => reconcileOverrides(), intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcileOverrides();
  });
}

/* ========================================================================== *
 * Bulk list component.
 * ========================================================================== */
const PAGE_SIZE_DEFAULT = 25;

/**
 * Generic bulk-capable list. See module header for the feature contract.
 * Selection SURVIVES pagination/filtering; ids not currently rendered stay put.
 */
export function createBulkList(opts) {
  const pageSize = opts.pageSize ?? PAGE_SIZE_DEFAULT;
  const root = el('div', { class: 'ops-bulklist', attrs: { role: 'region', 'aria-label': opts.ariaLabel || 'List' } });

  const toolbar = el('div', { class: 'ops-toolbar' });
  const qInput = el('input', { class: 'input', attrs: { type: 'text', placeholder: L('hist.search'), 'aria-label': L('hist.search') } });
  // attachSearchField returns the WRAPPER that carries .ccrSearch — keep it.
  const searchWrap = attachSearchField(qInput, { id: opts.searchId || 'bulk-list', storage: true, onChange: () => render(true) });
  toolbar.append(searchWrap);

  const facetRow = el('div', { class: 'ops-facets', attrs: { role: 'group' } });
  toolbar.append(facetRow);

  const counts = el('div', { class: 'body-small ops-counts', attrs: { role: 'status' } });
  const list = el('div', { class: 'result-list', attrs: { role: 'list' } });
  const pager = el('nav', { class: 'ops-pager', attrs: { 'aria-label': 'Pages' } });
  const selBar = el('div', { class: 'ops-selbar' });
  const progSlot = el('div', { class: 'ops-progress-slot' });

  root.append(toolbar, counts, list, pager, selBar, progSlot);

  const selected = new Set();
  const activeFacets = new Set();
  let page = 0;
  let lastCheckedIdx = -1;
  let renderedIds = [];

  function allItems() {
    return opts.items() || [];
  }

  function visibleItems() {
    const compiled = searchWrap.ccrSearch.compile();
    let items = allItems();
    if (activeFacets.size && opts.facets) {
      const fmap = new Map(opts.facets(allItems()).map((f) => [f.id, f]));
      items = items.filter((it) => {
        for (const fid of activeFacets) {
          const f = fmap.get(fid);
          if (f && f.test(it)) return true;
        }
        return false;
      });
    }
    if (!compiled.empty) items = items.filter((it) => compiled.test(opts.textOf(it)));
    return items;
  }

  function renderFacets() {
    clear(facetRow);
    if (!opts.facets) return;
    const fs = opts.facets(allItems());
    if (!fs.length) return;
    const allChip = chipBtn(L('hist.actions.all'), () => {
      activeFacets.clear();
      page = 0;
      render();
    });
    allChip.classList.toggle('chip--selected', activeFacets.size === 0);
    allChip.setAttribute('aria-pressed', String(activeFacets.size === 0));
    facetRow.append(allChip);
    for (const f of fs) {
      const on = activeFacets.has(f.id);
      const c = chipBtn(`${f.label()} (${f.count})`, () => {
        if (activeFacets.has(f.id)) activeFacets.delete(f.id);
        else activeFacets.add(f.id);
        page = 0;
        render();
      });
      c.classList.toggle('chip--selected', on);
      c.setAttribute('aria-pressed', String(on));
      facetRow.append(c);
    }
  }

  function render(keepPage = false) {
    if (!keepPage) /* fallthrough */ ;
    const vis = visibleItems();
    const pages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(vis.length / pageSize));
    page = Math.min(page, pages - 1);
    renderedIds = [];

    clear(list);
    if (!vis.length) {
      list.append(el('div', { class: 'empty-note', children: [opts.emptyText ? opts.emptyText() : L('results.none')] }));
    } else {
      const slice = pageSize === Infinity ? vis : vis.slice(page * pageSize, (page + 1) * pageSize);
      slice.forEach((it, i) => {
        const id = opts.getId(it);
        renderedIds.push(id);
        const row = el('div', { class: 'list-item', attrs: { role: 'listitem', 'data-id': id } });
        const cb = el('input', {
          attrs: {
            type: 'checkbox',
            'data-id': id,
            'aria-label': opts.rowAria ? opts.rowAria(it) : opts.textOf(it),
          },
        });
        cb.checked = selected.has(id);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(id);
          else selected.delete(id);
          lastCheckedIdx = i;
          paintCounts();
        });
        cb.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            const boxes = [...list.querySelectorAll('input[type=checkbox]')];
            const nextBox = boxes[boxes.indexOf(cb) + dir];
            nextBox?.focus();
          }
        });
        const body = el('div', { style: 'flex:1;min-width:0' });
        const content = opts.renderRow(it);
        if (content instanceof Node) body.append(content);
        else append(body, String(content));
        row.append(cb, body);
        row.addEventListener('click', (e) => {
          if (e.target.closest('input,button,a,select,textarea,label')) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
          if (e.shiftKey && lastCheckedIdx >= 0) {
            const anchor = renderedIds.indexOf(renderedIds[lastCheckedIdx] ?? '');
            const [from, to] = anchor <= i ? [anchor, i] : [i, anchor];
            for (let k = from; k <= to; k++) {
              const rid = renderedIds[k];
              if (rid) selected.add(rid);
              const box = list.querySelector(`input[data-id="${CSS.escape(String(rid))}"]`);
              if (box) box.checked = true;
            }
            paintCounts();
          }
        });
        list.append(row);
      });
    }

    // Pager
    clear(pager);
    if (pageSize !== Infinity && pages > 1) {
      const prev = el('button', { class: 'btn btn--text', type: 'button', children: ['‹'], attrs: { 'aria-label': 'Previous page' } });
      prev.disabled = page === 0;
      prev.addEventListener('click', () => {
        page = Math.max(0, page - 1);
        render();
      });
      const next = el('button', { class: 'btn btn--text', type: 'button', children: ['›'], attrs: { 'aria-label': 'Next page' } });
      next.disabled = page >= pages - 1;
      next.addEventListener('click', () => {
        page = Math.min(pages - 1, page + 1);
        render();
      });
      pager.append(prev, el('span', { class: 'body-small', children: [L('hist.page', { p: page + 1, P: pages })] }), next);
    }

    renderFacets();
    paintCounts(vis.length, pages);
  }

  function paintCounts(visN, pagesN) {
    const vis = visN ?? visibleItems().length;
    const pages = pagesN ?? (pageSize === Infinity ? 1 : Math.max(1, Math.ceil(vis / pageSize)));
    const scope = pageSize === Infinity ? L('hist.scope.all') : L('hist.scope.page');
    counts.textContent = L('hist.counts', { shown: vis, sel: selected.size, scope, p: page + 1, P: pages });
    renderSelBar();
  }

  function renderSelBar() {
    clear(selBar);
    selBar.append(
      chipBtn(L('hist.sel.page'), () => {
        for (const box of list.querySelectorAll('input[type=checkbox]')) {
          box.checked = true;
          selected.add(box.dataset.id);
        }
        paintCounts();
      }),
      chipBtn(L('hist.sel.match', { n: visibleItems().length }), () => {
        for (const it of visibleItems()) selected.add(opts.getId(it));
        render();
      }),
      chipBtn(L('hist.sel.invert'), () => {
        for (const it of visibleItems()) {
          const id = opts.getId(it);
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
        }
        render();
      }),
      chipBtn(L('hist.sel.clear'), () => {
        selected.clear();
        render();
      }),
    );
    const extra = opts.selectionExtras?.(selected);
    if (extra) selBar.append(...extra);
  }

  /**
   * Chunked, cancellable bulk run with honest progress + partial results.
   * fn receives (id, ctx). Returns {done, cancelled}.
   */
  async function bulkRun(labelText, fn, ids) {
    const work = ids ?? [...selected];
    const total = work.length;
    const bar = el('div', { class: 'ops-progress', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0', 'aria-label': labelText } });
    const fill = el('div');
    const text = el('span', { class: 'body-small', children: [`${labelText} 0/${total}`] });
    const cancelBtn = el('button', { class: 'btn btn--tonal', type: 'button', children: [L('common.cancel')] });
    let cancelled = false;
    cancelBtn.addEventListener('click', () => {
      cancelled = true;
      cancelBtn.disabled = true;
    });
    bar.append(fill);
    clear(progSlot);
    progSlot.append(el('div', { class: 'ops-progress-row', children: [bar, text, cancelBtn] }));

    let done = 0;
    for (const id of work) {
      if (cancelled) break;
      await fn(id);
      done++;
      fill.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
      bar.setAttribute('aria-valuenow', String(done));
      text.textContent = `${labelText} ${done}/${total}`;
      if (done % 20 === 0) await new Promise((r) => setTimeout(r, 0)); // yield; keeps UI alive
    }
    setTimeout(() => clear(progSlot), 900);
    render();
    return { done, cancelled, remaining: total - done };
  }

  render();

  return {
    root,
    refresh: () => render(),
    selected,
    visibleItems,
    getSelectedIds: () => [...selected],
    selectAllPage: () => {
      for (const box of list.querySelectorAll('input[type=checkbox]')) {
        box.checked = true;
        selected.add(box.dataset.id);
      }
      paintCounts();
    },
    invertSelection: () => {
      for (const it of visibleItems()) {
        const id = opts.getId(it);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      }
      render();
    },
    bulkRun,
    setSearchText: (q) => {
      searchWrap.ccrSearch.setState({ query: q });
    },
  };
}

/* ========================================================================== *
 * Date-range picker: anchored popover, month/year jump, typed ISO/locale dates.
 * ========================================================================== */
export function openDateRangePicker({ anchor, from, to, onClose }) {
  const pop = el('div', { class: 'color-pop menu ops-cal', attrs: { role: 'dialog', 'aria-label': L('hist.date.pick') } });
  let cur = new Date(from ? new Date(from) : new Date());
  let side = 'from';

  const fromInput = el('input', { class: 'input', attrs: { type: 'text', 'aria-label': L('hist.from'), placeholder: 'YYYY-MM-DD' } });
  const toInput = el('input', { class: 'input', attrs: { type: 'text', 'aria-label': L('hist.to'), placeholder: 'YYYY-MM-DD' } });
  fromInput.value = from ? String(from).slice(0, 10) : '';
  toInput.value = to ? String(to).slice(0, 10) : '';

  const errLine = el('div', { class: 'body-small', attrs: { role: 'alert' }, style: 'color:var(--md-sys-color-error)' });
  const gridHead = el('div', { class: 'ops-cal-head' });
  const grid = el('div', { class: 'ops-cal-grid', attrs: { role: 'grid' } });

  function normalizeTyped(raw) {
    const s = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return parseDateStr(s) ? s : null;
    }
    if (s.length >= 6) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return isoDateOf(d);
    }
    return null;
  }

  function typed(sideKey, input) {
    const v = normalizeTyped(input.value);
    if (input.value.trim() === '') {
      errLine.textContent = '';
      emit(sideKey, null);
      return;
    }
    if (!v) {
      errLine.textContent = L('hist.date.invalid');
      return; // keep the visitor's typing; never discard input
    }
    errLine.textContent = '';
    emit(sideKey, v);
    cur = new Date(v);
    drawGrid();
  }
  fromInput.addEventListener('change', () => typed('from', fromInput));
  toInput.addEventListener('change', () => typed('to', toInput));

  function emit(sideKey, iso) {
    onClose?.({ from: sideKey === 'from' ? iso : fromInput.value ? normalizeTyped(fromInput.value) : null, to: sideKey === 'to' ? iso : toInput.value ? normalizeTyped(toInput.value) : null });
  }

  function drawGrid() {
    clear(gridHead);
    const label = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(cur);
    const mk = (txt, title, fn) => {
      const b = el('button', { class: 'chip', type: 'button', children: [txt], attrs: { 'aria-label': title } });
      b.style.cursor = 'pointer';
      b.addEventListener('click', fn);
      return b;
    };
    gridHead.append(
      mk('«', L('hist.cal.prevYear'), () => {
        cur.setFullYear(cur.getFullYear() - 1);
        drawGrid();
      }),
      mk('‹', L('hist.cal.prevMonth'), () => {
        cur.setMonth(cur.getMonth() - 1);
        drawGrid();
      }),
      el('strong', { children: [label] }),
      mk('›', L('hist.cal.nextMonth'), () => {
        cur.setMonth(cur.getMonth() + 1);
        drawGrid();
      }),
      mk('»', L('hist.cal.nextYear'), () => {
        cur.setFullYear(cur.getFullYear() + 1);
        drawGrid();
      }),
    );
    clear(grid);
    for (const d of WEEKDAYS) grid.append(el('span', { class: 'ops-cal-dow', attrs: { role: 'columnheader' }, children: [weekdayName(d)] }));
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    for (let i = 0; i < first.getDay(); i++) grid.append(el('span'));
    for (let dnum = 1; dnum <= daysInMonth; dnum++) {
      const iso = isoDateOf(new Date(cur.getFullYear(), cur.getMonth(), dnum));
      const btn = el('button', {
        class: 'chip ops-cal-day',
        type: 'button',
        children: [String(dnum)],
        attrs: { 'aria-label': iso, 'aria-pressed': 'false' },
      });
      btn.style.cursor = 'pointer';
      if (iso === fromInput.value || iso === toInput.value) {
        btn.classList.add('chip--selected');
        btn.setAttribute('aria-pressed', 'true');
      }
      btn.addEventListener('click', () => {
        if (side === 'from') {
          fromInput.value = iso;
          emit('from', iso);
          side = 'to';
        } else {
          toInput.value = iso;
          emit('to', iso);
          side = 'from';
        }
        drawGrid();
      });
      grid.append(btn);
    }
  }

  const presets = el('div', { class: 'ops-facets' });
  for (const [labelKey, days] of [
    ['hist.presets.today', 0],
    ['hist.presets.d7', 7],
    ['hist.presets.d30', 30],
    ['hist.presets.any', null],
  ]) {
    const b = chipBtn(L(labelKey), () => {
      if (days === null) {
        fromInput.value = '';
        toInput.value = '';
        emit('from', null);
      } else {
        const nowD = new Date();
        const past = new Date(nowD.getTime() - days * 86400000);
        fromInput.value = isoDateOf(days === 0 ? nowD : past);
        toInput.value = days === 0 ? '' : isoDateOf(nowD);
        emit('from', fromInput.value || null);
      }
      drawGrid();
    });
    presets.append(b);
  }

  const closeRow = el('div', { class: 'dialog-actions' });
  const closeBtn = el('button', { class: 'btn btn--text', type: 'button', children: [L('common.close')] });
  closeBtn.addEventListener('click', () => closePop());
  closeRow.append(closeBtn);

  const sides = el('div', { class: 'ops-cal-sides' });
  sides.append(
    el('div', { class: 'field', children: [el('label', { children: [L('hist.from')] }), fromInput] }),
    el('div', { class: 'field', children: [el('label', { children: [L('hist.to')] }), toInput] }),
  );
  pop.append(sides, errLine, presets, gridHead, grid, closeRow);

  function closePop() {
    pop.dispatchEvent(new CustomEvent('ccr-close'));
    pop.remove();
    anchor?.focus?.();
  }
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePop();
    }
  });
  document.body.appendChild(pop);
  positionPopover(pop, anchor || document.body);
  drawGrid();
  return { close: closePop };
}

/* ========================================================================== *
 * Scheduled-settings panel.
 * ========================================================================== */
export function renderScheduledPanel(container, { compact = false } = {}) {
  const wrap = el('section', { class: 'ops-panel', attrs: { 'aria-labelledby': 'sched-h' } });
  const h = el('h2', { class: 'title-large', attrs: { id: 'sched-h' }, children: [L('sched.tab')] });
  append(h, el('span', { class: 'bi-sub body-small', children: [L2('sched.tab')] }));
  wrap.append(h);
  if (!compact) wrap.append(el('p', { class: 'body-medium', children: [L('ops.lede')] }));

  const off = -new Date().getTimezoneOffset();
  const offStr = `${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  wrap.append(el('p', { class: 'body-small ops-tznote', children: [L('sched.tz.note', { tz, off: offStr })] }));

  const status = el('p', { class: 'body-medium ops-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  wrap.append(status);

  const actions = el('div', { class: 'ops-actions' });
  const addBtn = el('button', { class: 'btn btn--filled', type: 'button', children: [L('sched.addRule')] });
  const refreshBtn = el('button', { class: 'btn btn--outlined', type: 'button', children: [L('sched.refresh')] });
  const delAllBtn = el('button', { class: 'btn btn--danger', type: 'button', children: [L('sched.resetAll')] });
  actions.append(addBtn, refreshBtn, delAllBtn);
  wrap.append(actions);

  const rulesHost = el('div', { class: 'ops-rules' });
  wrap.append(rulesHost);

  let listApi = null;

  function paintStatus() {
    const winners = resolveWinners(loadSchedule(), new Date());
    clear(status);
    if (winners.size) {
      const bits = [...winners.entries()].map(([t, r]) => `${targetName(t)} → ${r.value} (${r.label})`);
      append(status, document.createTextNode(`${deco('⏰')}${L('sched.active.now')}: ${bits.join(' · ')}`));
    } else {
      append(status, document.createTextNode(deco('🛋️') + L('sched.none.now')));
    }
  }

  function rebuild() {
    const rules = loadSchedule().rules;
    clear(rulesHost);
    listApi = createBulkList({
      ariaLabel: L('sched.rules.h'),
      searchId: 'sched-rules',
      pageSize: Infinity,
      items: () => [...rules].reverse(), // newest first; later rule = higher precedence
      getId: (r) => r.id,
      textOf: (r) => `${r.label} ${r.target} ${r.value} ${summarizeRule(r)}`,
      emptyText: () => L('sched.empty'),
      rowAria: (r) => `${r.label} ${summarizeRule(r)}`,
      facets: (items) =>
        [...new Set(items.map((r) => r.target))].map((t) => ({
          id: t,
          label: () => targetName(t),
          count: items.filter((r) => r.target === t).length,
          test: (r) => r.target === t,
        })),
      renderRow: (r) => renderRuleCard(r, rebuild),
    });
    rulesHost.append(listApi.root);
    paintStatus();
  }

  addBtn.addEventListener('click', () => openRuleEditor(null, rebuild));
  refreshBtn.addEventListener('click', () => {
    const res = reconcileOverrides();
    paintStatus();
    notifyInfo(res.applied.length ? L('sched.applied', { target: res.applied[0].target, value: res.applied[0].value }) : L('sched.restoredBase'));
  });
  delAllBtn.addEventListener('click', async () => {
    const rules = loadSchedule().rules;
    if (!rules.length) return;
    const ok = await superConfirm({
      title: L('sched.super.reset.title', { n: rules.length }),
      body: L('sched.super.reset.body'),
      phrase: 'DELETE',
    });
    if (!ok) return;
    const sched = loadSchedule();
    const before = sched.rules.slice();
    sched.rules = [];
    saveSchedule(sched);
    journalCommit({ action: 'deleted', subject: 'schedule:all', before, after: null, meta: { count: before.length } });
    scheduleChangedCallbacks.forEach((fn) => fn());
    rebuild();
    notifyInfo(L('sched.deleted', { n: before.length }));
  });

  rebuild();
  container.append(wrap);
  return { repaint: rebuild, paintStatus };
}

function targetName(t) {
  return L(`sched.target.${t}`);
}

function deco(e) {
  return i18n.deco(e);
}

function notifyInfo(msg) {
  if (!inBrowser) return;
  import('./notify.js').then((m) => m.info(msg)).catch(() => {});
}

function renderRuleCard(rule, onChange) {
  const card = el('article', { class: 'card rule-card', attrs: { 'data-rule-id': rule.id } });
  const head = el('div', { class: 'rule-head' });
  const labId = `rule-lab-${rule.id}`;
  const sw = el('label', { class: 'switch', attrs: { for: `rule-sw-${rule.id}` } });
  const cb = el('input', { attrs: { type: 'checkbox', id: `rule-sw-${rule.id}`, 'aria-describedby': labId } });
  cb.checked = rule.enabled;
  cb.addEventListener('change', () => {
    const sched = loadSchedule();
    const r = sched.rules.find((x) => x.id === rule.id);
    if (r) {
      const before = { ...r };
      r.enabled = cb.checked;
      saveSchedule(sched);
      journalCommit({ action: 'updated', subject: `rule:${rule.id}`, before, after: { ...r } });
      scheduleChangedCallbacks.forEach((fn) => fn());
      onChange();
    }
  });
  sw.append(cb);
  head.append(sw, el('strong', { attrs: { id: labId }, children: [rule.label] }));
  if (!rule.enabled) head.append(el('span', { class: 'tag tag--muted', children: [L('sched.rule.disabledTag')] }));
  head.append(el('span', { class: 'tag', children: [targetName(rule.target)] }));
  card.append(head);

  card.append(
    el('div', { class: 'body-small', children: [`${rule.value} · ${summarizeRule(rule)}`] }),
  );

  const next = nextActivation(rule);
  const nextLine = next
    ? L('sched.rule.next', { when: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(next) })
    : L('sched.rule.never');
  card.append(el('div', { class: 'body-small rule-next', children: [nextLine] }));

  const row = el('div', { class: 'rule-btns' });
  const up = iconBtn('↑', L('sched.moveUp'), () => moveRule(rule.id, -1, onChange));
  const down = iconBtn('↓', L('sched.moveDown'), () => moveRule(rule.id, +1, onChange));
  const edit = el('button', { class: 'btn btn--text', type: 'button', children: [L('sched.editRule')] });
  edit.addEventListener('click', () => openRuleEditor(rule, onChange));
  const del = el('button', { class: 'btn btn--text btn-del', type: 'button', children: [L('common.remove')] });
  del.addEventListener('click', () => {
    const sched = loadSchedule();
    const idx = sched.rules.findIndex((x) => x.id === rule.id);
    if (idx === -1) return;
    const before = sched.rules[idx];
    sched.rules.splice(idx, 1);
    saveSchedule(sched);
    journalCommit({ action: 'deleted', subject: `rule:${rule.id}`, before, after: null });
    scheduleChangedCallbacks.forEach((fn) => fn());
    onChange();
  });
  row.append(up, down, edit, del);
  card.append(row);
  return card;
}

function iconBtn(glyph, label, fn) {
  const b = el('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': label, title: label }, children: [glyph] });
  b.addEventListener('click', fn);
  return b;
}

function moveRule(id, delta, onChange) {
  const sched = loadSchedule();
  const i = sched.rules.findIndex((r) => r.id === id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= sched.rules.length) return;
  const before = sched.rules.map((r) => r.id);
  const [r] = sched.rules.splice(i, 1);
  sched.rules.splice(j, 0, r);
  saveSchedule(sched);
  journalCommit({
    action: 'updated',
    subject: 'schedule:order',
    before: { order: before },
    after: { order: sched.rules.map((x) => x.id) },
  });
  scheduleChangedCallbacks.forEach((fn) => fn());
  onChange();
}

function openRuleEditor(existing, onSaved) {
  const { body, close } = openDialog(existing ? L('sched.editRule') : L('sched.newRule'), { opener: null });
  const errs = el('div', { attrs: { role: 'alert' } });

  const labelIn = el('input', { class: 'input', attrs: { type: 'text', maxlength: String(LABEL_MAX), 'aria-label': L('sched.f.label') } });
  labelIn.value = existing?.label ?? '';

  const targetSel = el('select', { class: 'select', attrs: { 'aria-label': L('sched.f.target') } });
  for (const t of SCHED_TARGETS) targetSel.append(el('option', { attrs: { value: t }, children: [targetName(t)] }));
  targetSel.value = existing?.target ?? 'language';

  const valueWrap = el('div', { class: 'field' });
  function buildValueControl() {
    clear(valueWrap);
    valueWrap.append(el('label', { children: [L('sched.f.value')] }));
    const cur = existing && existing.target === targetSel.value ? existing.value : null;
    if (targetSel.value === 'language') {
      const s = el('select', { class: 'select', attrs: { 'data-role': 'value' } });
      for (const [v, name] of Object.entries(i18n.LANGS)) s.append(el('option', { attrs: { value: v }, children: [name] }));
      s.value = ['en', 'zh', 'bi'].includes(cur) ? cur : 'en';
      valueWrap.append(s);
    } else if (targetSel.value === 'theme') {
      const s = el('select', { class: 'select', attrs: { 'data-role': 'value' } });
      for (const [v, key] of [['light', 'theme.mode.light'], ['dark', 'theme.mode.dark'], ['auto', 'theme.mode.auto']]) {
        s.append(el('option', { attrs: { value: v }, children: [key] }));
      }
      s.value = ['light', 'dark', 'auto'].includes(cur) ? cur : 'dark';
      valueWrap.append(s);
    } else {
      const s = el('select', { class: 'select', attrs: { 'data-role': 'value', 'aria-label': L('sched.target.rainbow') } });
      for (const n of [1, 2, 3, 4, 5]) s.append(el('option', { attrs: { value: String(n) }, children: [L('common.level', { n })] }));
      s.value = cur && Number(cur) >= 1 && Number(cur) <= 5 ? String(Number(cur)) : '4';
      valueWrap.append(s);
    }
  }
  buildValueControl();
  targetSel.addEventListener('change', buildValueControl);

  const startD = el('input', { class: 'input', attrs: { type: 'date', 'aria-label': L('sched.f.startDate') } });
  const endD = el('input', { class: 'input', attrs: { type: 'date', 'aria-label': L('sched.f.endDate') } });
  startD.value = existing?.startDate ?? '';
  endD.value = existing?.endDate ?? '';

  const startT = el('input', { class: 'input', attrs: { type: 'time', 'aria-label': L('sched.f.startTime') } });
  const endT = el('input', { class: 'input', attrs: { type: 'time', 'aria-label': L('sched.f.endTime') } });
  startT.value = existing?.startTime ?? '22:00';
  endT.value = existing?.endTime ?? '06:00';

  const everyRadio = el('input', { attrs: { type: 'radio', name: 'days-mode', id: 'days-every', value: 'every' } });
  const customRadio = el('input', { attrs: { type: 'radio', name: 'days-mode', id: 'days-custom', value: 'custom' } });
  const dayBoxes = WEEKDAYS.map((d) => {
    const id = `day-${d}`;
    const lab = el('label', { class: 'switch', attrs: { for: id } });
    const cbx = el('input', { attrs: { type: 'checkbox', id, value: String(d) } });
    cbx.checked = Array.isArray(existing?.days) && existing.days.includes(d);
    cbx.addEventListener('change', () => {
      customRadio.checked = true;
      paintPreview();
    });
    lab.append(cbx, document.createTextNode(weekdayName(d)));
    return { d, cbx, lab };
  });
  if (existing?.days === 'every' || !existing) everyRadio.checked = true;
  else customRadio.checked = true;
  everyRadio.addEventListener('change', paintPreview);
  customRadio.addEventListener('change', paintPreview);

  const daysRow = el('div', { class: 'ops-days' });
  const evLab = el('label', { class: 'switch', attrs: { for: 'days-every' } });
  evLab.append(everyRadio, document.createTextNode(L('sched.everyday')));
  daysRow.append(evLab);
  const cuLab = el('label', { class: 'switch', attrs: { for: 'days-custom' } });
  cuLab.append(customRadio, document.createTextNode(L('sched.days') + ':'));
  daysRow.append(cuLab);
  for (const { lab } of dayBoxes) daysRow.append(lab);

  const preview = el('p', { class: 'body-small ops-preview', attrs: { role: 'status' } });
  function gatherDraft() {
    const valueCtl = valueWrap.querySelector('[data-role=value]');
    return {
      label: labelIn.value,
      target: targetSel.value,
      value: valueCtl ? valueCtl.value : '',
      startDate: startD.value || null,
      endDate: endD.value || null,
      startTime: startT.value,
      endTime: endT.value,
      days: everyRadio.checked ? 'every' : dayBoxes.filter((x) => x.cbx.checked).map((x) => x.d),
    };
  }
  /** Client-side pre-validation mirroring validateSchedule, with friendly copy. */
  function validateDraft(d) {
    const problems = [];
    if (!d.label || d.label.length > LABEL_MAX) problems.push(L('sched.err.label'));
    if (d.startDate && !parseDateStr(d.startDate)) problems.push(L('sched.err.date'));
    if (d.endDate && !parseDateStr(d.endDate)) problems.push(L('sched.err.date'));
    if (d.startDate && d.endDate && d.startDate > d.endDate) problems.push(L('sched.err.dateOrder'));
    if (parseTime(d.startTime) == null) problems.push(L('sched.err.time'));
    if (parseTime(d.endTime) == null) problems.push(L('sched.err.time'));
    if (d.days !== 'every' && d.days.length < 1) problems.push(L('sched.err.days'));
    if (d.target === 'language' && !['en', 'zh', 'bi'].includes(d.value)) problems.push(L('sched.err.value'));
    if (d.target === 'theme' && !['light', 'dark', 'auto'].includes(d.value)) problems.push(L('sched.err.value'));
    if (d.target === 'rainbow' && !(Number(d.value) >= 1 && Number(d.value) <= 5)) problems.push(L('sched.err.value'));
    return problems;
  }
  function paintPreview() {
    clear(errs);
    const d = gatherDraft();
    const problems = validateDraft(d);
    if (problems.length) {
      preview.textContent = '';
      errs.append(...problems.map((p) => el('div', { children: [p] })));
      return;
    }
    const sMin = parseTime(d.startTime);
    const eMin = parseTime(d.endTime);
    const notes = [];
    if (sMin === eMin) notes.push(L('sched.zeroLen'));
    else if (sMin > eMin) notes.push(L('sched.crossMid'));
    const probe = {
      id: 'sch-preview0000',
      enabled: true,
      startDate: d.startDate,
      endDate: d.endDate,
      days: d.days,
      startTime: d.startTime,
      endTime: d.endTime,
      target: d.target,
      value: d.value,
    };
    const nx = nextActivation(probe);
    const daysTxt = d.days === 'every' ? L('sched.everyday') : d.days.map(weekdayName).join(' ');
    const nxt = nx
      ? ' ' + L('sched.rule.next', { when: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(nx) })
      : ' ' + L('sched.rule.never');
    preview.textContent = `${daysTxt} ${d.startTime}–${d.endTime} · ${notes.join(' ')}${nxt}`;
  }
  for (const inp of [labelIn, startD, endD, startT, endT]) inp.addEventListener('input', paintPreview);
  paintPreview();

  const row = el('div', { class: 'dialog-actions' });
  const cancel = el('button', { class: 'btn btn--text', type: 'button', children: [L('common.cancel')] });
  cancel.addEventListener('click', () => close());
  const save = el('button', { class: 'btn btn--filled', type: 'button', children: [L('common.save')] });
  save.addEventListener('click', () => {
    const d = gatherDraft();
    const problems = validateDraft(d);
    if (problems.length) {
      clear(errs);
      errs.append(...problems.map((p) => el('div', { children: [p] })));
      return;
    }
    const sched = loadSchedule();
    if (sched.rules.length >= MAX_RULES && !existing) {
      errs.append(el('div', { children: [L('sched.err.maxRules', { n: MAX_RULES })] }));
      return;
    }
    const rule = {
      id: existing?.id ?? newRuleId(),
      enabled: existing ? existing.enabled : true,
      ...d,
    };
    const v = validateSchedule({ version: SCHEDULE_VERSION, rules: [...sched.rules.filter((r) => r.id !== rule.id), rule] });
    if (!v.ok) {
      clear(errs);
      errs.append(el('div', { children: [v.errors.join(', ')] }));
      return;
    }
    const before = existing ? sched.rules.find((r) => r.id === existing.id) ?? null : null;
    saveSchedule(v.schedule);
    journalCommit({ action: existing ? 'updated' : 'created', subject: `rule:${rule.id}`, before, after: rule });
    scheduleChangedCallbacks.forEach((fn) => fn());
    close();
    onSaved?.();
    notifyInfo(L('sched.saved', { n: v.schedule.rules.filter((r) => r.enabled).length }));
  });
  row.append(cancel, save);

  body.append(
    el('div', { class: 'field', children: [el('label', { children: [L('sched.f.label')] }), labelIn] }),
    el('div', { class: 'field', children: [el('label', { children: [L('sched.f.target')] }), targetSel] }),
    valueWrap,
    el('div', { class: 'field ops-two-col', children: [el('label', { children: [L('sched.f.startDate')] }), startD, el('label', { children: [L('sched.f.endDate')] }), endD] }),
    el('div', { class: 'field ops-two-col', children: [el('label', { children: [L('sched.f.startTime')] }), startT, el('label', { children: [L('sched.f.endTime')] }), endT] }),
    daysRow,
    errs,
    preview,
    row,
  );
  labelIn.focus();
}

/* ========================================================================== *
 * History panel.
 * ========================================================================== */
export function renderHistoryPanel(container, { compact = false } = {}) {
  const wrap = el('section', { class: 'ops-panel', attrs: { 'aria-labelledby': 'hist-h' } });
  const h = el('h2', { class: 'title-large', attrs: { id: 'hist-h' }, children: [L('hist.title')] });
  append(h, el('span', { class: 'bi-sub body-small', children: [L2('hist.title')] }));
  wrap.append(h);
  wrap.append(el('p', { class: 'body-small ops-note', children: [L('hist.appendOnlyNote')] }));

  let dateFrom = null;
  let dateTo = null;
  const dateBtn = el('button', { class: 'btn btn--outlined', type: 'button', children: [L('hist.date.any')], attrs: { 'aria-haspopup': 'dialog' } });
  dateBtn.addEventListener('click', () => {
    openDateRangePicker({
      anchor: dateBtn,
      from: dateFrom,
      to: dateTo,
      onClose: (range) => {
        dateFrom = range.from;
        dateTo = range.to;
        dateBtn.textContent = dateFrom || dateTo ? `${dateFrom ?? '…'} → ${dateTo ?? '…'}` : L('hist.date.any');
        listApi.refresh();
      },
    });
  });
  const tools = el('div', { class: 'ops-actions' });
  const exportBtn = el('button', { class: 'btn btn--tonal', type: 'button', children: [L('hist.export')] });
  const pruneBtn = el('button', { class: 'btn btn--danger', type: 'button', children: [L('hist.prune.run')] });
  tools.append(dateBtn, exportBtn, pruneBtn);
  wrap.append(tools);

  const host = el('div');
  wrap.append(host);

  function entriesFiltered() {
    const j = loadJournal();
    return filterEntries(
      [...j.entries].reverse(), // newest first
      null,
      null,
      dateFrom ? `${dateFrom}T00:00:00` : null,
      dateTo ? `${dateTo}T23:59:59.999` : null,
    );
  }

  const listApi = createBulkList({
    ariaLabel: L('hist.title'),
    searchId: 'history-panel',
    pageSize: 25,
    items: entriesFiltered,
    getId: (e) => e.id,
    textOf: (e) => `${e.subject} ${e.action} ${e.label || ''}`,
    rowAria: (e) => `${e.seq} ${e.action} ${e.subject}`,
    emptyText: () => L('hist.empty'),
    facets: (items) =>
      [...actionCounts(items).entries()].map(([action, count]) => ({
        id: action,
        label: () => L(`hist.action.${action}`) || action,
        count,
        test: (e) => e.action === action,
      })),
    renderRow: (e) => {
      const col = el('div');
      const title = el('div', { class: 'n-title' });
      const lbl = e.label ? ` — “${e.label}”` : '';
      append(title, document.createTextNode(`#${e.seq} ${L(`hist.action.${e.action}`) || e.action} · ${e.subject}${lbl}`));
      col.append(title);
      col.append(el('div', { class: 'body-small n-time', children: [new Date(e.at).toLocaleString()] }));
      const openB = el('button', { class: 'snackbar-text-btn', type: 'button', children: [L('hist.detail')] });
      openB.addEventListener('click', () => openEntryDetail(e.id, () => listApi.refresh()));
      col.append(openB);
      return col;
    },
    selectionExtras: (selected) => {
      const out = [];
      const delB = el('button', { class: 'btn btn--danger', type: 'button', children: [L('hist.bulk.delete')] });
      delB.addEventListener('click', () => bulkDeleteSelected([...selected], () => listApi.refresh()));
      const expB = el('button', { class: 'btn btn--tonal', type: 'button', children: [L('hist.bulk.export')] });
      expB.addEventListener('click', () => exportEntries(selectedIdsToEntries(selected)));
      out.push(delB, expB);
      return out;
    },
  });
  host.append(listApi.root);

  function selectedIdsToEntries(selected) {
    const ids = [...selected];
    if (ids.length) return loadJournal().entries.filter((e) => ids.includes(e.id));
    return entriesFiltered(); // no explicit selection → honour active filters
  }

  async function bulkDeleteSelected(ids, refresh) {
    if (!ids.length) return;
    const ok = await superConfirm({
      title: L('hist.super.delete.title', { n: ids.length }),
      body: L('hist.super.delete.body'),
      phrase: 'DELETE',
    });
    if (!ok) return;
    const res = await listApi.bulkRun(L('hist.deleting'), async (id) => {
      const j = loadJournal();
      saveJournal({ ...j, entries: j.entries.filter((e) => e.id !== id) });
    }, ids);
    refresh();
    notifyInfo(res.cancelled ? L('hist.cancelledAfter', { done: res.done, left: res.remaining }) : L('hist.deleted', { n: res.done }));
  }

  exportBtn.addEventListener('click', () => exportEntries(selectedIdsToEntries(listApi.selected)));
  pruneBtn.addEventListener('click', () => openPruneDialog(() => listApi.refresh()));

  container.append(wrap);
  return { repaint: () => listApi.refresh() };
}

async function openPruneDialog(refresh) {
  const j = loadJournal();
  const { body, close } = openDialog(L('hist.retention'));
  const modeSel = el('select', { class: 'select', attrs: { 'aria-label': L('hist.retention') } });
  for (const [v, key] of [
    ['keep-all', 'hist.policy.keepAll'],
    ['keep-count', 'hist.policy.keepCount'],
    ['keep-days', 'hist.policy.keepDays'],
  ]) {
    modeSel.append(el('option', { attrs: { value: v }, children: [L(key, { n: '…' })] }));
  }
  modeSel.value = j.policy.mode;
  const countIn = el('input', { class: 'input', attrs: { type: 'number', min: '10', max: String(JOURNAL_MAX_ENTRIES), 'aria-label': 'count' } });
  countIn.value = String(j.policy.count ?? 500);
  const daysIn = el('input', { class: 'input', attrs: { type: 'number', min: '7', max: '3650', 'aria-label': 'days' } });
  daysIn.value = String(j.policy.days ?? 90);
  const info = el('p', { class: 'body-small' });
  function paintInfo() {
    const policy = { mode: modeSel.value, count: Number(countIn.value) || 500, days: Number(daysIn.value) || 90 };
    const { removedCount } = applyPolicy(j, policy);
    info.textContent =
      modeSel.value === 'keep-all'
        ? L('hist.policy.keepAll')
        : `${removedCount} / ${j.entries.length}`;
  }
  modeSel.addEventListener('change', paintInfo);
  countIn.addEventListener('input', paintInfo);
  daysIn.addEventListener('input', paintInfo);
  paintInfo();

  const row = el('div', { class: 'dialog-actions' });
  const cancel = el('button', { class: 'btn btn--text', type: 'button', children: [L('common.cancel')] });
  cancel.addEventListener('click', () => close());
  const apply = el('button', { class: 'btn btn--filled', type: 'button', children: [L('common.apply')] });
  apply.addEventListener('click', async () => {
    const policy = { mode: modeSel.value, count: Number(countIn.value) || 500, days: Number(daysIn.value) || 90 };
    const { journal, removed, removedCount } = applyPolicy(loadJournal(), policy);
    if (removedCount) {
      const ok = await superConfirm({
        title: L('hist.prune.super.title', { n: removedCount }),
        body: L('hist.prune.super.body'),
        phrase: 'PRUNE',
      });
      if (!ok) return;
      const oldest = removed.length ? removed[0].at : null;
      const committed = commitEntry({ ...journal, policy }, { action: 'pruned', subject: 'journal', before: { entries: removed.length }, after: { kept: journal.entries.length }, meta: { removedCount, oldest } });
      saveJournal(committed.journal);
      notifyInfo(L('hist.pruned', { n: removedCount, m: committed.journal.entries.length, seq: committed.entry.seq }));
    } else {
      saveJournal({ ...loadJournal(), policy });
      notifyInfo(L('hist.policy.keepAll'));
    }
    close();
    refresh?.();
  });
  row.append(cancel, apply);
  body.append(
    el('div', { class: 'field', children: [el('label', { children: [L('hist.retention')] }), modeSel] }),
    el('div', { class: 'field', children: [el('label', { children: [L('hist.policy.count')] }), countIn] }),
    el('div', { class: 'field', children: [el('label', { children: [L('hist.policy.days')] }), daysIn] }),
    info,
    row,
  );
}

function openEntryDetail(entryId, refresh) {
  const j = loadJournal();
  const e = j.entries.find((x) => x.id === entryId);
  if (!e) return;
  const prev = [...j.entries].reverse().find((x) => x.subject === e.subject && x.seq < e.seq);
  const { body, close } = openDialog(L('hist.detail'), { wide: true });
  body.append(
    el('p', { class: 'body-medium', children: [`#${e.seq} · ${L(`hist.action.${e.action}`) || e.action} · ${e.subject}`] }),
    el('p', { class: 'body-small', children: [new Date(e.at).toLocaleString()] }),
  );
  if (e.label) body.append(el('p', { class: 'body-small', children: [`“${e.label}”`] }));

  body.append(el('h3', { class: 'title-medium', children: [L('hist.diff.vsPrev', { subject: e.subject })] }));
  if (!prev) {
    body.append(el('p', { class: 'body-small', children: [L('hist.diff.none')] }));
  } else {
    const lines = diffSnapshots(prev.after, e.after);
    const dv = el('div', { class: 'ops-diff', attrs: { role: 'figure', 'aria-label': 'diff' } });
    const show = lines.slice(0, 400);
    for (const ln of show) {
      const sign = ln.kind === 'added' ? '+' : ln.kind === 'removed' ? '−' : '~';
      const txt = ln.kind === 'added' ? `${ln.path}: ${ln.after}` : ln.kind === 'removed' ? `${ln.path}: ${ln.before}` : `${ln.path}: ${ln.before} → ${ln.after}`;
      dv.append(el('div', { class: `diff-line diff-${ln.kind}`, children: [`${sign} ${txt}`] }));
    }
    if (lines.length > show.length) dv.append(el('div', { class: 'diff-line', children: [`+ ${lines.length - show.length} more…`] }));
    body.append(dv);
  }

  const notes = el('div', { class: 'ops-detail-notes' });
  if (!snapIsReplayable(e.after)) notes.append(el('p', { class: 'body-small', children: [L('hist.truncatedSnap')] }));
  else if (e.after === null || e.after === undefined) notes.append(el('p', { class: 'body-small', children: [L('hist.restoreAbsent')] }));
  if (e.before === null || e.before === undefined) notes.append(el('p', { class: 'body-small', children: [L('hist.beforeAbsent')] }));
  body.append(notes);

  const row = el('div', { class: 'dialog-actions' });
  const closeBtn = el('button', { class: 'btn btn--text', type: 'button', children: [L('common.close')] });
  closeBtn.addEventListener('click', () => close());
  row.append(closeBtn);

  if (snapIsReplayable(e.after)) {
    const rb = el('button', { class: 'btn btn--tonal', type: 'button', children: [L('hist.restore')] });
    rb.addEventListener('click', () => {
      const entry = journalApply(e.subject, e.after);
      close();
      refresh?.();
      notifyInfo(L('hist.restoredDone', { seq: entry.seq }));
    });
    row.prepend(rb);
  }
  if (snapIsReplayable(e.before)) {
    const ub = el('button', { class: 'btn btn--tonal', type: 'button', children: [L('hist.undo')] });
    ub.addEventListener('click', () => {
      const entry = journalApply(e.subject, e.before);
      close();
      refresh?.();
      notifyInfo(L('hist.restoredDone', { seq: entry.seq }));
    });
    row.prepend(ub);
  }
  const lb = el('button', { class: 'btn btn--text', type: 'button', children: [L('hist.label.rev')] });
  lb.addEventListener('click', async () => {
    close();
    const label = await promptDialog(L('hist.label.rev'), e.label || '');
    if (label == null) return;
    const entry = journalCommit({ action: 'labeled', subject: e.subject, before: { label: e.label || null }, after: { label }, label, meta: { targetSeq: e.seq } });
    refresh?.();
    notifyInfo(L('hist.labeled') + ` (#${entry.seq})`);
  });
  row.prepend(lb);
  body.append(row);
}

function exportEntries(entries) {
  const redacted = entries.map((e) => ({
    seq: e.seq,
    id: e.id,
    at: e.at,
    action: e.action,
    subject: e.subject,
    label: e.label ?? null,
    before: redactValue(e.before),
    after: redactValue(e.after),
    meta: e.meta ?? null,
  }));
  const payload = {
    exportedAt: new Date().toISOString(),
    encoding: 'UTF-8',
    schema: `ccr-site journal v${JOURNAL_VERSION}`,
    redaction: 'Credential-shaped values (keys matching pass/token/secret/credential/api-key/auth) are replaced with [redacted]. Restore always uses the untouched LOCAL copy, never this export.',
    count: redacted.length,
    entries: redacted,
  };
  downloadJson(`ccr-site-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  notifyInfo(L('hist.exported', { n: redacted.length }));
}

function downloadJson(filename, text) {
  if (!inBrowser) return;
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { attrs: { href: url, download: filename } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ========================================================================== *
 * Mutation observer: poll store state, journal every visitor-owned change.
 * ========================================================================== */
let lastDump = null;
export function observeMutations(intervalMs = 20000) {
  if (!inBrowser) return;
  lastDump = store.dumpAll();
  setInterval(() => {
    const nowDump = store.dumpAll();
    const keys = new Set([...Object.keys(lastDump), ...Object.keys(nowDump)]);
    for (const k of keys) {
      if (k === JOURNAL_STORE_KEY || k.startsWith('schedule.base.')) continue; // journal + applier bookkeeping
      const before = lastDump[k];
      const after = nowDump[k];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      try {
        journalCommit({
          action: before === undefined ? 'created' : after === undefined ? 'deleted' : 'updated',
          subject: `setting:${k}`,
          before,
          after,
        });
      } catch {
        /* journal write failure must never break the site */
      }
    }
    lastDump = nowDump;
  }, intervalMs);
}

/* ========================================================================== *
 * Guide panel.
 * ========================================================================== */
export function renderGuidePanel(container) {
  const wrap = el('section', { class: 'ops-panel', attrs: { 'aria-labelledby': 'guide-h' } });
  const h = el('h2', { class: 'title-large', attrs: { id: 'guide-h' }, children: [L('guide.title')] });
  wrap.append(h);
  for (const [headKey, itemsKey] of [
    ['guide.sched.h', 'guide.sched.items'],
    ['guide.precedence.h', 'guide.precedence.items'],
    ['guide.sources.h', 'guide.sources.items'],
    ['guide.hist.h', 'guide.hist.items'],
    ['guide.bulk.h', 'guide.bulk.items'],
  ]) {
    wrap.append(el('h3', { class: 'title-medium', children: [L(headKey)] }));
    wrap.append(el('p', { class: 'body-medium', children: [L(itemsKey)] }));
  }
  container.append(wrap);
  return wrap;
}

/* ========================================================================== *
 * Boot: full ops page + slot mounting into settings.html.
 * ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);

/** Localize the static ops.html chrome through this module's copy table. */
function paintStaticChrome() {
  for (const node of document.querySelectorAll('[data-opsl]')) {
    node.textContent = L(node.getAttribute('data-opsl'));
  }
  for (const node of document.querySelectorAll('[data-opsl-aria]')) {
    node.setAttribute('aria-label', L(node.getAttribute('data-opsl-aria')));
  }
}

function wireTopbarChrome() {
  theme.init();
  const motionStyle = document.createElement('style');
  motionStyle.textContent =
    'html[data-motion="reduced"] *,html[data-motion="reduced"] *::before,html[data-motion="reduced"] *::after{animation:none!important;transition:none!important}';
  document.head.appendChild(motionStyle);

  const langSel = $('#lang-select');
  function paint() {
    if (!langSel) return;
    langSel.textContent = '';
    for (const [v, label] of Object.entries(i18n.LANGS)) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if (i18n.getLang() === v) o.selected = true;
      langSel.append(o);
    }
  }
  paint();
  langSel?.addEventListener('change', () => {
    i18n.setLang(langSel.value);
    paint();
    location.reload(); // simplest honest full repaint for the ops page
  });
  import('./notify.js').then((m) => m.init()).catch(() => {});
  return () => {};
}

function switchSection(id) {
  for (const sec of document.querySelectorAll('.pane')) {
    const on = sec.id === `pane-${id}`;
    sec.hidden = !on;
  }
  for (const tab of document.querySelectorAll('.m3-tab[data-section]')) {
    const on = tab.dataset.section === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  const target = $(`#pane-${id}`);
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

function bootOpsPage() {
  wireTopbarChrome();
  paintStaticChrome();
  i18n.apply(document);

  document.querySelectorAll('.m3-tab[data-section]').forEach((tab) => {
    tab.addEventListener('click', () => switchSection(tab.dataset.section));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const tabs = [...document.querySelectorAll('.m3-tab[data-section]')];
        const i = tabs.indexOf(tab);
        const nextTab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        nextTab.focus();
        nextTab.click();
      }
    });
  });

  renderScheduledPanel($('#pane-scheduled-host'));
  renderHistoryPanel($('#pane-history-host'));
  renderGuidePanel($('#pane-guide-host'));
  switchSection('scheduled');

  reconcileOverrides();
  startTicker();
  observeMutations();
  onScheduleChanged(() => reconcileOverrides());

  /* Command palette (Ctrl+Shift+F) wired to THIS page's real destinations. */
  Promise.all([import('./palette.js'), import('./notify.js')]).then(([paletteMod, notifyMod]) => {
    const stubBridge = {
      store,
      i18n,
      theme,
      tabs: {
        listTabs: () => [
          { id: 'scheduled', label: L('sched.tab'), page: 'ops.html?scheduled', pinned: false },
          { id: 'history', label: L('hist.tab'), page: 'ops.html?history', pinned: false },
          { id: 'guide', label: L('guide.tab'), page: 'ops.html#guide', pinned: false },
        ],
        reopenTab: (id) => {
          switchSection(id);
        },
        setDock: () => notifyMod.info('The dockable site tab strip lives on the Home and Settings pages.'),
        openDiscovery: () => notifyMod.info('Tab discovery searches live on the Home and Settings pages.'),
      },
      superConfirm,
      notify: notifyMod,
      registry: [],
      settingsRows: () => [],
      teleportToSetting: () => {},
    };
    paletteMod.init(stubBridge);
  }).catch(() => {});

  const params = new URLSearchParams(location.search);
  const want = params.get('view');
  if (want === 'history' || want === 'guide' || want === 'scheduled') switchSection(want);
}

function mountIntoSlots() {
  const histSlot = $('#history-slot');
  const schedSlot = $('#scheduled-slot');
  if (histSlot) {
    clear(histSlot);
    renderHistoryPanel(histSlot, { compact: true });
  }
  if (schedSlot) {
    clear(schedSlot);
    renderScheduledPanel(schedSlot, { compact: true });
  }
  // Scheduled slots must actually APPLY: reconcile now, keep watching.
  if (histSlot || schedSlot) {
    reconcileOverrides();
    startTicker();
    observeMutations();
    onScheduleChanged(() => reconcileOverrides());
  }
  const aboutPane = $('#spane-about');
  if ((histSlot || schedSlot) && aboutPane && !$('#ops-full-link')) {
    const p = el('p', { class: 'body-small', attrs: { id: 'ops-full-link' } });
    const a = el('a', { attrs: { href: 'ops.html' }, children: [L('ops.openFull')] });
    p.append(a);
    aboutPane.append(p);
  }
}

if (inBrowser) {
  const ready = () => {
    if ($('[data-ops-page]')) bootOpsPage();
    else if ($('#history-slot') || $('#scheduled-slot')) mountIntoSlots();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}
