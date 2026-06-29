import { useEffect, useRef, useState } from 'react';
import i18n from './i18n';
import CellConfigPanel from './components/CellConfigPanel';
import Toolbar from './components/Toolbar';
import SplitView from './components/SplitView';
import BottomInput from './components/BottomInput';
import TemplateChooser from './components/TemplateChooser';
import {
  BrowserState,
  CELL_IDS,
  AppLanguage,
  CellMode,
  CellTab,
  DEFAULT_URLS,
  LAYOUT_CELLS,
  LayoutMode,
  ThemeMode,
} from '../shared/types';
import { LayoutTemplate } from '../shared/presetTemplates';
import { PRESET_SITES } from '../shared/presetSites';

const INITIAL_URLS = CELL_IDS.reduce<Record<string, string>>((urls, cellId) => {
  urls[cellId] = '';
  return urls;
}, {});

const INITIAL_ACTIVE_CELLS = CELL_IDS.reduce<Record<string, boolean>>((activeCells, cellId) => {
  activeCells[cellId] = true;
  return activeCells;
}, {});

const INITIAL_CELL_MODES = CELL_IDS.reduce<Record<string, CellMode>>((modes, cellId) => {
  modes[cellId] = 'chat';
  return modes;
}, {});

const INITIAL_SEARCH_TEMPLATES = CELL_IDS.reduce<Record<string, string>>((templates, cellId) => {
  templates[cellId] = '';
  return templates;
}, {});

const INITIAL_MUTED_CELLS = CELL_IDS.reduce<Record<string, boolean>>((mutedCells, cellId) => {
  mutedCells[cellId] = false;
  return mutedCells;
}, {});

const INITIAL_TABS = CELL_IDS.reduce<Record<string, CellTab[]>>((tabs, cellId) => {
  tabs[cellId] = [];
  return tabs;
}, {});

const INITIAL_ACTIVE_TAB_IDS = CELL_IDS.reduce<Record<string, string>>((activeTabIds, cellId) => {
  activeTabIds[cellId] = '';
  return activeTabIds;
}, {});

