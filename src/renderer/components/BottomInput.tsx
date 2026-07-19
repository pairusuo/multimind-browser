import { KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConversationEntryMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';

const newConversationIconUrl = new URL('../assets/new-conversation.svg', import.meta.url).href;

interface BottomInputProps {
  activeCells: Record<string, boolean>;
  availableCells: Record<string, boolean>;
  conversationEntryMode: ConversationEntryMode;
  layoutMode: LayoutMode;
  onGenerateDocument: () => void;
  onSend: (text: string) => Promise<void>;
  onStartNewDiscussion: () => void;
  onToggleCell: (cellId: string, active: boolean) => void;
}

export default function BottomInput({
  activeCells,
  availableCells,
  conversationEntryMode,
  layoutMode,
  onGenerateDocument,
  onSend,
  onStartNewDiscussion,
  onToggleCell,
}: BottomInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [lastSentText, setLastSentText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const visibleCells = LAYOUT_CELLS[layoutMode];

  if (layoutMode === 'single' && conversationEntryMode === 'embedded') {
    return null;
  }

  async function send() {
    const nextText = text.trim();
    if (!nextText || isSending) {
      return;
    }

    setIsSending(true);
    try {
      await onSend(nextText);
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
    <aside className={`bottom-input-shell${conversationEntryMode === 'api' ? ' bottom-input-api-mode' : ''}`} aria-label={t('bottomInput.label')}>
      <div className="sync-cell-toggles" aria-label={t('bottomInput.syncCells')}>
        {visibleCells.map((cellId, index) => {
          const available = Boolean(availableCells[cellId]);
          const active = Boolean(activeCells[cellId] && available);
          return (
            <button
              key={cellId}
              type="button"
              className={active ? 'active' : ''}
              disabled={!available || isSending}
              title={available
                ? t('bottomInput.cellToggle.title', { index: index + 1 })
                : t(conversationEntryMode === 'api' ? 'bottomInput.cellToggle.noModel' : 'bottomInput.cellToggle.noUrl', { index: index + 1 })}
              aria-label={t('bottomInput.cellToggle.aria', { index: index + 1 })}
              aria-pressed={active}
              onClick={() => onToggleCell(cellId, !active)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="new-discussion-button"
        title={t('bottomInput.newDiscussion')}
        aria-label={t('bottomInput.newDiscussion')}
        disabled={isSending}
        onClick={onStartNewDiscussion}
      >
        <img src={newConversationIconUrl} alt="" />
      </button>
      <button
        type="button"
        className="generate-document-button"
        title={t('bottomInput.generateDocument')}
        aria-label={t('bottomInput.generateDocument')}
        disabled={isSending}
        onClick={onGenerateDocument}
      >
        <DocumentSummaryIcon />
      </button>
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

function DocumentSummaryIcon() {
  return (
    <svg className="document-summary-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3.75h7.1L18 7.65v12.6H7z" />
      <path d="M14 3.75v4h4" />
      <path d="M9.5 11h6" />
      <path d="M9.5 14h5.1" />
      <path d="M9.5 17h3.4" />
    </svg>
  );
}
