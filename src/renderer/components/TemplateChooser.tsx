import { LAYOUT_TEMPLATES, LayoutTemplate } from '../../shared/presetTemplates';

interface TemplateChooserProps {
  onApplyTemplate: (template: LayoutTemplate) => void;
}

export default function TemplateChooser({ onApplyTemplate }: TemplateChooserProps) {
  return (
    <div className="modal-backdrop">
      <section className="template-panel" aria-label="Choose layout template">
        <header>
          <h1>选择初始布局</h1>
        </header>
        <div className="template-grid">
          {LAYOUT_TEMPLATES.map((template) => (
            <button key={template.id} type="button" className="template-card" onClick={() => onApplyTemplate(template)}>
              <span>{template.name}</span>
              <small>{template.siteIds.length} 个格子</small>
            </button>
          ))}
          <button
            type="button"
            className="template-card"
            onClick={() =>
              onApplyTemplate({
                id: 'custom',
                name: '自定义',
                layout: 'triple',
                siteIds: [],
              })
            }
          >
            <span>自定义</span>
            <small>手动选择网站</small>
          </button>
        </div>
      </section>
    </div>
  );
}
