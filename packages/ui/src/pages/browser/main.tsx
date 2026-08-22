import { useEffect, useMemo, useState, type FormEvent } from "react";
import { mountAppRoot } from "@/main";
import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, Plus, RotateCw, UserRound, X } from "lucide-react";
import type { BuiltInBrowserState, ChromeLoginImportJob, ChromeLoginImportRequest } from "@ccr/core/contracts/app";

declare global {
  interface Window {
    ccrBrowser?: {
      back: (tabId?: string) => Promise<BuiltInBrowserState>;
      closeTab: (tabId: string) => Promise<BuiltInBrowserState>;
      forward: (tabId?: string) => Promise<BuiltInBrowserState>;
      getChromeLoginImport: (id: string) => Promise<ChromeLoginImportJob | undefined>;
      getState: () => Promise<BuiltInBrowserState>;
      navigate: (url: string, tabId?: string) => Promise<BuiltInBrowserState>;
      newTab: (url?: string) => Promise<BuiltInBrowserState>;
      reload: (tabId?: string) => Promise<BuiltInBrowserState>;
      resolveAutomationHandoff: (status: "completed" | "dismissed") => Promise<BuiltInBrowserState>;
      selectTab: (tabId: string) => Promise<BuiltInBrowserState>;
      startChromeLoginImport: (request: ChromeLoginImportRequest) => Promise<ChromeLoginImportJob>;
      onStateChanged: (callback: (state: BuiltInBrowserState) => void) => () => void;
    };
  }
}

const emptyState: BuiltInBrowserState = {
  apps: [],
  tabs: []
};
const browserHomeUrl = "about:blank";

