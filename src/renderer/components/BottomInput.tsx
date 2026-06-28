import { KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LAYOUT_CELLS, LayoutMode } from '../../shared/types';

interface BottomInputProps {
  activeCells: Record<string, boolean>;
  cellUrls: Record<string, string>;
  layoutMode: LayoutMode;
  onToggleCell: (cellId: string, active: boolean) => void;
}

export default function BottomInput({ activeCells, cellUrls, layoutMode, onToggleCell }: BottomInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [lastSentText, setLastSentText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const visibleCells = LAYOUT_CELLS[layoutMode];

  if (layoutMode === 'single') {
    return null;
  }

  async function send() {
    const nextText = text.trim();
    if (!nextText || isSending) {
      return;
    }

    setIsSending(true);
    try {
      await window.electronAPI.sendToAll({ text: nextText });
      setLastSentText(nextText);
      setText('');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }

    if (event.key === 'ArrowUp' && !text && lastSentText) {
      event.preventDefault();
      setText(lastSentText);
    }
  }

  return (
    <aside className="bottom-input-shell" aria-label={t('bottomInput.label')}>
      <div className="sync-cell-toggles" aria-label={t('bottomInput.syncCells')}>
        {visibleCells.map((cellId, index) => {
          const hasUrl = Boolean(cellUrls[cellId]?.trim());
          const active = Boolean(activeCells[cellId] && hasUrl);
          return (
            <button
              key={cellId}
              type="button"
              className={active ? 'active' : ''}
              disabled={!hasUrl || isSending}
              title={hasUrl
                ? t('bottomInput.cellToggle.title', { index: index + 1 })
                : t('bottomInput.cellToggle.noUrl', { index: index + 1 })}
              aria-label={t('bottomInput.cellToggle.aria', { index: index + 1 })}
              aria-pressed={active}
              onClick={() => onToggleCell(cellId, !active)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      <textarea
        value={text}
        disabled={isSending}
        placeholder={t('bottomInput.placeholder')}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="send-all-button"
        disabled={isSending || !text.trim()}
        onClick={() => void send()}
      >
        {isSending ? t('bottomInput.sending') : t('bottomInput.send')}
      </button>
    </aside>
  );
}
