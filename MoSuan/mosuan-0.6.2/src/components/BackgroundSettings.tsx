import { useLocale } from '../lib/locale';
import { useRef } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import type { useBackground } from '../hooks/useBackground';
import type { useReadingColor } from '../hooks/useReadingColor';
import { BackgroundFraming } from './BackgroundFraming';

export function BackgroundSettings({ appearance, readingColor, fontSize, onFontSizeChange }: { appearance: ReturnType<typeof useBackground>; readingColor: ReturnType<typeof useReadingColor>; fontSize: number; onFontSizeChange: (size: number) => void }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  return <section className="background-settings" aria-label={t('背景设置')}>
    <h3>{t('背景外观')}</h3><p>{t('从本地选一张喜欢的图片，也可以随时恢复墨算默认背景。')}</p>
    <div className="background-current">
      {appearance.url ? <img className="background-preview" src={appearance.url} alt={t('当前背景预览')} /> : <div className="background-default" aria-label={t('默认背景预览')}><span>∑</span><small>{t('墨算 · 默认')}</small></div>}
      <div><strong>{appearance.background ? t('自定义图片背景') : t('当前为默认背景')}</strong><small>{appearance.background ? appearance.background.name : t('原有的浅色阅读背景')}</small><small>{t('图片仅保存在当前浏览器')}</small></div>
    </div>
    <div className="background-buttons"><button className="button" disabled={appearance.busy} onClick={() => input.current?.click()}><ImagePlus size={16} />{t('上传背景图片')}</button><button className="button subtle" disabled={appearance.busy} onClick={() => void appearance.reset()}><RotateCcw size={15} />{t('恢复默认背景')}</button></div>
    <input className="hidden" ref={input} type="file" aria-label={t('选择背景图片')} accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" disabled={appearance.busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void appearance.upload(file); }} />
    <p className="background-help">{t('支持 JPG、PNG、WebP、GIF、AVIF、BMP，最大 12 MB。默认完整显示图片，动图使用静态画面。')}</p>
    {appearance.feedback && <p className="background-feedback" role="status" aria-live="polite">{t(appearance.feedback)}</p>}
    <BackgroundFraming appearance={appearance} />
    <div className="reading-color-settings"><h3>{t('阅读字体')}</h3><div className="font-size-setting"><span>{t('字号')}</span><div role="group" aria-label={t('阅读字号')}><button className="button" aria-label={t('减小字号')} disabled={fontSize <= 14} onClick={() => onFontSizeChange(Math.max(14, fontSize - 1))}>A−</button><output aria-label={t('当前字号')}>{fontSize} px</output><button className="button" aria-label={t('增大字号')} disabled={fontSize >= 22} onClick={() => onFontSizeChange(Math.min(22, fontSize + 1))}>A+</button></div><button className="font-size-reset" onClick={() => onFontSizeChange(16)}>{t('默认字号')}</button></div><div className="reading-color-options" role="group" aria-label={t('阅读字体颜色')}>
      {([['default', '默认字体'], ['black', '黑色字体'], ['white', '白色字体']] as const).map(([value, label]) => <button key={value} className="reading-color-option" disabled={readingColor.busy} aria-pressed={readingColor.color === value} onClick={() => void readingColor.choose(value)}><span aria-hidden="true" className={`color-swatch ${value}`} />{t(label)}</button>)}
    </div><p>{t('仅调整阅读区文字、公式和数字，背景图片保持不变。')}</p>{readingColor.feedback && <p className="reading-color-feedback" role="status" aria-live="polite">{t(readingColor.feedback)}</p>}</div>
  </section>;
}
