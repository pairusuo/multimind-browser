import { FormEvent, useEffect, useState } from 'react';
import { getRiskySiteReason } from '../../shared/riskySites';
import { LayoutMode } from '../../shared/types';

interface ToolbarProps {
  currentUrl: string;
  focusedCellId: string;
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onOpenConfig: () => void;
  onUrlChange: (url: string) => void;
}

const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; label: string; title: string }> = [
  { mode: 'single', label: '1', title: 'Single view' },
  { mode: 'horizontal', label: '2H', title: 'Side by side' },
  { mode: 'vertical', label: '2V', title: 'Stacked' },
  { mode: 'triple', label: '3', title: 'Triple view' },
  { mode: 'quad', label: '4', title: 'Quad view' },
];

export default function Toolbar({
  currentUrl,
  focusedCellId,
  layoutMode,
  onLayoutChange,
  onOpenConfig,
  onUrlChange,
}: ToolbarProps) {
  const [draftUrl, setDraftUrl] = useState(currentUrl);
  const addressRiskReason = layoutMode === 'single' ? getRiskySiteReason(draftUrl) : null;

  useEffect(() => {
    setDraftUrl(currentUrl);
  }, [currentUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = draftUrl.trim();
    if (!nextUrl) {
      return;
    }

    onUrlChange(nextUrl);
    await window.electronAPI.navigate({ cellId: focusedCellId, url: nextUrl });
  }

  async function handleLayoutChange(mode: LayoutMode) {
    onLayoutChange(mode);
    await window.electronAPI.setLayout(mode);
  }

  return (
    <header className="toolbar">
      <div className="toolbar-brand">MultiMind Browser</div>
      <nav className="navigation-controls" aria-label="Browser navigation">
        <button type="button" aria-label="Go back" onClick={() => window.electronAPI.navigateBack(focusedCellId)}>
          ←
        </button>
        <button type="button" aria-label="Go forward" onClick={() => window.electronAPI.navigateForward(focusedCellId)}>
          →
        </button>
        <button type="button" aria-label="Reload page" onClick={() => window.electronAPI.reload(focusedCellId)}>
          ↻
        </button>
      </nav>
      <form className={`address-form${addressRiskReason ? ' has-risk' : ''}`} onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="address-input">
          Address
        </label>
        <input
          id="address-input"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="Search or enter website address"
          autoComplete="off"
          spellCheck={false}
        />
        {addressRiskReason && (
          <p className="address-risk-warning" title={addressRiskReason}>
            Gemini 登录受限
          </p>
        )}
      </form>
      <div className="layout-controls" role="group" aria-label="Layout">
        {LAYOUT_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={layoutMode === option.mode ? 'active' : ''}
            title={option.title}
            aria-pressed={layoutMode === option.mode}
            onClick={() => void handleLayoutChange(option.mode)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" title="Edit cells" aria-label="Edit cells" onClick={onOpenConfig}>
          ⚙
        </button>
      </div>
    </header>
  );
}
