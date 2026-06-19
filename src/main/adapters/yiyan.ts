import { createGenericChatAdapter } from './generic';

export const yiyanAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/(?:yiyan|chat)\.baidu\.com/i,
});
