/**
 * Content lane: offline docs browser, landing features grid, in-site
 * changelog viewer, honest download state.
 *
 * Everything here renders from site/docs/site-data.js — a generated bundle of
 * the repository's REAL docs/features/*.md and CHANGELOG.md (see
 * site/docs/build-data.mjs). One source of truth; the sha-stamped bundle makes
 * drift visible in review.
 *
 * Surfaces mounted:
 *   #home-features-slot  features grid rendered from the bundled articles
 *   #docs-article-slot   docs index (search + anchored regex builder) + article reader
 *   #changelog-slot      changelog viewer (date-range calendar + regex search + export)
 *   #download-slot       release manifest check with an honest absent state
 *
 * Node-import safe: no DOM work at module top level. Storage only through
 * store.js. No network calls at runtime except the same-origin fetch of the
 * bundled release-manifest.json (an asset, not a remote service); external
 * commit/download links are plain anchors the USER initiates.
 */
import * as store from './store.js';
import { el, clear, positionPopover } from './util.js';
import * as i18n from './i18n.js';
import { attachSearchField, compile } from './search.js';
import * as notifyMod from './notify.js';
import { ARTICLES, CHANGELOG_MD } from '../../docs/site-data.js';

const inBrowser = typeof document !== 'undefined';

/* ================================================================== */
/* Local dictionary                                                    */
/* ------------------------------------------------------------------ */
/* The core lane owns i18n.js's DICT; this lane keeps its own copy so  */
/* ownership stays clean. Same semantics: {en, zh, spice?}, funny      */
/* level >= 4 prepends spice around facts that never change, bilingual */
/* mode renders a compact secondary line via biSub().                  */
/* ================================================================== */

const L = {
  'content.features.title': { en: 'What is inside', zh: '入面有乜' },
  'content.features.lede': {
    en: 'The three feature areas currently documented for Claude Code Router, rendered straight from the repository docs.',
    zh: 'Claude Code Router 而家文檔記載嘅三個功能範疇，直接由 repo 文檔渲染出嚟。',
    spice: { en: '(no marketing gloss — just the docs, dressed up)', zh: '（冇化妝冇吹水——係文檔本身，著咗靚衫）' },
  },
  'content.features.read': { en: 'Read the article', zh: '睇全文' },
  'content.status.label': { en: 'Status', zh: '狀態' },

  'docs.search.label': { en: 'Search articles', zh: '搜尋文章' },
  'docs.count': { en: '{n} article(s)', zh: '{n} 篇文章' },
  'docs.back': { en: '← All articles', zh: '← 返回文章列表' },
  'docs.suggested': { en: 'Suggested next articles', zh: '建議下一篇' },
  'docs.empty': {
    en: 'No article matches this search.',
    zh: '冇文章符合呢個搜尋。',
    spice: { en: '(the library went quiet)', zh: '（圖書館靜晒）' },
  },
  'docs.jump': { en: 'Open documentation tab', zh: '跳去文檔分頁' },

  'cl.search.label': { en: 'Search changelog', zh: '搜尋更新日誌' },
  'cl.date.all': { en: 'All dates', zh: '所有日期' },
  'cl.date.pick': { en: 'Pick date range…', zh: '揀日期範圍…' },
  'cl.cal.title': { en: 'Filter by date range', zh: '按日期範圍篩選' },
  'cl.cal.prev': { en: 'Previous month', zh: '上一個月' },
  'cl.cal.next': { en: 'Next month', zh: '下一個月' },
  'cl.cal.from': { en: 'From', zh: '由' },
  'cl.cal.to': { en: 'To', zh: '至' },
  'cl.cal.apply': { en: 'Apply range', zh: '套用範圍' },
  'cl.cal.clear': { en: 'Clear dates', zh: '清走日期' },
  'cl.cal.presets': { en: 'Presets', zh: '快速揀法' },
  'cl.preset.7': { en: 'Last 7 days', zh: '最近 7 日' },
  'cl.preset.30': { en: 'Last 30 days', zh: '最近 30 日' },
  'cl.preset.90': { en: 'Last 90 days', zh: '最近 90 日' },
  'cl.preset.year': { en: 'This year', zh: '今年' },
  'cl.cal.badDate': {
    en: 'Cannot read that date. Use {fmt} or ISO (YYYY-MM-DD).',
    zh: '睇唔明呢個日期。請用 {fmt} 或者 ISO 格式（YYYY-MM-DD）。',
  },
  'cl.cal.order': { en: '“From” is after “To” — the range was swapped automatically.', zh: '「由」遲過「至」——已經自動調轉咗。' },
  'cl.export.md': { en: 'Export .md', zh: '匯出 .md' },
  'cl.export.txt': { en: 'Export .txt', zh: '匯出 .txt' },
  'cl.shown': { en: '{shown} of {total} versions shown', zh: '顯示 {total} 個版本之中嘅 {shown} 個' },
  'cl.undated.group': { en: 'Not dated yet', zh: '仲未定日子' },
  'cl.undated.note': {
    en: 'A date filter does not apply to undated entries; they stay listed.',
    zh: '日期篩選唔會郁冇日期嘅項目；佢哋會照列出嚟。',
  },
  'cl.searchHiddenNote': { en: 'Entries hidden by this search are not exported.', zh: '被搜尋收起嘅項目唔會匯出。' },
  'cl.empty': {
    en: 'No changelog entry matches the current filters.',
    zh: '冇更新日誌項目符合而家嘅篩選。',
    spice: { en: '(the steamer basket came back empty)', zh: '（個籠仔倒返轉都冇嘢）' },
  },
  'cl.exported': { en: 'Exported {n} version(s) as {fmt}. Range: {range}', zh: '已匯出 {n} 個版本做 {fmt}。範圍：{range}' },

  'dl.checking': { en: 'Checking the release manifest…', zh: '正在查詢發布清單…' },
  'dl.absent.title': { en: 'No verified installer release yet', zh: '仲未有已驗證嘅安裝程式發布' },
  'dl.absent.body': {
    en: 'Releases are published automatically on every push once CI billing is unblocked. This page checks {path} when it loads; a download button appears here only when a verified release manifest exists. No URL is guessed and no third-party mirror is linked.',
    zh: '一旦 CI 收費解封，每次 push 都會自動發布版本。呢一頁載入時會查 {path}；只有喺存在已驗證嘅發布清單時，先會喺呢度出現下載掣。唔會亂估網址，亦唔會連去第三方鏡像。',
  },
  'dl.retry': { en: 'Check again', zh: '再查一次' },
  'dl.error.title': { en: 'Release manifest could not be read', zh: '讀唔到發布清單' },
  'dl.error.body': {
    en: 'The manifest check failed ({err}). Until a verified manifest is reachable there is nothing to download here — by design.',
    zh: '清單檢查失敗（{err}）。喺有已驗證嘅清單之前，呢度係冇嘢好下載嘅——設計如此。',
  },
  'dl.present.title': { en: 'Verified releases', zh: '已驗證發布' },
  'dl.assets': { en: '{n} file(s)', zh: '{n} 個檔案' },
  'dl.download': { en: 'Download', zh: '下載' },
};

/** Local el() wrapper that accepts children as extra arguments (the core
 * util el() takes children only via opts.children). */
function elt(tag, opts = {}, ...children) {
  const node = el(tag, opts);
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c);
  }
  return node;
}

