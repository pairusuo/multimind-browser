import type { NoticeType } from './types';

export const NOTICE_MESSAGES: Record<NoticeType, string> = {
  'google-login-blocked': 'Google 账号登录在内嵌浏览器中受限，建议改用邮箱/密码方式登录此网站（如该网站支持）',
  'inject-failed': '文字已填入，请手动按 Enter 发送',
  'load-failed': '该网站当前无法访问，可点击重试',
  'load-timeout': '该网站加载时间较长，可能存在网络问题',
  'conversation-truncated': '转发内容较长，已自动保留最近部分对话；较早内容未包含',
};
