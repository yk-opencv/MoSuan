import { useLocale } from '../lib/locale';
import type { useMathEngine } from '../hooks/useMathEngine';

export function MathEngineSettings({ renderer }: { renderer: ReturnType<typeof useMathEngine> }) {
  const { t } = useLocale();
  return <section className="math-engine-settings" aria-label={t('公式渲染设置')}><h3>{t('公式渲染方式')}</h3>
    <div className="math-engine-options" role="group" aria-label={t('公式渲染方式')}>
      <button disabled={renderer.busy} aria-pressed={renderer.engine === 'katex'} onClick={() => void renderer.choose('katex')}><strong>KaTeX</strong><small>{t('默认排版引擎')}</small></button>
      <button disabled={renderer.busy} aria-pressed={renderer.engine === 'mathjax'} onClick={() => void renderer.choose('mathjax')}><strong>MathJax</strong><small>{t('SVG 公式排版')}</small></button>
    </div><p>{t('切换后重新排版当前公式，保留对话原文。两种方式均使用本地资源。')}</p>
    {renderer.feedback && <p className="renderer-feedback" role="status" aria-live="polite">{t(renderer.feedback)}</p>}
  </section>;
}
