import { BrowserWindow, WebContents, WebContentsView, nativeTheme } from 'electron';
import { NOTICE_MESSAGES } from '../shared/notices';
import { PRESET_SITES } from '../shared/presetSites';
import {
  ApplyTemplatePayload,
  BrowserState,
  CELL_IDS,
  CellTab,
  CellMode,
  DEFAULT_URLS,
  IPC,
  LAYOUT_CELLS,
  LayoutMode,
  NoticeType,
  SplitRatiosPayload,
  ThemeMode,
} from '../shared/types';
import { getAdapterForUrl } from './adapters';

const TOOLBAR_HEIGHT = 52;
const BOTTOM_INPUT_HEIGHT = 80;
const CELL_BORDER_SIZE = 1;
const FOCUSED_CELL_BORDER_SIZE = 2;
const SPLITTER_SIZE = 4;
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BLANK_URL = 'about:blank';

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
    this.setLayout(this.layoutMode);
  }

  layout(): void {
    if (this.window.isDestroyed()) {
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

      if (this.overlayOpen || !cells.includes(cellId)) {
        view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });
        return;
      }

      view.setBounds(insetBounds(boundsByCell[cellId], cellId === this.focusedCellId ? FOCUSED_CELL_BORDER_SIZE : CELL_BORDER_SIZE));
    });
  }

  setLayout(mode: LayoutMode, fillDefaults = true): void {
    this.layoutMode = mode;
    this.store.set('browser.layout', mode);
    this.window.webContents.send(IPC.LAYOUT_CHANGED, { layoutMode: mode });
    const visibleCells = LAYOUT_CELLS[mode];

    if (fillDefaults) {
      this.fillDefaultUrlsForVisibleCells(visibleCells);
    }

    visibleCells.forEach((cellId) => {
      const view = this.ensureView(cellId);
      if (!this.attachedViews.has(cellId)) {
        this.window.contentView.addChildView(view);
        this.attachedViews.add(cellId);
      }
    });

    this.attachedViews.forEach((cellId) => {
      const view = this.views.get(cellId);
      if (view && !visibleCells.includes(cellId)) {
        this.window.contentView.removeChildView(view);
        this.attachedViews.delete(cellId);
      }
    });

    this.layout();
  }

  setSplitRatios(payload: SplitRatiosPayload): void {
    if (typeof payload.horizontalRatio === 'number') {
      this.horizontalRatio = clampRatio(payload.horizontalRatio);
    }

    if (typeof payload.verticalRatio === 'number') {
      this.verticalRatio = clampRatio(payload.verticalRatio);
    }

    this.layout();
  }

  setOverlayOpen(open: boolean): void {
    this.overlayOpen = open;
    this.layout();
  }

  setCellUrl(cellId: string, rawUrl: string, mode?: CellMode, searchUrlTemplate?: string): void {
    if (!isKnownCellId(cellId)) {
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
    if (isKnownCellId(cellId)) {
      this.activeCells[cellId] = active;
      this.store.set(`cells.${cellId}.active`, active);
      this.syncCellState(cellId);
    }
  }

  focusCell(cellId: string): void {
    if (isKnownCellId(cellId)) {
      this.focusedCellId = cellId;
      this.store.set('browser.focusedCellId', cellId);
      this.window.webContents.send(IPC.CELL_FOCUSED, { cellId });
      this.layout();
    }
  }

  navigate(cellId: string, rawUrl: string): void {
    if (!isKnownCellId(cellId)) {
      return;
    }

    const url = normalizeUrl(rawUrl);
    this.rememberCurrentSitePartition(cellId);
    this.cellUrls[cellId] = url;
    this.store.set(`cells.${cellId}.url`, url);
    this.updateActiveTab(cellId, { url });
    if (!url) {
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.active`, false);
    }
    this.syncCellState(cellId);
    this.loadCellUrl(cellId, url);
    this.layout();
  }

  navigateBack(cellId: string): void {
    const view = this.views.get(cellId);
    if (view?.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  }

  navigateForward(cellId: string): void {
    const view = this.views.get(cellId);
    if (view?.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  }

  reload(cellId: string): void {
    this.views.get(cellId)?.webContents.reload();
  }

  setThemeMode(mode: ThemeMode): BrowserState {
    this.themeMode = mode;
    this.store.set('browser.themeMode', mode);
    nativeTheme.themeSource = mode;
    return this.getBrowserState();
  }

  toggleMute(cellId: string): BrowserState {
    if (!isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const muted = !this.mutedCells[cellId];
    this.mutedCells[cellId] = muted;
    this.store.set(`cells.${cellId}.muted`, muted);
    this.views.get(cellId)?.webContents.setAudioMuted(muted);
    return this.getBrowserState();
  }

  newTab(cellId: string, rawUrl?: string): BrowserState {
    if (!isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const url = normalizeUrl(rawUrl ?? '');
    const tab = createTab(url || 'about:blank', 'New tab');
    this.tabs[cellId] = [...(this.tabs[cellId] ?? []), tab];
    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    this.navigate(cellId, url);
    return this.getBrowserState();
  }

  closeTab(cellId: string, tabId?: string): BrowserState {
    if (!isKnownCellId(cellId)) {
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
      nextTabs.push(createTab('about:blank', 'New tab'));
    }

    this.tabs[cellId] = nextTabs;
    if (this.activeTabIds[cellId] === targetTabId) {
      const nextTab = nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0];
      this.activeTabIds[cellId] = nextTab.id;
      this.navigate(cellId, nextTab.url === 'about:blank' ? '' : nextTab.url);
    }
    this.storeTabs(cellId);
    return this.getBrowserState();
  }

  switchTab(cellId: string, tabId?: string): BrowserState {
    if (!isKnownCellId(cellId) || !tabId) {
      return this.getBrowserState();
    }

    const tab = this.tabs[cellId]?.find((candidate) => candidate.id === tabId);
    if (!tab) {
      return this.getBrowserState();
    }

    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    this.navigate(cellId, tab.url === 'about:blank' ? '' : tab.url);
    return this.getBrowserState();
  }

  async sendToAll(text: string): Promise<void> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }

    const visibleCells = new Set(LAYOUT_CELLS[this.layoutMode]);
    const activeCells = [...this.cellStates.entries()].filter(
      ([cellId, state]) => visibleCells.has(cellId) && state.active && state.url,
    );

    for (const [cellId, state] of activeCells) {
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

  async injectScript(cellId: string, script: string): Promise<unknown> {
    const view = this.views.get(cellId);
    if (!view) {
      return false;
    }

    try {
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

  private ensureView(cellId: string): WebContentsView {
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
    this.rememberSitePartition(this.cellUrls[cellId], partition);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition,
      },
    });

    view.webContents.setUserAgent(CHROME_USER_AGENT);
    view.webContents.setAudioMuted(Boolean(this.mutedCells[cellId]));
    this.bindViewEvents(cellId, view);
    this.views.set(cellId, view);
    this.viewPartitions.set(cellId, partition);
    void view.webContents.loadURL(this.cellUrls[cellId] || BLANK_URL);
    return view;
  }

  private replaceView(cellId: string, partition: string): WebContentsView {
    const existingView = this.views.get(cellId);
    const wasAttached = this.attachedViews.has(cellId);

    if (existingView) {
      if (wasAttached) {
        this.window.contentView.removeChildView(existingView);
        this.attachedViews.delete(cellId);
      }

      existingView.webContents.removeAllListeners();
      existingView.webContents.close({ waitForBeforeUnload: false });
      this.views.delete(cellId);
      this.viewPartitions.delete(cellId);
    }

    const view = this.createView(cellId, partition);
    if (wasAttached) {
      this.window.contentView.addChildView(view);
      this.attachedViews.add(cellId);
    }

    return view;
  }

  private loadCellUrl(cellId: string, url: string): void {
    const view = this.ensureView(cellId);
    void view.webContents.loadURL(url || BLANK_URL);
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

  private bindViewEvents(cellId: string, view: WebContentsView): void {
    this.bindShortcutEvents(view.webContents);
    view.webContents.on('focus', () => {
      this.focusCell(cellId);
    });
    view.webContents.on('did-navigate', (_event, url) => {
      this.sendUrl(cellId, url);
      this.checkNavigationNotice(cellId, url);
    });
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      this.sendUrl(cellId, url);
      this.checkNavigationNotice(cellId, url);
    });
    view.webContents.on('page-title-updated', (_event, title) => {
      this.updateActiveTab(cellId, { title });
      this.window.webContents.send(IPC.CELL_TITLE_CHANGED, { cellId, title });
    });
    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      const favicon = favicons[0];
      if (favicon) {
        this.window.webContents.send(IPC.CELL_FAVICON_CHANGED, { cellId, favicon });
      }
    });
    view.webContents.on('did-finish-load', () => {
      this.cellUrls[cellId] = view.webContents.getURL();
      this.store.set(`cells.${cellId}.url`, view.webContents.getURL());
      this.updateActiveTab(cellId, {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle() || safeTabTitle(view.webContents.getURL()),
      });
      this.syncCellState(cellId);
      this.sendUrl(cellId, view.webContents.getURL());
      this.checkNavigationNotice(cellId, view.webContents.getURL());
      this.window.webContents.send(IPC.CELL_TITLE_CHANGED, {
        cellId,
        title: view.webContents.getTitle(),
      });
    });
    view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && validatedURL !== BLANK_URL) {
        this.showCellNotice(cellId, 'load-failed');
      }
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

  private sendUrl(cellId: string, url: string): void {
    this.window.webContents.send(IPC.CELL_URL_CHANGED, { cellId, url });
  }

  private checkNavigationNotice(cellId: string, url: string): void {
    if (url.includes('signin/rejected')) {
      this.showCellNotice(cellId, 'google-login-blocked');
    }
  }

  private showCellNotice(cellId: string, type: NoticeType): void {
    this.window.webContents.send(IPC.SHOW_CELL_NOTICE, {
      cellId,
      type,
      message: NOTICE_MESSAGES[type],
    });
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
        : [createTab(this.cellUrls[cellId] || 'about:blank', safeTabTitle(this.cellUrls[cellId]))];
      return tabs;
    }, {});
  }

  private getStoredActiveTabIds(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((activeTabIds, cellId) => {
      const storedTabId = this.store.get(`cells.${cellId}.activeTabId`);
      const tabs = this.tabs[cellId] ?? [];
      const activeTab = tabs.find((tab) => tab.id === storedTabId) ?? tabs[0];
      activeTabIds[cellId] = activeTab?.id ?? createTab('about:blank', 'New tab').id;
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

  private updateActiveTab(cellId: string, patch: Partial<Pick<CellTab, 'title' | 'url'>>): void {
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
  if (!url || url === 'about:blank') {
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

function findPresetSiteByUrl(rawUrl: string) {
  const url = parseUrl(rawUrl);
  if (!url) {
    return null;
  }

  return PRESET_SITES.find((site) => {
    const siteUrl = parseUrl(site.url);
    return siteUrl && normalizeHost(siteUrl.hostname) === normalizeHost(url.hostname);
  }) ?? null;
}

function inferCellMode(rawUrl: string): CellMode {
  return findPresetSiteByUrl(rawUrl)?.mode ?? 'chat';
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
  if (!trimmed || trimmed === BLANK_URL) {
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

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
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
