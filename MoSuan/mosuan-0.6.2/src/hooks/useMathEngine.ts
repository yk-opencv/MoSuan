import { useEffect, useRef, useState } from 'react';
import { ensureMathjax, type MathEngine } from '../lib/markdown';
import { loadMathEngine, saveMathEngine } from '../lib/background';

export function useMathEngine() {
  const [engine, setEngine] = useState<MathEngine>('katex');
  const [busy, setBusy] = useState(true); const [feedback, setFeedback] = useState('');
  const lock = useRef(true);
  useEffect(() => {
    let live = true;
    loadMathEngine().then(async value => {
      if (value === 'mathjax') { if (live) setFeedback('正在加载 MathJax…'); await ensureMathjax(); }
      if (live) { setEngine(value); setFeedback(''); }
    }).catch(() => { if (live) setFeedback('渲染设置或引擎加载失败，暂用 KaTeX；可重新选择或刷新后重试。'); })
      .finally(() => { if (live) { lock.current = false; setBusy(false); } });
    return () => { live = false; };
  }, []);
  async function choose(value: MathEngine) {
    if (lock.current || value === engine) return;
    lock.current = true; setBusy(true); setFeedback(value === 'mathjax' ? '正在加载 MathJax…' : '正在切换渲染方式…');
    try {
      if (value === 'mathjax') {
        try { await ensureMathjax(); }
        catch { setFeedback('MathJax 加载失败，请刷新页面后重试。'); return; }
      }
      await saveMathEngine(value); setEngine(value); setFeedback(`已切换为 ${value === 'mathjax' ? 'MathJax' : 'KaTeX'}，选择已保存。`);
    } catch { setFeedback('渲染方式保存失败，原设置已保留，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return { engine, busy, feedback, choose };
}
