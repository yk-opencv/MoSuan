import { useRef, useState } from 'react';

const key = 'mosuan-reader-settings-v1';
function initial() {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return { fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 14 && value.fontSize <= 22 ? value.fontSize as number : 16, rounds: [0, 2, 4, 8, 12].includes(value.rounds) ? value.rounds as number : 4 };
  } catch { return { fontSize: 16, rounds: 4 }; }
}
export function useReaderPreferences() {
  const [value, setValue] = useState(initial); const latest = useRef(value);
  const [feedback, setFeedback] = useState('');
  function update(patch: Partial<typeof value>) {
    latest.current = { ...latest.current, ...patch }; setValue(latest.current);
    try { localStorage.setItem(key, JSON.stringify(latest.current)); setFeedback(''); }
    catch { setFeedback('设置已生效，但浏览器无法保存；刷新后可能恢复默认值。'); }
  }
  return { ...value, feedback, setFontSize: (fontSize: number) => update({ fontSize }), setRounds: (rounds: number) => update({ rounds }) };
}

export function rememberedBook() {
  try { return sessionStorage.getItem('mosuan-active-book') || localStorage.getItem('mosuan-active-book') || ''; } catch { return ''; }
}
export function rememberBook(id: string) {
  try { sessionStorage.setItem('mosuan-active-book', id); localStorage.setItem('mosuan-active-book', id); } catch { /* Reading remains possible. */ }
}
export interface ReadingPosition { top: number; key?: string; offset?: number }
export function loadPosition(id: string): ReadingPosition {
  try {
    const value = JSON.parse(sessionStorage.getItem(`mosuan-position:${id}`) || localStorage.getItem(`mosuan-position:${id}`) || '{}');
    return { top: Number.isFinite(value.top) && value.top >= 0 ? value.top : 0, key: typeof value.key === 'string' ? value.key : undefined, offset: Number.isFinite(value.offset) ? value.offset : 0 };
  } catch { return { top: 0 }; }
}
export function savePosition(id: string, position: ReadingPosition) {
  try { sessionStorage.setItem(`mosuan-position:${id}`, JSON.stringify(position)); localStorage.setItem(`mosuan-position:${id}`, JSON.stringify(position)); } catch { /* Never prevent saving notebook content. */ }
}
