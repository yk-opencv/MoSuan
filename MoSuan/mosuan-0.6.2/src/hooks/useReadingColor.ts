import { useEffect, useRef, useState } from 'react';
import { loadReadingColor, saveReadingColor, type ReadingColor } from '../lib/background';

export function useReadingColor() {
  const [color, setColor] = useState<ReadingColor>('default');
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');
  const lock = useRef(true);
  useEffect(() => {
    let live = true;
    loadReadingColor().then(value => { if (live) setColor(value); })
      .catch(() => { if (live) setFeedback('字体设置读取失败，暂时使用默认字体颜色。'); })
      .finally(() => { if (live) { lock.current = false; setBusy(false); } });
    return () => { live = false; };
  }, []);
  async function choose(value: ReadingColor) {
    if (lock.current || value === color) return;
    lock.current = true; setBusy(true); setFeedback('正在保存字体颜色…');
    try { await saveReadingColor(value); setColor(value); setFeedback('字体颜色已保存，刷新后仍会保留。'); }
    catch { setFeedback('字体颜色保存失败，原设置已保留，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return { color, busy, feedback, choose };
}
