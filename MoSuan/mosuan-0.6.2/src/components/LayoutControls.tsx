import { useLocale } from '../lib/locale';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { useLayout, VisibilityKey } from '../hooks/useLayout';

const options: [VisibilityKey, string][] = [['sidebar', '左侧对话列表'], ['header', '顶部导航与导出'], ['toolbar', '阅读工具栏'], ['cover', '笔记标题与信息'], ['scrollbars', '滚动条'], ['jumps', '上下跳转按钮']];
export function LayoutControls({ layout }: { layout: ReturnType<typeof useLayout> }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <div ref={root} className={`layout-controls ${layout.preferences.header ? '' : 'floating'}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="layout-toggle" aria-label={t('显示选项')} title={t('显示选项')} aria-expanded={open} aria-controls={open ? 'layout-options' : undefined} onClick={() => setOpen(value => !value)}><SlidersHorizontal size={16} /><ChevronDown size={10} /></button>
    {open && <section className="layout-options" id="layout-options" aria-label={t('显示选项')}>
      <h3>{t('显示选项')}</h3>
      {layout.desktop && <label className="sidebar-width-control">{t('左右栏宽度 ')}<span>{layout.width} px</span><input aria-label={t('左栏宽度')} type="range" min={200} max={layout.maxWidth} value={layout.width} disabled={!layout.preferences.sidebar} onChange={event => layout.resize(Number(event.target.value), true)} /></label>}
      <div className="layout-checkboxes">{options.filter(([key]) => layout.desktop || key !== 'sidebar').map(([key, label]) => <label key={key}><input type="checkbox" checked={layout.preferences[key]} onChange={() => layout.toggle(key)} />{t(label)}</label>)}</div>
      <p>{layout.desktop ? t('也可拖动左右栏之间的分隔线。') : t('手机上通过菜单按钮打开对话列表。')}{t('隐藏滚动条后仍可正常滚动。')}</p>
      <button className="button layout-reset" onClick={layout.reset}><RotateCcw size={14} />{t('恢复默认布局')}</button>
      {layout.feedback && <p className="layout-feedback" role="status">{t(layout.feedback)}</p>}
    </section>}
  </div>;
}
