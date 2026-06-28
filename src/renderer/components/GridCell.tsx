import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CellMode, CellNoticePayload } from '../../shared/types';
import CellNotice from './CellNotice';

const shownNoticeKeys = new Set<string>();
const repeatableNoticeTypes = new Set<CellNoticePayload['type']>(['conversation-truncated']);

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
  const { t } = useTranslation();
  const host = safeHost(meta.url, t('gridCell.empty'));
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
      if (!repeatableNoticeTypes.has(payload.type) && shownNoticeKeys.has(noticeKey)) {
        return;
      }

      if (!repeatableNoticeTypes.has(payload.type)) {
        shownNoticeKeys.add(noticeKey);
      }
      setNotice(payload);
    });
  }, [cellId]);

  async function changeUrl() {
    const nextUrl = window.prompt(t('gridCell.address.prompt'), meta.url);
    if (!nextUrl?.trim()) {
      return;
    }

    await window.electronAPI.setCellUrl({ cellId, url: nextUrl });
  }

  async function forwardTo(targetCellId: string) {
    setTargetPickerOpen(false);
    setForwardingTargetId(targetCellId);
    const targetLabel = getTargetLabel(targetCells, targetCellId);
    setForwardStatus(t('gridCell.forward.status.forwarding', { target: targetLabel }));

    try {
      const record = await window.electronAPI.forwardResponse({ sourceCellId: cellId, targetCellId });
      setForwardStatus(record.sourceTruncated
        ? t('gridCell.forward.status.completedTruncated', { target: targetLabel })
        : t('gridCell.forward.status.completed', { target: targetLabel }));
    } catch (error) {
      console.error('Forward response failed:', error);
      setForwardStatus(t('gridCell.forward.status.failed', { target: targetLabel }));
    } finally {
      setForwardingTargetId(null);
    }
  }

  return (
    <article
      className={`grid-cell ${className}${focused ? ' focused' : ''}`}
      aria-label={t('gridCell.aria.browserCell', { host })}
      onClick={() => onFocus(cellId, meta.url)}
    >
      <div className="cell-header">
        {forwardStatus ? (
          <div className="forward-picker-inline forward-status-inline" role="status" onClick={(event) => event.stopPropagation()}>
            <span>{forwardStatus}</span>
            <button
              type="button"
              className="forward-picker-cancel"
              aria-label={t('gridCell.forward.dismissStatus')}
              onClick={() => setForwardStatus(null)}
            >
              ×
            </button>
          </div>
        ) : targetPickerOpen ? (
          <div className="forward-picker-inline" onClick={(event) => event.stopPropagation()}>
            <span className="forward-picker-label">{t('gridCell.forward.label')}</span>
            <div className="forward-picker-targets">
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
            <button
              type="button"
              className="forward-picker-cancel"
              aria-label={t('gridCell.forward.cancel')}
              onClick={() => setTargetPickerOpen(false)}
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <div className="cell-overlay" aria-live="polite">
              {meta.favicon ? <img src={meta.favicon} alt="" /> : <span className="favicon-placeholder" />}
              {meta.mode === 'search' && <span className="cell-mode-badge" title={t('gridCell.mode.search')}>⌕</span>}
              <span>{host}</span>
            </div>
            <div className="cell-menu" aria-label={t('gridCell.aria.controls', { host })}>
              <button
                type="button"
                title={t('gridCell.actions.forwardTo')}
                aria-label={t('gridCell.actions.forwardTo')}
                aria-expanded={targetPickerOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setTargetPickerOpen((open) => !open);
                }}
              >
                ⇥
              </button>
              <button type="button" title={t('gridCell.actions.reload')} aria-label={t('gridCell.actions.reloadCell')} onClick={() => window.electronAPI.reload(cellId)}>
                ↻
              </button>
              <button type="button" title={t('gridCell.actions.setAddress')} aria-label={t('gridCell.actions.setAddress')} onClick={() => void changeUrl()}>
                ⌘
              </button>
              <button type="button" title={t('gridCell.actions.openInNewTab')} aria-label={t('gridCell.actions.openInNewTab')} onClick={() => onNewTab(cellId, meta.url)}>
                +
              </button>
              <button
                type="button"
                className={meta.muted ? 'active' : ''}
                title={t('gridCell.actions.toggleMute')}
                aria-label={t('gridCell.actions.toggleMute')}
                aria-pressed={meta.muted}
                onClick={() => onToggleMute(cellId)}
              >
                M
              </button>
              <button
                type="button"
                className={meta.active ? 'active' : ''}
                title={t('gridCell.actions.toggleSync')}
                aria-label={t('gridCell.actions.toggleSync')}
                aria-pressed={meta.active}
                onClick={() => onToggle(cellId, !meta.active)}
              >
                ✓
              </button>
            </div>
          </>
        )}
      </div>
      {notice && <CellNotice notice={notice} onClose={() => setNotice(null)} />}
    </article>
  );
}

function safeHost(url: string, emptyLabel: string): string {
  try {
    return url ? new URL(url).host : emptyLabel;
  } catch {
    return url || emptyLabel;
  }
}

function getTargetLabel(targetCells: Array<{ cellId: string; label: string }>, cellId: string): string {
  return targetCells.find((target) => target.cellId === cellId)?.label ?? cellId.replace('cell-', 'Cell ');
}
