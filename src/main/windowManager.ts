import { BrowserWindow, WebContents, WebContentsView, nativeTheme } from 'electron';
import { NOTICE_MESSAGES } from '../shared/notices';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES } from '../shared/presetSites';
import {
  ApplyTemplatePayload,
  BrowserState,
  CELL_IDS,
  CellTab,
  CellMode,
  DEFAULT_URLS,
  ForwardRecord,
  ForwardResponsePayload,
  IPC,
  LAYOUT_CELLS,
  LayoutMode,
  NoticeType,
  SplitRatiosPayload,
  ThemeMode,
} from '../shared/types';
import { getAdapterForUrl } from './adapters';
import { CHROME_USER_AGENT } from './constants';

const TOOLBAR_HEIGHT = 52;
const BOTTOM_INPUT_HEIGHT = 64;
const CELL_BORDER_SIZE = 1;
const FOCUSED_CELL_BORDER_SIZE = 2;
const CELL_HEADER_HEIGHT = 42;
const SPLITTER_SIZE = 4;
const LOAD_TIMEOUT_MS = 10_000;
const NOTICE_REPLAY_DELAY_MS = 500;
const RESPONSE_POLL_INTERVAL_MS = 800;
const RESPONSE_WAIT_TIMEOUT_MS = 120_000;
const BLANK_URL = 'about:blank';
const EMPTY_STATE_URL = createEmptyStateUrl();

export interface BrowserStore {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
}

export async function createBrowserStore(): Promise<BrowserStore> {
  const importModule = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ default: new () => BrowserStore }>;
  const { default: ElectronStore } = await importModule('electron-store');
  return new ElectronStore();
}

interface CellState {
  url: string;
  active: boolean;
  mode: CellMode;
}

export class WindowManager {
  private views: Map<string, WebContentsView> = new Map();
  private viewPartitions: Map<string, string> = new Map();
  private attachedViews: Set<string> = new Set();
  private cellStates: Map<string, CellState> = new Map();
  private loadTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private layoutMode: LayoutMode;
  private cellUrls: Record<string, string>;
  private cellModes: Record<string, CellMode>;
  private searchUrlTemplates: Record<string, string>;
  private mutedCells: Record<string, boolean>;
  private tabs: Record<string, CellTab[]>;
  private activeTabIds: Record<string, string>;
  private themeMode: ThemeMode;
  private activeCells: Record<string, boolean> = {
    'cell-0': true,
    'cell-1': true,
    'cell-2': true,
    'cell-3': true,
  };
  private horizontalRatio = 0.5;
  private verticalRatio = 0.5;
  private focusedCellId: string;
  private overlayOpen = false;
  private destroyed = false;
  private forwardRecords: ForwardRecord[] = [];

  constructor(
    private readonly window: BrowserWindow,
    private readonly store: BrowserStore,
  ) {
    this.layoutMode = this.getStoredLayoutMode();
    this.cellUrls = this.getStoredCellUrls();
    this.cellModes = this.getStoredCellModes();
    this.searchUrlTemplates = this.getStoredSearchUrlTemplates();
    this.activeCells = this.getStoredActiveCells();
    this.mutedCells = this.getStoredMutedCells();
    this.tabs = this.getStoredTabs();
    this.activeTabIds = this.getStoredActiveTabIds();
    this.themeMode = this.getStoredThemeMode();
    nativeTheme.themeSource = this.themeMode;
    this.cellStates = this.createCellStates();
    this.focusedCellId = this.getStoredFocusedCellId();
    this.bindShortcutEvents(this.window.webContents);
    this.registerLegacySitePartitions();
  }

  createInitialView(): void {
    if (this.isDestroyed()) {
      return;
    }

    this.setLayout(this.layoutMode);
  }

  layout(): void {
    if (this.isDestroyed()) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    const cells = LAYOUT_CELLS[this.layoutMode];
    const contentHeight = Math.max(
      0,
      height - TOOLBAR_HEIGHT - (this.layoutMode === 'single' ? 0 : BOTTOM_INPUT_HEIGHT),
    );
    const boundsByCell = this.getBoundsByCell(width, contentHeight);

    CELL_IDS.forEach((cellId) => {
      const view = this.views.get(cellId);
      if (!view) {
        return;
      }

      if (view.webContents.isDestroyed()) {
        return;
      }

      if (this.overlayOpen || !cells.includes(cellId)) {
        safeSetBounds(view, { x: -10000, y: -10000, width: 0, height: 0 });
        return;
      }

      safeSetBounds(
        view,
        insetBoundsWithHeader(boundsByCell[cellId], cellId === this.focusedCellId ? FOCUSED_CELL_BORDER_SIZE : CELL_BORDER_SIZE),
      );
    });
  }

  setLayout(mode: LayoutMode, fillDefaults = true): void {
    if (this.isDestroyed()) {
      return;
    }

    this.layoutMode = mode;
    this.store.set('browser.layout', mode);
    this.sendToRenderer(IPC.LAYOUT_CHANGED, { layoutMode: mode });
    const visibleCells = LAYOUT_CELLS[mode];

    if (fillDefaults) {
      this.fillDefaultUrlsForVisibleCells(visibleCells);
    }

    visibleCells.forEach((cellId) => {
      const view = this.ensureView(cellId);
      if (!this.attachedViews.has(cellId)) {
        this.addChildView(view);
        this.attachedViews.add(cellId);
      }
    });

    this.attachedViews.forEach((cellId) => {
      const view = this.views.get(cellId);
      if (view && !visibleCells.includes(cellId)) {
        this.removeChildView(view);
        this.attachedViews.delete(cellId);
      }
    });

    this.layout();
  }

