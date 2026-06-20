import { FormEvent, useEffect, useRef, useState } from 'react';
import { getRiskySiteReason } from '../../shared/riskySites';
import { CellTab, LayoutMode, ThemeMode } from '../../shared/types';

interface ToolbarProps {
  currentUrl: string;
  focusedCellId: string;
  tabs: CellTab[];
  activeTabId: string;
  themeMode: ThemeMode;
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onOpenConfig: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onNavigate: (url: string) => void;
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
  tabs,
  activeTabId,
  themeMode,
  layoutMode,
  onLayoutChange,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onOpenConfig,
  onThemeModeChange,
  onNavigate,
}: ToolbarProps) {
  const [draftUrl, setDraftUrl] = useState(currentUrl);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const addressRiskReason = layoutMode === 'single' ? getRiskySiteReason(draftUrl) : null;
  const showTabs = layoutMode === 'single';

  useEffect(() => {
    setDraftUrl(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    tabRefs.current[activeTabId]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeTabId, tabs.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = draftUrl.trim();
    if (!nextUrl) {
      return;
    }

    onNavigate(nextUrl);
  }

  async function handleLayoutChange(mode: LayoutMode) {
    onLayoutChange(mode);
    await window.electronAPI.setLayout(mode);
  }

  function cycleThemeMode() {
    const nextMode: ThemeMode = themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system';
    onThemeModeChange(nextMode);
  }

  return (
    <header className={`toolbar${showTabs ? ' toolbar-single' : ''}`}>
      <div className="toolbar-brand" title="MultiMind Browser" aria-label="MultiMind Browser">
        <MultiMindLogo />
      </div>
      {showTabs && (
        <div className="tab-controls" aria-label="Tabs">
          <div className="browser-tabs" role="tablist" aria-label="Open tabs">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[tab.id] = element;
                  }}
                  role="tab"
                  className={`browser-tab${active ? ' active' : ''}`}
                  aria-selected={active}
                  title={tab.title || tab.url || 'New tab'}
                >
                  <button type="button" className="browser-tab-title" onClick={() => onSwitchTab(tab.id)}>
                    {tab.favicon ? <img className="browser-tab-favicon" src={tab.favicon} alt="" /> : null}
                    <span>{tab.title || tab.url || 'New tab'}</span>
                  </button>
                  <button
                    type="button"
                    className="browser-tab-close"
                    aria-label="Close tab"
                    disabled={!activeTabId}
                    onClick={() => onCloseTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        <button type="button" title="New tab" aria-label="New tab" onClick={onNewTab}>
          +
        </button>
        </div>
      )}
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
        <button type="button" className="toolbar-icon-button" title="Edit cells" aria-label="Edit cells" onClick={onOpenConfig}>
          ⚙
        </button>
        <button type="button" className="toolbar-icon-button" title={`Theme: ${themeMode}`} aria-label="Toggle theme" onClick={cycleThemeMode}>
          {themeMode === 'system' ? '◐' : themeMode === 'dark' ? '☾' : '☀'}
        </button>
      </div>
    </header>
  );
}

function MultiMindLogo() {
  return (
    <svg className="multimind-logo" viewBox="0 0 40 40" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="multimind-logo-fill" x1="7" y1="5" x2="33" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="30" height="30" rx="8" fill="url(#multimind-logo-fill)" />
      <path
        d="M10.2 29V11.4c0-1.5 1.8-2.2 2.8-1.2L20 17l7-6.8c1-1 2.8-.3 2.8 1.2V29"
        fill="none"
        stroke="#fff"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.7 27V22.5L20 25.4l4.3-2.9V27"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />
    </svg>
  );
}
