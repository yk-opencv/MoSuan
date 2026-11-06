import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { languages, translator, type Language, type Translate } from './translate';
const storageKey = 'mosuan-language';

function savedLanguage(): Language {
  try {
    const saved = localStorage.getItem(storageKey);
    return languages.find(({ code }) => code === saved)?.code ?? 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

const LocaleContext = createContext<{
  language: Language;
  chooseLanguage: (value: string) => void;
  saved: boolean;
  t: Translate;
}>({ language: 'zh-CN', chooseLanguage: () => {}, saved: true, t: translator('zh-CN') });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(savedLanguage);
  const [saved, setSaved] = useState(true);
  const t = useMemo(() => translator(language), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('墨算 · 公式阅读与对话');
  }, [language, t]);

  function chooseLanguage(value: string) {
    const option = languages.find(({ code }) => code === value);
    if (!option) return;
    setLanguage(option.code);
    try {
      localStorage.setItem(storageKey, option.code);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  return <LocaleContext.Provider value={{ language, chooseLanguage, saved, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

