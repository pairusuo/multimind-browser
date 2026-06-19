export interface RiskySite {
  urlPattern: RegExp;
  reason: string;
}

export const RISKY_SITES: RiskySite[] = [
  {
    urlPattern: /(^gemini$|gemini\.google\.com)/i,
    reason: '该网站仅支持 Google 账号登录，Google 已限制嵌入式浏览器登录，可能无法正常使用',
  },
];

export function getRiskySiteReason(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) {
    return null;
  }

  return RISKY_SITES.find((site) => site.urlPattern.test(value))?.reason ?? null;
}
