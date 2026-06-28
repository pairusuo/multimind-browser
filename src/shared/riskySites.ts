export interface RiskySite {
  urlPattern: RegExp;
  reasonKey: string;
}

export const RISKY_SITES: RiskySite[] = [
  {
    urlPattern: /(^gemini$|gemini\.google\.com)/i,
    reasonKey: 'riskySites.geminiGoogleLogin',
  },
];

export function getRiskySiteReasonKey(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) {
    return null;
  }

  return RISKY_SITES.find((site) => site.urlPattern.test(value))?.reasonKey ?? null;
}
