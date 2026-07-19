import { useEffect, useState } from 'react';
import { findPresetSiteByUrl } from '../../shared/presetSites';
import { ApiConversationCellState, CELL_IDS, CellMode, ConversationEntryMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';
import GridCell from './GridCell';

interface SplitViewProps {
  activeCells: Record<string, boolean>;
  apiCellStates: Record<string, ApiConversationCellState>;
  apiModels: string[];
  cellModes: Record<string, CellMode>;
  cellUrls: Record<string, string>;
  conversationEntryMode: ConversationEntryMode;
  focusedCellId: string;
  forwardControlsEnabled: boolean;
  layoutMode: LayoutMode;
  maximizedCellId: string | null;
  onFocusCell: (cellId: string, url: string) => void;
  onToggleMaximized: (cellId: string) => void;
  onNewTab: (cellId: string, url?: string) => void;
  onToggleCell: (cellId: string, active: boolean) => void;
  onApiCellModelChange: (cellId: string, model: string) => void;
  onApiForward: (sourceCellId: string, targetCellId: string) => Promise<void>;
  onClearApiCell: (cellId: string) => void;
}

type CellFavicons = Record<string, string | null>;

const INITIAL_FAVICONS = CELL_IDS.reduce<CellFavicons>((favicons, cellId) => {
  favicons[cellId] = null;
  return favicons;
}, {});

export default function SplitView({
  activeCells,
  apiCellStates,
  apiModels,
  cellModes,
  cellUrls,
  conversationEntryMode,
  focusedCellId,
  forwardControlsEnabled,
  layoutMode,
  maximizedCellId,
  onFocusCell,
  onToggleMaximized,
  onNewTab,
  onToggleCell,
  onApiCellModelChange,
  onApiForward,
  onClearApiCell,
}: SplitViewProps) {
  const [cellFavicons, setCellFavicons] = useState<CellFavicons>(INITIAL_FAVICONS);
  const layoutCells = LAYOUT_CELLS[layoutMode];
  const visibleCells = maximizedCellId && layoutCells.includes(maximizedCellId) ? [maximizedCellId] : layoutCells;

  useEffect(() => {
    const removeFaviconListener = window.electronAPI.onCellFaviconChanged((payload) => {
      setCellFavicons((current) => ({
        ...current,
        [payload.cellId]: payload.favicon,
      }));
    });

    return () => {
      removeFaviconListener();
    };
  }, []);

  return (
    <section
      className={`split-view split-view-${maximizedCellId ? 'single' : layoutMode}${maximizedCellId ? ' split-view-maximized' : ''}`}
      aria-label="Split browser cells"
    >
      {visibleCells.includes('cell-0') && (
        <GridCell
          cellId="cell-0"
          className="cell-a"
          focused={focusedCellId === 'cell-0'}
          conversationEntryMode={conversationEntryMode}
          apiState={apiCellStates['cell-0']}
          apiModels={apiModels}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-0'}
          showForwardControl={forwardControlsEnabled}
          targetCells={getTargetCells('cell-0', layoutCells, cellUrls, conversationEntryMode, apiCellStates)}
          meta={getCellMeta('cell-0', cellUrls, cellModes, activeCells, cellFavicons, conversationEntryMode)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
          onApiModelChange={onApiCellModelChange}
          onApiForward={onApiForward}
          onClearApiCell={onClearApiCell}
        />
      )}
      {visibleCells.includes('cell-1') && (
        <GridCell
          cellId="cell-1"
          className="cell-b"
          focused={focusedCellId === 'cell-1'}
          conversationEntryMode={conversationEntryMode}
          apiState={apiCellStates['cell-1']}
          apiModels={apiModels}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-1'}
          showForwardControl={forwardControlsEnabled}
          targetCells={getTargetCells('cell-1', layoutCells, cellUrls, conversationEntryMode, apiCellStates)}
          meta={getCellMeta('cell-1', cellUrls, cellModes, activeCells, cellFavicons, conversationEntryMode)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
          onApiModelChange={onApiCellModelChange}
          onApiForward={onApiForward}
          onClearApiCell={onClearApiCell}
        />
      )}
      {visibleCells.includes('cell-2') && (
        <GridCell
          cellId="cell-2"
          className="cell-c"
          focused={focusedCellId === 'cell-2'}
          conversationEntryMode={conversationEntryMode}
          apiState={apiCellStates['cell-2']}
          apiModels={apiModels}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-2'}
          showForwardControl={forwardControlsEnabled}
          targetCells={getTargetCells('cell-2', layoutCells, cellUrls, conversationEntryMode, apiCellStates)}
          meta={getCellMeta('cell-2', cellUrls, cellModes, activeCells, cellFavicons, conversationEntryMode)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
          onApiModelChange={onApiCellModelChange}
          onApiForward={onApiForward}
          onClearApiCell={onClearApiCell}
        />
      )}
      {visibleCells.includes('cell-3') && (
        <GridCell
          cellId="cell-3"
          className="cell-d"
          focused={focusedCellId === 'cell-3'}
          conversationEntryMode={conversationEntryMode}
          apiState={apiCellStates['cell-3']}
          apiModels={apiModels}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-3'}
          showForwardControl={forwardControlsEnabled}
          targetCells={getTargetCells('cell-3', layoutCells, cellUrls, conversationEntryMode, apiCellStates)}
          meta={getCellMeta('cell-3', cellUrls, cellModes, activeCells, cellFavicons, conversationEntryMode)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
          onApiModelChange={onApiCellModelChange}
          onApiForward={onApiForward}
          onClearApiCell={onClearApiCell}
        />
      )}
    </section>
  );
}

function getCellMeta(
  cellId: string,
  cellUrls: Record<string, string>,
  cellModes: Record<string, CellMode>,
  activeCells: Record<string, boolean>,
  favicons: CellFavicons,
  conversationEntryMode: ConversationEntryMode,
) {
  return {
    url: cellUrls[cellId] ?? '',
    mode: cellModes[cellId] ?? 'chat',
    favicon: favicons[cellId] ?? null,
    active: conversationEntryMode === 'api'
      ? Boolean(activeCells[cellId])
      : Boolean(activeCells[cellId] && cellUrls[cellId]?.trim()),
  };
}

function getTargetCells(
  sourceCellId: string,
  visibleCells: string[],
  cellUrls: Record<string, string>,
  conversationEntryMode: ConversationEntryMode,
  apiCellStates: Record<string, ApiConversationCellState>,
) {
  if (conversationEntryMode === 'api') {
    return visibleCells
      .filter((cellId) => cellId !== sourceCellId && Boolean(apiCellStates[cellId]?.model))
      .map((cellId) => ({
        cellId,
        label: apiCellStates[cellId].model,
      }));
  }

  return visibleCells
    .filter((cellId) => cellId !== sourceCellId && Boolean(cellUrls[cellId]?.trim()))
    .map((cellId) => ({
      cellId,
      label: getCellLabel(cellUrls[cellId] ?? '', cellId),
    }));
}

function getCellLabel(url: string, cellId: string): string {
  const preset = findPresetSiteByUrl(url);
  if (preset) {
    return preset.name;
  }

  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : cellId.replace('cell-', 'Cell ');
  } catch {
    return url || cellId.replace('cell-', 'Cell ');
  }
}