/** Resolve one local entry honouring language mode + funny level (facts stay exact). */
function ctRaw(entry) {
  const lang = i18n.getLang() === 'zh' ? 'zh' : 'en';
  let base = entry[lang] ?? entry.en;
  if (i18n.funnyLevel(lang) >= 4 && entry.spice) {
    const spice = entry.spice[lang] ?? entry.spice.en;
    if (spice) base = `${spice} ${base}`;
  }
  return base;
}

/** Translate a content-lane key with {var} substitution. */
function ct(key, vars) {
  const entry = L[key];
  let s = entry ? ctRaw(entry) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Secondary-language line for bilingual mode (facts, no spice). */
function ctSecondary(key) {
  const entry = L[key];
  if (!entry) return '';
  const lang = i18n.getLang() === 'zh' ? 'zh' : 'en';
  return entry[lang === 'en' ? 'zh' : 'en'] ?? '';
}

/** Set localized primary text (+ compact bilingual second line) on a node. */
function setText(node, key, vars) {
  node.textContent = ct(key, vars);
  if (i18n.getLang() === 'bi') {
    const sec = ctSecondary(key);
    if (sec && sec !== node.textContent) {
      const span = document.createElement('span');
      span.className = 'bi-sub body-small';
      span.textContent = sec;
      node.append(span);
    }
  }
  return node;
}

/* ================================================================== */
/* Paths                                                               */
/* ================================================================== */

function basePath() {
  if (!inBrowser) return '/';
  const m = document.querySelector('meta[name="ccr-base-path"]');
  return (m && m.getAttribute('content')) || '/';
}

/** Resolve a path relative to the configured base path (default /claude-code-router/). */
function siteUrl(p) {
  const b = basePath().replace(/\/*$/, '/');
  return b + String(p).replace(/^\/+/, '');
}

/* ================================================================== */
/* Shared isolated markdown renderer                                   */
/* ================================================================== */

/**
 * Emoji shortcode map (GitHub-style names). Unknown shortcodes render as
 * their literal text rather than being dropped — honesty over magic.
 */
const EMOJI = {
  tada: '🎉', rocket: '🚀', sparkles: '✨', bug: '🐛', wrench: '🔧',
  hammer: '🔨', art: '🎨', zap: '⚡', fire: '🔥', memo: '📝',
  book: '📖', books: '📚', lock: '🔒', unlock: '🔓', key: '🔑',
  shield: '🛡️', warning: '⚠️', construction: '🚧', white_check_mark: '✅',
  x: '❌', question: '❓', bulb: '💡', package: '📦', truck: '🚚',
  arrow_up: '⬆️', arrow_down: '⬇️', recycle: '♻️', trash: '🗑️',
  wrench_tone1: '🔧', gear: '⚙️', globe_with_meridians: '🌐',
  seedling: '🌱', blossom: ' blossom'.trim(), sunflower: '🌻',
  whale: '🐳', snake: '🐍', penguin: '🐧', owl: '🦉',
  heart: '❤️', eyes: '👀', clap: '👏', handshake: '🤝',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉',
  heavy_plus_sign: '➕', heavy_minus_sign: '➖', ok_hand: '👌',
  rotating_light: '🚨', lipstick: '💄', alembic: '⚗️', pencil2: '✏️',
};

/**
 * Inline tokenizer source. IMPORTANT: this is a SOURCE STRING compiled fresh
 * for every parseInline() call — a shared /g regex object would let a
 * recursive call (bold/italic/link labels recurse) reset lastIndex under the
 * iterating caller and hang the renderer in an infinite loop.
 */
export const INLINE_SOURCE =
  '(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(__[^_\\n]+__)|(\\*[^*\\n]+\\*)|(\\[[^\\]\\n]*\\]\\([^)\\s]*\\))|(https?:\\/\\/[^\\s<>()"\']+)|(:[a-zA-Z0-9_+-]+:)';

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'section';
}

/**
 * Parse inline markdown into DOM inside `parent`. Escaping is structural:
 * plain segments go through text nodes, so repo-authored text can never
 * introduce markup even though it is trusted input.
 */
export function parseInline(raw, parent, opts = {}) {
  const src = String(raw);
  const re = new RegExp(INLINE_SOURCE, 'g'); // per-call instance — see note above
  let last = 0;
  let m;
  const seenHex = new Set();
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) emitPlain(parent, src.slice(last, m.index), opts, seenHex);
    const tok = m[0];
    if (tok.startsWith('`')) {
      parent.append(elt('code', { class: 'ccr-md-code' }, tok.slice(1, -1)));
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      const b = el('strong');
      parseInline(tok.slice(2, -2), b, opts);
      parent.append(b);
    } else if (tok.startsWith('*')) {
      const em = el('em');
      parseInline(tok.slice(1, -1), em, opts);
      parent.append(em);
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
      if (lm) parent.append(buildLink(lm[1], lm[2], opts));
      else parent.append(document.createTextNode(tok));
    } else if (tok.startsWith(':') && tok.length > 2) {
      const name = tok.slice(1, -1).toLowerCase();
      const emoji = EMOJI[name];
      parent.append(document.createTextNode(emoji || tok));
    } else {
      // Bare URL autolink.
      parent.append(buildLink(tok, tok, opts));
    }
    last = m.index + tok.length;
  }
  if (last < src.length) emitPlain(parent, src.slice(last), opts, seenHex);
  return parent;
}

