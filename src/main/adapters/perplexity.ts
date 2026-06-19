import { createGenericChatAdapter } from './generic';

export const perplexityAdapter = createGenericChatAdapter({
  urlPattern: /https:\/\/(?:www\.)?perplexity\.ai/i,
  selectors: [
    'textarea[placeholder]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ],
});
