import { messages } from './localeMessages';

export const languages = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
] as const;

export type Language = typeof languages[number]['code'];
export type Translate = (source: string, ...values: (string | number)[]) => string;

export function translator(language: Language): Translate {
  return (source, ...values) => {
    const key = source.trim();
    const entry = language === 'zh-CN' || !Object.hasOwn(messages, key) ? undefined : messages[key];
    const text = entry ? source.replace(key, () => entry[language === 'en' ? 0 : 1]) : source;
    return values.length ? text.replace(/\{(\d+)\}/g, (token, index: string) => String(values[Number(index)] ?? token)) : text;
  };
}
