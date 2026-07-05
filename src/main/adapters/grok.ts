import type { SiteAdapter } from './index';

export const grokAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:www\.)?grok\.com/i,
  injectScript: (text: string) => buildGrokInjectScript(text),
  readyCheckScript: buildGrokReadyScript(),
};

function buildGrokReadyScript(): string {
  return `
    (() => ['textarea:not([disabled])', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]']
      .some((selector) => document.querySelector(selector)))();
  `;
}

function buildGrokInjectScript(text: string): string {
  return `
    (async () => {
      const targetText = ${JSON.stringify(text)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const input = [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"]')].at(-1);
      if (!input) return false;
      input.focus();
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, targetText);
      } else {
        const range = document.createRange();
        range.selectNodeContents(input);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, targetText);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const findSend = () => [...document.querySelectorAll('button, [role="button"]')]
        .reverse()
        .find((button) => {
          const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent, button.className?.toString()].filter(Boolean).join(' ');
          return /send|submit|发送|提交/i.test(label) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
        });
      for (let i = 0; i < 30; i += 1) {
        const button = findSend();
        if (button) {
          button.click();
          await delay(300);
          return true;
        }
        await delay(100);
      }
      return false;
    })();
  `;
}
