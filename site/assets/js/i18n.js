/**
 * i18n: English, playful Hong Kong Cantonese, bilingual display mode.
 *
 * Facts are never restyled away: versions, product names, warnings and error
 * causes live in the plain strings verbatim. The per-language funny level
 * (1 serious .. 5 maximum playfulness, BOTH shipped at 5) only adds flavour
 * around the facts via each entry's optional `spice`, never inside them.
 *
 * Emojis appear as decoration only where `deco()` is called (dialogs, toasts,
 * status lines) and only while "Show emojis" is on — never in button or
 * control text.
 */
import * as store from './store.js';

export const LANGS = /** @type {const} */ ({ en: 'English', zh: '廣東話', bi: 'English · 廣東話' });

/** @returns {'en'|'zh'|'bi'} */
export function getLang() {
  const v = store.get('lang', 'en');
  return v === 'zh' || v === 'bi' ? v : 'en';
}
export function setLang(v) {
  store.set('lang', v === 'zh' || v === 'bi' ? v : 'en');
}

/** Funny level for one language: 1..5, shipped default 5 for BOTH languages. */
export function funnyLevel(lang) {
  const key = lang === 'zh' ? 'funny.zh' : 'funny.en';
  let v = store.get(key, 5);
  if (!Number.isInteger(v) || v < 1 || v > 5) v = 5;
  return v;
}
export function setFunnyLevel(lang, level) {
  const key = lang === 'zh' ? 'funny.zh' : 'funny.en';
  store.set(key, Math.min(5, Math.max(1, Number(level) || 3)));
}

export function showEmojis() {
  return store.get('showEmojis', true) !== false;
}
export function setShowEmojis(v) {
  store.set('showEmojis', !!v);
}

/**
 * Emoji decoration helper. Returns '' whenever emojis are off, so call sites
 * can interpolate it without branching. Never use inside control labels.
 */
export function deco(emoji) {
  return showEmojis() && emoji ? emoji + ' ' : '';
}

function resolveText(entry, lang) {
  const wantZh = lang === 'zh';
  return wantZh ? entry.zh ?? entry.en : entry.en;
}

/**
 * Translate one key honouring language + funny level.
 * @param {string} key
 * @param {Record<string,string|number>} [vars] `{name}` substitutions.
 * @param {'en'|'zh'} [forceBase]
 */
export function t(key, vars, forceBase) {
  const entry = DICT[key];
  const lang = forceBase ?? (getLang() === 'zh' ? 'zh' : 'en');
  if (!entry) return key;
  let base = resolveText(entry, lang);
  const level = funnyLevel(lang === 'zh' ? 'zh' : 'en');
  if (level >= 4 && entry.spice) {
    const spice = resolveText({ en: entry.spice.en, zh: entry.spice.zh }, lang);
    if (spice) base = `${spice} ${base}`;
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      base = base.split(`{${k}}`).join(String(v));
    }
  }
  return base;
}

/** Secondary line for bilingual mode (the OTHER language, compact). */
export function tSecondary(key) {
  const entry = DICT[key];
  if (!entry) return '';
  const lang = getLang() === 'zh' ? 'zh' : 'en';
  return resolveText(entry, lang === 'en' ? 'zh' : 'en');
}

/**
 * Apply translations to a subtree: data-i18n (text), data-i18n-html
 * (trusted, repo-authored HTML only), data-i18n-placeholder,
 * data-i18n-aria-label, data-i18n-title. In bilingual mode the primary text is
 * rendered plus a compact secondary line.
 */
export function apply(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    const primary = t(key);
    node.textContent = primary;
    if (getLang() === 'bi') {
      const sec = tSecondary(key);
      if (sec && sec !== primary) {
        const span = document.createElement('span');
        span.className = 'bi-sub body-small';
        span.setAttribute('aria-hidden', 'false');
        span.textContent = sec;
        node.append(span);
      }
    }
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    // Trusted: this markup is authored in this repository, never user input.
    node.innerHTML = t(node.getAttribute('data-i18n-html'));
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  }
  for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
  }
}

/*
 * ---------------------------------------------------------------------------
 * Dictionary. Every entry: { en, zh, spice?: {en,zh} }. Keep facts identical
 * across en/zh/spice — only tone differs.
 * ---------------------------------------------------------------------------
 */
