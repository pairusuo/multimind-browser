import { useEffect, useState } from 'react';
import type { CellMode, CellNoticePayload } from '../../shared/types';
import CellNotice from './CellNotice';

const shownNoticeKeys = new Set<string>();

interface GridCellProps {
  cellId: string;
  className: string;
  focused: boolean;
  targetCells: Array<{ cellId: string; label: string }>;
  meta: {
    url: string;
    mode: CellMode;
    favicon: string | null;
    active: boolean;
    muted: boolean;
  };
  onFocus: (cellId: string, url: string) => void;
  onNewTab: (cellId: string, url?: string) => void;
  onToggleMute: (cellId: string) => void;
  onToggle: (cellId: string, active: boolean) => void;
}

export default function GridCell({
  cellId,
  className,
  focused,
  meta,
  onFocus,
  onNewTab,
  onToggleMute,
  onToggle,
  targetCells,
}: GridCellProps) {
  const host = safeHost(meta.url);
  const [notice, setNotice] = useState<CellNoticePayload | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [forwardingTargetId, setForwardingTargetId] = useState<string | null>(null);
  const [forwardStatus, setForwardStatus] = useState<string | null>(null);

  useEffect(() => {
    return window.electronAPI.onCellNotice((payload) => {
      if (payload.cellId !== cellId) {
        return;
      }

      const noticeKey = `${payload.cellId}-${payload.type}`;
      if (shownNoticeKeys.has(noticeKey)) {
        return;
      }

      shownNoticeKeys.add(noticeKey);
      setNotice(payload);
    });
  }, [cellId]);

  async function changeUrl() {
    const nextUrl = window.prompt('Set cell address', meta.url);
    if (!nextUrl?.trim()) {
      return;
    }

    await window.electronAPI.setCellUrl({ cellId, url: nextUrl });
  }

  async function forwardTo(targetCellId: string) {
    setTargetPickerOpen(false);
    setForwardingTargetId(targetCellId);
    setForwardStatus(`Forwarding to ${getTargetLabel(targetCells, targetCellId)}...`);

    try {
      await window.electronAPI.forwardResponse({ sourceCellId: cellId, targetCellId });
      setForwardStatus(`Forwarded to ${getTargetLabel(targetCells, targetCellId)}`);
    } catch (error) {
      console.error('Forward response failed:', error);
      setForwardStatus('Forward could not be completed');
    } finally {
      setForwardingTargetId(null);
    }
  }

  return (
    <article
      className={`grid-cell ${className}${focused ? ' focused' : ''}`}
      aria-label={`${host} browser cell`}
      onClick={() => onFocus(cellId, meta.url)}
    >
      <div className="cell-overlay" aria-live="polite">
        {meta.favicon ? <img src={meta.favicon} alt="" /> : <span className="favicon-placeholder" />}
        {meta.mode === 'search' && <span className="cell-mode-badge" title="Search cell">⌕</span>}
        <span>{host}</span>
      </div>
      {notice && <CellNotice notice={notice} onClose={() => setNotice(null)} />}
      {forwardStatus && (
        <div className="cell-forward-status" role="status">
          <span>{forwardStatus}</span>
          <button type="button" aria-label="Dismiss forward status" onClick={() => setForwardStatus(null)}>
            ×
          </button>
        </div>
      )}
      <div className="cell-menu" aria-label={`${host} cell controls`}>
        <button
          type="button"
          title="Forward To"
          aria-label="Forward To"
          aria-expanded={targetPickerOpen}
          onClick={(event) => {
            event.stopPropagation();
            setTargetPickerOpen((open) => !open);
          }}
        >
          ⇥
        </button>
        <button type="button" title="Reload" aria-label="Reload cell" onClick={() => window.electronAPI.reload(cellId)}>
          ↻
        </button>
        <button type="button" title="Set address" aria-label="Set cell address" onClick={() => void changeUrl()}>
          ⌘
        </button>
        <button type="button" title="Open in new tab" aria-label="Open in new tab" onClick={() => onNewTab(cellId, meta.url)}>
          +
        </button>
        <button
          type="button"
          className={meta.muted ? 'active' : ''}
          title="Toggle mute"
          aria-label="Toggle mute"
          aria-pressed={meta.muted}
          onClick={() => onToggleMute(cellId)}
        >
          M
        </button>
        <button
          type="button"
          className={meta.active ? 'active' : ''}
          title="Toggle sync"
          aria-label="Toggle sync"
          aria-pressed={meta.active}
          onClick={() => onToggle(cellId, !meta.active)}
        >
          ✓
        </button>
      </div>
      {targetPickerOpen && (
        <div className="forward-target-picker" aria-label="Choose forward target" onClick={(event) => event.stopPropagation()}>
          <div className="forward-target-options">
            {targetCells.map((target) => (
              <button
                key={target.cellId}
                type="button"
                disabled={forwardingTargetId !== null}
                onClick={() => void forwardTo(target.cellId)}
              >
                {target.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function safeHost(url: string): string {
  try {
    return url ? new URL(url).host : 'Empty cell';
  } catch {
    return url || 'Empty cell';
  }
}

function getTargetLabel(targetCells: Array<{ cellId: string; label: string }>, cellId: string): string {
  return targetCells.find((target) => target.cellId === cellId)?.label ?? cellId.replace('cell-', 'Cell ');
}