function BrowserChrome() {
  const [state, setState] = useState<BuiltInBrowserState>(emptyState);
  const [addressDraft, setAddressDraft] = useState("");
  const [chromeImportDialogOpen, setChromeImportDialogOpen] = useState(false);
  const [chromeImportDomainsDraft, setChromeImportDomainsDraft] = useState("");
  const [chromeImportError, setChromeImportError] = useState("");
  const [chromeImportJob, setChromeImportJob] = useState<ChromeLoginImportJob | undefined>();
  const [chromeImportMessage, setChromeImportMessage] = useState("");
  const [chromeImportStarting, setChromeImportStarting] = useState(false);
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId),
    [state.activeTabId, state.tabs]
  );
  const handoff = state.automationHandoff;

  useEffect(() => {
    let cancelled = false;
    void window.ccrBrowser?.getState().then((nextState) => {
      if (!cancelled) {
        setState(nextState);
      }
    });
    const unsubscribe = window.ccrBrowser?.onStateChanged(setState);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    setAddressDraft(activeTab?.url || "");
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    if (!chromeImportJob || chromeImportJob.status !== "pending") {
      return;
    }
    const interval = window.setInterval(() => {
      void window.ccrBrowser?.getChromeLoginImport(chromeImportJob.id).then((job) => {
        if (!job) {
          setChromeImportJob(undefined);
          return;
        }
        setChromeImportJob(job);
        if (job.status === "completed" && activeTab?.id && activeTabMatchesImport(activeTab.url, job.domains)) {
          void run(window.ccrBrowser?.reload(activeTab.id));
        }
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [activeTab?.id, activeTab?.url, chromeImportJob]);

  async function run(action: Promise<BuiltInBrowserState> | undefined): Promise<void> {
    if (!action) {
      return;
    }
    setState(await action);
  }

  function submitNavigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(window.ccrBrowser?.navigate(addressDraft, activeTab?.id));
  }

  async function submitChromeLoginImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domains = parseImportDomains(chromeImportDomainsDraft);
    if (domains.length === 0) {
      setChromeImportError("Enter at least one domain.");
      return;
    }
    setChromeImportError("");
    setChromeImportMessage("");
    setChromeImportStarting(true);
    try {
      const job = await window.ccrBrowser?.startChromeLoginImport({ domains, openConfirmationPage: true });
      if (!job) {
        throw new Error("Chrome login import is unavailable.");
      }
      setChromeImportJob(job);
      setChromeImportDomainsDraft(job.domains.join(", "));
      setChromeImportMessage("Confirmation page opened. If it did not open in Chrome, copy the extension import URL into the Chrome extension popup.");
    } catch (error) {
      setChromeImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setChromeImportStarting(false);
    }
  }

  function chromeImportTitle(): string {
    if (!chromeImportJob) {
      return "Import login from Chrome";
    }
    if (chromeImportJob.status === "completed") {
      return `Chrome import complete: ${chromeImportJob.result?.imported ?? 0} imported, ${chromeImportJob.result?.skipped ?? 0} skipped`;
    }
    if (chromeImportJob.status === "expired") {
      return "Chrome import expired";
    }
    if (chromeImportJob.status === "failed") {
      return "Chrome import failed";
    }
    return "Chrome import pending. Confirm it in the browser window.";
  }

  async function handleChromeImportButton() {
    if (chromeImportJob?.status === "pending") {
      setChromeImportDialogOpen(true);
      setChromeImportError("");
      setChromeImportMessage("Chrome import is pending.");
      return;
    }
    setChromeImportDomainsDraft(activeTabDomain(activeTab?.url));
    setChromeImportDialogOpen(true);
    setChromeImportError("");
    setChromeImportMessage("");
  }

  async function copyChromeImportUrl(kind: "confirm" | "import") {
    const url = kind === "confirm" ? chromeImportJob?.confirmUrl : chromeImportJob?.importUrl;
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setChromeImportError("");
      setChromeImportMessage(kind === "confirm" ? "Confirmation page URL copied." : "Extension import URL copied.");
    } catch (error) {
      setChromeImportMessage("");
      setChromeImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className={`browser-shell ${handoff ? "has-handoff" : ""}`}>
      <div className="tabs-row">
        <div className="traffic-space" />
        <div className="tabs-strip">
          {state.tabs.map((tab) => (
            <button
              className={`tab ${tab.id === state.activeTabId ? "active" : ""}`}
              key={tab.id}
              onClick={() => void run(window.ccrBrowser?.selectTab(tab.id))}
              title={tab.title || tab.url}
              type="button"
            >
              <span className="tab-title">{tab.isLoading ? "Loading" : tab.title || tab.url || "New Tab"}</span>
              <span
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  void run(window.ccrBrowser?.closeTab(tab.id));
                }}
                role="button"
                tabIndex={-1}
                title="Close tab"
              >
                <X size={13} strokeWidth={2.2} />
              </span>
            </button>
          ))}
          <button className="new-tab-button" onClick={() => void run(window.ccrBrowser?.newTab())} title="New tab" type="button">
            <Plus size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <form className="toolbar" onSubmit={submitNavigation}>
        <button
          className="icon-button"
          disabled={!activeTab?.canGoBack}
          onClick={() => void run(window.ccrBrowser?.back(activeTab?.id))}
          title="Back"
          type="button"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
        </button>
        <button
          className="icon-button"
          disabled={!activeTab?.canGoForward}
          onClick={() => void run(window.ccrBrowser?.forward(activeTab?.id))}
          title="Forward"
          type="button"
        >
          <ArrowRight size={17} strokeWidth={2.2} />
        </button>
        <button
          className="icon-button"
          disabled={!activeTab}
          onClick={() => void run(window.ccrBrowser?.reload(activeTab?.id))}
          title="Refresh"
          type="button"
        >
          {activeTab?.isLoading ? <LoaderCircle className="spin" size={17} strokeWidth={2.2} /> : <RotateCw size={16} strokeWidth={2.2} />}
        </button>
        <input
          aria-label="Address"
          autoComplete="off"
          disabled={!activeTab}
          onChange={(event) => setAddressDraft(event.target.value)}
          spellCheck={false}
          value={addressDraft}
        />
        <button
          className={`icon-button ${chromeImportJob?.status === "pending" ? "active-import" : ""}`}
          disabled={!activeTab}
          onClick={() => void handleChromeImportButton()}
          title={chromeImportTitle()}
          type="button"
        >
          <KeyRound size={16} strokeWidth={2.2} />
        </button>
      </form>

      {handoff ? (
        <div className="automation-handoff" role="status">
          <div className="handoff-copy">
            <UserRound size={16} strokeWidth={2.2} />
            <span className="handoff-message">{handoff.message}</span>
            {handoff.reason ? <span className="handoff-reason">{handoff.reason}</span> : null}
          </div>
          <div className="handoff-actions">
            <button
              className="handoff-button primary"
              onClick={() => void run(window.ccrBrowser?.resolveAutomationHandoff("completed"))}
              type="button"
            >
              <Check size={15} strokeWidth={2.4} />
              <span>Done</span>
            </button>
            <button
              className="handoff-button"
              onClick={() => void run(window.ccrBrowser?.resolveAutomationHandoff("dismissed"))}
              type="button"
            >
              <X size={14} strokeWidth={2.3} />
              <span>Hide</span>
            </button>
          </div>
        </div>
      ) : null}

      {chromeImportDialogOpen ? (
        <div className="chrome-import-backdrop" role="presentation">
          <form className="chrome-import-dialog" onSubmit={submitChromeLoginImport}>
            <div className="chrome-import-header">
              <div className="chrome-import-title">Import login from Chrome</div>
              <button
                className="icon-button"
                onClick={() => setChromeImportDialogOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} strokeWidth={2.3} />
              </button>
            </div>
            <label className="chrome-import-field">
              <span>Domains</span>
              <input
                autoFocus
                disabled={chromeImportStarting || chromeImportJob?.status === "pending"}
                onChange={(event) => setChromeImportDomainsDraft(event.target.value)}
                placeholder="example.com, auth.example.com"
                spellCheck={false}
                value={chromeImportDomainsDraft}
              />
            </label>
            {chromeImportJob?.status === "pending" ? (
              <>
                <label className="chrome-import-field">
                  <span>Extension import URL</span>
                  <input readOnly value={chromeImportJob.importUrl} />
                </label>
                <label className="chrome-import-field">
                  <span>Confirmation page URL</span>
                  <input readOnly value={chromeImportJob.confirmUrl} />
                </label>
              </>
            ) : null}
            {chromeImportError ? <div className="chrome-import-error" role="alert">{chromeImportError}</div> : null}
            {chromeImportMessage ? <div className="chrome-import-message" role="status">{chromeImportMessage}</div> : null}
            <div className="chrome-import-actions">
              {chromeImportJob?.status === "pending" ? (
                <>
                  <button className="chrome-import-button primary" onClick={() => void copyChromeImportUrl("import")} type="button">
                    Copy import URL
                  </button>
                  <button className="chrome-import-button" onClick={() => void copyChromeImportUrl("confirm")} type="button">
                    Copy page URL
                  </button>
                </>
              ) : (
                <button className="chrome-import-button primary" disabled={chromeImportStarting} type="submit">
                  {chromeImportStarting ? "Starting" : "Start import"}
                </button>
              )}
              <button className="chrome-import-button" onClick={() => setChromeImportDialogOpen(false)} type="button">
                Close
              </button>
            </div>
          </form>
        </div>
      ) : null}

    </div>
  );
}

