import { useEffect, useRef, useState } from 'react';
import { loadBackground, prepareBackground, saveBackground, type BackgroundImage } from '../lib/background';
import { backgroundGeometry, normalizeFraming, type BackgroundFraming } from '../lib/backgroundFraming';

export function useBackground() {
  const [background, setBackground] = useState<BackgroundImage | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('正在读取背景设置…');
  const lock = useRef(true);
  const [frame, setFrame] = useState(() => ({ width: window.innerWidth, height: Math.max(400, window.innerHeight) }));
  useEffect(() => {
    const resized = () => setFrame({ width: window.innerWidth, height: Math.max(400, window.innerHeight) });
    window.addEventListener('resize', resized); return () => window.removeEventListener('resize', resized);
  }, []);
  useEffect(() => {
    let live = true;
    loadBackground().then(value => {
      if (live) { setBackground(value); setFeedback(''); }
    }).catch(() => { if (live) setFeedback('背景读取失败，暂时使用默认背景；可重新上传或恢复默认。'); })
      .finally(() => { if (live) { lock.current = false; setBusy(false); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!background) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(background.image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [background?.image]);

  async function upload(file: File) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFeedback('正在处理并保存图片…');
    try {
      const value = await prepareBackground(file);
      await saveBackground(value);
      setBackground(value); setFeedback('背景已设置并保存，刷新后仍会保留。');
    } catch (error) {
      setFeedback(error instanceof DOMException ? '背景保存失败，原背景已保留。请检查浏览器存储空间后重试。' : error instanceof Error ? error.message : '背景设置失败，原背景已保留。');
    } finally { lock.current = false; setBusy(false); }
  }
  async function reset() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFeedback('正在恢复默认背景…');
    try { await saveBackground(null); setBackground(null); setFeedback('已恢复默认背景并保存。'); }
    catch { setFeedback('默认背景保存失败，原背景已保留，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function applyFraming(framing: BackgroundFraming) {
    if (lock.current || !background) return false;
    lock.current = true; setBusy(true); setFeedback('正在保存背景显示设置…');
    try {
      const value = { ...background, framing: normalizeFraming(framing) };
      await saveBackground(value); setBackground(value); setFeedback('背景显示设置已应用并保存。'); return true;
    } catch { setFeedback('背景显示设置保存失败，原设置已保留，请重试。'); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  const imageStyle = background ? backgroundGeometry(background, frame, background.framing).style : {};
  return { background, url, busy, feedback, upload, reset, frame, imageStyle, applyFraming };
}