/** Plain segment: optional git-commit SHA linkification (changelog items). */
function emitPlain(parent, text, opts, seenHex) {
  if (!opts.commitBase) {
    parent.append(document.createTextNode(text));
    return;
  }
  // Local regex: emitPlain can run inside buildLink→parseInline of an outer
  // scan, so a shared /g object would corrupt the outer iteration.
  const hexRe = /\b[0-9a-f]{7,40}\b/gi;
  let last = 0;
  let m;
  while ((m = hexRe.exec(text)) !== null) {
    const tok = m[0];
    // Require at least one digit or length >= 8 so hex-only English words
    // ("defaced") do not become fake commit links.
    if (!(tok.length >= 8 || /[0-9]/.test(tok))) continue;
    if (seenHex.has(tok)) continue;
    seenHex.add(tok);
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.setAttribute('href', opts.commitBase + tok.toLowerCase());
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'ccr-sha-link';
    a.textContent = tok;
    parent.append(a);
    last = m.index + tok.length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function buildLink(label, href, opts = {}) {
  const a = document.createElement('a');
  parseInline(label, a, opts);
  const resolved = opts.resolveHref ? opts.resolveHref(href) : { href };
  a.setAttribute('href', resolved.href || '#');
  if (resolved.articleId) {
    a.classList.add('ccr-md-link-article');
    a.dataset.ccrArticle = resolved.articleId;
  } else if (resolved.external) {
    a.classList.add('ccr-md-link-ext');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  return a;
}

/**
 * Render a markdown string into a DocumentFragment.
 * opts: {demote, resolveHref(href), headingId(text), commitBase}
 * Headings shift down by up to two levels so an article nests under the
 * page's own outline instead of fighting it.
 */
export function renderMarkdown(md, opts = {}) {
  const frag = document.createDocumentFragment();
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const demote = Math.min(2, Math.max(0, opts.demote || 0));
  const childOpts = demote < 2 ? { ...opts, demote: demote } : opts;
  let i = 0;

  const isBlockStart = (l) =>
    /^\s*$/.test(l) ||
    /^\s*(?:#{1,6}\s|>|```|~~~|-{3,}|\*{3,}|_{3,})/.test(l) ||
    /^(\s*)([-*+]|\d+[.)])\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fence) {
      const closer = new RegExp('^\\s*' + fence[1][0] + '{3,}\\s*$');
      const buf = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume closing fence (or EOF)
      const pre = el('pre', {
        class: 'ccr-md-pre',
        attrs: { tabindex: '0', 'aria-label': fence[2] ? `Code block (${fence[2]})` : 'Code block' },
      });
      pre.append(elt('code', { class: 'ccr-md-codeblock' }, buf.join('\n')));
      frag.append(pre);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + demote);
      const node = el('h' + level, { class: 'ccr-md-h ccr-md-h' + level });
      parseInline(h[2], node, childOpts);
      if (opts.headingId) {
        const id = opts.headingId(h[2].replace(/[#\s]+$/, ''));
        if (id) node.id = id;
      }
      frag.append(node);
      i++;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      frag.append(el('hr', { class: 'ccr-md-hr' }));
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const q = el('blockquote', { class: 'ccr-md-quote' });
      q.append(renderMarkdown(buf.join('\n'), { ...opts, demote: 2 }));
      frag.append(q);
      continue;
    }

    const listStart = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (listStart) {
      i = consumeList(lines, i, opts, frag);
      continue;
    }

    // Paragraph: soft-wrap consecutive plain lines together.
    const buf = [];
    while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    if (buf.length) {
      const p = el('p', { class: 'ccr-md-p' });
      buf.forEach((l, idx) => {
        if (idx) p.append(document.createTextNode(' '));
        parseInline(l.replace(/\s+$/, ''), p, childOpts);
      });
      frag.append(p);
    } else {
      i++; // safety: never stall on an unrecognized line
    }
  }
  return frag;
}

/** Consume one (possibly single-level-nested) list block. Returns next index. */
function consumeList(lines, i, opts, frag) {
  const first = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+/);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const listEl = el(ordered ? 'ol' : 'ul', { class: 'ccr-md-list' });
  let lastLi = null;
  let subList = null;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      // A single blank may continue the list if another item follows.
      if (lines[i + 1] && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1])) { i++; continue; }
      break;
    }
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) break;
    const indent = m[1].length;
    if (indent > baseIndent && lastLi) {
      if (!subList) subList = el(/\d/.test(m[2]) ? 'ol' : 'ul', { class: 'ccr-md-list ccr-md-list--nested' });
      const li2 = el('li');
      parseInline(m[3], li2, opts);
      subList.append(li2);
      i++;
      continue;
    }
    if (indent < baseIndent) break;
    if (subList && lastLi) { lastLi.append(subList); subList = null; }
    lastLi = el('li');
    parseInline(m[3], lastLi, opts);
    listEl.append(lastLi);
    i++;
  }
  if (subList && lastLi) lastLi.append(subList);
  frag.append(listEl);
  return i;
}

/* ================================================================== */
/* Article helpers                                                     */
/* ================================================================== */

const REPO_BLOB_BASE = 'https://github.com/Ding-Ding-Projects/claude-code-router/blob/main/';
const REPO_COMMIT_BASE = 'https://github.com/Ding-Ding-Projects/claude-code-router/commit/';

export function articleAnchor(articleId, slug) {
  return `ccr-art-${articleId}--${slug}`;
}

