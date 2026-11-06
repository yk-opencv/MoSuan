import { useLocale } from '../lib/locale';
import { useEffect, useRef } from 'react';
import { Archive, BookOpenText, ChevronRight, Languages, Plug, Settings2, Type } from 'lucide-react';

export type SettingsCategory = 'appearance' | 'connection' | 'backup' | 'language' | 'guide';
export function SettingsMenu({ open, showGuide, onToggle, onChoose }: { open: boolean; showGuide: boolean; onToggle: () => void; onChoose: (category: SettingsCategory) => void }) {
  const { t } = useLocale();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [open]);
  return <div className="settings-entry">
    {open && <div ref={menu} className="settings-menu" id="settings-categories" role="menu" aria-label={t('设置分类')} onKeyDown={event => {
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.stopPropagation(); onToggle(); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
      <div className="settings-menu-caption">{t('设置')}</div>
      <button role="menuitem" onClick={() => onChoose('appearance')}><Type size={18} /><span>{t('字体与外观')}<small>{t('字号、颜色与背景图片')}</small></span><ChevronRight size={15} /></button>
      <button role="menuitem" onClick={() => onChoose('connection')}><Plug size={18} /><span>{t('API 与连接')}<small>{t('选择服务、查看连接状态')}</small></span><ChevronRight size={15} /></button>
      <button role="menuitem" onClick={() => onChoose('backup')}><Archive size={18} /><span>{t('备份与恢复')}<small>{t('保存或迁移全部笔记')}</small></span><ChevronRight size={15} /></button>
      <button role="menuitem" onClick={() => onChoose('language')}><Languages size={18} /><span>{t('语言')}<small>{t('切换界面语言。')}</small></span><ChevronRight size={15} /></button>
      {showGuide && <button role="menuitem" onClick={() => onChoose('guide')}><BookOpenText size={18} /><span>{t('使用说明')}<small>{t('导入、阅读与常见问题')}</small></span><ChevronRight size={15} /></button>}
    </div>}
    <button ref={trigger} className={`nav-item settings-trigger ${open ? 'selected' : ''}`} aria-label={t('设置')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'settings-categories' : undefined} onClick={onToggle}><Settings2 size={17} />{t('设置')}<span><ChevronRight size={14} /></span></button>
  </div>;
}
