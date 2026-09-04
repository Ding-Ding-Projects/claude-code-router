import {
  AnimatedDisclosure, AnimatedListItem, AnimatePresence, AppConfig, Braces, buildExtensionList, Button,
  Card, CardContent, CardHeader, Check, ChevronDown, CircleAlert, ClaudeDesignRouteRuleType,
  claudeDesignRouteRuleTypeLabel, claudeDesignRouteRuleTypeOptions, ClaudeDesignRoutingDraft, ClaudeDesignRoutingRuleDraft, createRouteModelOptions, Dialog,
  DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, ExtensionListItem,
  cn, extensionMatchesQuery, ExtensionSource, Field, GatewayProviderConfig, Input, isClaudeDesignStaticRuleType,
  Label, motion, normalizeClaudeDesignRuleTypeChange, Play, PluginSettingsDraft, Plus, RouteTargetControl,
  Search, SelectControl, Settings, TextAreaControl, Toggle, translateOptions,
  Trash2, useAppText, useMemo, useState, X
} from "../shared/index";
import { MdButton } from "@/components/md3";

export function ExtensionsView({
  configureExtension,
  config,
  installExtension,
  exportClaudeDesignMigration,
  legacyMigrationAvailable,
  openExtensionApp,
  removeExtension,
  setExtensionEnabled
}: {
  configureExtension: (source: ExtensionSource, index: number) => void;
  config: AppConfig;
  installExtension: () => void;
  exportClaudeDesignMigration: () => void;
  legacyMigrationAvailable: boolean;
  openExtensionApp: (index: number, appId?: string) => void;
  removeExtension: (source: ExtensionSource, index: number, groupIndexes: number[]) => void;
  setExtensionEnabled: (source: ExtensionSource, index: number, enabled: boolean, groupIndexes: number[]) => void;
}) {
  const t = useAppText();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const extensions = useMemo(() => buildExtensionList(config), [config.plugins, config.providerPlugins]);
  const visibleExtensions = useMemo(
    () => extensions.filter((extension) => extensionMatchesQuery(extension, normalizedQuery)),
    [extensions, normalizedQuery]
  );

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex h-full min-h-0 min-w-0 flex-col"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <Card className="flex h-full min-h-0 min-w-0 flex-col">
        <CardHeader className="flex-row items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("Search extensions")}
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search extensions")}
              value={query}
            />
          </div>
          <MdButton aria-label={t("Install extension")} onClick={installExtension} size="sm" title={t("Install extension")} type="button">
            <Plus className="h-4 w-4" />
            {t("Install")}
          </MdButton>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {extensions.length === 0 ? (
            <div className="m-4 rounded-[var(--md-sys-shape-corner-medium)] border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-10 text-center">
              <Braces className="mx-auto mb-2 h-7 w-7 text-[var(--md-sys-color-outline)]" />
              <div className="md-type-body-medium text-[var(--md-sys-color-on-surface-variant)]">{t("No extensions installed")}</div>
              <div className="md-type-body-small mt-1 text-[var(--md-sys-color-outline)]">{t("Click Install to add one")}</div>
            </div>
          ) : null}
          {extensions.length > 0 && visibleExtensions.length === 0 ? (
            <div className="md-type-body-medium m-4 rounded-[var(--md-sys-shape-corner-medium)] border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-10 text-center text-[var(--md-sys-color-on-surface-variant)]">{t("No matching extensions")}</div>
          ) : null}
          {visibleExtensions.length > 0 ? (
            <div className="min-w-0">
              <div className="min-w-[720px]">
                <div className="md-type-label-medium sticky top-0 z-10 grid h-10 grid-cols-[minmax(180px,0.95fr)_minmax(220px,1.15fr)_minmax(240px,1.2fr)_116px_116px] items-center gap-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] px-4 uppercase tracking-wide text-[var(--md-sys-color-on-surface-variant)]">
                  <div className="truncate">{t("Name")}</div>
                  <div className="truncate">{t("Path")}</div>
                  <div className="truncate">{t("Capability")}</div>
                  <div className="truncate">{t("Status")}</div>
                  <div aria-hidden="true" />
                </div>
                <div className="divide-y divide-border/60">
                  <AnimatePresence initial={false}>
                  {visibleExtensions.map((extension) => {
                    const appId = extension.source === "plugins" ? openablePluginAppId(config, extension.index) : undefined;
                    const isClaudeDesignLegacy = extension.source === "plugins" && config.plugins[extension.index]?.id === "claude-design";
                    return (
                    <AnimatedListItem
                      className="grid min-h-[58px] grid-cols-[minmax(180px,0.95fr)_minmax(220px,1.15fr)_minmax(240px,1.2fr)_116px_116px] items-center gap-3 px-4 py-2.5 transition-colors duration-[var(--md-sys-motion-duration-short3)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_4%,transparent)]"
                      key={`${extension.source}-${extension.index}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold">{extension.name}</div>
                      </div>
                      <div className="md-type-body-small min-w-0 truncate text-[var(--md-sys-color-on-surface-variant)]" title={extension.target}>
                        {extension.target}
                      </div>
                      <div className="md-type-body-small min-w-0 truncate text-[var(--md-sys-color-on-surface-variant)]" title={extension.capability}>
                        {extension.capability}
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        {extension.canToggle ? (
                          <Toggle checked={extension.enabled} onChange={(enabled) => setExtensionEnabled(extension.source, extension.index, enabled, extension.groupIndexes)} />
                        ) : null}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        {appId ? (
                          <MdButton
                            aria-label={`${t("Open")} ${extension.name}`}
                            onClick={() => openExtensionApp(extension.index, appId)}
                            size="iconSm"
                            title={t("Open plugin app")}
                            type="button"
                            variant="text"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </MdButton>
                        ) : null}
                        <MdButton
                          aria-label={`${t("Configure")} ${extension.name}`}
                          disabled={!extension.canConfigure}
                          onClick={() => configureExtension(extension.source, extension.index)}
                          size="iconSm"
                          title={t("Configure plugin")}
                          type="button"
                          variant="text"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </MdButton>
                        <MdButton aria-label={`${t("Remove")} ${extension.name}`} onClick={() => removeExtension(extension.source, extension.index, extension.groupIndexes)} size="iconSm" title={t("Remove extension")} type="button" variant="text">
                          <Trash2 className="h-3.5 w-3.5" />
                        </MdButton>
                      </div>
                      {isClaudeDesignLegacy && legacyMigrationAvailable ? (
                        <div className="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-[var(--md-sys-shape-corner-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2">
                          <div className="min-w-0">
                            <div className="md-type-label-large">{t("Claude Design Desktop migration")}</div>
                            <div className="md-type-body-small text-[var(--md-sys-color-on-surface-variant)]">{t("Export selected legacy projects into a versioned ZIP. Nothing is disabled or deleted automatically.")}</div>
                          </div>
                          <MdButton onClick={exportClaudeDesignMigration} size="sm" type="button" variant="tonal">
                            {t("Export migration archive")}
                          </MdButton>
                        </div>
                      ) : null}
                    </AnimatedListItem>
                    );
                  })}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function openablePluginAppId(config: AppConfig, index: number): string | undefined {
  const plugin = config.plugins[index];
  if (!plugin || plugin.enabled === false || plugin.surfaces?.apps === false) {
    return undefined;
  }
  const configuredApp = plugin.apps?.find((app) => app.name?.trim() && app.url?.trim());
  if (configuredApp) {
    return configuredApp.id?.trim() || configuredApp.name.trim();
  }
  if (plugin.id === "claude-design") {
    return "claude-design";
  }
  if (plugin.id === "claude-ship") {
    return "claude-ship";
  }
  return undefined;
}

export function DeleteExtensionDialog({
  extension,
  onClose,
  onConfirm
}: {
  extension: ExtensionListItem;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useAppText();

  return (
    <Dialog onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>{t("Delete Extension")}</DialogTitle>
          </div>
          <MdButton aria-label={t("Close dialog")} onClick={onClose} size="iconSm" title={t("Close")} type="button" variant="text">
            <X className="h-4 w-4" />
          </MdButton>
        </DialogHeader>

        <DialogBody>
          <div className="rounded-[var(--md-sys-shape-corner-small)] border border-transparent bg-[var(--md-sys-color-error-container)] px-3 py-2.5">
            <div className="md-type-body-medium flex items-start gap-2 font-medium text-[var(--md-sys-color-on-error-container)]">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("Delete this extension from the configuration?")}</span>
            </div>
            <div className="md-type-body-small mt-2 space-y-1 text-[color-mix(in_srgb,var(--md-sys-color-on-error-container)_80%,var(--md-sys-color-on-surface))]">
              <div className="truncate" title={extension.name}>
                <span className="font-medium text-[var(--md-sys-color-on-error-container)]">{t("Name")}:</span> {extension.name}
              </div>
              <div className="truncate" title={extension.target}>
                <span className="font-medium text-[var(--md-sys-color-on-error-container)]">{t("Path")}:</span> {extension.target}
              </div>
              <div className="truncate" title={extension.capability}>
                <span className="font-medium text-[var(--md-sys-color-on-error-container)]">{t("Capability")}:</span> {extension.capability}
              </div>
              <div>{t("This action is applied immediately to the draft config and will auto-save with other changes.")}</div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <MdButton autoFocus onClick={onClose} size="sm" type="button" variant="outlined">
            {t("Cancel")}
          </MdButton>
          <MdButton onClick={onConfirm} size="sm" type="button" variant="error">
            <Trash2 className="h-4 w-4" />
            {t("Delete")}
          </MdButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PluginSettingsDialog({
  draft,
  error,
  extension,
  onChange,
  onClose,
  onSubmit
}: {
  draft: PluginSettingsDraft;
  error: string;
  extension: ExtensionListItem;
  onChange: (patch: Partial<PluginSettingsDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const t = useAppText();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <Dialog onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>{t("Plugin Settings")}</DialogTitle>
          </div>
          <MdButton aria-label={t("Close dialog")} onClick={onClose} size="iconSm" title={t("Close")} type="button" variant="text">
            <X className="h-4 w-4" />
          </MdButton>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
              <Field label={t("Enabled")}>
                <Toggle checked={draft.enabled} onChange={(enabled) => onChange({ enabled })} />
              </Field>
              <Field label={t("Name")}>
                <Input readOnly value={extension.name} />
              </Field>
              <Field className="sm:col-span-2" label={t("Module path")}>
                <Input value={draft.modulePath} onChange={(event) => onChange({ modulePath: event.target.value })} />
              </Field>
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-background">
              <Button
                aria-expanded={advancedOpen}
                className="md-type-label-large flex h-10 w-full items-center justify-between gap-3 px-3 text-left text-[var(--md-sys-color-on-surface)] transition-colors duration-[var(--md-sys-motion-duration-short3)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,transparent)]"
                onClick={() => setAdvancedOpen((value) => !value)}
                type="button"
                unstyled
              >
                <span className="min-w-0 truncate">{t("Advanced settings")}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", advancedOpen && "rotate-180")} />
              </Button>
              <AnimatePresence initial={false}>
                {advancedOpen ? (
                  <AnimatedDisclosure key="plugin-settings-advanced">
                    <div className="space-y-4 border-t border-border p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Field label={t("App surface")}>
                          <Toggle checked={draft.appsSurfaceEnabled} onChange={(appsSurfaceEnabled) => onChange({ appsSurfaceEnabled })} />
                        </Field>
                        <Field label={t("Gateway surface")}>
                          <Toggle checked={draft.gatewaySurfaceEnabled} onChange={(gatewaySurfaceEnabled) => onChange({ gatewaySurfaceEnabled })} />
                        </Field>
                        <Field label={t("Provider surface")}>
                          <Toggle checked={draft.providerSurfaceEnabled} onChange={(providerSurfaceEnabled) => onChange({ providerSurfaceEnabled })} />
                        </Field>
                      </div>

                      <Field label={t("Browser apps JSON")}>
                        <TextAreaControl minHeight={132} value={draft.appsText} onChange={(appsText) => onChange({ appsText })} />
                      </Field>

                      <Field label={t("Plugin permissions JSON")}>
                        <TextAreaControl minHeight={120} value={draft.permissionsText} onChange={(permissionsText) => onChange({ permissionsText })} />
                      </Field>

                      <Field label={t("Plugin proxy JSON")}>
                        <TextAreaControl minHeight={120} value={draft.proxyText} onChange={(proxyText) => onChange({ proxyText })} />
                      </Field>

                      <Field label={t("Plugin core gateway JSON")}>
                        <TextAreaControl minHeight={132} value={draft.coreGatewayText} onChange={(coreGatewayText) => onChange({ coreGatewayText })} />
                      </Field>

                      <Field label={t("Plugin config JSON")}>
                        <TextAreaControl minHeight={160} value={draft.configText} onChange={(configText) => onChange({ configText })} />
                      </Field>
                    </div>
                  </AnimatedDisclosure>
                ) : null}
              </AnimatePresence>
            </div>

            {error ? (
              <div className="md-type-body-medium rounded-[var(--md-sys-shape-corner-small)] border border-transparent bg-[var(--md-sys-color-error-container)] px-3 py-2 text-[var(--md-sys-color-on-error-container)]">{t(error)}</div>
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter>
          <MdButton onClick={onClose} size="sm" type="button" variant="outlined">
            {t("Cancel")}
          </MdButton>
          <MdButton onClick={onSubmit} size="sm" type="button">
            <Check className="h-4 w-4" />
            {t("Save")}
          </MdButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfigureClaudeDesignDialog({
  canSubmit,
  draft,
  routesLabel = "Claude Design routes",
  sourceModelLabel = "Claude Design model",
  sourceModelDefaults = { model: "claude-opus-4-8", pattern: "claude-" },
  onAddRule,
  onChange,
  onChangeRule,
  onClose,
  onRemoveRule,
  onSubmit,
  providers
}: {
  canSubmit: boolean;
  draft: ClaudeDesignRoutingDraft;
  routesLabel?: string;
  sourceModelLabel?: string;
  sourceModelDefaults?: { model: string; pattern: string };
  onAddRule: () => void;
  onChange: (patch: Partial<ClaudeDesignRoutingDraft>) => void;
  onChangeRule: (index: number, patch: Partial<ClaudeDesignRoutingRuleDraft>) => void;
  onClose: () => void;
  onRemoveRule: (index: number) => void;
  onSubmit: () => void;
  providers: GatewayProviderConfig[];
}) {
  const t = useAppText();
  const modelOptions = useMemo(() => createRouteModelOptions(providers), [providers]);
  const ruleTypeOptions = translateOptions(claudeDesignRouteRuleTypeOptions, t);

  return (
    <Dialog onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>{t("Configure Routing")}</DialogTitle>
          </div>
          <MdButton aria-label={t("Close dialog")} onClick={onClose} size="iconSm" title={t("Close")} type="button" variant="text">
            <X className="h-4 w-4" />
          </MdButton>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
              <Field label={t("Model routing")}>
                <Toggle checked={draft.enabled} onChange={(enabled) => onChange({ enabled })} />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="md-type-label-medium min-w-0 uppercase tracking-wide text-[var(--md-sys-color-on-surface-variant)]">{t(routesLabel)}</div>
                <MdButton onClick={onAddRule} size="sm" type="button" variant="tonal">
                  <Plus className="h-3.5 w-3.5" />
                  {t("Add")}
                </MdButton>
              </div>

              {draft.rules.length === 0 ? (
                <div className="md-type-body-medium rounded-[var(--md-sys-shape-corner-small)] border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-8 text-center text-[var(--md-sys-color-on-surface-variant)]">{t("No plugin routes configured")}</div>
              ) : null}

              <div className="space-y-2">
                <AnimatePresence initial={false}>
                {draft.rules.map((rule, index) => (
                  <AnimatedListItem className="rounded-[var(--md-sys-shape-corner-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-3" key={rule.id || index}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={t("Name")}>
                        <Input value={rule.name} onChange={(event) => onChangeRule(index, { name: event.target.value })} />
                      </Field>
                      <Field label={t("Condition")}>
                        <SelectControl
                          value={rule.type}
                          onChange={(type) => onChangeRule(index, normalizeClaudeDesignRuleTypeChange(rule, type as ClaudeDesignRouteRuleType, sourceModelDefaults))}
                          options={ruleTypeOptions}
                        />
                      </Field>
                      {rule.type === "model" ? (
                        <Field label={t(sourceModelLabel)}>
                          <Input value={rule.model} onChange={(event) => onChangeRule(index, { model: event.target.value })} />
                        </Field>
                      ) : null}
                      {rule.type === "model-prefix" ? (
                        <Field label={t("Model prefix")}>
                          <Input value={rule.pattern} onChange={(event) => onChangeRule(index, { pattern: event.target.value })} />
                        </Field>
                      ) : null}
                      {isClaudeDesignStaticRuleType(rule.type) ? (
                        <div className="md-type-body-medium flex min-h-[58px] items-end rounded-[var(--md-sys-shape-corner-small)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] px-3 py-2 text-[var(--md-sys-color-on-surface-variant)]">{t(claudeDesignRouteRuleTypeLabel(rule.type))}</div>
                      ) : null}
                      <Field label={t("Target model")}>
                        <RouteTargetControl
                          modelOptions={modelOptions}
                          onChange={(target) => onChangeRule(index, { target })}
                          value={rule.target}
                        />
                      </Field>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <Label className="md-type-body-medium flex min-w-0 items-center gap-2 text-[var(--md-sys-color-on-surface-variant)]">
                        <Toggle checked={rule.enabled} onChange={(enabled) => onChangeRule(index, { enabled })} />
                        <span>{t("Enabled")}</span>
                      </Label>
                      <MdButton aria-label={`${t("Remove")} ${rule.name || t("Plugin route")}`} onClick={() => onRemoveRule(index)} size="iconSm" title={t("Remove rule")} type="button" variant="text">
                        <Trash2 className="h-3.5 w-3.5" />
                      </MdButton>
                    </div>
                  </AnimatedListItem>
                ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <MdButton onClick={onClose} size="sm" type="button" variant="outlined">
            {t("Cancel")}
          </MdButton>
          <MdButton disabled={!canSubmit} onClick={onSubmit} size="sm" type="button">
            <Check className="h-4 w-4" />
            {t("Save")}
          </MdButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
