import { createGenericChatAdapter } from './generic';

export const chatglmAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/(?:www\.)?chatglm\.cn/i,
});
