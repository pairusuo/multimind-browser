import { chatgptAdapter } from './chatgpt';
import { chatglmAdapter } from './chatglm';
import { claudeAdapter } from './claude';
import { copilotAdapter } from './copilot';
import { deepseekAdapter } from './deepseek';
import { doubaoAdapter } from './doubao';
import { grokAdapter } from './grok';
import { kimiAdapter } from './kimi';
import { perplexityAdapter } from './perplexity';
import { tongyiAdapter } from './tongyi';
import { yiyanAdapter } from './yiyan';

export interface SiteAdapter {
  urlPattern: RegExp;
  injectScript: (text: string) => string;
  readyCheckScript: string;
  extractLatestResponse?: () => string;
  isResponseComplete?: () => string;
  extractConversation?: () => string;
}

export const adapters: SiteAdapter[] = [
  claudeAdapter,
  chatgptAdapter,
  grokAdapter,
  perplexityAdapter,
  copilotAdapter,
  deepseekAdapter,
  kimiAdapter,
  yiyanAdapter,
  tongyiAdapter,
  doubaoAdapter,
  chatglmAdapter,
];

export function getAdapterForUrl(url: string): SiteAdapter | null {
  return adapters.find((adapter) => adapter.urlPattern.test(url)) ?? null;
}
