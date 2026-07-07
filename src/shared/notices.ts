import type { NoticeType } from './types';

export const NOTICE_MESSAGE_KEYS: Record<NoticeType, string> = {
  'google-login-blocked': 'notices.googleLoginBlocked.message',
  'inject-failed': 'notices.injectFailed.message',
  'load-failed': 'notices.loadFailed.message',
  'load-timeout': 'notices.loadTimeout.message',
  'source-response-pending': 'notices.sourceResponsePending.message',
  'conversation-truncated': 'notices.conversationTruncated.message',
};
