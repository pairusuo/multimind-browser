import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

export const DEFAULT_LANGUAGE = 'zh';

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: getInitialRendererLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

function getInitialRendererLanguage(): string {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export default i18n;
