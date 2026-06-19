import { createGenericChatAdapter } from './generic';

export const kimiAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/kimi\.moonshot\.cn/i,
});
