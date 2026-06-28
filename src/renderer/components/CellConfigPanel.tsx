import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES } from '../../shared/presetSites';
import { getRiskySiteReasonKey } from '../../shared/riskySites';
import { AppLanguage, CellMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';

interface CellConfigPanelProps {
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  language: AppLanguage;
  layoutMode: LayoutMode;
  onClose: () => void;
  onLanguageChange: (language: AppLanguage) => void;
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
  language,
  layoutMode,
  onClose,
  onLanguageChange,
  onSave,
}: CellConfigPanelProps) {
  const { t } = useTranslation();
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
      <form className="cell-config-panel" aria-label={t('cellConfig.aria.panel')} onSubmit={handleSubmit}>
        <header className="panel-header">
          <h1>{t('cellConfig.title')}</h1>
          <button type="button" aria-label={t('cellConfig.actions.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <section className="settings-section" aria-label={t('settings.title')}>
          <label htmlFor="language-select">{t('settings.language.label')}</label>
          <select
            id="language-select"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
          >
            <option value="zh">{t('settings.language.options.zh')}</option>
            <option value="en">{t('settings.language.options.en')}</option>
          </select>
        </section>
        <div className="cell-config-list">
          {visibleCells.map((cellId, index) => (
            <CellConfigRow
              key={cellId}
              cellId={cellId}
              index={index}
              draftUrl={draftUrls[cellId] ?? ''}
              draftMode={draftModes[cellId] ?? 'chat'}
              draftSearchTemplate={draftSearchTemplates[cellId] ?? ''}
              selectedPresetId={getSelectedPresetId(cellId)}
              showSearchModeToggle={shouldShowSearchModeToggle(cellId)}
              onDraftUrlChange={updateDraftUrl}
              onDraftModeChange={(nextMode) => {
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
              onSearchTemplateChange={(nextTemplate) =>
                setDraftSearchTemplates((current) => ({
                  ...current,
                  [cellId]: nextTemplate,
                }))
              }
            />
          ))}
        </div>
        <footer className="panel-actions">
          <button type="button" onClick={onClose}>
            {t('cellConfig.actions.cancel')}
          </button>
          <button type="submit">{t('cellConfig.actions.confirm')}</button>
        </footer>
      </form>
    </div>
  );
}

interface CellConfigRowProps {
  cellId: string;
  index: number;
  draftUrl: string;
  draftMode: CellMode;
  draftSearchTemplate: string;
  selectedPresetId: string;
  showSearchModeToggle: boolean;
  onDraftUrlChange: (cellId: string, nextUrl: string) => void;
  onDraftModeChange: (nextMode: CellMode) => void;
  onSearchTemplateChange: (nextTemplate: string) => void;
}

function CellConfigRow({
  cellId,
  index,
  draftUrl,
  draftMode,
  draftSearchTemplate,
  selectedPresetId,
  showSearchModeToggle,
  onDraftUrlChange,
  onDraftModeChange,
  onSearchTemplateChange,
}: CellConfigRowProps) {
  const { t } = useTranslation();
  const riskReasonKey = getRiskySiteReasonKey(draftUrl);

  return (
    <section className="cell-config-row">
      <label htmlFor={`${cellId}-preset`}>{t('cellConfig.cell.label', { index: index + 1 })}</label>
      <select
        id={`${cellId}-preset`}
        value={selectedPresetId}
        onChange={(event) => {
          const preset = PRESET_SITES.find((site) => site.id === event.target.value);
          onDraftUrlChange(cellId, preset ? preset.url : '');
        }}
      >
        <optgroup label={t('cellConfig.groups.chat')}>
          {PRESET_SITES.filter((site) => site.mode === 'chat').map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('cellConfig.groups.search')}>
          {PRESET_SITES.filter((site) => site.mode === 'search').map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </optgroup>
        <option value="custom">{t('cellConfig.customUrl')}</option>
      </select>
      <input
        value={draftUrl}
        onChange={(event) => onDraftUrlChange(cellId, event.target.value)}
        placeholder="https://example.com"
        spellCheck={false}
      />
      {showSearchModeToggle && (
        <label className="search-mode-toggle">
          <input
            type="checkbox"
            checked={draftMode === 'search'}
            onChange={(event) => onDraftModeChange(event.target.checked ? 'search' : 'chat')}
          />
          {t('cellConfig.searchModeToggle')}
        </label>
      )}
      {showSearchModeToggle && draftMode === 'search' && (
        <input
          className="search-template-input"
          value={draftSearchTemplate}
          onChange={(event) => onSearchTemplateChange(event.target.value)}
          placeholder="https://example.com/search?q={query}"
          spellCheck={false}
        />
      )}
      {riskReasonKey && <p className="risk-warning">{t(riskReasonKey)}</p>}
    </section>
  );
}
