import { createGenericChatAdapter } from './generic';

export const copilotAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/copilot\.microsoft\.com/i,
  selectors: [
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ],
});
