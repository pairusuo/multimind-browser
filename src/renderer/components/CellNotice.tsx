import type { CellNoticePayload } from '../../shared/types';

interface CellNoticeProps {
  notice: CellNoticePayload;
  onClose: () => void;
}

const NOTICE_LABELS: Record<CellNoticePayload['type'], string> = {
  'google-login-blocked': '登录受限',
  'inject-failed': '需要手动发送',
  'load-failed': '访问提示',
  'load-timeout': '加载较慢',
  'conversation-truncated': '内容已裁剪',
};

const NOTICE_ICONS: Record<CellNoticePayload['type'], string> = {
  'google-login-blocked': 'i',
  'inject-failed': '↵',
  'load-failed': '!',
  'load-timeout': '…',
  'conversation-truncated': '…',
};

export default function CellNotice({ notice, onClose }: CellNoticeProps) {
  return (
    <div className={`cell-notice cell-notice-${notice.type}`} role="status">
      <span className="cell-notice-icon" aria-hidden="true">
        {NOTICE_ICONS[notice.type]}
      </span>
      <div className="cell-notice-copy">
        <strong>{NOTICE_LABELS[notice.type]}</strong>
        <span>{notice.message}</span>
      </div>
      <button type="button" aria-label="Close notice" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
