import type { NoticeType } from './types';

export const NOTICE_MESSAGES: Record<NoticeType, string> = {
  'google-login-blocked': 'Google 账号登录在内嵌浏览器中受限，建议改用邮箱/密码方式登录此网站（如该网站支持）',
  'inject-failed': '文字已填入，请手动按 Enter 发送',
  'load-failed': '该网站当前无法访问，可点击重试',
};
