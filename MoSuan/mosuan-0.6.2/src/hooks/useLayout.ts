import { useEffect, useRef, useState } from 'react';

export const layoutDefaults = { sidebar: true, header: true, toolbar: true, cover: true, scrollbars: true, jumps: true, sidebarWidth: null as number | null };
export type LayoutPreferences = typeof layoutDefaults;
export type VisibilityKey = Exclude<keyof LayoutPreferences, 'sidebarWidth'>;
const storageKey = 'mosuan-layout-v1';
export function maximumSidebarWidth(viewport: number) { return Math.max(200, Math.min(480, viewport - 366)); }
function initialLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    const preferences = { ...layoutDefaults };
    if (value && typeof value === 'object') {
      for (const key of ['sidebar', 'header', 'toolbar', 'cover', 'scrollbars', 'jumps'] as const) if (typeof value[key] === 'boolean') preferences[key] = value[key];
      if (typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)) preferences.sidebarWidth = Math.max(200, Math.min(480, value.sidebarWidth));
    }
    return { preferences, feedback: '' };
  } catch { return { preferences: { ...layoutDefaults }, feedback: '已使用默认布局，浏览器中的布局设置暂不可读取。' }; }
}
export function useLayout() {
  const [initial] = useState(initialLayout);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [feedback, setFeedback] = useState(initial.feedback);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const latest = useRef(preferences);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(latest.current)); setFeedback(''); }
    catch { setFeedback('布局已生效，但无法保存到浏览器；刷新后可能恢复旧布局。'); }
  }
  function update(patch: Partial<LayoutPreferences>, persist = true) {
    latest.current = { ...latest.current, ...patch }; setPreferences(latest.current);
    if (persist) save();
  }
  const defaultWidth = viewportWidth >= 1600 ? 285 : viewportWidth <= 1100 ? 224 : 264;
  const maxWidth = maximumSidebarWidth(viewportWidth);
  const width = Math.max(200, Math.min(maxWidth, preferences.sidebarWidth ?? defaultWidth));
  return {
    preferences, feedback, width, maxWidth, desktop: viewportWidth > 760,
    toggle: (key: VisibilityKey) => update({ [key]: !latest.current[key] }),
    resize: (value: number, persist = false) => update({ sidebarWidth: Math.round(Math.max(200, Math.min(maximumSidebarWidth(window.innerWidth), value))) }, persist),
    commit: save,
    resetWidth: () => update({ sidebarWidth: null }),
    reset: () => { latest.current = { ...layoutDefaults }; setPreferences(latest.current); save(); },
  };
}
