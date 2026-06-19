import { createGenericChatAdapter } from './generic';

export const grokAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/(?:www\.)?grok\.com/i,
});
