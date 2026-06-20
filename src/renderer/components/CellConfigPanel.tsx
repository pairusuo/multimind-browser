import { FormEvent, useState } from 'react';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES } from '../../shared/presetSites';
import { getRiskySiteReason } from '../../shared/riskySites';
import { CellMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';

interface CellConfigPanelProps {
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  layoutMode: LayoutMode;
  onClose: () => void;
  onSave: (
    nextUrls: Record<string, string>,
    nextModes: Record<string, CellMode>,
    nextSearchTemplates: Record<string, string>,
  ) => void;
}

export default function CellConfigPanel({
  cellUrls,
  cellModes,
  searchUrlTemplates,
  layoutMode,
  onClose,
  onSave,
}: CellConfigPanelProps) {
  const visibleCells = LAYOUT_CELLS[layoutMode];
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>(() => ({ ...cellUrls }));
  const [draftModes, setDraftModes] = useState<Record<string, CellMode>>(() => ({ ...cellModes }));
  const [draftSearchTemplates, setDraftSearchTemplates] = useState<Record<string, string>>(() => ({
    ...searchUrlTemplates,
  }));

  function updateDraftUrl(cellId: string, nextUrl: string) {
    const inferredMode = inferModeFromUrl(nextUrl);
    const matchedPreset = findPresetSiteByUrl(nextUrl);

    setDraftUrls((current) => ({
      ...current,
      [cellId]: nextUrl,
    }));

    if (inferredMode === 'unknown') {
      const previousUrl = draftUrls[cellId] ?? '';
      const previousWasUnknown = previousUrl.trim() !== '' && inferModeFromUrl(previousUrl) === 'unknown';
      setDraftModes((current) => ({
        ...current,
        [cellId]: previousWasUnknown ? current[cellId] ?? 'chat' : 'chat',
      }));
      if (!previousWasUnknown) {
        setDraftSearchTemplates((current) => ({
          ...current,
          [cellId]: '',
        }));
      }
      return;
    }

    setDraftModes((current) => ({
      ...current,
      [cellId]: inferredMode,
    }));
    setDraftSearchTemplates((current) => ({
      ...current,
      [cellId]: matchedPreset?.searchUrlTemplate ?? '',
    }));
  }

  function shouldShowSearchModeToggle(cellId: string): boolean {
    const url = draftUrls[cellId]?.trim() ?? '';
    return url !== '' && inferModeFromUrl(url) === 'unknown';
  }

  function getSelectedPresetId(cellId: string): string {
    return findPresetSiteByUrl(draftUrls[cellId] ?? '')?.id ?? 'custom';
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftUrls, draftModes, draftSearchTemplates);
  }

  return (
    <div className="modal-backdrop">
      <form className="cell-config-panel" aria-label="Edit cells" onSubmit={handleSubmit}>
        <header className="panel-header">
          <h1>编辑格子</h1>
          <button type="button" aria-label="Close panel" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="cell-config-list">
          {visibleCells.map((cellId, index) => (
            <section key={cellId} className="cell-config-row">
              <label htmlFor={`${cellId}-preset`}>格子 {index + 1}</label>
              <select
                id={`${cellId}-preset`}
                value={getSelectedPresetId(cellId)}
                onChange={(event) => {
                  const preset = PRESET_SITES.find((site) => site.id === event.target.value);
                  if (preset) {
                    updateDraftUrl(cellId, preset.url);
                  } else {
                    updateDraftUrl(cellId, '');
                  }
                }}
              >
                <optgroup label="AI 助手">
                  {PRESET_SITES.filter((site) => site.mode === 'chat').map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="搜索引擎">
                  {PRESET_SITES.filter((site) => site.mode === 'search').map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </optgroup>
                <option value="custom">自定义 URL</option>
              </select>
              <input
                value={draftUrls[cellId] ?? ''}
                onChange={(event) => updateDraftUrl(cellId, event.target.value)}
                placeholder="https://example.com"
                spellCheck={false}
              />
              {shouldShowSearchModeToggle(cellId) && (
                <label className="search-mode-toggle">
                  <input
                    type="checkbox"
                    checked={draftModes[cellId] === 'search'}
                    onChange={(event) => {
                      const nextMode: CellMode = event.target.checked ? 'search' : 'chat';
                      setDraftModes((current) => ({
                        ...current,
                        [cellId]: nextMode,
                      }));
                      if (nextMode === 'search' && !draftSearchTemplates[cellId]) {
                        setDraftSearchTemplates((current) => ({
                          ...current,
                          [cellId]: 'https://www.google.com/search?q={query}',
                        }));
                      }
                    }}
                  />
                  这是搜索引擎
                </label>
              )}
              {shouldShowSearchModeToggle(cellId) && draftModes[cellId] === 'search' && (
                <input
                  className="search-template-input"
                  value={draftSearchTemplates[cellId] ?? ''}
                  onChange={(event) =>
                    setDraftSearchTemplates((current) => ({
                      ...current,
                      [cellId]: event.target.value,
                    }))
                  }
                  placeholder="https://example.com/search?q={query}"
                  spellCheck={false}
                />
              )}
              {getRiskySiteReason(draftUrls[cellId]) && (
                <p className="risk-warning">{getRiskySiteReason(draftUrls[cellId])}</p>
              )}
            </section>
          ))}
        </div>
        <footer className="panel-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit">确认</button>
        </footer>
      </form>
    </div>
  );
}
