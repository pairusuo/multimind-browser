import type { SiteAdapter } from './index';

const CHATGLM_INPUT_SELECTORS = [
  'textarea:not([disabled])',
  '[contenteditable="true"][role="textbox"]',
  '[role="textbox"]:not([aria-disabled="true"])',
  '[contenteditable="true"]',
];

export const chatglmAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:www\.)?chatglm\.cn/i,
  injectScript: (text: string) => buildChatglmInjectScript(text),
  nativeInjection: {
    prepareScript: () => buildCoordinateInputFocusScript(CHATGLM_INPUT_SELECTORS),
    usesNativeTextInsertion: true,
    clickTargetScript: (text: string) => buildChatglmClickButtonScript({
      text,
      inputSelectors: CHATGLM_INPUT_SELECTORS,
    }),
    beforeNativeClickScript: (text: string) => buildChatglmSubmitScript(text),
    acceptedScript: buildTextOrGeneratingAcceptedScript(CHATGLM_INPUT_SELECTORS),
    enterFallbackScript: buildCoordinateInputFocusScript(CHATGLM_INPUT_SELECTORS),
  },
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
  extractLatestResponse: () => buildChatglmConversationScript(true),
  extractConversation: () => buildChatglmConversationScript(false),
  isResponseComplete: () => buildChatglmCompletionScript(),
};

function buildCoordinateInputFocusScript(inputSelectors: string[]): string {
  return `
    (() => {
      const inputSelectors = ${JSON.stringify(inputSelectors)};
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const input = inputSelectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter(isVisible)
        .at(-1);
      if (!input) return false;

      input.focus();
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        input.select();
        input.setSelectionRange?.(0, input.value.length);
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return document.activeElement === input || input.contains(document.activeElement);
    })();
  `;
}

