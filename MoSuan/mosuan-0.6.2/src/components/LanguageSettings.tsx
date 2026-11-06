import { Languages } from 'lucide-react';
import { useLocale } from '../lib/locale';
import { languages } from '../lib/translate';

export function LanguageSettings() {
  const { t, language, chooseLanguage, saved } = useLocale();
  return <>
    <div className="modal-icon"><Languages size={24} /></div>
    <h2>{t('语言')}</h2>
    <p>{t('切换界面语言。')}</p>
    <div className="settings-row language-setting">
      <label htmlFor="interface-language">{t('界面语言')}</label>
      <select id="interface-language" value={language} onChange={event => chooseLanguage(event.target.value)}>
        {languages.map(({ code, label }) => <option key={code} value={code} lang={code}>{label}</option>)}
      </select>
    </div>
    {!saved && <p role="status">{t('语言已切换，但当前设备无法保存此设置。')}</p>}
  </>;
}