export const DICT = {
  /* brand / nav */
  'brand.name': { en: 'Claude Code Router', zh: 'Claude Code Router' },
  'brand.aria': { en: 'Claude Code Router home', zh: 'Claude Code Router 主頁' },
  'nav.home': { en: 'Home', zh: '主頁' },
  'nav.docs': { en: 'Docs', zh: '文檔' },
  'nav.changelog': { en: 'Changelog', zh: '更新日誌' },
  'nav.settings': { en: 'Settings', zh: '設定' },
  'nav.download': { en: 'Download', zh: '下載' },

  /* home */
  'home.title': { en: 'Route Claude Code to any LLM', zh: '將 Claude Code 路由去任何 LLM' },
  'home.lede': {
    en: 'Claude Code Router is a free tool that lets you direct Claude Code requests to different models and providers, with transform rules, routing profiles and provider management.',
    zh: 'Claude Code Router 係免費工具，可以幫你將 Claude Code 嘅請求派去唔同模型同供應商，仲有轉換規則、路由設定檔同供應商管理。',
  },
  'home.cta.download': { en: 'Get the app', zh: '攞個 app' },
  'home.card.docs.title': { en: 'Documentation', zh: '文檔' },
  'home.card.docs.body': { en: 'Feature articles covering behaviour, configuration and failure modes.', zh: '功能文章，講清楚行為、配置同失敗模式。' },
  'home.card.changelog.title': { en: 'Changelog', zh: '更新日誌' },
  'home.card.changelog.body': { en: 'Every released version, searchable, with links to the exact commits.', zh: '每個發布版本都有，可以搜尋，重有確切 commit 連結。' },
  'home.card.settings.title': { en: "This site's settings", zh: '呢個網站嘅設定' },
  'home.card.settings.body': { en: 'Theme, language, typography, colours, notifications — all customizable, all local.', zh: '主題、語言、字體、顏色、通知——全部可以自訂，全部只存本機。', spice: { en: '(go on, break it in half — there is a reset)', zh: '（是但較，較爛都有得 reset）' } },

  docs: { en: 'Documentation', zh: '文檔' },
  changelog: { en: 'Changelog', zh: '更新日誌' },
  download: { en: 'Download', zh: '下載' },
  settingsTitle: { en: 'Settings', zh: '設定' },
  'docs.title': { en: 'Documentation', zh: '文檔' },
  'changelog.title': { en: 'Changelog', zh: '更新日誌' },
  'download.title': { en: 'Download', zh: '下載' },

  'slot.pending.title': { en: 'Wave-2 content mounts here', zh: '第二波內容會喺呢度出現' },
  'slot.pending.body': {
    en: 'Wave-2 mounts its surface inside this documented slot container. The slot, scroll container and search wiring are ready now.',
    zh: '第二波會將佢個界面掛入呢個已記錄嘅槽位。槽位、捲動容器同搜尋接線而家已經備妥。',
  },

  /* theme */
  'theme.toggle': { en: 'Toggle light or dark theme', zh: '切換光暗主題' },
  'theme.mode.auto': { en: 'Auto (follow system)', zh: '自動（跟系統）' },
  'theme.mode.light': { en: 'Light', zh: '光的' },
  'theme.mode.dark': { en: 'Dark', zh: '暗的' },
  'theme.changed': { en: 'Theme applied.', zh: '主題已套用。' },

  /* palette */
  'palette.open': { en: 'Commands', zh: '指令' },
  'palette.close': { en: 'Close palette', zh: '閂咗個 palette' },
  'palette.placeholder': { en: 'Search commands, pages and settings…', zh: '搜尋指令、頁面同設定…' },
  'palette.noMatch': { en: 'No commands match this query.', zh: '冇指令符合呢個搜尋。', spice: { en: '(the palette looked everywhere)', zh: '（palette 周圍都搵勻）' } },
  'palette.results': { en: '{n} results', zh: '{n} 個結果' },
  'palette.size.bounded': { en: 'Bounded card', zh: '細卡模式' },
  'palette.size.full': { en: 'Full window', zh: '全視窗' },
  'palette.hint': { en: 'Type to filter · ↑↓ move · Enter activate · Esc close', zh: '打字過濾 · ↑↓ 揀 · Enter 確認 · Esc 閂' },

  /* tabs */
  'tabs.overflow.open': { en: 'More tabs', zh: '更多分頁' },
  'tabs.newGroup': { en: 'New tab group…', zh: '開新分頁群組…' },
  'tabs.renameGroup': { en: 'Rename group…', zh: '改群組名…' },
  'tabs.colorGroup': { en: 'Group colour…', zh: '群組顏色…' },
  'tabs.collapseGroup': { en: 'Collapse group', zh: '收起群組' },
  'tabs.expandGroup': { en: 'Expand group', zh: '攤開群組' },
  'tabs.removeGroup': { en: 'Remove group (keep tabs)', zh: '移除群組（保留分頁）' },
  'tabs.moveIntoGroup': { en: 'Move into group…', zh: '移入群組…' },
  'tab.pin': { en: 'Pin tab', zh: '釘住分頁' },
  'tab.unpin': { en: 'Unpin tab', zh: '拔返出嚟' },
  'tab.editAppearance': { en: 'Edit tab appearance…', zh: '編輯分頁外觀…' },
  'tab.close': { en: 'Close', zh: '閂' },
  'tab.closeOthers': { en: 'Close other tabs', zh: '閂其他分頁' },
  'tab.closeRight': { en: 'Close tabs to the right', zh: '閂右邊全部' },
  'tabs.dock': { en: 'Dock strip to…', zh: '工具列停去…' },
  'tabs.dock.left': { en: 'Left', zh: '左邊' },
  'tabs.dock.right': { en: 'Right', zh: '右邊' },
  'tabs.dock.top': { en: 'Top', zh: '頂部' },
  'tabs.dock.bottom': { en: 'Bottom', zh: '底部' },
  'tabs.searchStrip': { en: 'Find in current strip…', zh: '喺現行分頁列搵…' },
  'tabs.searchGroup': { en: 'Search inside every tab group…', zh: '搜尋每個分頁群組入面…' },
  'tabs.searchGroupsByName': { en: 'Find tab groups by name…', zh: '按名稱搵分頁群組…' },
  'tabs.searchMaster': { en: 'Master tab search (all tabs)…', zh: '總搜尋（所有分頁）…' },
  'tabs.bulkClose': { en: 'Bulk close tabs…', zh: '大量閂分頁…' },
  'tabs.bulk.title': { en: 'Close tabs containing / not containing text', zh: '閂包含／唔包含指定文字嘅分頁' },
  'tabs.bulk.containing': { en: 'Close tabs CONTAINING', zh: '閂「包含」嘅' },
  'tabs.bulk.notContaining': { en: 'Close tabs NOT containing', zh: '閂「唔包含」嘅' },
  'tabs.bulk.preview': { en: '{n} tab(s) match. Review before closing:', zh: '{n} 個分頁符合。閂之前先睇清楚：' },
  'tabs.bulk.none': { en: 'No tabs match. Nothing will close.', zh: '冇分頁符合，唔會閂任何嘢。', spice: { en: '(every tab survives this round)', zh: '（今輪全數生還）' } },
  'tabs.bulk.includePinned': { en: 'Also include pinned tabs', zh: '連釘住嘅分頁都計埋' },
  'tabs.bulk.confirm': { en: 'Close {n} tab(s)', zh: '閂 {n} 個分頁' },
  'tabs.bulk.done': { en: 'Closed {n} tab(s); skipped {m} protected.', zh: '閂咗 {n} 個分頁；跳過 {m} 個受保護。' },
  'tabs.groupPicker.title': { en: 'Move “{tab}” into group', zh: '將「{tab}」移入群組' },
  'tabs.groupPicker.newGroup': { en: '+ Create new group', zh: '+ 開個新群組' },
  'tabs.groupPicker.empty': { en: 'No groups yet — create one below.', zh: '仲未有群組——下面開一個啦。' },
  'tabs.groupPicker.members': { en: '{n} member(s)', zh: '{n} 個成員' },
  'tabs.movedToGroup': { en: 'Tab moved into “{group}”.', zh: '分頁已移入「{group}」。' },
  'tabs.pinned': { en: 'Pinned.', zh: '釘好喇。' },
  'tabs.unpinned': { en: 'Unpinned.', zh: '拔咗喇。' },
  'tabs.protected': { en: '{tab} is pinned — unpin it first to close it.', zh: '{tab} 釘住咗——想閂就先拔走佢。' },
  'tabs.discovery.strip.title': { en: 'Find in current tab strip', zh: '喺現行分頁列搵' },
  'tabs.discovery.group.title': { en: 'Search inside tab groups', zh: '搜尋分頁群組入面' },
  'tabs.discovery.groups.title': { en: 'Find tab groups by name', zh: '按名稱搵分頁群組' },
  'tabs.discovery.master.title': { en: 'Master tab search — every open tab', zh: '總搜尋——所有分頁' },
  'tabs.lockedTag': { en: 'locked', zh: '上鎖' },

  /* menus */
  'menu.filter': { en: 'Filter menu…', zh: '過濾選單…' },
  'menu.noMatch': { en: 'No menu items match.', zh: '冇項目符合。' },
  'menu.results': { en: '{n} item(s)', zh: '{n} 項' },

  /* search + regex builder */
  'search.builder.open': { en: 'Open regex builder', zh: '開 regex 建造器' },
  'search.mode.plain': { en: 'Plain text', zh: '純文字' },
  'search.mode.regex': { en: 'Regular expression', zh: '正規表達式' },
  'builder.title': { en: 'Regex builder', zh: 'Regex 建造器' },
  'builder.pattern': { en: 'Pattern', zh: '樣式' },
  'builder.flags': { en: 'Flags', zh: '旗標' },
  'builder.flagsHint': { en: 'g global · i ignore case · m multiline · s dotall · u unicode', zh: 'g 全域 · i 忽略大小寫 · m 多行 · s dotall · u unicode' },
  'builder.sample': { en: 'Sample text', zh: '測試文字' },
  'builder.matches': { en: '{n} match(es)', zh: '{n} 個匹配' },
  'builder.invalid': { en: 'Invalid pattern: {err}', zh: '無效樣式：{err}' },
  'builder.insert': { en: 'Insert token', zh: '插入符號' },
  'builder.apply': { en: 'Use pattern', zh: '用呢個樣式' },
  'builder.engine': { en: 'Engine: JavaScript RegExp (ECMAScript). Escape \\ . $ ^ etc. yourself in literal mode.', zh: '引擎：JavaScript RegExp（ECMAScript）。字面模式下自己處理 \\ . $ ^ 等跳脫。' },
  'results.count': { en: '{n} result(s)', zh: '{n} 個結果' },
  'results.none': { en: 'Nothing matches this filter.', zh: '冇嘢符合呢個篩選。', spice: { en: '(zero, zilch, not one)', zh: '（零粒都冇）' } },

  /* notifications */
  'notify.dismiss': { en: 'Dismiss', zh: '收到' },
  'notify.centre.open': { en: 'Notification centre', zh: '通知中心' },
  'notify.centre.title': { en: 'Notification centre & history', zh: '通知中心同歷史' },
  'notify.centre.empty': { en: 'No notifications yet. Errors and warnings stay here until you clear them.', zh: '暫時冇通知。錯誤同警告會留喺度直到你清走。', spice: { en: '(peacefully empty)', zh: '（靜英英，乜都冇）' } },
  'notify.selectAll': { en: 'Select all (this list)', zh: '全揀（呢一版）' },
  'notify.selectInverse': { en: 'Invert selection', zh: '反轉揀法' },
  'notify.clearFilters': { en: 'Clear filters', zh: '清走篩選' },
  'notify.bulkDismiss': { en: 'Dismiss selected', zh: '收起所選' },
  'notify.bulkDelete': { en: 'Delete selected permanently', zh: '永久刪除所選' },
  'notify.bulkExport': { en: 'Export selected', zh: '匯出所選' },
  'notify.exported': { en: 'Exported {n} notification(s) as JSON (downloaded file).', zh: '已匯出 {n} 條通知做 JSON（已下載）。' },
  'notify.deleted': { en: 'Deleted {n}.', zh: '刪除咗 {n} 條。' },
  'notify.super.delete.title': { en: 'Permanently delete {n} notification(s)?', zh: '永久刪除 {n} 條通知？' },
  'notify.super.delete.body': { en: 'History is local and cannot be recovered after deletion.', zh: '歷史只存本機，刪咗就救唔返。' },

  /* super confirmation */
  'super.title': { en: 'Confirm destructive action', zh: '確認破壞性動作' },
  'super.key1': { en: 'Key 1 — type exactly: {phrase}', zh: '第一把鑰匙——照打：{phrase}' },
  'super.key2': { en: 'Key 2 — hold the second button until it fills', zh: '第二把鑰匙——撳住第二個掣等佢填滿' },
  'super.key2.holding': { en: 'Keep holding…', zh: '繼續揿住…' },
  'super.slider': { en: 'Final confirmation slider', zh: '最後確認滑桿' },
  'super.exit': { en: 'Emergency exit — cancel', zh: '緊急出口——取消' },
  'super.blocked': { en: 'Complete both keys to unlock the slider.', zh: '先完成兩把鑰匙先可以拉滑桿。' },

  /* settings sections */
  'settings.section.appearance': { en: 'Appearance', zh: '外觀' },
  'settings.section.language': { en: 'Language & voice', zh: '語言同口吻' },
  'settings.section.notifications': { en: 'Notifications', zh: '通知' },
  'settings.section.tabs': { en: 'Tabs & layout', zh: '分頁同版面' },
  'settings.section.accessibility': { en: 'Accessibility & motion', zh: '無障礙同動態' },
  'settings.section.data': { en: 'Data & privacy', zh: '資料同私隱' },
  'settings.section.about': { en: 'About', zh: '關於' },
  'settings.title': { en: 'Settings', zh: '設定' },
  'settings.intro': { en: 'Everything on this site is customizable and stored locally in your browser. Nothing here leaves this machine.', zh: '呢個網站全部嘢都可以自訂，而且只會存喺你個瀏覽器度，乜都唔會離開部機。' },
  'settings.explain.show': { en: 'What does this do?', zh: '呢個係做乜？' },
  'settings.provenance.default': { en: 'Shipped default: {value}', zh: '原廠預設：{value}' },
  'settings.provenance.custom': { en: 'You changed this from the shipped default.', zh: '你改咗呢個，同原廠預設唔同。' },
  'settings.coverage.warn': { en: 'Coverage check found mismatches between the hand-written settings inventory and the rendered page — see the browser console for the exact list.', zh: '覆蓋檢查發現手寫設定清單同實際頁面有出入——詳細清單睇瀏覽器 console。' },

  /* appearance editor */
  'appear.edit': { en: 'Edit appearance…', zh: '編輯外觀…' },
  'appear.title': { en: 'Appearance — {target}', zh: '外觀——{target}' },
  'appear.tab.colour': { en: 'Colour', zh: '顏色' },
  'appear.tab.type': { en: 'Typography', zh: '字體排印' },
  'appear.tab.shape': { en: 'Shape & spacing', zh: '形狀同間距' },
  'appear.resetElement': { en: 'Reset this element', zh: '重設呢個元素' },
  'appear.resetGlobal': { en: 'Reset ALL customizations', zh: '重設全部自訂' },
  'appear.presets': { en: 'Presets (from shipped defaults)', zh: '預設集（來自原廠預設）' },
  'appear.export': { en: 'Export JSON', zh: '匯出 JSON' },
  'appear.import': { en: 'Import JSON', zh: '匯入 JSON' },
  'appear.imported': { en: 'Imported {n} override(s).', zh: '匯入咗 {n} 項覆寫。' },
  'appear.resetDone': { en: 'Customization reset.', zh: '自訂已重設。' },

  'color.pick': { en: 'Pick colour…', zh: '揀顏色…' },
  'color.rainbow': { en: 'Animated rainbow', zh: '彩虹流動' },
  'color.rainbow.speed': { en: 'Rainbow speed (level {n})', zh: '彩虹速度（級別 {n}）' },
  'color.rainbow.durationNote': { en: 'One full cycle ≈ {s}s. One duration is published globally so every rainbow turns together; reduced motion settles on ONE fixed hue.', zh: '轉一圈約 {s} 秒。全站共用一個速度令所有彩虹同步；減少動態時會定喺單一色相。' },
  'contrast.vs': { en: 'Contrast vs page background: {ratio}:1', zh: '同頁面背景嘅對比：{ratio}:1' },

  'type.family': { en: 'Family', zh: '字族' },
  'type.family.note': { en: 'Browsers cannot enumerate installed system fonts, so this bundled web-safe list stands in honestly — no pretend font detection.', zh: '瀏覽器冇得列舉系統字體，所以老老實实用呢份內置通用字族清單——唔會扮偵測到你裝咗乜。' },
  'type.size': { en: 'Size (px)', zh: '大細（px）' },
  'type.weight': { en: 'Weight', zh: '粗幼' },
  'type.style': { en: 'Style', zh: '體' },
  'type.decoration': { en: 'Decoration', zh: '修飾' },
  'type.underline': { en: 'Underline', zh: '底線' },
  'type.strikeSingle': { en: 'Strikethrough', zh: '刪除線' },
  'type.strikeDouble': { en: 'Double strikethrough', zh: '雙刪除線' },
  'type.overline': { en: 'Overline', zh: '頂線' },
  'type.caps': { en: 'Capitalization', zh: '大細楷' },
  'type.smallCaps': { en: 'Small caps', zh: '小楷大寫' },
  'type.superSub': { en: 'Baseline offset', zh: '基線偏移' },
  'type.highlight': { en: 'Highlight', zh: '螢光筆' },
  'type.outline': { en: 'Outline', zh: '描邊' },
  'type.shadow': { en: 'Shadow', zh: '陰影' },
  'type.glow': { en: 'Glow', zh: '光暈' },
  'type.charSpacing': { en: 'Character spacing (px)', zh: '字符間距（px）' },
  'type.wordSpacing': { en: 'Word spacing (px)', zh: '詞語間距（px）' },
  'type.lineHeight': { en: 'Line height', zh: '行高' },
  'type.direction': { en: 'Direction', zh: '方向' },
  'type.align': { en: 'Alignment', zh: '對齊' },
  'type.previewLabel': { en: 'Live preview', zh: '即時預覽' },

  /* common */
  'common.cancel': { en: 'Cancel', zh: '取消' },
  'common.close': { en: 'Close', zh: '閂' },
  'common.ok': { en: 'OK', zh: '好' },
  'common.apply': { en: 'Apply', zh: '套用' },
  'common.reset': { en: 'Reset', zh: '重設' },
  'common.save': { en: 'Save', zh: '儲存' },
  'common.add': { en: 'Add', zh: '加入' },
  'common.remove': { en: 'Remove', zh: '移除' },
  'common.rename': { en: 'Rename', zh: '改名' },
  'common.name': { en: 'Name', zh: '名' },
  'common.on': { en: 'On', zh: '開' },
  'common.off': { en: 'Off', zh: '閂' },
  'common.level': { en: 'Level {n}', zh: '級別 {n}' },
  'common.serious': { en: 'Fully serious', zh: '完全正經' },
  'common.maxFun': { en: 'Maximum playfulness', zh: '最好玩' },
  'common.copy': { en: 'Copy', zh: '複製' },
  'common.jump': { en: 'Go there', zh: '跳過去' },

  /* data */
  'data.resetAll.title': { en: 'Erase all site preferences?', zh: '抹走晒網站偏好？' },
  'data.resetAll.body': { en: 'Theme, language, funny levels, tabs, appearance overrides, notification history — everything goes back to shipped defaults.', zh: '主題、語言、搞笑程度、分頁、外觀覆寫、通知歷史——全部回復原廠。' },
  'data.resetAll.done': { en: 'Erased {n} preference(s).', zh: '抹走咗 {n} 項偏好。' },
  'data.export': { en: 'Export all settings (JSON)', zh: '匯出全部設定（JSON）' },
  'data.import': { en: 'Import settings (JSON)', zh: '匯入設定（JSON）' },
  'data.privacy.note': { en: 'All state lives in this browser under localStorage keys named ccr-site.*. No analytics, no network calls, no sync.', zh: '所有狀態只存喺呢個瀏覽器嘅 localStorage（ccr-site.* ）。零分析、零網絡請求、零同步。' },

  /* about */
  'about.version': { en: 'Site version', zh: '網站版本' },
  'about.funny.disclosure': {
    en: 'Disclosure: the funny-level sliders style all copy on this site — including errors and warnings. English and Cantonese both ship at level 5; change either any time. Facts (versions, warnings, what a control does) never change.',
    zh: '披露：搞笑程度滑桿會影響全站文案——包括錯誤同警告。英文同廣東話都預設第 5 級，隨時可調。事實（版本、警告、控件作用）永遠唔變。',
  },

  /* settings rows (labels + explanations) */
  'settings.language.label': { en: 'Language mode', zh: '語言模式' },
  'settings.language.desc': {
    en: 'English, playful Hong Kong Cantonese, or bilingual (primary plus a compact second line). Applies immediately.',
    zh: '英文、搞笑廣東話、或者雙語（主行加一行細字）。即刻生效。',
  },
  'settings.funny.en.label': { en: 'Funny level — English', zh: '搞笑程度——英文' },
  'settings.funny.zh.label': { en: 'Funny level — Cantonese', zh: '搞笑程度——廣東話' },
  'settings.showEmojis.label': { en: 'Show emojis in dialogs and messages', zh: '喺對話框同訊息顯示 emoji' },
  'settings.showEmojis.desc': {
    en: 'Adds a relevant emoji decoration to dialogs, toasts and status lines when on. Never added to buttons, action labels or field labels.',
    zh: '開咗之後，對話框、toast 同狀態列會有相關 emoji 點點綴。掣、動作標籤同欄位標籤永遠唔會有。',
  },
  'settings.notify.timeout.label': { en: 'Info auto-dismiss after', zh: '資訊通知自動收起時間' },
  'settings.notify.timeout.desc': {
    en: 'Informational snackbars auto-dismiss after this long. Errors and warnings ALWAYS persist until dismissed, whatever this value is.',
    zh: '資訊式通知會喺呢段時間後自動收起。錯誤同警告無論點設定都會留到你自己閂。',
  },
  'settings.notify.cap.label': { en: 'History cap', zh: '歷史上限' },
  'settings.notify.sample.label': { en: 'Fire one of each kind', zh: '每種通知發一個' },
  'settings.notify.sample.desc': {
    en: 'Shows one info, success, warning and error snackbar so you can see the persistence behaviour for yourself.',
    zh: '彈一個 info、success、warning、error 出嚟，等你親眼睇下邊啲會留低。',
  },
  'settings.tabs.dock.desc': {
    en: 'Which edge the tab strip docks to. Changeable here AND from the strip context menu; persisted per visitor.',
    zh: '分頁列停喺哪一邊。呢度同分頁列右鍵選單都可以改；會記住你嘅選擇。',
  },
  'settings.tabs.discovery.desc': {
    en: 'Four searches: current strip, inside every group, groups by name, and a master search across all tabs — each with its own regex builder.',
    zh: '四個搜尋：現行分頁列、每個群組內、按名稱搵群組、同埋跨所有分頁嘅總搜尋——各自都有 regex 建造器。',
  },
  'settings.motion.label': { en: 'Motion', zh: '動態效果' },
  'settings.motion.desc': {
    en: 'Auto follows your system reduced-motion setting. Reduced disables animation site-wide AND settles the rainbow on ONE fixed hue.',
    zh: '自動會跟系統嘅減少動態設定。減少模式會停用全站動畫，仲會將彩虹定喺單一色相。',
  },
  'settings.focus.label': { en: 'Focus ring width', zh: '焦點環粗幼' },
  'settings.focus.desc': {
    en: 'Keyboard focus indicators stay visible everywhere; make them thicker if you like.',
    zh: '鍵盤焦點指示全部可見；想粗啲就較粗啲。',
  },
};

/* Bilingual compact-secondary styling hook (kept tiny; app.css carries it). */
if (typeof document !== 'undefined' && !document.getElementById('ccr-bi-style')) {
  const style = document.createElement('style');
  style.id = 'ccr-bi-style';
  style.textContent =
    '.bi-sub{display:block;font-size:12px;line-height:16px;color:var(--md-sys-color-on-surface-variant)}';
  document.head.appendChild(style);
}
