import { KeyboardEvent, useState } from 'react';
import { LAYOUT_CELLS, LayoutMode } from '../../shared/types';

interface BottomInputProps {
  activeCells: Record<string, boolean>;
  cellUrls: Record<string, string>;
  layoutMode: LayoutMode;
  onToggleCell: (cellId: string, active: boolean) => void;
}

export default function BottomInput({ activeCells, cellUrls, layoutMode, onToggleCell }: BottomInputProps) {
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
    <aside className="bottom-input-shell" aria-label="Unified input">
      <div className="sync-cell-toggles" aria-label="Synchronized cells">
        {visibleCells.map((cellId, index) => {
          const hasUrl = Boolean(cellUrls[cellId]?.trim());
          const active = Boolean(activeCells[cellId] && hasUrl);
          return (
            <button
              key={cellId}
              type="button"
              className={active ? 'active' : ''}
              disabled={!hasUrl || isSending}
              title={hasUrl ? `Toggle cell ${index + 1}` : `Cell ${index + 1} has no URL`}
              aria-label={`Toggle cell ${index + 1}`}
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
        placeholder="输入后按 Enter 同步发送，Shift+Enter 换行"
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
        {isSending ? '发送中' : '发送'}
      </button>
    </aside>
  );
}
