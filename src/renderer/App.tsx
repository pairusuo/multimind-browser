import { useEffect, useState } from 'react';
import CellConfigPanel from './components/CellConfigPanel';
import Toolbar from './components/Toolbar';
import SplitView from './components/SplitView';
import BottomInput from './components/BottomInput';
import TemplateChooser from './components/TemplateChooser';
import { BrowserState, CELL_IDS, DEFAULT_URLS, LAYOUT_CELLS, LayoutMode } from '../shared/types';
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

export default function App() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [cellUrls, setCellUrls] = useState<Record<string, string>>(INITIAL_URLS);
  const [activeCells, setActiveCells] = useState<Record<string, boolean>>(INITIAL_ACTIVE_CELLS);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState('cell-0');
  const url = cellUrls[focusedCellId] ?? '';

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
    });

    return () => {
      removeFocusListener();
      removeUrlListener();
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

  function handleUrlChange(nextUrl: string) {
    setCellUrls((current) => ({
      ...current,
      [focusedCellId]: nextUrl,
    }));
  }

  async function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
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

  async function handleSaveCellConfig(nextUrls: Record<string, string>) {
    const visibleCells = getVisibleCells(layoutMode);
    setCellUrls((current) => ({
      ...current,
      ...nextUrls,
    }));

    for (const cellId of visibleCells) {
      const nextUrl = nextUrls[cellId]?.trim();
      await window.electronAPI.setCellUrl({ cellId, url: nextUrl ?? '' });
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

  function applyBrowserState(state: BrowserState) {
    setLayoutMode(state.layoutMode);
    setCellUrls({
      ...INITIAL_URLS,
      ...state.cellUrls,
    });
    setActiveCells({
      ...INITIAL_ACTIVE_CELLS,
      ...state.activeCells,
    });
    setFocusedCellId(state.focusedCellId);
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
    setActiveCells(INITIAL_ACTIVE_CELLS);
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
        layoutMode={layoutMode}
        onLayoutChange={(mode) => void handleLayoutChange(mode)}
        onOpenConfig={() => setShowConfigPanel(true)}
        onUrlChange={handleUrlChange}
      />
      <main className={`browser-stage browser-stage-${layoutMode}`} aria-label="Browser content">
        <SplitView
          activeCells={activeCells}
          cellUrls={cellUrls}
          focusedCellId={focusedCellId}
          layoutMode={layoutMode}
          onFocusCell={handleFocusCell}
          onToggleCell={handleToggleCell}
        />
      </main>
      <BottomInput
        activeCells={activeCells}
        cellUrls={cellUrls}
        layoutMode={layoutMode}
        onToggleCell={handleToggleCell}
      />
      {!hasCompletedOnboarding && <TemplateChooser onApplyTemplate={(template) => void handleApplyTemplate(template)} />}
      {showConfigPanel && (
        <CellConfigPanel
          cellUrls={cellUrls}
          layoutMode={layoutMode}
          onClose={() => setShowConfigPanel(false)}
          onSave={(nextUrls) => void handleSaveCellConfig(nextUrls)}
        />
      )}
    </div>
  );
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