/** Link resolver for a rendered article: internal docs links stay on-site. */
function makeResolver(currentArticleId) {
  return function resolveHref(href) {
    if (href.startsWith('#')) {
      return { href: '#' + articleAnchor(currentArticleId, href.slice(1)) };
    }
    const mdMatch = href.match(/(?:^|\/)([\w.-]+)\.md(?:[#?].*)?$/);
    if (mdMatch) {
      const id = mdMatch[1];
      if (ARTICLES.some((a) => a.id === id)) return { href: '#', articleId: id };
      // Unknown markdown target: point at the canonical blob in the repo.
      const clean = href.replace(/^\.\//, '');
      return { href: REPO_BLOB_BASE + clean, external: true };
    }
    if (/^https?:\/\//i.test(href)) return { href, external: true };
    return { href: siteUrl(href.replace(/^\.\//, '')) };
  };
}

/** Strip the trailing "Suggested next articles" section into link data. */
function extractSuggested(md) {
  const marker = /^##\s+Suggested (?:next )?articles\s*$/im.exec(md);
  if (!marker) return { body: md, suggestions: [] };
  const tail = md.slice(marker.index + marker[0].length);
  const suggestions = [];
  const bullet = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]]+)\]\(([^)]+)\)/gm;
  let bm;
  while ((bm = bullet.exec(tail)) !== null) {
    const ref = bm[2];
    const idMatch = ref.match(/(?:^|\/)([\w.-]+)\.md(?:[#?].*)?$/);
    suggestions.push({ title: bm[1], articleId: idMatch ? idMatch[1] : null, href: ref });
  }
  return { body: md.slice(0, marker.index).replace(/\s+$/, '\n'), suggestions };
}

function openArticle(id) {
  store.set('docs.selected', id);
  paintDocsView();
  const pane = document.getElementById('pane-docs');
  if (pane && pane.hidden) {
    const navBtn = document.querySelector('[data-nav-tab="docs"]');
    if (navBtn instanceof HTMLElement) navBtn.click();
  }
}

/* ================================================================== */
/* Styles                                                              */
/* ================================================================== */

let stylesInstalled = false;
function ensureStyles() {
  if (stylesInstalled || !inBrowser) return;
  stylesInstalled = true;
  const style = document.createElement('style');
  style.id = 'ccr-content-style';
  style.textContent = `
.ccr-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 4px 0 14px; }
.ccr-toolbar .search-field { flex: 1 1 220px; min-width: 180px; max-width: 420px; }
.ccr-count { color: var(--md-sys-color-on-surface-variant); font-size: var(--md-sys-typescale-body-small-font-size); margin: 6px 0 12px; }

/* Docs index rows */
.ccr-doc-list { display: grid; gap: 10px; }
.ccr-doc-row {
  display: grid; gap: 6px; width: 100%; text-align: start; cursor: pointer;
  padding: 14px 16px; border-radius: var(--md-sys-shape-corner-medium);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-low); color: inherit; font: inherit;
}
.ccr-doc-row:hover { background: var(--md-sys-color-surface-container); }
.ccr-doc-row .t { font-weight: 600; font-size: var(--md-sys-typescale-title-medium-font-size); }
.ccr-doc-row .s { color: var(--md-sys-color-on-surface-variant); font-size: var(--md-sys-typescale-body-medium-font-size); }
.ccr-chip-status {
  justify-self: start; display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 10px; border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container);
  font-size: var(--md-sys-typescale-label-small-font-size);
}

/* Features grid reuses the core card-grid/card classes. */
#home-features-slot { margin-top: 40px; }
#home-features-slot .lede { color: var(--md-sys-color-on-surface-variant); }
.ccr-feature-card h3 { margin: 0 0 6px; font-size: var(--md-sys-typescale-title-large-font-size); }
.ccr-feature-card .sum { color: var(--md-sys-color-on-surface-variant); min-height: 3lh; }
.ccr-feature-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

/* Article typography */
.ccr-article { max-width: 76ch; }
.ccr-article .ccr-md-h { color: var(--md-sys-color-on-surface); scroll-margin-top: 90px; }
.ccr-article .ccr-md-h3 { font-size: var(--md-sys-typescale-headline-small-font-size); margin: 22px 0 8px; }
.ccr-article .ccr-md-h4 { font-size: var(--md-sys-typescale-title-large-font-size); margin: 18px 0 6px; }
.ccr-article .ccr-md-h5, .ccr-article .ccr-md-h6 { font-size: var(--md-sys-typescale-title-medium-font-size); margin: 14px 0 6px; }
.ccr-md-p, .ccr-md-list, .ccr-md-quote { line-height: 1.6; }
.ccr-md-list { padding-left: 22px; margin: 8px 0; }
.ccr-md-list--nested { margin: 4px 0 2px; }
.ccr-md-code { background: var(--md-sys-color-surface-container-high); padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; overflow-wrap: anywhere; }
.ccr-md-pre-wrap { min-width: 0; }
.ccr-md-pre {
  background: var(--md-sys-color-inverse-surface); color: var(--md-sys-color-inverse-on-surface);
  border-radius: var(--md-sys-shape-corner-small); padding: 12px 14px; margin: 10px 0;
  overflow-x: auto; max-height: 480px; font-size: var(--md-sys-typescale-body-small-font-size);
}
.ccr-md-pre:focus-visible { outline: var(--ccr-focus-width, 2px) solid var(--md-sys-color-primary); outline-offset: 2px; }
.ccr-md-codeblock { font-family: ui-monospace, Consolas, monospace; white-space: pre; }
.ccr-md-quote {
  margin: 10px 0; padding: 8px 14px; border-inline-start: 4px solid var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 70%, transparent);
  border-radius: var(--md-sys-shape-corner-small);
}
.ccr-md-quote .ccr-md-p:first-child { margin-top: 0; }
.ccr-md-quote .ccr-md-p:last-child { margin-bottom: 0; }
.ccr-md-hr { border: none; border-top: 1px solid var(--md-sys-color-outline-variant); margin: 18px 0; }
.ccr-article a { color: var(--md-sys-color-primary); text-decoration-thickness: 1px; text-underline-offset: 3px; }
.ccr-md-link-ext::after { content: " ↗"; font-size: 0.85em; }
.ccr-sha-link { font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; }

.ccr-back-row { margin: 4px 0 12px; }
.ccr-suggested { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--md-sys-color-outline-variant); }
.ccr-suggested h4 { margin: 0 0 8px; }
.ccr-suggest-row { display: flex; gap: 8px; flex-wrap: wrap; }

/* Changelog viewer */
.ccr-cl-entry {
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low);
  padding: 14px 16px; margin: 0 0 14px;
}
.ccr-cl-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.ccr-cl-version { font-weight: 700; font-size: var(--md-sys-typescale-title-large-font-size); }
.ccr-cl-date { color: var(--md-sys-color-on-surface-variant); font-size: var(--md-sys-typescale-body-small-font-size); }
.ccr-cl-cat { font-size: var(--md-sys-typescale-label-large-font-size); color: var(--md-sys-color-primary); margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.4px; }
.ccr-cl-entry .ccr-md-list { margin: 4px 0; }
.ccr-cl-note { color: var(--md-sys-color-on-surface-variant); font-size: var(--md-sys-typescale-body-small-font-size); margin: 4px 0 10px; }
.ccr-empty {
  padding: 22px; text-align: center; color: var(--md-sys-color-on-surface-variant);
  border: 1px dashed var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
}

/* Calendar popover */
.ccr-cal { width: min(94vw, 340px); }
.ccr-cal-head { display: flex; align-items: center; gap: 6px; }
.ccr-cal-head .select { min-width: 0; flex: 1 1 auto; }
.ccr-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.ccr-cal-dow { text-align: center; font-size: 11px; color: var(--md-sys-color-on-surface-variant); padding: 2px 0; }
.ccr-cal-day {
  aspect-ratio: 1; min-width: 30px; min-height: 30px; border-radius: 50%;
  border: none; background: transparent; color: inherit; font: inherit; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.ccr-cal-day:hover { background: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent); }
.ccr-cal-day.is-out { visibility: hidden; pointer-events: none; }
.ccr-cal-day.is-endpoint { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
.ccr-cal-day.is-inrange { background: color-mix(in srgb, var(--md-sys-color-primary) 24%, transparent); border-radius: 0; }
.ccr-cal-day.is-endpoint.is-inrange { border-radius: 50%; }
.ccr-cal-typed { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ccr-cal-typed label { display: grid; gap: 4px; font-size: var(--md-sys-typescale-label-small-font-size); }
.ccr-cal-error { color: var(--md-sys-color-error); font-size: var(--md-sys-typescale-body-small-font-size); min-height: 1em; }
.ccr-cal-presets { display: flex; gap: 6px; flex-wrap: wrap; }

/* Download surface */
.ccr-dl-card {
  display: grid; gap: 10px; justify-items: start; max-width: 62ch;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low); padding: 18px 20px;
}
.ccr-dl-card code { background: var(--md-sys-color-surface-container-high); padding: 1px 6px; border-radius: 4px; overflow-wrap: anywhere; }
.ccr-dl-release { border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 12px; margin-top: 4px; width: 100%; }

@media (max-width: 560px) {
  .ccr-toolbar { align-items: stretch; flex-direction: column; }
  .ccr-toolbar .search-field { max-width: none; }
  .ccr-cal { width: min(94vw, 320px); }
}
`;
  document.head.appendChild(style);
}

/* ================================================================== */
/* Surface: landing features grid                                      */
/* ================================================================== */

function mountFeatures(host) {
  clear(host);
  const h = el('h2', { class: 'headline-medium' });
  setText(h, 'content.features.title');
  const lede = el('p', { class: 'lede body-medium' });
  setText(lede, 'content.features.lede');
  host.append(h, lede);

  const grid = el('div', { class: 'card-grid' });
  for (const article of ARTICLES) {
    const card = el('article', { class: 'card ccr-feature-card' });
    const title = elt('h3', {}, article.title);
    card.append(title);
    if (article.status) {
      const chip = el('span', { class: 'ccr-chip-status' });
      chip.append(
        document.createTextNode(`${ct('content.status.label')}: ${article.status}`),
      );
      chip.setAttribute('role', 'status');
      card.append(chip);
    }
    card.append(elt('p', { class: 'sum body-medium' }, article.summary || ''));
    const actions = el('div', { class: 'ccr-feature-actions' });
    const readBtn = elt('button', { class: 'btn btn--tonal', type: 'button' }, ct('content.features.read'));
    readBtn.addEventListener('click', () => openArticle(article.id));
    actions.append(readBtn);
    card.append(actions);
    grid.append(card);
  }
  host.append(grid);
}

/* ================================================================== */
/* Surface: docs browser                                               */
/* ================================================================== */

let docsToolbar = null;
let docsView = null;
let docsSearchWrap = null;

function mountDocs(slot) {
  clear(slot);
  docsToolbar = el('div', { class: 'ccr-toolbar' });
  docsView = el('div', {});
  slot.append(docsToolbar, docsView);

  // The input must be in the DOM before attachSearchField wraps it in place.
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'input';
  input.id = 'ccr-docs-search-input';
  input.setAttribute('aria-label', ct('docs.search.label'));
  docsToolbar.append(input);
  docsSearchWrap = attachSearchField(input, {
    id: 'docs-search',
    storage: true,
    onChange: () => {
      if (!store.get('docs.selected', null)) paintDocsView();
    },
  });

  paintDocsView();
}

function docsFilteredArticles() {
  const state = docsSearchWrap?.ccrSearch?.getState?.() || { query: '', mode: 'plain', flags: [] };
  const compiled = compile(state);
  if (compiled.empty) return ARTICLES.slice();
  return ARTICLES.filter((a) => compiled.test(`${a.title}\n${a.summary}\n${a.markdown}`));
}

function paintDocsView() {
  if (!docsView) return;
  clear(docsView);
  const selectedId = store.get('docs.selected', null);
  const article = ARTICLES.find((a) => a.id === selectedId);
  if (article) paintArticle(article);
  else paintDocList();
}

function paintDocList() {
  const list = docsFilteredArticles();
  const count = elt('div', { class: 'ccr-count', attrs: { role: 'status' } }, ct('docs.count', { n: list.length }));
  docsView.append(count);
  if (!list.length) {
    docsView.append(elt('div', { class: 'ccr-empty' }, ct('docs.empty')));
    return;
  }
  const wrap = el('div', { class: 'ccr-doc-list' });
  for (const a of list) {
    const row = el('button', { class: 'ccr-doc-row', type: 'button' });
    row.append(elt('span', { class: 't' }, a.title));
    if (a.status) {
      const chip = elt('span', { class: 'ccr-chip-status' }, `${ct('content.status.label')}: ${a.status}`);
      chip.style.justifySelf = 'start';
      row.append(chip);
    }
    row.append(elt('span', { class: 's' }, a.summary || ''));
    row.addEventListener('click', () => openArticle(a.id));
    wrap.append(row);
  }
  docsView.append(wrap);
}

function paintArticle(article) {
  const backRow = el('div', { class: 'ccr-back-row' });
  const back = elt('button', { class: 'btn btn--text', type: 'button' }, ct('docs.back'));
  back.addEventListener('click', () => {
    store.reset('docs.selected');
    paintDocsView();
  });
  backRow.append(back);
  docsView.append(backRow);

  const { body, suggestions } = extractSuggested(article.markdown);
  const resolver = makeResolver(article.id);

  const art = el('article', {
    class: 'ccr-article',
    attrs: { role: 'article', 'aria-label': article.title },
  });
  art.append(renderMarkdown(body, {
    demote: 2,
    resolveHref: resolver,
    headingId: (text) => articleAnchor(article.id, slugify(text)),
  }));
  docsView.append(art);

  // Every article ends with suggested-article links (from the doc itself).
  if (suggestions.length) {
    const sug = el('nav', {
      class: 'ccr-suggested',
      attrs: { 'aria-label': ct('docs.suggested') },
    });
    sug.append(elt('h4', {}, ct('docs.suggested')));
    const row = el('div', { class: 'ccr-suggest-row' });
    for (const s of suggestions) {
      const btn = el('button', { class: 'chip', type: 'button' });
      parseInline(s.title, btn, { resolveHref: resolver });
      btn.addEventListener('click', () => {
        if (s.articleId && ARTICLES.some((a) => a.id === s.articleId)) openArticle(s.articleId);
        else window.open(REPO_BLOB_BASE + s.href.replace(/^\.?\//, ''), '_blank', 'noopener');
      });
      row.append(btn);
    }
    sug.append(row);
    docsView.append(sug);
  }

  // Internal article links navigate in place; external ones stay normal.
  art.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-ccr-article]');
    if (a) {
      e.preventDefault();
      openArticle(a.dataset.ccrArticle);
    }
  });
}

/* ================================================================== */
/* Surface: changelog viewer                                           */
/* ================================================================== */

let clToolbar = null;
let clView = null;
let clSearchWrap = null;
let clDateBtn = null;

function parseISODateOrNull(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseChangelog(md) {
  const entries = [];
  let entry = null;
  let category = null;
  for (const rawLine of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    const h2 = rawLine.match(/^##\s+(.*)$/);
    if (h2 && !/^###/.test(rawLine)) {
      const head = h2[1].trim();
      const bracket = head.match(/^\[\s*([^\]]+?)\s*\]\s*(?:-\s*(.*))?$/);
      const version = bracket ? bracket[1] : head.split(/\s+-\s+/)[0];
      const dateText = bracket ? (bracket[2] || '').trim() : (head.match(/\s+-\s+(.*)$/) || [])[1] || '';
      entry = {
        version,
        dateText: dateText || '',
        date: parseISODateOrNull(dateText),
        categories: [],
      };
      entries.push(entry);
      category = null;
      continue;
    }
    if (!entry) continue;
    const h3 = rawLine.match(/^###\s+(.*)$/);
    if (h3) {
      category = { name: h3[1].trim(), items: [] };
      entry.categories.push(category);
      continue;
    }
    const item = rawLine.match(/^\s*[-*+]\s+(.*)$/);
    if (item) {
      if (!category) {
        category = { name: 'Changes', items: [] };
        entry.categories.push(category);
      }
      category.items.push(item[1]);
      continue;
    }
    const cont = rawLine.match(/^\s{2,}(\S.*)$/);
    if (cont && category && category.items.length) {
      category.items[category.items.length - 1] += ' ' + cont[1].trim();
    }
  }
  return entries;
}

function clRange() {
  const r = store.get('changelog.range', { from: null, to: null }) || {};
  return {
    from: typeof r.from === 'string' && parseISODateOrNull(r.from) ? r.from : null,
    to: typeof r.to === 'string' && parseISODateOrNull(r.to) ? r.to : null,
  };
}

function entryMatchesFilters(entry, searchState) {
  const range = clRange();
  if (entry.date && (range.from || range.to)) {
    if (range.from && entry.date < parseISODateOrNull(range.from)) return false;
    if (range.to && entry.date > parseISODateOrNull(range.to)) return false;
  }
  const compiled = compile(searchState);
  if (compiled.empty) return true;
  const haystack = [entry.version, entry.dateText]
    .concat(...entry.categories.map((c) => [c.name, ...c.items]))
    .join('\n');
  return compiled.test(haystack);
}

function mountChangelog(slot) {
  clear(slot);
  clToolbar = el('div', { class: 'ccr-toolbar' });
  clView = el('div', {});
  slot.append(clToolbar, clView);

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'input';
  input.id = 'ccr-cl-search-input';
  input.setAttribute('aria-label', ct('cl.search.label'));
  clToolbar.append(input);
  clSearchWrap = attachSearchField(input, {
    id: 'changelog-search',
    storage: true,
    onChange: () => paintClView(),
  });

  clDateBtn = el('button', { class: 'btn btn--outlined', type: 'button', attrs: { 'aria-haspopup': 'dialog' } });
  paintClDateLabel();
  clDateBtn.addEventListener('click', () => openCalendar(clDateBtn));

  const exportMd = elt('button', { class: 'btn btn--text', type: 'button' }, ct('cl.export.md'));
  exportMd.addEventListener('click', () => exportChangelog('md'));
  const exportTxt = elt('button', { class: 'btn btn--text', type: 'button' }, ct('cl.export.txt'));
  exportTxt.addEventListener('click', () => exportChangelog('text'));

  clToolbar.append(clDateBtn, exportMd, exportTxt);
  paintClView();
}

function paintClDateLabel() {
  if (!clDateBtn) return;
  const r = clRange();
  clear(clDateBtn);
  if (!r.from && !r.to) {
    clDateBtn.append(document.createTextNode(ct('cl.date.all')));
    clDateBtn.classList.remove('chip--selected');
  } else {
    clDateBtn.append(document.createTextNode(`${r.from || '…'} → ${r.to || '…'}`));
    clDateBtn.classList.add('chip--selected');
  }
}

function paintClView() {
  if (!clView) return;
  clear(clView);
  const ENTRIES = parseChangelog(CHANGELOG_MD);
  const state = clSearchWrap?.ccrSearch?.getState?.() || { query: '', mode: 'plain', flags: [] };

  const dated = ENTRIES.filter((e) => e.date);
  dated.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const undated = ENTRIES.filter((e) => !e.date);

  const shownDated = dated.filter((e) => entryMatchesFilters(e, state));
  const shownUndated = undated.filter((e) => entryMatchesFilters(e, state));
  const shown = shownDated.length + shownUndated.length;

  const countLine = el('div', { class: 'ccr-count', attrs: { role: 'status' } });
  countLine.append(document.createTextNode(
    ct('cl.shown', { shown, total: ENTRIES.length }),
  ));
  countLine.append(document.createTextNode(' · '));
  countLine.append(document.createTextNode(ct('cl.searchHiddenNote')));
  clView.append(countLine);

  if (!shown) {
    clView.append(elt('div', { class: 'ccr-empty' }, ct('cl.empty')));
    return;
  }

  const commitOpts = {
    commitBase: REPO_COMMIT_BASE,
    resolveHref: makeResolver('__cl__'),
  };
  for (const entry of shownDated) clView.append(renderClEntry(entry, commitOpts));

  if (shownUndated.length) {
    clView.append(elt('h3', { class: 'headline-small', style: 'margin-top:22px' }, ct('cl.undated.group')));
    clView.append(elt('p', { class: 'ccr-cl-note' }, ct('cl.undated.note')));
    for (const entry of shownUndated) clView.append(renderClEntry(entry, commitOpts));
  }
}

function renderClEntry(entry, inlineOpts) {
  const card = el('article', { class: 'ccr-cl-entry', attrs: { 'aria-label': `Version ${entry.version}` } });
  const head = el('div', { class: 'ccr-cl-head' });
  head.append(elt('span', { class: 'ccr-cl-version' }, entry.version));
  if (entry.dateText) head.append(elt('span', { class: 'ccr-cl-date' }, entry.dateText));
  card.append(head);

  for (const cat of entry.categories) {
    if (!cat.items.length) continue;
    card.append(elt('div', { class: 'ccr-cl-cat' }, cat.name));
    const ul = el('ul', { class: 'ccr-md-list' });
    for (const item of cat.items) {
      const li = el('li');
      parseInline(item, li, inlineOpts);
      ul.append(li);
    }
    card.append(ul);
  }
  return card;
}

/* ---------------- advanced calendar ---------------- */

const DOW_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DOW_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

function localeDayOrder() {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2023, 11, 25));
    const order = {};
    let idx = 0;
    for (const p of parts) {
      if (p.type === 'year' || p.type === 'month' || p.type === 'day') order[p.type] = idx++;
    }
    return (o) => order[o] ?? 9;
  } catch {
    return (o) => ({ year: 0, month: 1, day: 2 })[o] ?? 9;
  }
}

/** Typed-date parser: ISO always accepted, plus the visitor's locale format. Invalid input is REPORTED, never discarded. */
function parseTypedDate(str) {
  const s = String(str).trim();
  if (!s) return { empty: true };
  const iso = parseISODateOrNull(s);
  if (iso) return { date: iso };
  const nums = s.match(/(\d+)/g);
  if (!nums || nums.length !== 3) return { invalid: true };
  const order = localeDayOrder();
  const slots = { year: null, month: null, day: null };
  const keys = ['year', 'month', 'day'].sort((a, b) => order(a) - order(b));
  keys.forEach((k, idx2) => { slots[k] = Number(nums[idx2]); });
  if (slots.year < 100) slots.year += 2000;
  const d = new Date(slots.year, slots.month - 1, slots.day);
  if (
    slots.month < 1 || slots.month > 12 ||
    d.getFullYear() !== slots.year || d.getMonth() !== slots.month - 1 || d.getDate() !== slots.day
  ) return { invalid: true };
  return { date: d };
}

function fmtTypedHint() {
  const probe = new Date(2023, 11, 25);
  try {
    const f = new Intl.DateTimeFormat(undefined).format(probe);
    return f.replace(/25/g, 'DD').replace(/2023/g, 'YYYY').replace(/12/g, 'MM');
  } catch {
    return 'MM/DD/YYYY';
  }
}

function fmtHuman(d) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  } catch {
    return isoOf(d);
  }
}

function openCalendar(trigger) {
  closeCalendar();
  const committed = clRange();
  const edit = { from: committed.from, to: committed.to };
  const today = new Date();
  let viewYear = edit.from ? Number(edit.from.slice(0, 4)) : today.getFullYear();
  let viewMonth = edit.from ? Number(edit.from.slice(5, 7)) - 1 : today.getMonth();

  const pop = el('div', {
    class: 'color-pop ccr-cal menu',
    attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-label': ct('cl.cal.title') },
  });

  /* header: prev / month / year / next */
  const head = el('div', { class: 'ccr-cal-head' });
  const prevBtn = elt('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': ct('cl.cal.prev') } }, '‹');
  const nextBtn = elt('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': ct('cl.cal.next') } }, '›');
  const monthSel = el('select', { class: 'select', attrs: { 'aria-label': 'Month' } });
  const yearSel = el('select', { class: 'select', attrs: { 'aria-label': 'Year' } });
  const zh = i18n.getLang() === 'zh';
  MONTH_EN.forEach((mEn, idx) => {
    monthSel.append(elt('option', { attrs: { value: String(idx) } }, zh ? MONTH_ZH[idx] : mEn));
  });
  for (let y = today.getFullYear() - 6; y <= today.getFullYear() + 2; y++) {
    yearSel.append(elt('option', { attrs: { value: String(y) } }, String(y)));
  }
  head.append(prevBtn, monthSel, yearSel, nextBtn);
  pop.append(head);

  const grid = el('div', { class: 'ccr-cal-grid', attrs: { role: 'grid', 'aria-label': ct('cl.cal.title') } });
  pop.append(grid);

  /* typed inputs */
  const typed = el('div', { class: 'ccr-cal-typed' });
  const fromInput = el('input', { class: 'input', attrs: { type: 'text', inputmode: 'numeric', placeholder: fmtTypedHint(), spellcheck: 'false' } });
  const toInput = el('input', { class: 'input', attrs: { type: 'text', inputmode: 'numeric', placeholder: fmtTypedHint(), spellcheck: 'false' } });
  const fromLab = elt('label', {}, ct('cl.cal.from'));
  fromInput.id = 'ccr-cal-from-input'; fromLab.setAttribute('for', fromInput.id); fromLab.append(fromInput);
  const toLab = elt('label', {}, ct('cl.cal.to'));
  toInput.id = 'ccr-cal-to-input'; toLab.setAttribute('for', toInput.id); toLab.append(toInput);
  typed.append(fromLab, toLab);
  pop.append(typed);

  const errLine = el('div', { class: 'ccr-cal-error', attrs: { role: 'alert' } });
  errLine.textContent = ' ';
  pop.append(errLine);

  /* presets */
  const presetRow = el('div', { class: 'ccr-cal-presets' });
  const presets = [
    ['cl.preset.7', 7],
    ['cl.preset.30', 30],
    ['cl.preset.90', 90],
  ];
  for (const [key, days] of presets) {
    const chip = elt('button', { class: 'chip', type: 'button' }, ct(key));
    chip.addEventListener('click', () => {
      const end = new Date(today);
      const start = new Date(today);
      start.setDate(start.getDate() - (days - 1));
      edit.from = isoOf(start);
      edit.to = isoOf(end);
      viewYear = start.getFullYear(); viewMonth = start.getMonth();
      syncTyped(); paintGrid(); errLine.textContent = ' ';
    });
    presetRow.append(chip);
  }
  const yearChip = elt('button', { class: 'chip', type: 'button' }, ct('cl.preset.year'));
  yearChip.addEventListener('click', () => {
    edit.from = `${today.getFullYear()}-01-01`;
    edit.to = isoOf(today);
    viewMonth = 0; viewYear = today.getFullYear();
    syncTyped(); paintGrid(); errLine.textContent = ' ';
  });
  presetRow.append(yearChip);
  pop.append(el('div', { class: 'body-small', children: [ct('cl.cal.presets')] }), presetRow);

  /* actions */
  const actions = el('div', { class: 'dialog-actions' });
  const applyBtn = elt('button', { class: 'btn btn--filled', type: 'button' }, ct('cl.cal.apply'));
  const clearBtn = elt('button', { class: 'btn btn--text', type: 'button' }, ct('cl.cal.clear'));
  const closeBtn = elt('button', { class: 'btn btn--text', type: 'button' }, i18n.t('common.close'));
  actions.append(clearBtn, closeBtn, applyBtn);
  pop.append(actions);

  function setEditFromTyped(input, which) {
    const res = parseTypedDate(input.value);
    if (res.empty) { edit[which] = null; errLine.textContent = ' '; paintGrid(); return; }
    if (res.invalid) {
      // Report inline WITHOUT discarding what the visitor typed.
      errLine.textContent = ct('cl.cal.badDate', { fmt: fmtTypedHint() });
      return;
    }
    errLine.textContent = ' ';
    edit[which] = isoOf(res.date);
    normalizeOrder();
    syncTyped(false);
    paintGrid();
  }

  function normalizeOrder() {
    if (edit.from && edit.to && edit.from > edit.to) {
      const t = edit.from; edit.from = edit.to; edit.to = t;
      errLine.textContent = ct('cl.cal.order');
    }
  }

  function syncTyped(fillInputs = true) {
    if (fillInputs) { fromInput.value = edit.from || ''; toInput.value = edit.to || ''; }
    monthSel.value = String(viewMonth);
    yearSel.value = String(viewYear);
  }

  function paintGrid() {
    clear(grid);
    const dows = zh ? DOW_ZH : DOW_EN;
    for (const name of dows) grid.append(elt('span', { class: 'ccr-cal-dow', attrs: { 'aria-hidden': 'true' } }, name));
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells = [];
    for (let k = 0; k < startOffset; k++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    for (const cell of cells) {
      if (cell === null) {
        grid.append(el('span', { class: 'ccr-cal-day is-out', attrs: { 'aria-hidden': 'true' } }));
        continue;
      }
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(cell).padStart(2, '0')}`;
      const btn = elt('button', {
        class: 'ccr-cal-day',
        type: 'button',
        attrs: { 'aria-label': fmtHuman(new Date(viewYear, viewMonth, cell)), 'aria-pressed': 'false' },
      }, String(cell));
      const isFrom = iso === edit.from;
      const isTo = iso === edit.to;
      if (isFrom || isTo) {
        btn.classList.add('is-endpoint');
        btn.setAttribute('aria-pressed', 'true');
      } else if (edit.from && edit.to && iso > edit.from && iso < edit.to) {
        btn.classList.add('is-inrange');
      }
      btn.addEventListener('click', () => {
        if (!edit.from || (edit.from && edit.to)) {
          edit.from = iso; edit.to = null;
        } else {
          if (iso < edit.from) { edit.to = edit.from; edit.from = iso; }
          else edit.to = iso;
        }
        errLine.textContent = ' ';
        syncTyped();
        paintGrid();
        fromInput.focus({ preventScroll: true });
      });
      grid.append(btn);
    }
  }

  prevBtn.addEventListener('click', () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    syncTyped(false); paintGrid();
  });
  nextBtn.addEventListener('click', () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    syncTyped(false); paintGrid();
  });
  monthSel.addEventListener('change', () => { viewMonth = Number(monthSel.value); paintGrid(); });
  yearSel.addEventListener('change', () => { viewYear = Number(yearSel.value); paintGrid(); });
  fromInput.addEventListener('change', () => setEditFromTyped(fromInput, 'from'));
  toInput.addEventListener('change', () => setEditFromTyped(toInput, 'to'));

  applyBtn.addEventListener('click', () => {
    normalizeOrder();
    store.set('changelog.range', { from: edit.from || null, to: edit.to || null });
    paintClDateLabel();
    paintClView();
    closeCalendar();
  });
  clearBtn.addEventListener('click', () => {
    edit.from = null; edit.to = null;
    syncTyped(); paintGrid(); errLine.textContent = ' ';
    store.set('changelog.range', { from: null, to: null });
    paintClDateLabel();
    paintClView();
  });

  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeCalendar(); }
  });

  document.body.appendChild(pop);
  positionPopover(pop, trigger);
  calendarState = { pop, trigger };
  syncTyped();
  paintGrid();
  fromInput.focus({ preventScroll: true });
}

let calendarState = null;
function closeCalendar() {
  if (!calendarState) return;
  calendarState.pop.remove();
  const trg = calendarState.trigger;
  calendarState = null;
  if (trg instanceof HTMLElement) trg.focus({ preventScroll: true });
}

/** Dismiss the calendar when the pointer goes down outside it. */
if (inBrowser && typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', (e) => {
    if (!calendarState) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (!calendarState.pop.contains(target) && target !== calendarState.trigger) closeCalendar();
  });
}

/* ---------------- export ---------------- */

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stripInlineForText(s) {
  return String(s)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/_([^_]*)_/g, '$1');
}

function currentFilteredEntries() {
  const ENTRIES = parseChangelog(CHANGELOG_MD);
  const state = clSearchWrap?.ccrSearch?.getState?.() || { query: '', mode: 'plain', flags: [] };
  const dated = ENTRIES.filter((e) => e.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  const undated = ENTRIES.filter((e) => !e.date);
  return {
    all: ENTRIES,
    filtered: [...dated.filter((e) => entryMatchesFilters(e, state)), ...undated.filter((e) => entryMatchesFilters(e, state))],
    searchState: state,
  };
}

function describeRange(range) {
  if (!range.from && !range.to) return ct('cl.date.all');
  return `${range.from || '…'} → ${range.to || '…'}`;
}

function exportChangelog(fmt) {
  const { all, filtered, searchState } = currentFilteredEntries();
  const range = clRange();
  const stamp = new Date().toISOString();
  const searchDesc = !searchState.query
    ? 'none'
    : searchState.mode === 'regex'
      ? `regex /${searchState.query}/${(searchState.flags || []).join('')}`
      : `plain "${searchState.query}"`;

  const lines = [];
  if (fmt === 'md') {
    lines.push('# Claude Code Router — Changelog export', '');
  } else {
    lines.push('CLAUDE CODE ROUTER — CHANGELOG EXPORT', '='.repeat(36), '');
  }
  lines.push(`Exported: ${stamp}`);
  lines.push(`Range: ${describeRange(range)}`);
  lines.push(`Search: ${searchDesc}`);
  lines.push(`Versions: ${filtered.length} of ${all.length}`);
  lines.push('');
  for (const entry of filtered) {
    if (fmt === 'md') {
      lines.push(`## ${entry.version}${entry.dateText ? ` — ${entry.dateText}` : ''}`, '');
      for (const cat of entry.categories) {
        if (!cat.items.length) continue;
        lines.push(`### ${cat.name}`, '');
        for (const item of cat.items) lines.push(`- ${item}`);
        lines.push('');
      }
    } else {
      lines.push(`${entry.version}${entry.dateText ? ` (${entry.dateText})` : ''}`);
      for (const cat of entry.categories) {
        if (!cat.items.length) continue;
        lines.push(`  ${cat.name}:`);
        for (const item of cat.items) lines.push(`    * ${stripInlineForText(item)}`);
      }
      lines.push('');
    }
  }
  const dateTag = stamp.slice(0, 10);
  const filename = `claude-code-router-changelog-${dateTag}.${fmt === 'md' ? 'md' : 'txt'}`;
  downloadFile(filename, lines.join('\n') + '\n', fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8');
  notifyMod.info(i18n.deco('📦') + ct('cl.exported', { n: filtered.length, fmt: fmt === 'md' ? 'Markdown' : 'plain text', range: describeRange(range) }));
}

