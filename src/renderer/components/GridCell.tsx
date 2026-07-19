import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiConversationCellState, CellMode, CellNoticePayload, ConversationEntryMode, LayoutMode } from '../../shared/types';
import CellNotice from './CellNotice';

const shownNoticeKeys = new Set<string>();
const repeatableNoticeTypes = new Set<CellNoticePayload['type']>(['conversation-truncated', 'source-response-pending']);

interface GridCellProps {
  cellId: string;
  className: string;
  focused: boolean;
  conversationEntryMode: ConversationEntryMode;
  apiState: ApiConversationCellState | undefined;
  apiModels: string[];
  layoutMode: LayoutMode;
  maximized: boolean;
  showForwardControl: boolean;
  targetCells: Array<{ cellId: string; label: string }>;
  meta: {
    url: string;
    mode: CellMode;
    favicon: string | null;
    active: boolean;
  };
  onFocus: (cellId: string, url: string) => void;
  onToggleMaximized: (cellId: string) => void;
  onNewTab: (cellId: string, url?: string) => void;
  onToggle: (cellId: string, active: boolean) => void;
  onApiModelChange: (cellId: string, model: string) => void;
  onApiForward: (sourceCellId: string, targetCellId: string) => Promise<void>;
}

export default function GridCell({
  cellId,
  className,
  focused,
  conversationEntryMode,
  apiState,
  apiModels,
  layoutMode,
  maximized,
  showForwardControl,
  targetCells,
  meta,
  onFocus,
  onToggleMaximized,
  onNewTab,
  onToggle,
  onApiModelChange,
  onApiForward,
}: GridCellProps) {
  const { t } = useTranslation();
  const isApiMode = conversationEntryMode === 'api';
  const host = isApiMode ? apiState?.model || t('gridCell.api.emptyModel') : safeHost(meta.url, t('gridCell.empty'));
  const [notice, setNotice] = useState<CellNoticePayload | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [forwardingTargetId, setForwardingTargetId] = useState<string | null>(null);
  const [forwardStatus, setForwardStatus] = useState<string | null>(null);
  const showCellMenu = layoutMode !== 'single';

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

  async function forwardTo(targetCellId: string) {
    setTargetPickerOpen(false);
    setForwardingTargetId(targetCellId);
    const targetLabel = getTargetLabel(targetCells, targetCellId);
    setForwardStatus(t('gridCell.forward.status.forwarding', { target: targetLabel }));

    try {
      if (isApiMode) {
        await onApiForward(cellId, targetCellId);
        setForwardStatus(t('gridCell.forward.status.completed', { target: targetLabel }));
      } else {
        const record = await window.electronAPI.forwardResponse({ sourceCellId: cellId, targetCellId });
        setForwardStatus(record.sourceTruncated
          ? t('gridCell.forward.status.completedTruncated', { target: targetLabel })
          : t('gridCell.forward.status.completed', { target: targetLabel }));
      }
    } catch (error) {
      console.error('Forward response failed:', error);
      setForwardStatus(t('gridCell.forward.status.failed', { target: targetLabel }));
    } finally {
      setForwardingTargetId(null);
    }
  }

  return (
    <article
      className={`grid-cell ${className}${isApiMode ? ' api-grid-cell' : ''}${focused ? ' focused' : ''}${maximized ? ' maximized' : ''}`}
      aria-label={t(isApiMode ? 'gridCell.aria.apiCell' : 'gridCell.aria.browserCell', { host })}
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
              {isApiMode ? <span className="favicon-placeholder api-favicon-placeholder" /> : meta.favicon ? <img src={meta.favicon} alt="" /> : <span className="favicon-placeholder" />}
              {!isApiMode && meta.mode === 'search' && <span className="cell-mode-badge" title={t('gridCell.mode.search')}>⌕</span>}
              {isApiMode ? (
                <select
                  className="api-model-select"
                  value={apiState?.model ?? ''}
                  aria-label={t('gridCell.api.modelSelect')}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onApiModelChange(cellId, event.target.value)}
                >
                  <option value="">{t('gridCell.api.emptyModel')}</option>
                  {getApiModelOptions(apiState?.model ?? '', apiModels).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{host}</span>
              )}
            </div>
            {(isApiMode || showCellMenu) && (
              <div className="cell-menu" aria-label={t('gridCell.aria.controls', { host })}>
              {showForwardControl && targetCells.length > 0 && (!isApiMode || Boolean(apiState?.content.trim())) && (
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
              )}
              <button
                type="button"
                className={maximized ? 'active' : ''}
                title={maximized ? t('gridCell.actions.restoreCell') : t('gridCell.actions.maximizeCell')}
                aria-label={maximized ? t('gridCell.actions.restoreCell') : t('gridCell.actions.maximizeCell')}
                aria-pressed={maximized}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMaximized(cellId);
                }}
              >
                {maximized ? '▣' : '□'}
              </button>
              {!isApiMode && (
                <>
                  <button type="button" title={t('gridCell.actions.reload')} aria-label={t('gridCell.actions.reloadCell')} onClick={() => window.electronAPI.reload(cellId)}>
                    ↻
                  </button>
                  <button type="button" title={t('gridCell.actions.newTab')} aria-label={t('gridCell.actions.newTab')} onClick={() => onNewTab(cellId)}>
                    +
                  </button>
                </>
              )}
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
            )}
          </>
        )}
      </div>
      {isApiMode && <ApiCellBody state={apiState} />}
      {notice && <CellNotice notice={notice} onClose={() => setNotice(null)} />}
    </article>
  );
}

function ApiCellBody({ state }: { state: ApiConversationCellState | undefined }) {
  const { t } = useTranslation();

  if (!state?.model) {
    return (
      <div className="api-cell-body api-cell-empty">
        <p>{t('gridCell.api.noModel')}</p>
      </div>
    );
  }

  if (state.status === 'running') {
    return (
      <div className="api-cell-body api-cell-empty" role="status">
        <p>{t('gridCell.api.running')}</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="api-cell-body">
        <p className="api-cell-error">{state.error || t('gridCell.api.failed')}</p>
      </div>
    );
  }

  if (!state.content) {
    return (
      <div className="api-cell-body api-cell-empty">
        <p>{t('gridCell.api.placeholder')}</p>
      </div>
    );
  }

  return (
    <div className="api-cell-body">
      {typeof state.elapsedMs === 'number' && (
        <div className="api-cell-meta">{t('gridCell.api.elapsed', { seconds: (state.elapsedMs / 1000).toFixed(1) })}</div>
      )}
      <pre>{state.content}</pre>
    </div>
  );
}

function getTargetLabel(targetCells: Array<{ cellId: string; label: string }>, cellId: string): string {
  return targetCells.find((target) => target.cellId === cellId)?.label ?? cellId.replace('cell-', 'Cell ');
}

function getApiModelOptions(selectedModel: string, models: string[]): string[] {
  return selectedModel && !models.includes(selectedModel) ? [selectedModel, ...models] : models;
}

function safeHost(url: string, emptyLabel: string): string {
  try {
    return url ? new URL(url).host : emptyLabel;
  } catch {
    return url || emptyLabel;
  }
}
