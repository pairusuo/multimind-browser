import { LayoutMode } from '../../shared/types';

interface BottomInputProps {
  layoutMode: LayoutMode;
}

export default function BottomInput({ layoutMode }: BottomInputProps) {
  if (layoutMode === 'single') {
    return null;
  }

  return (
    <aside className="bottom-input-shell" aria-label="Unified input">
      <div className="bottom-input-placeholder" />
    </aside>
  );
}
