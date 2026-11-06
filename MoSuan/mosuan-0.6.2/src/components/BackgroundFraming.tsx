import { useLocale } from '../lib/locale';
import { useEffect, useRef, useState } from 'react';
import { Check, Move, RotateCcw } from 'lucide-react';
import type { useBackground } from '../hooks/useBackground';
import { backgroundGeometry, defaultFraming, normalizeFraming, type BackgroundFraming as Framing } from '../lib/backgroundFraming';

export function BackgroundFraming({ appearance }: { appearance: ReturnType<typeof useBackground> }) {
  const { t } = useLocale();
  const { background, frame, url, busy } = appearance;
  const saved = normalizeFraming(background?.framing);
  const [draft, setDraft] = useState<Framing>(saved);
  const drag = useRef<{ x: number; y: number; initial: Framing } | null>(null);
  useEffect(() => { setDraft(normalizeFraming(background?.framing)); }, [background]);
  if (!background || !url) return null;
  const changed = draft.fit !== saved.fit || draft.x !== saved.x || draft.y !== saved.y || draft.zoom !== saved.zoom;
  const imageStyle = backgroundGeometry(background, frame, draft).style;
  function move(dx: number, dy: number, width: number, height: number, initial: Framing) {
    const geometry = backgroundGeometry(background!, { width, height }, initial);
    const gapX = width - geometry.width, gapY = height - geometry.height;
    setDraft({ ...initial, x: Math.round(Math.max(0, Math.min(100, initial.x + (Math.abs(gapX) > 1 ? dx / gapX * 100 : 0)))), y: Math.round(Math.max(0, Math.min(100, initial.y + (Math.abs(gapY) > 1 ? dy / gapY * 100 : 0)))) });
  }
  return <div className="background-framing">
    <h4>{t('选择图片显示范围')}</h4>
    <div className="background-fit-options" role="group" aria-label={t('背景显示方式')}>
      <button disabled={busy} aria-pressed={draft.fit === 'contain'} onClick={() => setDraft({ ...defaultFraming })}>{t('完整显示')}<small>{t('保留整张图片')}</small></button>
      <button disabled={busy} aria-pressed={draft.fit === 'cover'} onClick={() => setDraft({ ...draft, fit: 'cover' })}>{t('铺满背景')}<small>{t('允许裁切边缘')}</small></button>
    </div>
    <div className="background-framing-buttons"><button className="button subtle" disabled={busy} onClick={() => setDraft({ ...defaultFraming })}><RotateCcw size={14} />{t('还原显示范围')}</button><button className="button primary" disabled={busy || !changed} onClick={() => void appearance.applyFraming(draft)}><Check size={14} />{t('应用显示设置')}</button></div>
    <div className={`background-framing-preview ${busy ? 'disabled' : ''}`} role="group" aria-label={t('背景范围预览')} tabIndex={0} style={{ aspectRatio: `${frame.width} / ${frame.height}`, maxWidth: `${240 * frame.width / frame.height}px`, backgroundImage: `url("${url}")`, ...imageStyle }}
      onPointerDown={event => {
        if (busy || event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, initial: draft }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      }}
      onPointerMove={event => {
        if (!drag.current || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        move(event.clientX - drag.current.x, event.clientY - drag.current.y, rect.width, rect.height, drag.current.initial);
      }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (!busy && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
          move(event.key === 'ArrowRight' ? 8 : event.key === 'ArrowLeft' ? -8 : 0, event.key === 'ArrowDown' ? 8 : event.key === 'ArrowUp' ? -8 : 0, rect.width, rect.height, draft);
        }
      }}><span><Move size={12} />{t('拖动调整位置')}</span></div>
    <p className="background-framing-hint">{t('预览与当前窗口比例相同。完整显示会保留空白；铺满时可拖动图片，选好显示区域。')}</p>
    <div className="background-framing-sliders">{([['zoom', '放大', 100, 200, 5], ['x', '左右位置', 0, 100, 1], ['y', '上下位置', 0, 100, 1]] as const).map(([key, label, min, max, step]) => <label key={key}>{t(label)}<output>{draft[key]}%</output><input type="range" aria-label={t('背景{0}', t(label))} min={min} max={max} step={step} value={draft[key]} disabled={busy} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} /></label>)}</div>
    {changed && <p className="background-framing-hint">{t('当前为预览，点击「应用显示设置」后保存。')}</p>}
  </div>;
}