/* ================================================================== */
/* Surface: honest download state                                      */
/* ================================================================== */

function mountDownload(slot) {
  clear(slot);
  const checking = elt('div', { class: 'ccr-empty', attrs: { role: 'status' } }, ct('dl.checking'));
  slot.append(checking);

  fetch(siteUrl('release-manifest.json'), { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((manifest) => paintDownloadResult(slot, manifest))
    .catch((err) => paintDownloadAbsent(slot, { error: err && err.message }));
}

/** Expected schema (documented contract):
 * { releases: [{ version, date?, notesUrl?, assets: [{ name, url, sha256?, sizeBytes? }] }] }
 * An empty object {} — the shipped placeholder — means "no verified release".
 */
function isValidManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (!Array.isArray(manifest.releases)) return false;
  return manifest.releases.every((r) =>
    r && typeof r.version === 'string' &&
    (!r.assets || (Array.isArray(r.assets) && r.assets.every((a) => a && typeof a.url === 'string'))),
  );
}

/** Localized template with the {path} placeholder left intact, split around it. */
function ctTemplateParts(key) {
  const entry = L[key];
  return (entry ? ctRaw(entry) : key).split('{path}');
}

function paintDownloadAbsent(slot, { error } = {}) {
  clear(slot);
  const card = el('div', { class: 'ccr-dl-card', attrs: { role: 'status' } });
  const title = elt('h3', { class: 'title-large' }, error ? ct('dl.error.title') : ct('dl.absent.title'));
  card.append(title);

  if (error) {
    const body = elt('p', { class: 'body-medium' }, ct('dl.error.body', { err: error }));
    card.append(body);
  } else {
    // Absent state: facts exact — what is checked, when a button may appear,
    // and the explicit promise that nothing is guessed.
    const parts = ctTemplateParts('dl.absent.body');
    const body = el('p', { class: 'body-medium' });
    body.append(document.createTextNode(parts[0] || ''));
    if (parts.length > 1) {
      body.append(elt('code', {}, 'release-manifest.json'));
      body.append(document.createTextNode(parts.slice(1).join('{path}')));
    }
    card.append(body);
    const pathLine = el('p', { class: 'body-small' });
    pathLine.append(document.createTextNode('Manifest URL: '));
    pathLine.append(elt('code', {}, siteUrl('release-manifest.json')));
    card.append(pathLine);
  }

  const retry = elt('button', { class: 'btn btn--tonal', type: 'button' }, ct('dl.retry'));
  retry.addEventListener('click', () => mountDownload(slot));
  card.append(retry);
  slot.append(card);
}

function paintDownloadResult(slot, manifest) {
  if (!isValidManifest(manifest) || !manifest.releases.length) {
    paintDownloadAbsent(slot, {});
    return;
  }
  clear(slot);
  const title = elt('h3', { class: 'title-large' }, ct('dl.present.title'));
  slot.append(title);
  for (const rel of manifest.releases) {
    const card = el('div', { class: 'ccr-dl-card ccr-dl-release' });
    card.append(elt('strong', {}, rel.version));
    if (rel.date) card.append(elt('span', { class: 'ccr-cl-date' }, rel.date));
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    card.append(elt('span', { class: 'body-small' }, ct('dl.assets', { n: assets.length })));
    for (const asset of assets) {
      const a = document.createElement('a');
      a.className = 'btn btn--filled';
      a.setAttribute('href', asset.url);
      a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('download', '');
      a.textContent = `${ct('dl.download')} — ${asset.name || asset.url}`;
      card.append(a);
    }
    slot.append(card);
  }
}

/* ================================================================== */
/* Boot                                                                */
/* ================================================================== */

const MOUNTS = [];

if (inBrowser) {
  boot();
}

function boot() {
  ensureStyles();
  const feats = document.getElementById('home-features-slot');
  if (feats) MOUNTS.push([feats, mountFeatures]);
  const docsSlot = document.getElementById('docs-article-slot');
  if (docsSlot) MOUNTS.push([docsSlot, mountDocs]);
  const clSlot = document.getElementById('changelog-slot');
  if (clSlot) MOUNTS.push([clSlot, mountChangelog]);
  const dlSlot = document.getElementById('download-slot');
  if (dlSlot) MOUNTS.push([dlSlot, mountDownload]);
  if (!MOUNTS.length) return;

  for (const [host, fn] of MOUNTS) fn(host);

  // Language modes, both funny levels and the emoji switch restyle every
  // mounted surface live — facts stay exact, voice follows the sliders.
  let scheduled = false;
  const rerender = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureStyles();
      for (const [host, fn] of MOUNTS) fn(host);
    }, 0);
  };
  for (const key of ['lang', 'funny.en', 'funny.zh', 'showEmojis']) store.subscribe(key, rerender);
}

/** Programmatic surface (palette teleport can grow onto this later). */
export const contentAPI = {
  articles: () => ARTICLES.map(({ id, title, status, summary }) => ({ id, title, status, summary })),
  openArticle,
};