mountAppRoot(<BrowserChrome />);

function activeTabDomain(url: string | undefined): string {
  if (!url || url === browserHomeUrl) {
    return "";
  }
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function activeTabMatchesImport(url: string | undefined, domains: string[]): boolean {
  const host = activeTabDomain(url).toLowerCase();
  return Boolean(host && domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

function parseImportDomains(value: string): string[] {
  return [...new Set(value
    .split(/[,\n]/)
    .map((item) => normalizeImportDomain(item))
    .filter((item): item is string => Boolean(item)))];
}

function normalizeImportDomain(value: string): string | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    const domain = raw.replace(/^\*\./, "").split("/")[0];
    return domain && !domain.includes(" ") ? domain : undefined;
  }
}

const style = document.createElement("style");
/*
 * Material Design 3 chrome. Every colour, shape, elevation, motion and type
 * value below comes from the --md-sys-* custom properties in
 * styles/m3/tokens.css (bundled into assets/main.css and injected into this
 * page's HTML); the scheme follows [data-md-theme] on <html>, set by
 * M3ThemeProvider through the shared bootstrap. Geometry - row heights,
 * grid columns, paddings - is unchanged from the previous chrome.
 */
style.textContent = `
  :root {
    color-scheme: light dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body,
  #root {
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  body {
    background: var(--md-sys-color-background);
    color: var(--md-sys-color-on-background);
  }

  button,
  input {
    -webkit-app-region: no-drag;
    font: inherit;
  }

  button {
    color: var(--md-sys-color-on-surface);
  }

  .browser-shell {
    display: grid;
    grid-template-rows: 38px 44px minmax(0, 1fr);
    height: 100%;
    min-width: 0;
    position: relative;
    width: 100%;
  }

  .browser-shell.has-handoff {
    grid-template-rows: 38px 44px 44px minmax(0, 1fr);
  }

  .tabs-row {
    -webkit-app-region: drag;
    align-items: end;
    background: var(--md-sys-color-surface-container);
    display: flex;
    min-width: 0;
    padding: 5px 8px 0 0;
  }

  .traffic-space {
    flex: 0 0 76px;
    height: 100%;
  }

  .tabs-strip {
    align-items: end;
    display: flex;
    flex: 1;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  }

  .tab,
  .new-tab-button,
  .icon-button {
    align-items: center;
    background: transparent;
    border: 0;
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
    outline: none;
  }

  /* Material 3 tab anatomy: the selected document tab rises out of the strip
     onto the toolbar surface with top-only corner rounding. */
  .tab {
    border-radius: var(--md-sys-shape-corner-small) var(--md-sys-shape-corner-small) 0 0;
    color: var(--md-sys-color-on-surface-variant);
    gap: 6px;
    height: 31px;
    justify-content: flex-start;
    max-width: 210px;
    min-width: 86px;
    padding: 0 7px 0 10px;
    transition: background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    width: clamp(110px, 18vw, 210px);
  }

  .tab.active {
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--md-elevation-level1);
    color: var(--md-sys-color-on-surface);
  }

  .tab:not(.active):hover,
  .new-tab-button:hover,
  .icon-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  }

  .tab:focus-visible,
  .new-tab-button:focus-visible,
  .icon-button:focus-visible,
  .handoff-button:focus-visible,
  .chrome-import-button:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 1px;
  }

  .tab-title {
    flex: 1;
    font-size: var(--md-sys-typescale-body-small-font-size);
    letter-spacing: var(--md-sys-typescale-body-small-letter-spacing);
    line-height: var(--md-sys-typescale-body-small-line-height);
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    align-items: center;
    border-radius: var(--md-sys-shape-corner-full);
    display: inline-flex;
    flex: 0 0 auto;
    height: 18px;
    justify-content: center;
    width: 18px;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  }

  .new-tab-button {
    border-radius: var(--md-sys-shape-corner-full);
    flex: 0 0 auto;
    height: 28px;
    margin-bottom: 2px;
    transition: background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    width: 30px;
  }

  .toolbar {
    -webkit-app-region: drag;
    align-items: center;
    background: var(--md-sys-color-surface-container-lowest);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    display: grid;
    gap: 4px;
    grid-template-columns: 32px 32px 32px minmax(0, 1fr) 32px;
    padding: 6px 10px;
  }

  /* Material 3 icon button: round, on-surface-variant glyph, state-layer hover. */
  .icon-button {
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant);
    height: 30px;
    transition:
      background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
      color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    width: 30px;
  }

  .icon-button:disabled {
    cursor: default;
    opacity: 0.38;
  }

  .icon-button.active-import {
    background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
    color: var(--md-sys-color-primary);
  }

  /* Material 3 search-bar-style filled field for the address bar. */
  input {
    background: var(--md-sys-color-surface-container-high);
    border: 1px solid transparent;
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface);
    font-size: var(--md-sys-typescale-body-medium-font-size);
    height: 30px;
    min-width: 0;
    outline: none;
    padding: 0 12px;
    transition:
      background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
      border-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    width: 100%;
  }

  input::placeholder {
    color: var(--md-sys-color-on-surface-variant);
  }

  input:focus {
    background: var(--md-sys-color-surface-container-lowest);
    border-color: var(--md-sys-color-primary);
  }

  input:focus-visible {
    outline: none;
  }

  input:disabled {
    opacity: 0.38;
  }

  .automation-handoff {
    -webkit-app-region: drag;
    align-items: center;
    background: var(--md-sys-color-tertiary-container);
    border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-on-tertiary-container) 14%, transparent);
    color: var(--md-sys-color-on-tertiary-container);
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    padding: 6px 10px;
  }

  .handoff-copy {
    align-items: center;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .handoff-message,
  .handoff-reason {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .handoff-message {
    font-size: var(--md-sys-typescale-title-small-font-size);
    font-weight: var(--md-sys-typescale-title-small-font-weight);
    letter-spacing: var(--md-sys-typescale-title-small-letter-spacing);
    line-height: var(--md-sys-typescale-title-small-line-height);
  }

  .handoff-reason {
    color: color-mix(in srgb, var(--md-sys-color-on-tertiary-container) 76%, transparent);
    font-size: var(--md-sys-typescale-body-small-font-size);
  }

  .handoff-actions {
    -webkit-app-region: no-drag;
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  /* Material 3 buttons: filled primary and tonal secondary, fully rounded,
     label-large type. */
  .handoff-button {
    align-items: center;
    background: var(--md-sys-color-secondary-container);
    border: 0;
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-secondary-container);
    cursor: pointer;
    display: inline-flex;
    font-size: var(--md-sys-typescale-label-large-font-size);
    font-weight: var(--md-sys-typescale-label-large-font-weight);
    gap: 5px;
    height: 30px;
    justify-content: center;
    letter-spacing: var(--md-sys-typescale-label-large-letter-spacing);
    line-height: var(--md-sys-typescale-label-large-line-height);
    min-width: 0;
    padding: 0 12px;
    transition:
      background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
      box-shadow var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    white-space: nowrap;
  }

  .handoff-button:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 8%, var(--md-sys-color-secondary-container));
    box-shadow: var(--md-elevation-level1);
  }

  .handoff-button.primary {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .handoff-button.primary:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-primary) 8%, var(--md-sys-color-primary));
  }

  /* Material 3 dialog: scrim backdrop, extra-large corners, level-3
     elevation, surface-container-high sheet. */
  .chrome-import-backdrop {
    align-items: start;
    background: color-mix(in srgb, var(--md-sys-color-scrim) 40%, transparent);
    bottom: 0;
    display: flex;
    justify-content: center;
    left: 0;
    padding: 28px 16px;
    position: fixed;
    right: 0;
    top: 82px;
    z-index: 20;
  }

  .browser-shell.has-handoff .chrome-import-backdrop {
    top: 126px;
  }

  .chrome-import-dialog {
    background: var(--md-sys-color-surface-container-high);
    border: 0;
    border-radius: var(--md-sys-shape-corner-extra-large);
    box-shadow: var(--md-elevation-level3);
    color: var(--md-sys-color-on-surface);
    display: grid;
    gap: 12px;
    max-width: 520px;
    padding: 18px;
    width: min(520px, 100%);
  }

  .chrome-import-header {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    min-width: 0;
  }

  .chrome-import-title {
    font-size: var(--md-sys-typescale-title-small-font-size);
    font-weight: var(--md-sys-typescale-title-small-font-weight);
    letter-spacing: var(--md-sys-typescale-title-small-letter-spacing);
    line-height: var(--md-sys-typescale-title-small-line-height);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chrome-import-field {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .chrome-import-field span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: var(--md-sys-typescale-label-small-font-size);
    font-weight: var(--md-sys-typescale-label-small-font-weight);
    letter-spacing: var(--md-sys-typescale-label-small-letter-spacing);
    line-height: var(--md-sys-typescale-label-small-line-height);
  }

  .chrome-import-dialog input {
    background: var(--md-sys-color-surface-container-highest);
    border-radius: var(--md-sys-shape-corner-small);
    padding: 0 10px;
  }

  .chrome-import-dialog input:focus {
    background: var(--md-sys-color-surface-container-highest);
  }

  .chrome-import-error,
  .chrome-import-message {
    border-radius: var(--md-sys-shape-corner-small);
    font-size: var(--md-sys-typescale-body-small-font-size);
    line-height: 1.4;
    padding: 8px 10px;
  }

  .chrome-import-error {
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }

  .chrome-import-message {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .chrome-import-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: end;
  }

  /* Text button by default, filled primary for the main action. */
  .chrome-import-button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-primary);
    cursor: pointer;
    display: inline-flex;
    font-size: var(--md-sys-typescale-label-large-font-size);
    font-weight: var(--md-sys-typescale-label-large-font-weight);
    height: 32px;
    justify-content: center;
    letter-spacing: var(--md-sys-typescale-label-large-letter-spacing);
    line-height: var(--md-sys-typescale-label-large-line-height);
    min-width: 86px;
    padding: 0 14px;
    transition:
      background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
      box-shadow var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
  }

  .chrome-import-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
  }

  .chrome-import-button:disabled {
    cursor: default;
    opacity: 0.38;
  }

  .chrome-import-button.primary {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .chrome-import-button.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--md-sys-color-on-primary) 8%, var(--md-sys-color-primary));
    box-shadow: var(--md-elevation-level1);
  }

  .spin {
    animation: spin var(--md-sys-motion-duration-extra-long2) var(--md-sys-motion-easing-linear) infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  @media (max-width: 720px) {
    .automation-handoff {
      gap: 6px;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .handoff-reason {
      display: none;
    }

    .handoff-button span {
      display: none;
    }

    .handoff-button {
      padding: 0 8px;
      width: 32px;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
document.head.appendChild(style);
