/**
 * HAND-WRITTEN settings inventory — the completeness contract for the whole
 * settings surface. Every settings element the site renders MUST appear here
 * exactly once, and every entry here MUST render. settings-page.js fails
 * visibly (banner + console) when either side drifts, because a guard that
 * only checks features already discovered cannot detect one that vanished.
 *
 * Each row: { id, tab, labelKey, descKey, control, getDefault(), get(), set(v),
 *             format?(v) -> string for the provenance line }
 * `default` is the SHIPPED value — the provenance line under every control
 * states truthfully whether the visitor is looking at their own value or the
 * compiled-in fallback, naming the actual default either way.
 */

export const TABS = [
  { id: 'appearance', labelKey: 'settings.section.appearance' },
  { id: 'language', labelKey: 'settings.section.language' },
  { id: 'notifications', labelKey: 'settings.section.notifications' },
  { id: 'tabs', labelKey: 'settings.section.tabs' },
  { id: 'accessibility', labelKey: 'settings.section.accessibility' },
  { id: 'data', labelKey: 'settings.section.data' },
  { id: 'about', labelKey: 'settings.section.about' },
];

/** Hand-written coverage list — do not generate this array from the DOM. */
export function registry(bridge) {
  return [
    /* ---------------- Appearance ---------------- */
    {
      id: 'appearance-theme-mode',
      tab: 'appearance',
      labelKey: 'theme.toggle',
      descKey: 'theme.mode.auto',
      control: 'select',
      options: [
        ['auto', 'theme.mode.auto'],
        ['light', 'theme.mode.light'],
        ['dark', 'theme.mode.dark'],
      ],
      getDefault: () => 'auto',
      get: () => bridge.theme.getMode(),
      set: (v) => bridge.theme.setMode(v),
      format: (v) => String(v),
    },
    {
      id: 'appearance-rainbow-speed',
      tab: 'appearance',
      labelKey: 'color.rainbow.speed',
      descKey: 'color.rainbow.durationNote',
      control: 'slider',
      min: 1,
      max: 10,
      step: 1,
      getDefault: () => 4,
      get: () => bridge.store.get('appearance.rainbowSpeed', 4),
      set: (v) => bridge.color.publishRainbowGlobals() ?? bridge.store.set('appearance.rainbowSpeed', v),
      format: (v) => `${v}`,
      vars: () => ({ s: bridge.color.rainbowDurationSec(bridge.store.get('appearance.rainbowSpeed', 4)) }),
    },
    {
      id: 'appearance-editor-hint',
      tab: 'appearance',
      labelKey: 'appear.edit',
      descKey: 'type.family.note',
      control: 'action',
      actionLabelKey: 'common.jump',
      run: () => bridge.appearance.openEditor(bridge.appearance.TARGETS[0]),
      getDefault: () => '—',
      get: () => 'right-click any surface · Shift+F10',
      format: () => 'right-click · Shift+F10',
    },

    /* ---------------- Language & voice ---------------- */
    {
      id: 'language-mode',
      tab: 'language',
      labelKey: 'settings.language.label',
      descKey: 'settings.language.desc',
      control: 'select',
      options: [
        ['en', 'English'],
        ['zh', '廣東話'],
        ['bi', 'English · 廣東話'],
      ],
      getDefault: () => 'en',
      get: () => bridge.i18n.getLang(),
      set: (v) => bridge.onLanguageChange(v),
      format: (v) => String(v),
    },
    {
      id: 'funny-level-en',
      tab: 'language',
      labelKey: 'settings.funny.en.label',
      descKey: 'about.funny.disclosure',
      control: 'slider',
      min: 1,
      max: 5,
      step: 1,
      labels: { minKey: 'common.serious', maxKey: 'common.maxFun' },
      getDefault: () => 5,
      get: () => bridge.i18n.funnyLevel('en'),
      set: (v) => bridge.i18n.setFunnyLevel('en', v),
      format: (v) => String(v),
    },
    {
      id: 'funny-level-zh',
      tab: 'language',
      labelKey: 'settings.funny.zh.label',
      descKey: 'about.funny.disclosure',
      control: 'slider',
      min: 1,
      max: 5,
      step: 1,
      labels: { minKey: 'common.serious', maxKey: 'common.maxFun' },
      getDefault: () => 5,
      get: () => bridge.i18n.funnyLevel('zh'),
      set: (v) => bridge.i18n.setFunnyLevel('zh', v),
      format: (v) => String(v),
    },
    {
      id: 'show-emojis',
      tab: 'language',
      labelKey: 'settings.showEmojis.label',
      descKey: 'settings.showEmojis.desc',
      control: 'switch',
      getDefault: () => true,
      get: () => bridge.i18n.showEmojis(),
      set: (v) => bridge.i18n.setShowEmojis(v),
      format: (v) => (v ? 'on' : 'off'),
    },

    /* ---------------- Notifications ---------------- */
    {
      id: 'notifications-info-timeout',
      tab: 'notifications',
      labelKey: 'settings.notify.timeout.label',
      descKey: 'settings.notify.timeout.desc',
      control: 'slider',
      min: 2000,
      max: 12000,
      step: 200,
      getDefault: () => 5200,
      get: () => bridge.store.get('notify.infoTimeoutMs', 5200),
      set: (v) => bridge.store.set('notify.infoTimeoutMs', v),
      format: (v) => `${Math.round(v / 100) / 10}s`,
    },
    {
      id: 'notifications-history-cap',
      tab: 'notifications',
      labelKey: 'settings.notify.cap.label',
      descKey: 'settings.notify.timeout.desc',
      control: 'select',
      options: [
        ['50', '50'],
        ['100', '100'],
        ['200', '200'],
        ['500', '500'],
      ],
      getDefault: () => '200',
      get: () => String(bridge.store.get('notify.historyCap', 200)),
      set: (v) => bridge.store.set('notify.historyCap', Number(v)),
      format: (v) => String(v),
    },
    {
      id: 'notifications-sample',
      tab: 'notifications',
      labelKey: 'settings.notify.sample.label',
      descKey: 'settings.notify.sample.desc',
      control: 'action',
      actionLabelKey: 'common.ok',
      run: () => {
        bridge.notify.info('Sample notification');
        bridge.notify.success('Saved successfully');
        bridge.notify.warn('Warnings persist until dismissed');
        bridge.notify.error('Errors persist until dismissed');
      },
      getDefault: () => '—',
      get: () => 'info · success · warning · error',
      format: () => '4 kinds',
    },

    /* ---------------- Tabs & layout ---------------- */
    {
      id: 'tabs-dock',
      tab: 'tabs',
      labelKey: 'tabs.dock',
      descKey: 'settings.tabs.dock.desc',
      control: 'select',
      options: [
        ['left', 'tabs.dock.left'],
        ['right', 'tabs.dock.right'],
        ['top', 'tabs.dock.top'],
        ['bottom', 'tabs.dock.bottom'],
      ],
      getDefault: () => 'left',
      get: () => bridge.tabs.getDock(),
      set: (v) => bridge.tabs.setDock(v),
      format: (v) => String(v),
    },
    {
      id: 'tabs-discovery',
      tab: 'tabs',
      labelKey: 'tabs.searchMaster',
      descKey: 'settings.tabs.discovery.desc',
      control: 'action',
      actionLabelKey: 'common.jump',
      run: () => bridge.tabs.openDiscovery('master'),
      getDefault: () => '—',
      get: () => 'strip / groups / groups-by-name / master',
      format: () => '4 searches',
    },
    {
      id: 'tabs-reset',
      tab: 'tabs',
      labelKey: 'common.reset',
      descKey: 'data.resetAll.body',
      control: 'action',
      actionLabelKey: 'common.reset',
      danger: true,
      run: async () => {
        const ok = await bridge.superConfirm({ title: i18n0('data.resetAll.title'), body: i18n0('data.resetAll.body'), phrase: 'RESET' });
        if (ok) {
          bridge.store.remove('tabs');
          location.reload();
        }
      },
      getDefault: () => '—',
      get: () => 'order · pins · groups · dock',
      format: () => 'resets tab state',
    },

    /* ---------------- Accessibility & motion ---------------- */
    {
      id: 'motion-override',
      tab: 'accessibility',
      labelKey: 'settings.motion.label',
      descKey: 'settings.motion.desc',
      control: 'select',
      options: [
        ['auto', 'theme.mode.auto'],
        ['reduced', 'common.off'],
        ['full', 'common.on'],
      ],
      getDefault: () => 'auto',
      get: () => bridge.store.get('motion.override', 'auto'),
      set: (v) => bridge.motion.applyOverride(v),
      format: (v) => String(v),
    },
    {
      id: 'focus-ring-width',
      tab: 'accessibility',
      labelKey: 'settings.focus.label',
      descKey: 'settings.focus.desc',
      control: 'slider',
      min: 1,
      max: 4,
      step: 1,
      getDefault: () => 2,
      get: () => bridge.store.get('a11y.focusWidth', 2),
      set: (v) => bridge.motion.setFocusWidth(v),
      format: (v) => `${v}px`,
    },

    /* ---------------- Data & privacy ---------------- */
    {
      id: 'data-export',
      tab: 'data',
      labelKey: 'data.export',
      descKey: 'data.privacy.note',
      control: 'action',
      actionLabelKey: 'data.export',
      run: () => bridge.exportSettings(),
      getDefault: () => '—',
      get: () => 'JSON download',
      format: () => 'JSON',
    },
    {
      id: 'data-import',
      tab: 'data',
      labelKey: 'data.import',
      descKey: 'data.privacy.note',
      control: 'file',
      accept: 'application/json',
      run: (file) => bridge.importSettings(file),
      getDefault: () => '—',
      get: () => 'JSON upload',
      format: () => 'JSON',
    },
    {
      id: 'data-reset-all',
      tab: 'data',
      labelKey: 'data.resetAll.title',
      descKey: 'data.privacy.note',
      control: 'action',
      actionLabelKey: 'data.resetAll.title',
      danger: true,
      run: () => bridge.resetAll(),
      getDefault: () => '—',
      get: () => `${bridge.store.keys().length} key(s)`,
      format: () => 'erases local state',
    },

    /* ---------------- About ---------------- */
    {
      id: 'about-version',
      tab: 'about',
      labelKey: 'about.version',
      descKey: 'about.funny.disclosure',
      control: 'static',
      getDefault: () => bridge.siteVersion,
      get: () => bridge.siteVersion,
      format: (v) => String(v),
    },
    {
      id: 'about-funny-disclosure',
      tab: 'about',
      labelKey: 'about.funny.disclosure',
      descKey: 'about.funny.disclosure',
      control: 'static',
      getDefault: () => 'level 5 / level 5',
      get: () => `level ${bridge.i18n.funnyLevel('en')} / level ${bridge.i18n.funnyLevel('zh')}`,
      format: (v) => String(v),
    },
  ];
}

function i18n0(key) {
  // Late-bound to avoid an import cycle at module evaluation time.
  return globalThis.__ccrI18n ? globalThis.__ccrI18n.t(key) : key;
}