export default function App() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [cellUrls, setCellUrls] = useState<Record<string, string>>(INITIAL_URLS);
  const [cellModes, setCellModes] = useState<Record<string, CellMode>>(INITIAL_CELL_MODES);
  const [searchUrlTemplates, setSearchUrlTemplates] = useState<Record<string, string>>(INITIAL_SEARCH_TEMPLATES);
  const [activeCells, setActiveCells] = useState<Record<string, boolean>>(INITIAL_ACTIVE_CELLS);
  const [mutedCells, setMutedCells] = useState<Record<string, boolean>>(INITIAL_MUTED_CELLS);
  const [tabs, setTabs] = useState<Record<string, CellTab[]>>(INITIAL_TABS);
  const [activeTabIds, setActiveTabIds] = useState<Record<string, string>>(INITIAL_ACTIVE_TAB_IDS);
  const activeTabIdsRef = useRef<Record<string, string>>(INITIAL_ACTIVE_TAB_IDS);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [language, setLanguage] = useState<AppLanguage>('zh');
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState('cell-0');
  const [maximizedCellId, setMaximizedCellId] = useState<string | null>(null);
  const url = cellUrls[focusedCellId] ?? '';

  useEffect(() => {
    activeTabIdsRef.current = activeTabIds;
  }, [activeTabIds]);

  useEffect(() => {
    const screenshotMode = new URLSearchParams(window.location.search).get('screenshotMode');
    if (screenshotMode === 'triple' || screenshotMode === 'config' || screenshotMode === 'risk' || screenshotMode === 'notice') {
      void applyScreenshotState(screenshotMode);
      return;
    }

    void window.electronAPI.getBrowserState().then(applyBrowserState);
  }, []);

  useEffect(() => {
    void window.electronAPI.setOverlayOpen(showConfigPanel || !hasCompletedOnboarding);
  }, [hasCompletedOnboarding, showConfigPanel]);

  useEffect(() => {
    const removeFocusListener = window.electronAPI.onCellFocused((payload) => {
      setFocusedCellId(payload.cellId);
    });
    const removeUrlListener = window.electronAPI.onCellUrlChanged((payload) => {
      setCellUrls((current) => ({
        ...current,
        [payload.cellId]: payload.url,
      }));
      patchActiveTab(payload.cellId, { url: payload.url });
    });
    const removeTitleListener = window.electronAPI.onCellTitleChanged((payload) => {
      patchActiveTab(payload.cellId, { title: payload.title });
    });
    const removeFaviconListener = window.electronAPI.onCellFaviconChanged((payload) => {
      patchActiveTab(payload.cellId, { favicon: payload.favicon });
    });
    const removeLayoutListener = window.electronAPI.onLayoutChanged((payload) => {
      setLayoutMode(payload.layoutMode);
    });

    return () => {
      removeFocusListener();
      removeUrlListener();
      removeTitleListener();
      removeFaviconListener();
      removeLayoutListener();
    };
  }, []);

  function handleFocusCell(cellId: string, nextUrl: string) {
    setFocusedCellId(cellId);
    setCellUrls((current) => ({
      ...current,
      [cellId]: nextUrl,
    }));
    void window.electronAPI.focusCell({ cellId });
  }

  function patchActiveTab(cellId: string, patch: Partial<CellTab>) {
    const tabId = activeTabIdsRef.current[cellId];
    setTabs((current) => ({
      ...current,
      [cellId]: patchTabList(current[cellId] ?? [], tabId, patch),
    }));
  }

  async function handleNavigate(nextUrl: string) {
    setCellUrls((current) => ({
      ...current,
      [focusedCellId]: nextUrl,
    }));
    const state = await window.electronAPI.navigate({ cellId: focusedCellId, url: nextUrl });
    applyBrowserState(state);
  }

  async function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    setMaximizedCellId(null);
    await window.electronAPI.setMaximizedCell({ cellId: null });
    setCellUrls((current) => fillDefaultUrlsForLayout(current, mode));
    const firstCell = 'cell-0';
    setFocusedCellId(firstCell);
    await window.electronAPI.focusCell({ cellId: firstCell });
  }

  async function handleApplyTemplate(template: LayoutTemplate) {
    const state = await window.electronAPI.applyTemplate({ template });
    applyBrowserState(state);
    setShowConfigPanel(template.id === 'custom');
  }

  async function handleSaveCellConfig(
    nextUrls: Record<string, string>,
    nextModes: Record<string, CellMode>,
    nextSearchTemplates: Record<string, string>,
  ) {
    const visibleCells = getVisibleCells(layoutMode);
    setCellUrls((current) => ({
      ...current,
      ...nextUrls,
    }));
    setCellModes((current) => ({
      ...current,
      ...nextModes,
    }));
    setSearchUrlTemplates((current) => ({
      ...current,
      ...nextSearchTemplates,
    }));

    for (const cellId of visibleCells) {
      const nextUrl = nextUrls[cellId]?.trim();
      await window.electronAPI.setCellUrl({
        cellId,
        url: nextUrl ?? '',
        mode: nextModes[cellId],
        searchUrlTemplate: nextSearchTemplates[cellId],
      });
      if (!nextUrl) {
        setActiveCells((current) => ({
          ...current,
          [cellId]: false,
        }));
      }
    }

    setShowConfigPanel(false);
    setHasCompletedOnboarding(true);
  }

  function handleToggleCell(cellId: string, active: boolean) {
    setActiveCells((current) => ({
      ...current,
      [cellId]: active,
    }));
    void window.electronAPI.toggleCell({ cellId, active });
  }

  async function handleThemeModeChange(mode: ThemeMode) {
    const state = await window.electronAPI.setThemeMode(mode);
    applyBrowserState(state);
  }

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    const state = await window.electronAPI.setLanguage(nextLanguage);
    applyBrowserState(state);
  }

  async function handleNewTab(cellId: string, url?: string) {
    const state = await window.electronAPI.newTab({ cellId, url });
    applyBrowserState(state);
  }

  async function handleCloseTab(cellId: string, tabId?: string) {
    const state = await window.electronAPI.closeTab({ cellId, tabId });
    applyBrowserState(state);
  }

  async function handleSwitchTab(cellId: string, tabId?: string) {
    const state = await window.electronAPI.switchTab({ cellId, tabId });
    applyBrowserState(state);
  }

  async function handleToggleMute(cellId: string) {
    const state = await window.electronAPI.toggleMute(cellId);
    applyBrowserState(state);
  }

  async function handleStartNewDiscussion() {
    const state = await window.electronAPI.startNewDiscussion();
    applyBrowserState(state);
  }

  function handleToggleMaximizedCell(cellId: string) {
    const nextCellId = maximizedCellId === cellId ? null : cellId;
    setMaximizedCellId(nextCellId);
    if (nextCellId) {
      setFocusedCellId(nextCellId);
    }
    void window.electronAPI.setMaximizedCell({ cellId: nextCellId });
  }

  function applyBrowserState(state: BrowserState) {
    setLayoutMode(state.layoutMode);
    setCellUrls({
      ...INITIAL_URLS,
      ...state.cellUrls,
    });
    setCellModes({
      ...INITIAL_CELL_MODES,
      ...state.cellModes,
    });
    setSearchUrlTemplates({
      ...INITIAL_SEARCH_TEMPLATES,
      ...state.searchUrlTemplates,
    });
    setActiveCells({
      ...INITIAL_ACTIVE_CELLS,
      ...state.activeCells,
    });
    setMutedCells({
      ...INITIAL_MUTED_CELLS,
      ...state.mutedCells,
    });
    setTabs({
      ...INITIAL_TABS,
      ...state.tabs,
    });
    setActiveTabIds({
      ...INITIAL_ACTIVE_TAB_IDS,
      ...state.activeTabIds,
    });
    activeTabIdsRef.current = {
      ...INITIAL_ACTIVE_TAB_IDS,
      ...state.activeTabIds,
    };
    setThemeMode(state.themeMode);
    setLanguage(state.language);
    if (i18n.language !== state.language) {
      void i18n.changeLanguage(state.language);
    }
    setFocusedCellId(state.focusedCellId);
    setMaximizedCellId(state.maximizedCellId);
    setHasCompletedOnboarding(state.hasCompletedOnboarding);
  }

  async function applyScreenshotState(mode: string) {
    const demoUrls = {
      ...INITIAL_URLS,
      'cell-0': mode === 'risk' ? 'https://gemini.google.com' : PRESET_SITES.find((site) => site.id === 'claude')?.url ?? '',
      'cell-1': PRESET_SITES.find((site) => site.id === 'chatgpt')?.url ?? '',
      'cell-2': PRESET_SITES.find((site) => site.id === 'deepseek')?.url ?? '',
    };

    setLayoutMode('triple');
    setCellUrls(demoUrls);
    setCellModes(INITIAL_CELL_MODES);
    setSearchUrlTemplates(INITIAL_SEARCH_TEMPLATES);
    setActiveCells(INITIAL_ACTIVE_CELLS);
    setMutedCells(INITIAL_MUTED_CELLS);
    setTabs(INITIAL_TABS);
    setActiveTabIds(INITIAL_ACTIVE_TAB_IDS);
    setThemeMode('system');
    setLanguage('zh');
    if (i18n.language !== 'zh') {
      void i18n.changeLanguage('zh');
    }
    setFocusedCellId('cell-0');
    setHasCompletedOnboarding(true);
    setShowConfigPanel(mode === 'config' || mode === 'risk');
    await window.electronAPI.setLayout('triple');
    if (mode === 'notice') {
      window.setTimeout(() => {
        void window.electronAPI.setCellUrl({
          cellId: 'cell-0',
          url: 'https://accounts.google.com/v3/signin/rejected?app_domain=https%3A%2F%2Fauth.openai.com',
        });
      }, 1200);
    }
  }

  return (
    <div className="app-shell">
      <Toolbar
        currentUrl={url}
        focusedCellId={focusedCellId}
        tabs={tabs[focusedCellId] ?? []}
        activeTabId={activeTabIds[focusedCellId] ?? ''}
        themeMode={themeMode}
        layoutMode={layoutMode}
        onLayoutChange={(mode) => void handleLayoutChange(mode)}
        onNewTab={() => void handleNewTab(focusedCellId)}
        onCloseTab={(tabId) => void handleCloseTab(focusedCellId, tabId)}
        onSwitchTab={(tabId) => void handleSwitchTab(focusedCellId, tabId)}
        onOpenConfig={() => setShowConfigPanel(true)}
        onThemeModeChange={(mode) => void handleThemeModeChange(mode)}
        onNavigate={(url) => void handleNavigate(url)}
      />
      <main
        className={`browser-stage browser-stage-${layoutMode}${maximizedCellId ? ' browser-stage-maximized' : ''}`}
        aria-label="Browser content"
      >
        <SplitView
          activeCells={activeCells}
          cellModes={cellModes}
          cellUrls={cellUrls}
          mutedCells={mutedCells}
          focusedCellId={focusedCellId}
          layoutMode={layoutMode}
          maximizedCellId={maximizedCellId}
          onFocusCell={handleFocusCell}
          onToggleMaximized={handleToggleMaximizedCell}
          onNewTab={(cellId, url) => void handleNewTab(cellId, url)}
          onToggleMute={(cellId) => void handleToggleMute(cellId)}
          onToggleCell={handleToggleCell}
        />
      </main>
      {!maximizedCellId && (
        <BottomInput
          activeCells={activeCells}
          cellUrls={cellUrls}
          layoutMode={layoutMode}
          onStartNewDiscussion={() => void handleStartNewDiscussion()}
          onToggleCell={handleToggleCell}
        />
      )}
      {!hasCompletedOnboarding && <TemplateChooser onApplyTemplate={(template) => void handleApplyTemplate(template)} />}
      {showConfigPanel && (
        <CellConfigPanel
          cellUrls={cellUrls}
          cellModes={cellModes}
          searchUrlTemplates={searchUrlTemplates}
          language={language}
          layoutMode={layoutMode}
          onClose={() => setShowConfigPanel(false)}
          onLanguageChange={(nextLanguage) => void handleLanguageChange(nextLanguage)}
          onSave={(nextUrls, nextModes, nextSearchTemplates) =>
            void handleSaveCellConfig(nextUrls, nextModes, nextSearchTemplates)
          }
        />
      )}
    </div>
  );
}

function patchTabList(tabs: CellTab[], tabId: string, patch: Partial<CellTab>): CellTab[] {
  if (!tabId) {
    return tabs;
  }

  return tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
}

function getVisibleCells(layoutMode: LayoutMode): string[] {
  return LAYOUT_CELLS[layoutMode];
}

function fillDefaultUrlsForLayout(urls: Record<string, string>, layoutMode: LayoutMode): Record<string, string> {
  return LAYOUT_CELLS[layoutMode].reduce<Record<string, string>>(
    (nextUrls, cellId) => ({
      ...nextUrls,
      [cellId]: nextUrls[cellId]?.trim() ? nextUrls[cellId] : DEFAULT_URLS[cellId],
    }),
    { ...urls },
  );
}
