import { useEffect, useState } from 'react';
import type { CellMode, CellNoticePayload } from '../../shared/types';
import CellNotice from './CellNotice';

const shownNoticeKeys = new Set<string>();

interface GridCellProps {
  cellId: string;
  className: string;
  focused: boolean;
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
}: GridCellProps) {
  const host = safeHost(meta.url);
  const [notice, setNotice] = useState<CellNoticePayload | null>(null);

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
      <div className="cell-menu" aria-label={`${host} cell controls`}>
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
