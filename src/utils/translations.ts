import { Language } from '../types';
import { en } from '../locales/en';
import { ua } from '../locales/ua';

export function t(key: string, lang: Language): string {
    const localeDict = lang === 'ua' ? ua : en;
    return (localeDict as Record<string, string>)[key] || key;
}

