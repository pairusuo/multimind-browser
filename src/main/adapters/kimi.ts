import type { SiteAdapter } from './index';

export const kimiAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:kimi\.moonshot\.cn|(?:www\.)?kimi\.com)/i,
  injectScript: (text: string) => buildKimiFallbackInjectScript(text),
  nativeInjection: {
    prepareScript: (text: string) => buildKimiPrepareScript(text),
    acceptedScript: buildKimiAcceptedScript(),
  },
  readyCheckScript: `
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return [...document.querySelectorAll('.chat-input-editor[data-lexical-editor="true"], [data-lexical-editor="true"], .chat-input-editor, [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
        .some(isVisible);
    })();
  `,
  extractLatestResponse: () => buildKimiConversationScript(true),
  extractConversation: () => buildKimiConversationScript(false),
  isResponseComplete: () => buildKimiCompletionScript(),
};

function buildKimiPrepareScript(text: string): string {
  return `
    (async () => {
      const targetText = ${JSON.stringify(text)};
      const expectedText = targetText.trim();
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const getText = (element) => (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
        ? element.value.trim()
        : (element.innerText || element.textContent || '').trim();
      const normalizeText = (value) => value.replace(/\\s+/g, ' ').trim();
      const hasExpectedText = (currentText) => {
        const normalizedCurrent = normalizeText(currentText);
        const normalizedExpected = normalizeText(expectedText);
        if (!normalizedCurrent || !normalizedExpected) return false;
        if (normalizedCurrent === normalizedExpected) return true;
        if (normalizedExpected.length < 160) return false;

        const head = normalizedExpected.slice(0, 80);
        const tail = normalizedExpected.slice(-80);
        return normalizedCurrent.length >= normalizedExpected.length * 0.8
          && normalizedCurrent.includes(head)
          && normalizedCurrent.includes(tail);
      };
      const input = [
        ...document.querySelectorAll('.chat-input-editor[data-lexical-editor="true"], [data-lexical-editor="true"], .chat-input-editor, [contenteditable="true"][role="textbox"], [contenteditable="true"]')
      ].filter(isVisible).at(-1);
      if (!input) return null;

      input.focus();
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return null;
        setter.call(input, targetText);
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, targetText);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const button = document.querySelector('.send-button-container:not(.disabled)')
          || [...document.querySelectorAll('.send-button-container')]
            .find((candidate) => !candidate.className?.toString().toLowerCase().includes('disabled'));
        const currentText = getText(input);
        if (button && isVisible(button) && hasExpectedText(currentText)) {
          const rect = button.getBoundingClientRect();
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        }
        await delay(100);
      }

      return null;
    })();
  `;
}

function buildKimiAcceptedScript(): string {
  return `
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const getInputText = () => {
        const input = document.querySelector('.chat-input-editor[data-lexical-editor="true"], .chat-input-editor, [data-lexical-editor="true"]');
        return (input?.innerText || input?.textContent || '').trim();
      };
      const hasGeneratingControl = () => [...document.querySelectorAll('.stop-button-container, [class*="stop" i], [aria-label], [title]')]
        .some((candidate) => {
          const label = [
            candidate.getAttribute?.('aria-label'),
            candidate.getAttribute?.('title'),
            candidate.className?.toString(),
            candidate.textContent,
          ].filter(Boolean).join(' ');
          return /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(label);
        });

      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (!getInputText()) return true;
        if (hasGeneratingControl()) return true;
        await delay(100);
      }
      return false;
    })();
  `;
}

function buildKimiFallbackInjectScript(text: string): string {
  return `
    (async () => {
      const targetText = ${JSON.stringify(text)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const input = [...document.querySelectorAll('.chat-input-editor[data-lexical-editor="true"], [data-lexical-editor="true"], .chat-input-editor, [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
        .filter(isVisible).at(-1);
      if (!input) return false;
      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, targetText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = document.querySelector('.send-button-container:not(.disabled)');
        if (button && isVisible(button)) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        }
        await delay(100);
      }
      return false;
    })();
  `;
}

function buildKimiCompletionScript(): string {
  return `
    (() => {
      const text = (element) => [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.className?.toString(),
        element?.textContent,
      ].filter(Boolean).join(' ');
      return ![...document.querySelectorAll('.stop-button-container, [class*="stop" i], [aria-label], [title]')]
        .some((candidate) => /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(text(candidate)));
    })();
  `;
}

function buildKimiConversationScript(latestOnly: boolean): string {
  return `
    (() => {
      const uiText = /给 Kimi 发送消息|Kimi 智能助手|探索版|联网搜索|深度思考|常用语|新建会话|历史会话|内容由 ?AI ?生成|免责声明|上传文件|发送消息/i;
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const clean = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
      const nodes = [
        ...document.querySelectorAll('[class*="chat-message"], [class*="message-item"], [class*="segment-content"], [class*="markdown-body"], [class*="markdown"], [class*="user-content"], [class*="assistant"]')
      ].filter(isVisible);
      const entries = [];
      const seen = new Set();
      nodes.forEach((node, index) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll?.('button, nav, aside, header, footer, textarea, input, [contenteditable="true"], [role="button"], [aria-hidden="true"], [class*="suggest"], [class*="recommend"], [class*="toolbar"], [class*="feedback"]').forEach((child) => child.remove());
        const content = clean(clone.innerText || clone.textContent || '');
        if (content.length < 2 || content.length > 12000 || uiText.test(content) || seen.has(content)) return;
        seen.add(content);
        const descriptor = [
          node.getAttribute?.('data-role'),
          node.getAttribute?.('data-message-author-role'),
          node.className?.toString(),
          node.closest?.('[class]')?.className?.toString(),
        ].filter(Boolean).join(' ').toLowerCase();
        const role = /user|human|mine|right/.test(descriptor) ? 'user' : /assistant|bot|kimi|markdown/.test(descriptor) ? 'assistant' : (index % 2 === 0 ? 'user' : 'assistant');
        entries.push({ role, content, order: index });
      });
      if (${latestOnly ? 'true' : 'false'}) {
        return [...entries].reverse().find((entry) => entry.role === 'assistant')?.content || null;
      }
      return entries.length ? { entries } : null;
    })();
  `;
}
