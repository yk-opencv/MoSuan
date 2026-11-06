import { useEffect, useRef } from 'react';
import { loadPosition, savePosition } from './useReaderPreferences';

export interface ReadingJump { bookId: string; key?: string }

export function useReadingPosition(id: string, ready: boolean, viewport: React.RefObject<HTMLDivElement | null>, keys: string[], scrollToIndex: (index: number) => void, layoutKey: string, jump?: ReadingJump, parsing = false) {
  const latest = useRef({ keys, scrollToIndex, layoutKey, parsing }); latest.current = { keys, scrollToIndex, layoutKey, parsing };
  const capture = useRef(() => {});
  const cancel = useRef(() => {});
  const lastJump = useRef<ReadingJump | undefined>(undefined);
  useEffect(() => {
    const element = viewport.current;
    if (!ready || !id || !element) return;
    const fromSearch = jump?.bookId === id && jump !== lastJump.current;
    if (fromSearch) {
      lastJump.current = jump;
      element.focus({ preventScroll: true });
    }
    const position = fromSearch ? { top: 0, key: jump.key, offset: 0 } : loadPosition(id);
    let restoring = true, frame = 0, timer = 0, attempts = 0, stable = 0;
    function save() {
      if (restoring || !element || element.dataset.readingBookId !== id) return;
      const top = element.getBoundingClientRect().top;
      const row = Array.from(element.querySelectorAll<HTMLElement>('.virtual-row')).find(row => row.getBoundingClientRect().bottom > top + 1);
      savePosition(id, { top: element.scrollTop, key: element.scrollTop > 0 ? row?.dataset.rowKey : undefined, offset: row ? top - row.getBoundingClientRect().top : 0 });
    }
    capture.current = save;
    const waitingSince = performance.now();
    function restore() {
      const index = position.key ? latest.current.keys.indexOf(position.key) : -1;
      if (index < 0 && position.key && latest.current.parsing && performance.now() - waitingSince < 10_000) {
        frame = requestAnimationFrame(restore);
        return;
      }
      if (!element || ++attempts > 45) { restoring = false; if (fromSearch) save(); return; }
      const row = index >= 0 ? element.querySelector<HTMLElement>(`.virtual-row[data-index="${index}"]`) : null;
      if (row) {
        const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top + (position.offset || 0);
        const target = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + delta));
        if (Math.abs(target - element.scrollTop) > 1) { element.scrollTop = target; stable = 0; } else stable++;
      } else if (index >= 0) latest.current.scrollToIndex(index);
      else { element.scrollTop = position.top; stable++; }
      if (stable >= 4) { restoring = false; if (fromSearch) save(); return; }
      frame = requestAnimationFrame(restore);
    }
    if (!position.top && !position.key) { element.scrollTop = 0; restoring = false; if (fromSearch) save(); }
    else frame = requestAnimationFrame(restore);
    const scroll = () => { clearTimeout(timer); if (!restoring) timer = window.setTimeout(save, 180); };
    const interrupt = () => { restoring = false; cancelAnimationFrame(frame); };
    cancel.current = interrupt;
    element.addEventListener('scroll', scroll);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(type, interrupt);
    window.addEventListener('pagehide', save);
    return () => {
      if (latest.current.layoutKey === layoutKey) save();
      clearTimeout(timer); cancelAnimationFrame(frame); element.removeEventListener('scroll', scroll);
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(type, interrupt);
      window.removeEventListener('pagehide', save);
      cancel.current = () => {};
    };
  }, [id, ready, viewport, layoutKey, jump]);
  return { rememberPosition: () => capture.current(), cancelRestore: () => cancel.current() };
}
