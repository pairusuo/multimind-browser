import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES } from '../../shared/presetSites';
import { getRiskySiteReasonKey } from '../../shared/riskySites';
import { ApiConversationConfig, AppLanguage, CellMode, ConversationEntryMode, LAYOUT_CELLS, LayoutMode, ThemeMode } from '../../shared/types';

interface CellConfigPanelProps {
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  language: AppLanguage;
  conversationEntryMode: ConversationEntryMode;
  apiConfig: ApiConversationConfig;
  forwardControlsEnabled: boolean;
  layoutMode: LayoutMode;
  themeMode: ThemeMode;
  onClose: () => void;
  onLayoutChange: (mode: LayoutMode) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onConversationEntryModeChange: (mode: ConversationEntryMode) => void;
  onForwardControlsEnabledChange: (enabled: boolean) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onOpenMemory: () => void;
  onSaveApiConfig: (payload: { baseUrl: string; apiKey?: string; models: string[]; cellModels?: Record<string, string> }) => void;
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
  conversationEntryMode,
  apiConfig,
  forwardControlsEnabled,
  layoutMode,
  themeMode,
  onClose,
  onLayoutChange,
  onLanguageChange,
  onConversationEntryModeChange,
  onForwardControlsEnabledChange,
  onThemeModeChange,
  onOpenMemory,
  onSaveApiConfig,
  onSave,
}: CellConfigPanelProps) {
  const { t } = useTranslation();
  const visibleCells = LAYOUT_CELLS[layoutMode];
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>(() => ({ ...cellUrls }));
  const [draftModes, setDraftModes] = useState<Record<string, CellMode>>(() => ({ ...cellModes }));
  const [draftSearchTemplates, setDraftSearchTemplates] = useState<Record<string, string>>(() => ({
    ...searchUrlTemplates,
  }));
  const [draftApiBaseUrl, setDraftApiBaseUrl] = useState(apiConfig.baseUrl);
  const [draftApiKey, setDraftApiKey] = useState('');
  const [draftApiModels, setDraftApiModels] = useState(apiConfig.models.join(', '));
  const [draftApiCellModels, setDraftApiCellModels] = useState<Record<string, string>>(() => ({
    ...(apiConfig.cellModels ?? {}),
  }));
  const [appVersion, setAppVersion] = useState('');
  const apiModelOptions = splitModels(draftApiModels);

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

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
    onSaveApiConfig({
      baseUrl: draftApiBaseUrl,
      apiKey: draftApiKey,
      models: apiModelOptions,
      cellModels: draftApiCellModels,
    });
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
          <span className="settings-section-label">{t('settings.layout.label')}</span>
          <div className="settings-segmented-control settings-layout-control" role="radiogroup" aria-label={t('settings.layout.label')}>
            {LAYOUT_OPTIONS.map((option) => (
              <label key={option.mode} className={layoutMode === option.mode ? 'active' : ''} title={t(option.titleKey)}>
                <input
                  type="radio"
                  name="workspace-layout"
                  value={option.mode}
                  checked={layoutMode === option.mode}
                  onChange={() => onLayoutChange(option.mode)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <span className="settings-section-label">{t('settings.theme.label')}</span>
          <div className="settings-segmented-control settings-theme-control" role="radiogroup" aria-label={t('settings.theme.label')}>
            {(['system', 'light', 'dark'] as const).map((option) => (
              <label key={option} className={themeMode === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="theme-mode"
                  value={option}
                  checked={themeMode === option}
                  onChange={() => onThemeModeChange(option)}
                />
                <span>{t(`settings.theme.options.${option}`)}</span>
              </label>
            ))}
          </div>
          <span className="settings-section-label">{t('settings.language.label')}</span>
          <div className="settings-segmented-control settings-language-control" role="radiogroup" aria-label={t('settings.language.label')}>
            {(['zh', 'en'] as const).map((option) => (
              <label key={option} className={language === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="app-language"
                  value={option}
                  checked={language === option}
                  onChange={() => onLanguageChange(option)}
                />
                <span>{t(`settings.language.options.${option}`)}</span>
              </label>
            ))}
          </div>
          <span className="settings-section-label">{t('settings.conversationEntry.label')}</span>
          <div className="settings-segmented-control settings-entry-control" role="radiogroup" aria-label={t('settings.conversationEntry.label')}>
            {(['embedded', 'api'] as const).map((option) => (
              <label key={option} className={conversationEntryMode === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="conversation-entry-mode"
                  value={option}
                  checked={conversationEntryMode === option}
                  onChange={() => onConversationEntryModeChange(option)}
                />
                <span>{t(`settings.conversationEntry.options.${option}`)}</span>
              </label>
            ))}
          </div>
          {conversationEntryMode === 'api' && (
            <>
              <span className="settings-section-label">{t('settings.apiConversation.baseUrl')}</span>
              <input
                className="settings-text-input"
                value={draftApiBaseUrl}
                onChange={(event) => setDraftApiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <span className="settings-section-label">{t('settings.apiConversation.apiKey')}</span>
              <input
                className="settings-text-input"
                type="password"
                value={draftApiKey}
                onChange={(event) => setDraftApiKey(event.target.value)}
                placeholder={apiConfig.apiKeyConfigured
                  ? t('settings.apiConversation.apiKeyConfigured')
                  : t('settings.apiConversation.apiKeyPlaceholder')}
              />
              <span className="settings-section-label">{t('settings.apiConversation.models')}</span>
              <input
                className="settings-text-input"
                value={draftApiModels}
                onChange={(event) => setDraftApiModels(event.target.value)}
                placeholder="gpt-4o-mini, gpt-4.1-mini"
              />
            </>
          )}
          <span className="settings-section-label">{t('settings.memory.label')}</span>
          <button type="button" className="settings-memory-button" onClick={onOpenMemory}>
            <MemoryIcon />
            <span>{t('settings.memory.open')}</span>
          </button>
          <span className="settings-section-label">{t('settings.forward.toggle')}</span>
          <div className="settings-forward-control">
            <label className="settings-forward-toggle" aria-label={t('settings.forward.toggle')}>
              <input
                type="checkbox"
                role="switch"
                checked={forwardControlsEnabled}
                onChange={(event) => onForwardControlsEnabledChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>
            <span className="settings-forward-hint">{t('settings.forward.hint')}</span>
          </div>
          <span className="settings-section-label">{t('settings.version.label')}</span>
          <span className="app-version">
            {appVersion ? t('settings.version.value', { version: appVersion }) : t('settings.version.loading')}
          </span>
        </section>
        <div className="cell-config-list">
          {conversationEntryMode === 'api'
            ? visibleCells.map((cellId, index) => (
                <ApiCellConfigRow
                  key={cellId}
                  cellId={cellId}
                  index={index}
                  model={draftApiCellModels[cellId] ?? apiModelOptions[index] ?? ''}
                  modelOptions={apiModelOptions}
                  onModelChange={(model) =>
                    setDraftApiCellModels((current) => ({
                      ...current,
                      [cellId]: model,
                    }))
                  }
                />
              ))
            : visibleCells.map((cellId, index) => (
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

function splitModels(value: string): string[] {
  const models = value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(models)].slice(0, 4);
}

const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; label: string; titleKey: string }> = [
  { mode: 'single', label: '1', titleKey: 'settings.layout.options.single' },
  { mode: 'horizontal', label: '2H', titleKey: 'settings.layout.options.horizontal' },
  { mode: 'vertical', label: '2V', titleKey: 'settings.layout.options.vertical' },
  { mode: 'triple', label: '3', titleKey: 'settings.layout.options.triple' },
  { mode: 'quad', label: '4', titleKey: 'settings.layout.options.quad' },
];

function MemoryIcon() {
  return (
    <svg className="settings-memory-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4.75h10.5L19 8.25v11H5Z" />
      <path d="M15.5 4.75v3.5H19" />
      <path d="M8.25 12h7.5" />
      <path d="M8.25 15.5h5.5" />
    </svg>
  );
}

interface ApiCellConfigRowProps {
  cellId: string;
  index: number;
  model: string;
  modelOptions: string[];
  onModelChange: (model: string) => void;
}

function ApiCellConfigRow({ cellId, index, model, modelOptions, onModelChange }: ApiCellConfigRowProps) {
  const { t } = useTranslation();
  const options = model && !modelOptions.includes(model) ? [model, ...modelOptions] : modelOptions;

  return (
    <section className="cell-config-row api-cell-config-row">
      <label htmlFor={`${cellId}-api-model`}>{t('cellConfig.cell.label', { index: index + 1 })}</label>
      <select
        id={`${cellId}-api-model`}
        className="preset-select"
        value={model}
        onChange={(event) => onModelChange(event.target.value)}
      >
        <option value="">{t('gridCell.api.emptyModel')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="api-cell-config-hint">{t('settings.apiConversation.cellModelHint')}</span>
    </section>
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
        className="preset-select"
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
