import type { SiteAdapter } from './index';

export const tongyiAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:chat\.qwen\.ai|(?:www\.)?qianwen\.com|tongyi\.aliyun\.com)/i,
  injectScript: (text: string) => buildTongyiInjectScript(text),
  readyCheckScript: `
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return [
        'textarea:not([disabled])',
        '[contenteditable="true"]',
        '[role="textbox"]:not([aria-disabled="true"])'
      ].some((selector) => [...document.querySelectorAll(selector)].some(isVisible));
    })();
  `,
  extractLatestResponse: () => buildTongyiConversationScript(true),
  extractConversation: () => buildTongyiConversationScript(false),
  isResponseComplete: () => buildTongyiCompletionScript(),
};

function buildTongyiInjectScript(text: string): string {
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
      const input = [
        ...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"], [role="textbox"]:not([aria-disabled="true"])')
      ].filter(isVisible).at(-1);
      if (!input) return false;

      input.focus();
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return false;
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

      const inputText = () => input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
        ? input.value.trim()
        : (input.innerText || input.textContent || '').trim();
      const labelOf = (element) => [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.getAttribute?.('data-testid'),
        element?.className?.toString(),
        element?.textContent,
      ].filter(Boolean).join(' ');
      const isEnabled = (element) => element
        && isVisible(element)
        && element.getAttribute?.('aria-disabled') !== 'true'
        && element.getAttribute?.('disabled') === null
        && !element.disabled
        && !/disabled|disable|readonly/.test(element.className?.toString().toLowerCase() || '');
      const isExcluded = (element) => /(attach|upload|file|image|voice|mic|model|setting|history|new|附件|上传|文件|图片|语音|麦克风|模型|设置|历史|新建)/i.test(labelOf(element));
      const composer = input.closest('form') || input.closest('[class*="composer" i], [class*="input" i], [class*="chat" i]') || input.parentElement || document.body;
      const click = (element) => {
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
            element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          } else {
            element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
        }
        element.click?.();
      };
      const findSendButton = () => {
        const selectors = [
          'button[aria-label*="发送"]',
          '[role="button"][aria-label*="发送"]',
          'button[aria-label*="send" i]',
          '[role="button"][aria-label*="send" i]',
          '[data-testid*="send" i]',
          'button[type="submit"]',
          '[class*="send" i]',
          '[class*="submit" i]'
        ];
        for (const selector of selectors) {
          const found = [...document.querySelectorAll(selector)].reverse().find((candidate) => isEnabled(candidate) && !isExcluded(candidate));
          if (found) return found;
        }
        return [...composer.querySelectorAll('button, [role="button"], [tabindex]')]
          .filter((candidate) => isEnabled(candidate) && !isExcluded(candidate))
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (ar.bottom - br.bottom) || (ar.right - br.right);
          }).at(-1) || null;
      };
      const hasStopControl = () => [...document.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="stop" i]')]
        .some((candidate) => isVisible(candidate) && /(stop|cancel|停止|暂停|取消|生成中|思考中)/i.test(labelOf(candidate)));

      let button = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        button = findSendButton();
        if (button) break;
        await delay(100);
      }
      if (!button) return false;
      click(button);

      for (let attempt = 0; attempt < 35; attempt += 1) {
        if (!inputText()) return true;
        if (hasStopControl()) return true;
        await delay(100);
      }
      return false;
    })();
  `;
}

function buildTongyiCompletionScript(): string {
  return `
    (() => {
      const text = (element) => [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.className?.toString(),
        element?.textContent,
      ].filter(Boolean).join(' ');
      return ![...document.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="stop" i]')]
        .some((candidate) => /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(text(candidate)));
    })();
  `;
}

function buildTongyiConversationScript(latestOnly: boolean): string {
  return `
    (() => {
      const uiText = /给通义千问发送消息|通义千问|Qwen|联网搜索|深度思考|新建对话|历史记录|内容由 ?AI ?生成|换一换|猜你想问|上传文件|发送消息/i;
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const clean = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
      const nodes = [
        ...document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="chat-item"], [class*="bubble"], [class*="markdown"], [class*="answer"], [class*="response"]')
      ].filter(isVisible);
      const entries = [];
      const seen = new Set();
      nodes.forEach((node, index) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll?.('button, nav, aside, header, footer, textarea, input, [contenteditable="true"], [role="button"], [aria-hidden="true"], [class*="suggest"], [class*="recommend"], [class*="toolbar"], [class*="feedback"], [class*="source"]').forEach((child) => child.remove());
        const content = clean(clone.innerText || clone.textContent || '');
        if (content.length < 2 || content.length > 12000 || uiText.test(content) || seen.has(content)) return;
        seen.add(content);
        const descriptor = [
          node.getAttribute?.('data-role'),
          node.getAttribute?.('data-message-author-role'),
          node.className?.toString(),
          node.closest?.('[class]')?.className?.toString(),
        ].filter(Boolean).join(' ').toLowerCase();
        const role = /user|human|question|mine|right/.test(descriptor) ? 'user' : /assistant|answer|bot|response|markdown/.test(descriptor) ? 'assistant' : (index % 2 === 0 ? 'user' : 'assistant');
        entries.push({ role, content, order: index });
      });
      if (${latestOnly ? 'true' : 'false'}) {
        return [...entries].reverse().find((entry) => entry.role === 'assistant')?.content || null;
      }
      return entries.length ? { entries } : null;
    })();
  `;
}