function buildChatglmClickButtonScript({
  text,
  inputSelectors,
}: {
  text: string;
  inputSelectors: string[];
}): string {
  return `
    (async () => {
      const targetText = ${JSON.stringify(text)};
      const expectedText = targetText.trim();
      const inputSelectors = ${JSON.stringify(inputSelectors)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      };
      const textOf = (element) => (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
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
      const labelOf = (element) => [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.getAttribute?.('data-testid'),
        element?.getAttribute?.('data-test-id'),
        element?.getAttribute?.('class'),
        element?.textContent,
      ].filter(Boolean).join(' ');
      const isEnabled = (element) => element
        && isVisible(element)
        && element.getAttribute?.('aria-disabled') !== 'true'
        && element.getAttribute?.('disabled') === null
        && !element.disabled
        && !/disabled|disable|readonly/.test(element.className?.toString().toLowerCase() || '');
      const isExcluded = (element) => /(attach|upload|file|image|voice|mic|audio|model|setting|history|new|search|network|think|reason|auto|附件|上传|文件|图片|语音|麦克风|录音|模型|设置|历史|新建|搜索|联网|思考|推理|自动)/i.test(labelOf(element));
      const findInput = () => inputSelectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter(isVisible)
        .at(-1);
      const clickableTarget = (element) => element.closest?.('button, [role="button"], [tabindex], [aria-label], [title], [class*="send" i], [class*="submit" i], [class*="arrow" i]')
        || element;
      const containsInput = (element, input) => element === input || element.contains?.(input);
      const rectCenter = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const findComposer = (input) => {
        const inputRect = input.getBoundingClientRect();
        let current = input.parentElement;
        let best = null;
        while (current && current !== document.body) {
          const rect = current.getBoundingClientRect();
          if (
            isVisible(current)
            && rect.width >= Math.max(inputRect.width, 240)
            && rect.height >= Math.max(inputRect.height, 48)
            && rect.height <= 260
            && Math.abs(rect.bottom - inputRect.bottom) <= 96
          ) {
            best = current;
          }
          current = current.parentElement;
        }
        return best || input.closest('form') || input.parentElement || document.body;
      };
      const scoreCandidate = (element, inputRect, composerRect) => {
        const rect = element.getBoundingClientRect();
        const label = labelOf(element);
        const center = rectCenter(rect);
        const nearInputY = center.y >= inputRect.top - 90 && center.y <= inputRect.bottom + 90;
        if (!nearInputY) return -Infinity;
        if (rect.width < 10 || rect.height < 10 || rect.width > 96 || rect.height > 96) return -Infinity;

        let score = 0;
        if (/(send|submit|arrow|plane|发送|提交)/i.test(label)) score += 140;
        if (center.x >= inputRect.right - 140) score += 80;
        if (center.x >= composerRect.right - 140) score += 70;
        if (rect.width >= 28 && rect.width <= 64 && rect.height >= 28 && rect.height <= 64) score += 35;
        if (rect.width === rect.height || Math.abs(rect.width - rect.height) <= 12) score += 15;
        if (/^(button)$/i.test(element.tagName) || element.getAttribute?.('role') === 'button') score += 12;
        score += Math.max(0, Math.min(30, center.x - inputRect.left) / 10);
        return score;
      };

      const input = findInput();
      if (!input) return null;

      const findButton = () => {
        const inputNow = findInput();
        if (!inputNow) return null;
        const composerNow = findComposer(inputNow);
        const composerRect = composerNow.getBoundingClientRect();
        const inputRect = inputNow.getBoundingClientRect();
        const directPoints = [
          { x: composerRect.right - 34, y: composerRect.bottom - 34 },
          { x: composerRect.right - 42, y: inputRect.bottom - 34 },
          { x: inputRect.right - 34, y: inputRect.bottom - 34 },
        ];
        for (const point of directPoints) {
          if (point.x <= 0 || point.y <= 0 || point.x >= window.innerWidth || point.y >= window.innerHeight) {
            continue;
          }
          const element = document.elementFromPoint(point.x, point.y);
          const target = element ? clickableTarget(element) : null;
          if (target && !containsInput(target, inputNow) && isEnabled(target) && !isExcluded(target)) {
            return { x: point.x, y: point.y };
          }
        }

        const searchRoots = [composerNow, composerNow.parentElement].filter(Boolean);
        const seen = new Set();
        const candidates = searchRoots
          .flatMap((root) => [...root.querySelectorAll('button, [role="button"], [tabindex], [aria-label], [title], [class*="send" i], [class*="submit" i], [class*="arrow" i], svg, div')])
          .map(clickableTarget)
          .filter((candidate) => {
            if (!candidate || seen.has(candidate)) return false;
            seen.add(candidate);
            if (containsInput(candidate, inputNow)) return false;
            if (!isEnabled(candidate) || isExcluded(candidate)) return false;
            const rect = candidate.getBoundingClientRect();
            const center = rectCenter(rect);
            return center.x >= inputRect.left
              && center.x <= Math.max(composerRect.right + 8, window.innerWidth)
              && center.y >= composerRect.top - 16
              && center.y <= composerRect.bottom + 16;
          })
          .map((candidate) => ({
            candidate,
            score: scoreCandidate(candidate, inputRect, composerRect),
            rect: candidate.getBoundingClientRect(),
          }))
          .filter((item) => Number.isFinite(item.score))
          .sort((a, b) => (b.score - a.score) || (b.rect.right - a.rect.right));
        return candidates[0]?.candidate || null;
      };

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const button = findButton();
        const currentText = textOf(findInput());
        if (button && hasExpectedText(currentText)) {
          if (typeof button.x === 'number' && typeof button.y === 'number') {
            return {
              x: Math.round(button.x),
              y: Math.round(button.y),
            };
          }
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

function buildChatglmSubmitScript(text: string): string {
  return `
    (async () => {
      const targetText = ${JSON.stringify(text)};
      const expectedText = targetText.trim();
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      };
      const textOf = (element) => (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
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
      const labelOf = (element) => [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.getAttribute?.('data-testid'),
        element?.getAttribute?.('data-test-id'),
        element?.getAttribute?.('class'),
        element?.textContent,
      ].filter(Boolean).join(' ');
      const isEnabled = (element) => element
        && isVisible(element)
        && element.getAttribute?.('aria-disabled') !== 'true'
        && element.getAttribute?.('disabled') === null
        && !element.disabled
        && !/disabled|disable|readonly/.test(element.className?.toString().toLowerCase() || '');
      const isExcluded = (element) => /(attach|upload|file|image|voice|mic|audio|model|setting|history|new|search|network|think|reason|auto|附件|上传|文件|图片|语音|麦克风|录音|模型|设置|历史|新建|搜索|联网|思考|推理|自动)/i.test(labelOf(element));
      const findInput = () => [
        ...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"], [role="textbox"]:not([aria-disabled="true"]), [contenteditable="true"]')
      ].filter(isVisible).at(-1);
      const input = findInput();
      if (!input || !hasExpectedText(textOf(input))) return false;

      input.focus();
      const inputRect = input.getBoundingClientRect();
      let composer = input.parentElement;
      while (composer?.parentElement && composer !== document.body) {
        const rect = composer.getBoundingClientRect();
        if (rect.width >= inputRect.width && rect.height >= inputRect.height && rect.height <= 260 && Math.abs(rect.bottom - inputRect.bottom) <= 96) {
          break;
        }
        composer = composer.parentElement;
      }
      composer = composer || input.closest('form') || input.parentElement || document.body;
      const composerRect = composer.getBoundingClientRect();

      const eventInitAt = (x, y) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
      });
      const dispatchPointerClick = (element, x, y) => {
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        const pointerInit = { ...eventInitAt(x, y), pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
        if (typeof PointerEvent === 'function') {
          element.dispatchEvent(new PointerEvent('pointerover', pointerInit));
          element.dispatchEvent(new PointerEvent('pointerenter', pointerInit));
          element.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
          element.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
        }
        element.dispatchEvent(new MouseEvent('mouseover', eventInitAt(x, y)));
        element.dispatchEvent(new MouseEvent('mouseenter', eventInitAt(x, y)));
        element.dispatchEvent(new MouseEvent('mousedown', { ...eventInitAt(x, y), button: 0, buttons: 1 }));
        element.dispatchEvent(new MouseEvent('mouseup', { ...eventInitAt(x, y), button: 0, buttons: 0 }));
        element.dispatchEvent(new MouseEvent('click', { ...eventInitAt(x, y), button: 0, buttons: 0 }));
        element.click?.();
      };
      const dispatchEnter = (target) => {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          target.dispatchEvent(new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
          }));
        }
      };
      const hasSent = () => {
        const currentInput = findInput();
        const text = currentInput ? textOf(currentInput) : '';
        const generating = [...document.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="stop" i]')]
          .some((candidate) => /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(labelOf(candidate)));
        return !text || generating;
      };

      const form = input.closest('form');
      if (form) {
        try {
          form.requestSubmit?.();
        } catch {
          form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: null }));
        }
        await delay(250);
        if (hasSent()) return true;
      }

      const points = [
        { x: composerRect.right - 34, y: composerRect.bottom - 34 },
        { x: composerRect.right - 44, y: inputRect.bottom - 28 },
        { x: inputRect.right - 34, y: inputRect.bottom - 28 },
      ];
      const targets = [];
      for (const point of points) {
        const element = document.elementFromPoint(point.x, point.y);
        let current = element;
        for (let depth = 0; current && depth < 5; depth += 1) {
          if (isEnabled(current) && !isExcluded(current) && current !== input && !current.contains?.(input)) {
            targets.push({ element: current, x: point.x, y: point.y });
          }
          current = current.parentElement;
        }
      }
      const selectorTargets = [
        ...composer.querySelectorAll('button, [role="button"], [tabindex], [aria-label], [title], [class*="send" i], [class*="submit" i], [class*="arrow" i], svg')
      ].filter((candidate) => isEnabled(candidate) && !isExcluded(candidate) && candidate !== input && !candidate.contains?.(input));
      for (const candidate of selectorTargets) {
        const rect = candidate.getBoundingClientRect();
        targets.push({ element: candidate, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }

      const seen = new Set();
      for (const target of targets) {
        if (!target.element || seen.has(target.element)) continue;
        seen.add(target.element);
        dispatchPointerClick(target.element, target.x, target.y);
        await delay(250);
        if (hasSent()) return true;
      }

      dispatchEnter(input);
      dispatchEnter(document.activeElement || input);
      await delay(250);
      if (hasSent()) return true;
      return false;
    })();
  `;
}

function buildTextOrGeneratingAcceptedScript(inputSelectors: string[]): string {
  return `
    (async () => {
      const inputSelectors = ${JSON.stringify(inputSelectors)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const getInputText = () => {
        const input = inputSelectors
          .flatMap((selector) => [...document.querySelectorAll(selector)])
          .filter(isVisible)
          .at(-1);
        if (!input) return '';
        return input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
          ? input.value.trim()
          : (input.innerText || input.textContent || '').trim();
      };
      const hasGeneratingControl = () => [...document.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="stop" i]')]
        .some((candidate) => {
          const label = [
            candidate.getAttribute?.('aria-label'),
            candidate.getAttribute?.('title'),
            candidate.className?.toString(),
            candidate.textContent,
          ].filter(Boolean).join(' ');
          return /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(label);
        });

      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (!getInputText()) return true;
        if (hasGeneratingControl()) return true;
        await delay(100);
      }
      return false;
    })();
  `;
}

function buildChatglmInjectScript(text: string): string {
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

function buildChatglmCompletionScript(): string {
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

function buildChatglmConversationScript(latestOnly: boolean): string {
  return `
    (() => {
      const uiText = /给智谱清言发送消息|智谱清言|清言|GLM|联网搜索|深度思考|新建对话|历史记录|内容由 ?AI ?生成|猜你想问|上传文件|发送消息/i;
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const clean = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
      const nodes = [
        ...document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="chat-item"], [class*="bubble"], [class*="markdown"], [class*="answer"], [class*="content"]')
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
        const role = /user|human|question|mine|right/.test(descriptor) ? 'user' : /assistant|answer|bot|glm|markdown/.test(descriptor) ? 'assistant' : (index % 2 === 0 ? 'user' : 'assistant');
        entries.push({ role, content, order: index });
      });
      if (${latestOnly ? 'true' : 'false'}) {
        return [...entries].reverse().find((entry) => entry.role === 'assistant')?.content || null;
      }
      return entries.length ? { entries } : null;
    })();
  `;
}
