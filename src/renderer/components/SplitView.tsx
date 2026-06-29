import { PointerEvent, useEffect, useMemo, useState } from 'react';
import { findPresetSiteByUrl } from '../../shared/presetSites';
import { CELL_IDS, CellMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';
import GridCell from './GridCell';

interface SplitViewProps {
  activeCells: Record<string, boolean>;
  cellModes: Record<string, CellMode>;
  cellUrls: Record<string, string>;
  focusedCellId: string;
  layoutMode: LayoutMode;
  maximizedCellId: string | null;
  onFocusCell: (cellId: string, url: string) => void;
  onToggleMaximized: (cellId: string) => void;
  onNewTab: (cellId: string, url?: string) => void;
  onToggleCell: (cellId: string, active: boolean) => void;
}

type CellFavicons = Record<string, string | null>;

const INITIAL_FAVICONS = CELL_IDS.reduce<CellFavicons>((favicons, cellId) => {
  favicons[cellId] = null;
  return favicons;
}, {});

export default function SplitView({
  activeCells,
  cellModes,
  cellUrls,
  focusedCellId,
  layoutMode,
  maximizedCellId,
  onFocusCell,
  onToggleMaximized,
  onNewTab,
  onToggleCell,
}: SplitViewProps) {
  const [cellFavicons, setCellFavicons] = useState<CellFavicons>(INITIAL_FAVICONS);
  const [horizontalRatio, setHorizontalRatio] = useState(0.5);
  const [verticalRatio, setVerticalRatio] = useState(0.5);
  const layoutCells = LAYOUT_CELLS[layoutMode];
  const visibleCells = maximizedCellId && layoutCells.includes(maximizedCellId) ? [maximizedCellId] : layoutCells;
  const showSplitters = !maximizedCellId;

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

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns:
        maximizedCellId
          ? '1fr'
          : layoutMode === 'horizontal' || layoutMode === 'triple' || layoutMode === 'quad'
          ? `${horizontalRatio}fr 4px ${1 - horizontalRatio}fr`
          : '1fr',
      gridTemplateRows:
        maximizedCellId
          ? '1fr'
          : layoutMode === 'vertical' || layoutMode === 'triple' || layoutMode === 'quad'
          ? `${verticalRatio}fr 4px ${1 - verticalRatio}fr`
          : '1fr',
    }),
    [horizontalRatio, layoutMode, maximizedCellId, verticalRatio],
  );

  function handleHorizontalDrag(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const nextRatio = clamp((event.clientX - rect.left) / rect.width);
    setHorizontalRatio(nextRatio);
    void window.electronAPI.setSplitRatios({ horizontalRatio: nextRatio });
  }

  function handleVerticalDrag(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const nextRatio = clamp((event.clientY - rect.top) / rect.height);
    setVerticalRatio(nextRatio);
    void window.electronAPI.setSplitRatios({ verticalRatio: nextRatio });
  }

  function startHorizontalDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    handleHorizontalDrag(event);
  }

  function startVerticalDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    handleVerticalDrag(event);
  }

  return (
    <section
      className={`split-view split-view-${layoutMode}${maximizedCellId ? ' split-view-maximized' : ''}`}
      style={gridStyle}
      aria-label="Split browser cells"
    >
      {visibleCells.includes('cell-0') && (
        <GridCell
          cellId="cell-0"
          className="cell-a"
          focused={focusedCellId === 'cell-0'}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-0'}
          targetCells={getTargetCells('cell-0', layoutCells, cellUrls)}
          meta={getCellMeta('cell-0', cellUrls, cellModes, activeCells, cellFavicons)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
        />
      )}
      {showSplitters && (layoutMode === 'horizontal' || layoutMode === 'triple' || layoutMode === 'quad') && (
        <div
          className="splitter splitter-vertical"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startHorizontalDrag}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              handleHorizontalDrag(event);
            }
          }}
        />
      )}
      {visibleCells.includes('cell-1') && (
        <GridCell
          cellId="cell-1"
          className="cell-b"
          focused={focusedCellId === 'cell-1'}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-1'}
          targetCells={getTargetCells('cell-1', layoutCells, cellUrls)}
          meta={getCellMeta('cell-1', cellUrls, cellModes, activeCells, cellFavicons)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
        />
      )}
      {showSplitters && (layoutMode === 'vertical' || layoutMode === 'triple' || layoutMode === 'quad') && (
        <div
          className="splitter splitter-horizontal"
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={startVerticalDrag}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              handleVerticalDrag(event);
            }
          }}
        />
      )}
      {visibleCells.includes('cell-2') && (
        <GridCell
          cellId="cell-2"
          className="cell-c"
          focused={focusedCellId === 'cell-2'}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-2'}
          targetCells={getTargetCells('cell-2', layoutCells, cellUrls)}
          meta={getCellMeta('cell-2', cellUrls, cellModes, activeCells, cellFavicons)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
        />
      )}
      {visibleCells.includes('cell-3') && (
        <GridCell
          cellId="cell-3"
          className="cell-d"
          focused={focusedCellId === 'cell-3'}
          layoutMode={layoutMode}
          maximized={maximizedCellId === 'cell-3'}
          targetCells={getTargetCells('cell-3', layoutCells, cellUrls)}
          meta={getCellMeta('cell-3', cellUrls, cellModes, activeCells, cellFavicons)}
          onFocus={onFocusCell}
          onToggleMaximized={onToggleMaximized}
          onNewTab={onNewTab}
          onToggle={onToggleCell}
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
) {
  return {
    url: cellUrls[cellId] ?? '',
    mode: cellModes[cellId] ?? 'chat',
    favicon: favicons[cellId] ?? null,
    active: Boolean(activeCells[cellId] && cellUrls[cellId]?.trim()),
  };
}

function getTargetCells(sourceCellId: string, visibleCells: string[], cellUrls: Record<string, string>) {
  return visibleCells
    .filter((cellId) => cellId !== sourceCellId)
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

function clamp(value: number): number {
  return Math.min(0.8, Math.max(0.2, value));
}
