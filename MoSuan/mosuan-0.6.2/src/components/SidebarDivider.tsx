import { useLocale } from '../lib/locale';
import { useRef, useState } from 'react';
import type { useLayout } from '../hooks/useLayout';

export function SidebarDivider({ layout }: { layout: ReturnType<typeof useLayout> }) {
  const { t } = useLocale();
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function finish() { if (start.current) { start.current = null; setDragging(false); layout.commit(); } }
  return <div className={`sidebar-divider ${dragging ? 'dragging' : ''}`} role="separator" aria-label={t('调整左右栏宽度')} aria-orientation="vertical" aria-controls="conversation-sidebar reading-workspace" aria-valuemin={200} aria-valuemax={layout.maxWidth} aria-valuenow={layout.width} tabIndex={0} title={t('拖动调整左右宽度；双击恢复默认宽度')}
    onPointerDown={event => {
      if (event.button !== 0) return;
      start.current = { x: event.clientX, width: layout.width }; setDragging(true);
      event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }}
    onPointerMove={event => { if (start.current) layout.resize(start.current.width + event.clientX - start.current.x); }}
    onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={layout.resetWidth}
    onKeyDown={event => {
      const values: Record<string, number> = { ArrowLeft: layout.width - 12, ArrowRight: layout.width + 12, Home: 200, End: layout.maxWidth };
      if (event.key in values) { event.preventDefault(); layout.resize(values[event.key], true); }
      if (event.key === 'Enter') { event.preventDefault(); layout.resetWidth(); }
    }}><span /></div>;
}