  setSplitRatios(payload: SplitRatiosPayload): void {
    if (this.isDestroyed()) {
      return;
    }

    if (typeof payload.horizontalRatio === 'number') {
      this.horizontalRatio = clampRatio(payload.horizontalRatio);
    }

    if (typeof payload.verticalRatio === 'number') {
      this.verticalRatio = clampRatio(payload.verticalRatio);
    }

    this.layout();
  }

  setOverlayOpen(open: boolean): void {
    if (this.isDestroyed()) {
      return;
    }

    this.overlayOpen = open;
    this.layout();
  }

  setCellUrl(cellId: string, rawUrl: string, mode?: CellMode, searchUrlTemplate?: string): void {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return;
    }

    const url = normalizeUrl(rawUrl);
    this.rememberCurrentSitePartition(cellId);
    this.cellUrls[cellId] = url;
    this.store.set(`cells.${cellId}.url`, url);
    this.updateActiveTab(cellId, { url });
    this.setCellMode(cellId, mode ?? inferCellMode(url));
    this.setSearchUrlTemplate(cellId, searchUrlTemplate ?? inferSearchUrlTemplate(url, this.cellModes[cellId]));
    if (!url) {
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.active`, false);
    }
    this.syncCellState(cellId);
    this.loadCellUrl(cellId, url);
    this.layout();
  }

  toggleCell(cellId: string, active: boolean): void {
    if (!this.isDestroyed() && isKnownCellId(cellId)) {
      this.activeCells[cellId] = active;
      this.store.set(`cells.${cellId}.active`, active);
      this.syncCellState(cellId);
    }
  }

  focusCell(cellId: string): void {
    if (!this.isDestroyed() && isKnownCellId(cellId)) {
      this.focusedCellId = cellId;
      this.store.set('browser.focusedCellId', cellId);
      this.sendToRenderer(IPC.CELL_FOCUSED, { cellId });
      this.layout();
    }
  }

  navigate(cellId: string, rawUrl: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const url = normalizeUrl(rawUrl);
    this.rememberCurrentSitePartition(cellId);
    this.cellUrls[cellId] = url;
    this.store.set(`cells.${cellId}.url`, url);
    this.updateActiveTab(cellId, { url });
    this.updateKnownSiteMetadata(cellId, url);
    if (!url) {
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.active`, false);
    }
    this.syncCellState(cellId);
    this.loadCellUrl(cellId, url);
    this.layout();
    return this.getBrowserState();
  }

  navigateBack(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed() && view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  }

  navigateForward(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed() && view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  }

  reload(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  }

  setThemeMode(mode: ThemeMode): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    this.themeMode = mode;
    this.store.set('browser.themeMode', mode);
    nativeTheme.themeSource = mode;
    return this.getBrowserState();
  }

  toggleMute(cellId: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const muted = !this.mutedCells[cellId];
    this.mutedCells[cellId] = muted;
    this.store.set(`cells.${cellId}.muted`, muted);
    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(muted);
    }
    return this.getBrowserState();
  }

  newTab(cellId: string, rawUrl?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const url = normalizeUrl(rawUrl ?? '');
    const tab = createTab(url, 'New tab');
    this.tabs[cellId] = [...(this.tabs[cellId] ?? []), tab];
    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    this.navigate(cellId, url);
    return this.getBrowserState();
  }

  closeTab(cellId: string, tabId?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const tabs = this.tabs[cellId] ?? [];
    const targetTabId = tabId ?? this.activeTabIds[cellId];
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
    if (targetIndex === -1) {
      return this.getBrowserState();
    }

    const nextTabs = tabs.filter((tab) => tab.id !== targetTabId);
    if (!nextTabs.length) {
      nextTabs.push(createTab('', 'New tab'));
    }

    this.tabs[cellId] = nextTabs;
    if (this.activeTabIds[cellId] === targetTabId) {
      const nextTab = nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0];
      this.activeTabIds[cellId] = nextTab.id;
      this.navigate(cellId, nextTab.url);
    }
    this.storeTabs(cellId);
    return this.getBrowserState();
  }

  switchTab(cellId: string, tabId?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId) || !tabId) {
      return this.getBrowserState();
    }

    const tab = this.tabs[cellId]?.find((candidate) => candidate.id === tabId);
    if (!tab) {
      return this.getBrowserState();
    }

    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    this.navigate(cellId, tab.url);
    return this.getBrowserState();
  }

  async sendToAll(text: string): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }

    const visibleCells = new Set(LAYOUT_CELLS[this.layoutMode]);
    const activeCells = [...this.cellStates.entries()].filter(
      ([cellId, state]) => visibleCells.has(cellId) && state.active && state.url,
    );

    for (const [cellId, state] of activeCells) {
      if (this.isDestroyed()) {
        return;
      }

      if (state.mode === 'search') {
        const searchUrl = buildSearchUrl(this.getSearchUrlTemplate(cellId), trimmedText);
        if (searchUrl) {
          this.navigate(cellId, searchUrl);
        }
      } else {
        await this.injectText(cellId, trimmedText);
      }
      await delay(150);
    }
  }

  async injectText(cellId: string, text: string): Promise<boolean> {
    if (this.isDestroyed()) {
      return false;
    }

    const url = this.cellUrls[cellId]?.trim();
    if (!url) {
      return false;
    }

    const adapter = getAdapterForUrl(url);
    if (!adapter) {
      this.showCellNotice(cellId, 'inject-failed');
      return false;
    }

    const result = await this.injectScript(cellId, adapter.injectScript(text));
    return result === true;
  }

  async forwardResponse(payload: ForwardResponsePayload): Promise<ForwardRecord> {
    if (this.isDestroyed()) {
      throw new Error('Window has been destroyed.');
    }

    const { sourceCellId, targetCellId } = payload;
    if (!isKnownCellId(sourceCellId) || !isKnownCellId(targetCellId)) {
      throw new Error('Unknown source or target cell.');
    }
    if (sourceCellId === targetCellId) {
      throw new Error('Source and target cells must be different.');
    }

    await this.waitForResponseComplete(sourceCellId);
    const sourceContent = await this.extractLatestResponse(sourceCellId);
    if (!sourceContent) {
      throw new Error(`No readable source response in ${sourceCellId}.`);
    }

    const targetReply = await this.crossValidateCells(sourceCellId, targetCellId, sourceContent);
    const record: ForwardRecord = {
      id: createRecordId(),
      sourceCellId,
      targetCellId,
      sourceContent,
      targetReply,
      timestamp: Date.now(),
    };
    this.forwardRecords.push(record);
    this.sendToRenderer(IPC.FORWARD_COMPLETED, { record });
    return record;
  }

  private async crossValidateCells(sourceCellId: string, targetCellId: string, sourceResponse: string): Promise<string> {
    await Promise.all([
      this.waitForResponseComplete(sourceCellId),
      this.waitForResponseComplete(targetCellId),
    ]);

    const previousTargetResponse = await this.extractLatestResponse(targetCellId);
    const targetPrompt = `这是另一个 AI 的观点：${sourceResponse}---你怎么看，有没有需要补充或反驳的地方`;
    const injected = await this.injectText(targetCellId, targetPrompt);
    if (!injected) {
      throw new Error(`Unable to inject cross-validation prompt into ${targetCellId}.`);
    }

    const targetResponse = await this.waitForNextResponse(targetCellId, previousTargetResponse);
    return targetResponse;
  }

  async extractLatestResponse(cellId: string): Promise<string | null> {
    if (this.isDestroyed()) {
      return null;
    }

    const adapter = this.getReadableAdapter(cellId);
    const result = await this.executeCellScript(cellId, adapter.extractLatestResponse());
    return typeof result === 'string' && result.trim() ? result.trim() : null;
  }

  async isResponseComplete(cellId: string): Promise<boolean> {
    if (this.isDestroyed()) {
      return false;
    }

    const adapter = this.getReadableAdapter(cellId);
    const result = await this.executeCellScript(cellId, adapter.isResponseComplete());
    return result === true;
  }

  async waitForResponseComplete(cellId: string, timeoutMs = RESPONSE_WAIT_TIMEOUT_MS): Promise<void> {
    const startedAt = Date.now();
    let completeChecks = 0;

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${cellId} response completion.`);
      }

      if (await this.isResponseComplete(cellId)) {
        completeChecks += 1;
        if (completeChecks >= 2) {
          return;
        }
      } else {
        completeChecks = 0;
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }
  }

  async waitForCellReady(cellId: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    const startedAt = Date.now();

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${cellId} input readiness.`);
      }

      const url = this.cellUrls[cellId]?.trim();
      const adapter = url ? getAdapterForUrl(url) : null;
      if (adapter?.readyCheckScript) {
        try {
          const ready = await this.executeCellScript(cellId, adapter.readyCheckScript);
          if (ready === true) {
            return;
          }
        } catch {
          // The page may still be navigating; keep polling until the timeout.
        }
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }

    throw new Error(`Window closed while waiting for ${cellId} readiness.`);
  }

  async waitForNextResponse(
    cellId: string,
    previousResponse: string | null,
    timeoutMs = RESPONSE_WAIT_TIMEOUT_MS,
  ): Promise<string> {
    const startedAt = Date.now();
    let sawGeneration = false;
    let latestResponse: string | null = null;
    let stableChecks = 0;

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for next response in ${cellId}.`);
      }

      const complete = await this.isResponseComplete(cellId);
      if (!complete) {
        sawGeneration = true;
        stableChecks = 0;
      }

      const response = await this.extractLatestResponse(cellId);
      const hasNewResponse = Boolean(response && response !== previousResponse);
      if (complete && hasNewResponse && (sawGeneration || Date.now() - startedAt > RESPONSE_POLL_INTERVAL_MS * 2)) {
        if (response === latestResponse) {
          stableChecks += 1;
        } else {
          latestResponse = response;
          stableChecks = 1;
        }

        if (stableChecks >= 2 && latestResponse) {
          return latestResponse;
        }
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }

    throw new Error(`Window closed while waiting for next response in ${cellId}.`);
  }

  async injectScript(cellId: string, script: string): Promise<unknown> {
    if (this.isDestroyed()) {
      return false;
    }

    const view = this.views.get(cellId);
    if (!view || view.webContents.isDestroyed()) {
      return false;
    }

    try {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return false;
      }
      const result = await view.webContents.executeJavaScript(script);
      if (result === false) {
        this.showCellNotice(cellId, 'inject-failed');
      }
      return result;
    } catch {
      this.showCellNotice(cellId, 'inject-failed');
      return false;
    }
  }

  private getReadableAdapter(cellId: string): {
    extractLatestResponse: () => string;
    isResponseComplete: () => string;
  } {
    if (!isKnownCellId(cellId)) {
      throw new Error(`Unknown cell: ${cellId}.`);
    }

    const url = this.cellUrls[cellId]?.trim();
    if (!url) {
      throw new Error(`No URL configured for ${cellId}.`);
    }

    const adapter = getAdapterForUrl(url);
    if (!adapter?.extractLatestResponse || !adapter.isResponseComplete) {
      throw new Error(`No readable adapter for ${cellId}: ${url}.`);
    }

    return {
      extractLatestResponse: adapter.extractLatestResponse,
      isResponseComplete: adapter.isResponseComplete,
    };
  }

  private async executeCellScript(cellId: string, script: string): Promise<unknown> {
    if (this.isDestroyed()) {
      return null;
    }

    const view = this.views.get(cellId);
    if (!view || view.webContents.isDestroyed()) {
      throw new Error(`No active view for ${cellId}.`);
    }

    return view.webContents.executeJavaScript(script);
  }

  getBrowserState(): BrowserState {
    return {
      layoutMode: this.layoutMode,
      cellUrls: { ...this.cellUrls },
      cellModes: { ...this.cellModes },
      searchUrlTemplates: { ...this.searchUrlTemplates },
      activeCells: { ...this.activeCells },
      mutedCells: { ...this.mutedCells },
      tabs: cloneTabs(this.tabs),
      activeTabIds: { ...this.activeTabIds },
      themeMode: this.themeMode,
      focusedCellId: this.focusedCellId,
      hasCompletedOnboarding: Boolean(this.store.get('browser.hasCompletedOnboarding', false)),
    };
  }

  applyTemplate(payload: ApplyTemplatePayload): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    const { template } = payload;
    this.store.set('browser.hasCompletedOnboarding', true);

    template.siteIds.forEach((siteId, index) => {
      const cellId = CELL_IDS[index];
      const site = PRESET_SITES.find((presetSite) => presetSite.id === siteId);
      if (!cellId || !site) {
        return;
      }

      this.cellUrls[cellId] = site.url;
      this.cellModes[cellId] = site.mode;
      this.searchUrlTemplates[cellId] = site.searchUrlTemplate ?? '';
      this.store.set(`cells.${cellId}.url`, site.url);
      this.store.set(`cells.${cellId}.mode`, site.mode);
      this.store.set(`cells.${cellId}.searchUrlTemplate`, site.searchUrlTemplate ?? '');
      this.store.set(`cells.${cellId}.active`, true);
      this.activeCells[cellId] = true;
      this.syncCellState(cellId);
    });

    LAYOUT_CELLS[template.layout].slice(template.siteIds.length).forEach((cellId) => {
      this.cellUrls[cellId] = '';
      this.cellModes[cellId] = 'chat';
      this.searchUrlTemplates[cellId] = '';
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.url`, '');
      this.store.set(`cells.${cellId}.mode`, 'chat');
      this.store.set(`cells.${cellId}.searchUrlTemplate`, '');
      this.store.set(`cells.${cellId}.active`, false);
      this.syncCellState(cellId);
    });

    this.focusCell('cell-0');
    this.setLayout(template.layout, false);
    LAYOUT_CELLS[template.layout].forEach((cellId) => {
      const url = this.cellUrls[cellId];
      if (url) {
        this.loadCellUrl(cellId, url);
      }
    });

    return this.getBrowserState();
  }

  dispose(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.loadTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.loadTimeouts.clear();

    this.views.forEach((view) => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.removeAllListeners();
      }
    });
  }

  private ensureView(cellId: string): WebContentsView {
    if (this.isDestroyed()) {
      throw new Error('WindowManager has been destroyed');
    }

    const partition = this.getPartitionForUrl(this.cellUrls[cellId], cellId);
    const existingView = this.views.get(cellId);
    if (existingView) {
      if (this.viewPartitions.get(cellId) !== partition) {
        return this.replaceView(cellId, partition);
      }

      return existingView;
    }

    return this.createView(cellId, partition);
  }

  private createView(cellId: string, partition: string): WebContentsView {
    if (this.isDestroyed()) {
      throw new Error('WindowManager has been destroyed');
    }

    this.rememberSitePartition(this.cellUrls[cellId], partition);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition,
      },
    });

    if (!view.webContents.isDestroyed()) {
      view.webContents.setUserAgent(CHROME_USER_AGENT);
      view.webContents.setAudioMuted(Boolean(this.mutedCells[cellId]));
    }
    this.bindViewEvents(cellId, view);
    this.views.set(cellId, view);
    this.viewPartitions.set(cellId, partition);
    this.loadViewUrl(view, this.getLoadUrl(this.cellUrls[cellId]));
    return view;
  }

  private replaceView(cellId: string, partition: string): WebContentsView {
    const existingView = this.views.get(cellId);
    const wasAttached = this.attachedViews.has(cellId);

    if (existingView) {
      this.clearLoadTimeout(cellId);
      if (wasAttached) {
        this.removeChildView(existingView);
        this.attachedViews.delete(cellId);
      }

      if (!existingView.webContents.isDestroyed()) {
        existingView.webContents.removeAllListeners();
        existingView.webContents.close({ waitForBeforeUnload: false });
      }
      this.views.delete(cellId);
      this.viewPartitions.delete(cellId);
    }

    const view = this.createView(cellId, partition);
    if (wasAttached) {
      this.addChildView(view);
      this.attachedViews.add(cellId);
    }

    return view;
  }

  private loadCellUrl(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.ensureView(cellId);
    this.loadViewUrl(view, this.getLoadUrl(url));
  }

  private fillDefaultUrlsForVisibleCells(cellIds: string[]): void {
    cellIds.forEach((cellId) => {
      if (this.cellUrls[cellId]?.trim()) {
        return;
      }

      const defaultUrl = DEFAULT_URLS[cellId];
      if (!defaultUrl) {
        return;
      }

      this.cellUrls[cellId] = defaultUrl;
      this.store.set(`cells.${cellId}.url`, defaultUrl);
      this.setCellMode(cellId, inferCellMode(defaultUrl));
      this.setSearchUrlTemplate(cellId, inferSearchUrlTemplate(defaultUrl, this.cellModes[cellId]));
      this.syncCellState(cellId);
    });
  }

  private setCellMode(cellId: string, mode: CellMode): void {
    this.cellModes[cellId] = mode;
    this.store.set(`cells.${cellId}.mode`, mode);
    this.syncCellState(cellId);
  }

  private setSearchUrlTemplate(cellId: string, template: string): void {
    this.searchUrlTemplates[cellId] = template;
    this.store.set(`cells.${cellId}.searchUrlTemplate`, template);
  }

  private getSearchUrlTemplate(cellId: string): string {
    return this.searchUrlTemplates[cellId] || inferSearchUrlTemplate(this.cellUrls[cellId], this.cellModes[cellId]);
  }

  private updateKnownSiteMetadata(cellId: string, url: string): void {
    const site = findPresetSiteByUrl(url);
    if (!site) {
      return;
    }

    const searchUrlTemplate = site.searchUrlTemplate ?? inferSearchUrlTemplate(url, site.mode);
    this.cellModes[cellId] = site.mode;
    this.searchUrlTemplates[cellId] = searchUrlTemplate;
    this.store.set(`cells.${cellId}.mode`, site.mode);
    this.store.set(`cells.${cellId}.searchUrlTemplate`, searchUrlTemplate);
  }

  private createCellStates(): Map<string, CellState> {
    return new Map(
      CELL_IDS.map((cellId) => [
        cellId,
        {
          url: this.cellUrls[cellId] ?? '',
          active: Boolean(this.activeCells[cellId] && this.cellUrls[cellId]?.trim()),
          mode: this.cellModes[cellId] ?? 'chat',
        },
      ]),
    );
  }

  private syncCellState(cellId: string): void {
    if (!isKnownCellId(cellId)) {
      return;
    }

    this.cellStates.set(cellId, {
      url: this.cellUrls[cellId] ?? '',
      active: Boolean(this.activeCells[cellId] && this.cellUrls[cellId]?.trim()),
      mode: this.cellModes[cellId] ?? 'chat',
    });
  }

  private registerLegacySitePartitions(): void {
    CELL_IDS.forEach((cellId) => {
      const url = this.cellUrls[cellId];
      if (url) {
        this.rememberSitePartition(url, `persist:${cellId}`);
      }
    });
  }

  private rememberCurrentSitePartition(cellId: string): void {
    const currentUrl = this.cellUrls[cellId];
    const currentPartition = this.viewPartitions.get(cellId) ?? `persist:${cellId}`;
    this.rememberSitePartition(currentUrl, currentPartition);
  }

  private rememberSitePartition(url: string, partition: string): void {
    const siteKey = getSiteKey(url);
    if (!siteKey || this.getStoredSitePartition(siteKey)) {
      return;
    }

    this.store.set(getSitePartitionStoreKey(siteKey), partition);
  }

  private getPartitionForUrl(url: string, fallbackCellId: string): string {
    const siteKey = getSiteKey(url);
    if (!siteKey) {
      return `persist:${fallbackCellId}`;
    }

    const storedPartition = this.getStoredSitePartition(siteKey);
    if (storedPartition) {
      return storedPartition;
    }

    const partition = `persist:site-${siteKey}`;
    this.store.set(getSitePartitionStoreKey(siteKey), partition);
    return partition;
  }

  private getStoredSitePartition(siteKey: string): string | null {
    const storedPartition = this.store.get(getSitePartitionStoreKey(siteKey));
    return typeof storedPartition === 'string' && storedPartition.startsWith('persist:')
      ? storedPartition
      : null;
  }

  private getPersistedUrlAfterLoad(cellId: string, loadedUrl: string): string {
    if (isClaudeAiUrl(this.cellUrls[cellId]) && isClaudeComUrl(loadedUrl)) {
      return 'https://claude.ai/';
    }

    return loadedUrl;
  }

  private bindViewEvents(cellId: string, view: WebContentsView): void {
    this.bindShortcutEvents(view.webContents);
    view.webContents.on('focus', () => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.focusCell(cellId);
    });
    view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      if (!isInPlace && isMainFrame && !isEmptyStateUrl(url)) {
        this.startLoadTimeout(cellId, url);
      }
    });
    view.webContents.on('did-navigate', (_event, url) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      const publicUrl = this.toPublicUrl(url);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
    });
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      const publicUrl = this.toPublicUrl(url);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
    });
    view.webContents.on('page-title-updated', (_event, title) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.updateActiveTab(cellId, { title });
      this.sendToRenderer(IPC.CELL_TITLE_CHANGED, { cellId, title });
    });
    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      const favicon = favicons[0];
      if (favicon) {
        this.updateActiveTab(cellId, { favicon });
        this.sendToRenderer(IPC.CELL_FAVICON_CHANGED, { cellId, favicon });
      }
    });
    view.webContents.on('did-finish-load', () => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.clearLoadTimeout(cellId);
      const publicUrl = this.toPublicUrl(view.webContents.getURL());
      const persistedUrl = this.getPersistedUrlAfterLoad(cellId, publicUrl);
      this.cellUrls[cellId] = persistedUrl;
      this.store.set(`cells.${cellId}.url`, persistedUrl);
      this.updateKnownSiteMetadata(cellId, publicUrl);
      this.updateActiveTab(cellId, {
        url: persistedUrl,
        title: publicUrl ? view.webContents.getTitle() || safeTabTitle(publicUrl) : 'New tab',
      });
      this.syncCellState(cellId);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
      this.sendToRenderer(IPC.CELL_TITLE_CHANGED, {
        cellId,
        title: publicUrl ? view.webContents.getTitle() : 'New tab',
      });
    });
    view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.clearLoadTimeout(cellId);
      if (isMainFrame && errorCode !== -3 && validatedURL !== BLANK_URL && !isEmptyStateUrl(validatedURL)) {
        this.showCellNotice(cellId, 'load-failed');
      }
    });
    view.webContents.on('destroyed', () => {
      this.clearLoadTimeout(cellId);
    });
  }

  private getBoundsByCell(width: number, contentHeight: number): Record<string, Electron.Rectangle> {
    const y = TOOLBAR_HEIGHT;

    if (this.layoutMode === 'single') {
      return {
        'cell-0': { x: 0, y, width, height: contentHeight },
        'cell-1': { x: 0, y, width: 0, height: 0 },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'horizontal') {
      const leftWidth = splitSize(width, this.horizontalRatio);
      return {
        'cell-0': { x: 0, y, width: leftWidth, height: contentHeight },
        'cell-1': {
          x: leftWidth + SPLITTER_SIZE,
          y,
          width: Math.max(0, width - leftWidth - SPLITTER_SIZE),
          height: contentHeight,
        },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'vertical') {
      const topHeight = splitSize(contentHeight, this.verticalRatio);
      return {
        'cell-0': { x: 0, y, width, height: topHeight },
        'cell-1': {
          x: 0,
          y: y + topHeight + SPLITTER_SIZE,
          width,
          height: Math.max(0, contentHeight - topHeight - SPLITTER_SIZE),
        },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'triple') {
      const leftWidth = splitSize(width, this.horizontalRatio);
      const rightWidth = Math.max(0, width - leftWidth - SPLITTER_SIZE);
      const topHeight = splitSize(contentHeight, this.verticalRatio);

      return {
        'cell-0': { x: 0, y, width: leftWidth, height: contentHeight },
        'cell-1': { x: leftWidth + SPLITTER_SIZE, y, width: rightWidth, height: topHeight },
        'cell-2': {
          x: leftWidth + SPLITTER_SIZE,
          y: y + topHeight + SPLITTER_SIZE,
          width: rightWidth,
          height: Math.max(0, contentHeight - topHeight - SPLITTER_SIZE),
        },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    const leftWidth = splitSize(width, this.horizontalRatio);
    const rightWidth = Math.max(0, width - leftWidth - SPLITTER_SIZE);
    const topHeight = splitSize(contentHeight, this.verticalRatio);
    const bottomHeight = Math.max(0, contentHeight - topHeight - SPLITTER_SIZE);

    return {
      'cell-0': { x: 0, y, width: leftWidth, height: topHeight },
      'cell-1': { x: leftWidth + SPLITTER_SIZE, y, width: rightWidth, height: topHeight },
      'cell-2': { x: 0, y: y + topHeight + SPLITTER_SIZE, width: leftWidth, height: bottomHeight },
      'cell-3': {
        x: leftWidth + SPLITTER_SIZE,
        y: y + topHeight + SPLITTER_SIZE,
        width: rightWidth,
        height: bottomHeight,
      },
    };
  }

  private startLoadTimeout(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    this.clearLoadTimeout(cellId);
    if (!url || url === BLANK_URL) {
      return;
    }

    const timeout = setTimeout(() => {
      if (this.isDestroyed()) {
        return;
      }

      const view = this.views.get(cellId);
      if (!view || view.webContents.isDestroyed()) {
        return;
      }

      const currentUrl = view.webContents.getURL();
      if (currentUrl && currentUrl !== BLANK_URL && view.webContents.isLoading()) {
        this.showCellNotice(cellId, 'load-timeout');
      }
      this.loadTimeouts.delete(cellId);
    }, LOAD_TIMEOUT_MS);

    this.loadTimeouts.set(cellId, timeout);
  }

  private clearLoadTimeout(cellId: string): void {
    const timeout = this.loadTimeouts.get(cellId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.loadTimeouts.delete(cellId);
  }

  private sendUrl(cellId: string, url: string): void {
    this.sendToRenderer(IPC.CELL_URL_CHANGED, { cellId, url });
  }

  private checkNavigationNotice(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    if (url.includes('signin/rejected')) {
      this.showCellNotice(cellId, 'google-login-blocked');
    }
  }

  private showCellNotice(cellId: string, type: NoticeType): void {
    if (this.isDestroyed()) {
      return;
    }

    const payload = {
      cellId,
      type,
      message: NOTICE_MESSAGES[type],
    };

    this.sendToRenderer(IPC.SHOW_CELL_NOTICE, payload);
    setTimeout(() => {
      if (!this.isDestroyed()) {
        this.sendToRenderer(IPC.SHOW_CELL_NOTICE, payload);
      }
    }, NOTICE_REPLAY_DELAY_MS);
  }

  private getStoredLayoutMode(): LayoutMode {
    const storedLayout = this.store.get('browser.layout', 'single');
    return isLayoutMode(storedLayout) ? storedLayout : 'single';
  }

  private getStoredCellUrls(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((urls, cellId) => {
      urls[cellId] = String(this.store.get(`cells.${cellId}.url`, DEFAULT_URLS[cellId]));
      return urls;
    }, {});
  }

  private getStoredCellModes(): Record<string, CellMode> {
    return CELL_IDS.reduce<Record<string, CellMode>>((modes, cellId) => {
      const storedMode = this.store.get(`cells.${cellId}.mode`);
      modes[cellId] = isCellMode(storedMode) ? storedMode : inferCellMode(this.cellUrls[cellId]);
      return modes;
    }, {});
  }

  private getStoredSearchUrlTemplates(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((templates, cellId) => {
      templates[cellId] = String(
        this.store.get(
          `cells.${cellId}.searchUrlTemplate`,
          inferSearchUrlTemplate(this.cellUrls[cellId], this.cellModes[cellId]),
        ),
      );
      return templates;
    }, {});
  }

  private getStoredActiveCells(): Record<string, boolean> {
    return CELL_IDS.reduce<Record<string, boolean>>((activeCells, cellId) => {
      const hasUrl = Boolean(this.cellUrls[cellId]?.trim());
      activeCells[cellId] = Boolean(this.store.get(`cells.${cellId}.active`, hasUrl));
      return activeCells;
    }, {});
  }

  private getStoredMutedCells(): Record<string, boolean> {
    return CELL_IDS.reduce<Record<string, boolean>>((mutedCells, cellId) => {
      mutedCells[cellId] = Boolean(this.store.get(`cells.${cellId}.muted`, false));
      return mutedCells;
    }, {});
  }

  private getStoredTabs(): Record<string, CellTab[]> {
    return CELL_IDS.reduce<Record<string, CellTab[]>>((tabs, cellId) => {
      const storedTabs = this.store.get(`cells.${cellId}.tabs`);
      tabs[cellId] = isCellTabList(storedTabs)
        ? storedTabs
        : [createTab(this.cellUrls[cellId], safeTabTitle(this.cellUrls[cellId]))];
      return tabs;
    }, {});
  }

  private getStoredActiveTabIds(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((activeTabIds, cellId) => {
      const storedTabId = this.store.get(`cells.${cellId}.activeTabId`);
      const tabs = this.tabs[cellId] ?? [];
      const activeTab = tabs.find((tab) => tab.id === storedTabId) ?? tabs[0];
      activeTabIds[cellId] = activeTab?.id ?? createTab('', 'New tab').id;
      return activeTabIds;
    }, {});
  }

  private getStoredThemeMode(): ThemeMode {
    const storedThemeMode = this.store.get('browser.themeMode', 'system');
    return isThemeMode(storedThemeMode) ? storedThemeMode : 'system';
  }

  private bindShortcutEvents(webContents: WebContents): void {
    webContents.on('before-input-event', (event, input) => {
      const nextLayout = getLayoutShortcut(input);
      if (!nextLayout) {
        return;
      }

      event.preventDefault();
      this.setLayout(nextLayout);
    });
  }

  private updateActiveTab(cellId: string, patch: Partial<Pick<CellTab, 'title' | 'url' | 'favicon'>>): void {
    const tabId = this.activeTabIds[cellId];
    const tabs = this.tabs[cellId];
    if (!tabId || !tabs) {
      return;
    }

    this.tabs[cellId] = tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
    this.storeTabs(cellId);
  }

  private storeTabs(cellId: string): void {
    this.store.set(`cells.${cellId}.tabs`, this.tabs[cellId] ?? []);
    this.store.set(`cells.${cellId}.activeTabId`, this.activeTabIds[cellId] ?? '');
  }

  private getStoredFocusedCellId(): string {
    const storedCellId = this.store.get('browser.focusedCellId', 'cell-0');
    return typeof storedCellId === 'string' && isKnownCellId(storedCellId) ? storedCellId : 'cell-0';
  }

  private isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed();
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    if (this.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send(channel, payload);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private addChildView(view: WebContentsView): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    try {
      this.window.contentView.addChildView(view);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private removeChildView(view: WebContentsView): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    try {
      this.window.contentView.removeChildView(view);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private loadViewUrl(view: WebContentsView, url: string): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    void view.webContents.loadURL(url).catch((error) => {
      if (!this.isDestroyed() && !isDestroyedObjectError(error)) {
        console.error('Failed to load URL:', error);
      }
    });
  }

  private getLoadUrl(url: string): string {
    return url || EMPTY_STATE_URL;
  }

  private toPublicUrl(url: string): string {
    return isEmptyStateUrl(url) || url === BLANK_URL ? '' : url;
  }
}

function splitSize(total: number, ratio: number): number {
  if (total <= SPLITTER_SIZE) {
    return 0;
  }

  return Math.round((total - SPLITTER_SIZE) * clampRatio(ratio));
}

function clampRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function insetBounds(bounds: Electron.Rectangle, inset: number): Electron.Rectangle {
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(0, bounds.width - inset * 2),
    height: Math.max(0, bounds.height - inset * 2),
  };
}

function insetBoundsWithHeader(bounds: Electron.Rectangle, inset: number): Electron.Rectangle {
  const contentBounds = insetBounds(bounds, inset);
  return {
    ...contentBounds,
    y: contentBounds.y + CELL_HEADER_HEIGHT,
    height: Math.max(0, contentBounds.height - CELL_HEADER_HEIGHT),
  };
}

function isKnownCellId(cellId: string): boolean {
  return CELL_IDS.includes(cellId as (typeof CELL_IDS)[number]);
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && value in LAYOUT_CELLS;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isCellTabList(value: unknown): value is CellTab[] {
  return Array.isArray(value)
    && value.every((tab) => (
      tab
      && typeof tab === 'object'
      && typeof (tab as CellTab).id === 'string'
      && typeof (tab as CellTab).title === 'string'
      && typeof (tab as CellTab).url === 'string'
      && (typeof (tab as CellTab).favicon === 'undefined' || typeof (tab as CellTab).favicon === 'string')
    ));
}

function createTab(url: string, title?: string): CellTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || safeTabTitle(url),
    url,
  };
}

function cloneTabs(tabs: Record<string, CellTab[]>): Record<string, CellTab[]> {
  return CELL_IDS.reduce<Record<string, CellTab[]>>((clonedTabs, cellId) => {
    clonedTabs[cellId] = [...(tabs[cellId] ?? [])];
    return clonedTabs;
  }, {});
}

function safeTabTitle(url: string): string {
  if (!url || url === 'about:blank' || isEmptyStateUrl(url)) {
    return 'New tab';
  }

  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function getLayoutShortcut(input: Electron.Input): LayoutMode | null {
  if (!(input.meta || input.control) || input.alt || input.shift) {
    return null;
  }

  const key = input.key.toLowerCase();
  if (key === '1') return 'single';
  if (key === '2') return 'horizontal';
  if (key === '3') return 'triple';
  if (key === '4') return 'quad';
  return null;
}

function isCellMode(value: unknown): value is CellMode {
  return value === 'chat' || value === 'search';
}

function inferCellMode(rawUrl: string): CellMode {
  const inferredMode = inferModeFromUrl(rawUrl);
  return inferredMode === 'unknown' ? 'chat' : inferredMode;
}

function inferSearchUrlTemplate(rawUrl: string, mode: CellMode): string {
  const presetTemplate = findPresetSiteByUrl(rawUrl)?.searchUrlTemplate;
  if (presetTemplate) {
    return presetTemplate;
  }

  if (mode !== 'search') {
    return '';
  }

  const url = parseUrl(rawUrl);
  if (!url) {
    return '';
  }

  const queryParam = url.hostname.includes('baidu.') || url.hostname.includes('sogou.') ? 'wd' : 'q';
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}?${queryParam}={query}`;
}

function buildSearchUrl(template: string, query: string): string {
  return template ? template.replace('{query}', encodeURIComponent(query)) : '';
}

function getSiteKey(rawUrl: string): string | null {
  const url = parseUrl(rawUrl);
  if (!url) {
    return null;
  }

  const presetSite = PRESET_SITES.find((site) => {
    const presetUrl = parseUrl(site.url);
    return presetUrl && normalizeHost(presetUrl.hostname) === normalizeHost(url.hostname);
  });

  return sanitizePartitionSegment(presetSite?.id ?? url.hostname);
}

function getSitePartitionStoreKey(siteKey: string): string {
  return `browser.sessions.${siteKey}.partition`;
}

function parseUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === BLANK_URL || isEmptyStateUrl(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(normalizeUrl(trimmed));
    } catch {
      return null;
    }
  }
}

function isEmptyStateUrl(url: string): boolean {
  return url === EMPTY_STATE_URL || url.startsWith('data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%20lang%3D%22zh-CN%22%3E');
}

function createEmptyStateUrl(): string {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>New tab</title><style>
body{margin:0;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#111827;display:grid;place-items:center;height:100vh}
main{width:min(560px,calc(100vw - 48px));text-align:center}
h1{margin:0 0 10px;font-size:24px}
p{margin:0 0 22px;color:#64748b}
.links{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
a{display:block;border:1px solid rgba(15,23,42,.12);border-radius:8px;padding:12px;background:#fff;color:#1d4ed8;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#0f172a;color:#f8fafc}p{color:#94a3b8}a{background:#111827;border-color:rgba(255,255,255,.14);color:#93c5fd}}
</style></head><body><main><h1>新标签页</h1><p>在地址栏输入网址或搜索内容，或选择常用站点开始。</p><div class="links">
<a href="https://claude.ai">Claude</a><a href="https://chatgpt.com">ChatGPT</a><a href="https://chat.deepseek.com">DeepSeek</a><a href="https://www.doubao.com">豆包</a>
</div></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isClaudeAiUrl(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return normalizeHost(url?.hostname ?? '') === 'claude.ai';
}

function isClaudeComUrl(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return normalizeHost(url?.hostname ?? '') === 'claude.com';
}

function createRecordId(): string {
  return `forward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizePartitionSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function safeSetBounds(view: WebContentsView, bounds: Electron.Rectangle): void {
  if (view.webContents.isDestroyed()) {
    return;
  }

  try {
    view.setBounds(bounds);
  } catch (error) {
    if (!isDestroyedObjectError(error)) {
      throw error;
    }
  }
}

function isDestroyedObjectError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Object has been destroyed');
}
