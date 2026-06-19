import { FormEvent, useMemo, useState } from 'react';
import { PRESET_SITES } from '../../shared/presetSites';
import { getRiskySiteReason } from '../../shared/riskySites';
import { LAYOUT_CELLS, LayoutMode } from '../../shared/types';

interface CellConfigPanelProps {
  cellUrls: Record<string, string>;
  layoutMode: LayoutMode;
  onClose: () => void;
  onSave: (nextUrls: Record<string, string>) => void;
}

export default function CellConfigPanel({ cellUrls, layoutMode, onClose, onSave }: CellConfigPanelProps) {
  const visibleCells = LAYOUT_CELLS[layoutMode];
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>(() => ({ ...cellUrls }));
  const presetByUrl = useMemo(() => new Map(PRESET_SITES.map((site) => [site.url, site.id])), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftUrls);
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
                value={presetByUrl.get(draftUrls[cellId]) ?? 'custom'}
                onChange={(event) => {
                  const preset = PRESET_SITES.find((site) => site.id === event.target.value);
                  setDraftUrls((current) => ({
                    ...current,
                    [cellId]: preset?.url ?? current[cellId] ?? '',
                  }));
                }}
              >
                <option value="custom">自定义 URL</option>
                <optgroup label="International">
                  {PRESET_SITES.filter((site) => site.region === 'international').map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="China">
                  {PRESET_SITES.filter((site) => site.region === 'china').map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                value={draftUrls[cellId] ?? ''}
                onChange={(event) =>
                  setDraftUrls((current) => ({
                    ...current,
                    [cellId]: event.target.value,
                  }))
                }
                placeholder="https://example.com"
                spellCheck={false}
              />
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
