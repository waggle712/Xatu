import type { Language } from '@xatu/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ta from '../locales/ta.json';

export const resources = { en: { translation: en }, ta: { translation: ta } } as const;

// Tamil first: the pilot is in Trichy. The welcome screen lets people switch.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'ta',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
}

export default i18n;
