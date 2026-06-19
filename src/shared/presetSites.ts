export interface PresetSite {
  id: string;
  name: string;
  url: string;
  region: 'international' | 'china';
}

export const PRESET_SITES: PresetSite[] = [
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', region: 'international' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', region: 'international' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com', region: 'international' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://perplexity.ai', region: 'international' },
  { id: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com', region: 'international' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', region: 'china' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', region: 'china' },
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com', region: 'china' },
  { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com', region: 'china' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com', region: 'china' },
  { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn', region: 'china' },
];
