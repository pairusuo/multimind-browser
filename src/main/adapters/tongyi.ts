import { createGenericChatAdapter } from './generic';

export const tongyiAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/tongyi\.aliyun\.com/i,
});
