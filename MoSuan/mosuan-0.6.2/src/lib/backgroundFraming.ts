export interface BackgroundFraming { fit: 'contain' | 'cover'; x: number; y: number; zoom: number }
export const defaultFraming: BackgroundFraming = { fit: 'contain', x: 50, y: 50, zoom: 100 };
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
export function normalizeFraming(value?: Partial<BackgroundFraming> | null): BackgroundFraming {
  return { fit: value?.fit === 'cover' ? 'cover' : 'contain', x: bounded(value?.x, 50, 0, 100), y: bounded(value?.y, 50, 0, 100), zoom: bounded(value?.zoom, 100, 100, 200) };
}
export function backgroundGeometry(image: { width: number; height: number }, frame: { width: number; height: number }, placement?: Partial<BackgroundFraming>) {
  const framing = normalizeFraming(placement);
  const ratio = framing.fit === 'contain' ? Math.min(frame.width / image.width, frame.height / image.height) : Math.max(frame.width / image.width, frame.height / image.height);
  const width = image.width * ratio * framing.zoom / 100;
  const height = image.height * ratio * framing.zoom / 100;
  return { width, height, style: { backgroundSize: `${width / frame.width * 100}% auto`, backgroundPosition: `${framing.x}% ${framing.y}%` } };
}
