import { normalizeFraming, type BackgroundFraming } from './backgroundFraming';
import type { MathEngine } from './markdown';
export interface BackgroundImage { image: Blob; name: string; width: number; height: number; framing?: BackgroundFraming }
export type ReadingColor = 'default' | 'black' | 'white';
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1920;
const formats = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);

export async function prepareBackground(file: File): Promise<BackgroundImage> {
  if (!file.size) throw new Error('图片文件为空，请重新选择。');
  if (file.size > MAX_BYTES) throw new Error('背景图片不能超过 12 MB，请选择较小的图片。');
  if (!formats.has(file.type) && !(file.type === '' && /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name))) {
    throw new Error('请选择 JPG、PNG、WebP、GIF、AVIF 或 BMP 图片。');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('图片无法读取，可能已损坏或格式不受支持，请换一张图片。'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error('图片分辨率过大，请先缩小到 4000 万像素以内。');
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器后重试。');
    context.fillStyle = '#eff1e9'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片处理失败，请换一张图片。')), 'image/jpeg', 0.85));
    return { image: blob, name: file.name.slice(0, 120), width: canvas.width, height: canvas.height, framing: normalizeFraming() };
  } finally {
    URL.revokeObjectURL(url); image.src = ''; canvas.width = 0; canvas.height = 0;
  }
}

async function openAppearanceDB(): Promise<IDBDatabase> {
  // Separate preferences from notebooks, preserving existing notebook schema
  // and compatibility with other tabs still running the previous version.
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mosuan-preferences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('appearance');
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('背景设置被其他窗口占用，请关闭旧窗口后重试。'));
  });
}
export async function loadBackground(): Promise<BackgroundImage | null> {
  const db = await openAppearanceDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('appearance');
      const request = tx.objectStore('appearance').get('background');
      tx.oncomplete = () => {
        const value = request.result;
        if (!value) return resolve(null);
        if (!(value.image instanceof Blob) || value.image.type !== 'image/jpeg' || !value.image.size || typeof value.name !== 'string' || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || Math.max(value.width, value.height) > MAX_EDGE) {
          reject(new Error('背景设置无法读取，请重新上传图片或恢复默认背景。')); return;
        }
        resolve({ ...value, framing: normalizeFraming(value.framing) });
      };
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function saveBackground(value: BackgroundImage | null): Promise<void> {
  const db = await openAppearanceDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('appearance', 'readwrite'); const store = tx.objectStore('appearance');
      if (value) store.put(value, 'background'); else store.delete('background');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function loadReadingColor(): Promise<ReadingColor> {
  const db = await openAppearanceDB();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('appearance'); const request = tx.objectStore('appearance').get('reading-color');
    tx.oncomplete = () => resolve(['black', 'white'].includes(request.result) ? request.result : 'default');
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function saveReadingColor(value: ReadingColor): Promise<void> {
  const db = await openAppearanceDB();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('appearance', 'readwrite');
    if (value === 'default') tx.objectStore('appearance').delete('reading-color');
    else tx.objectStore('appearance').put(value, 'reading-color');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadMathEngine(): Promise<MathEngine> {
  const db = await openAppearanceDB();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('appearance'); const request = tx.objectStore('appearance').get('math-engine');
    tx.oncomplete = () => resolve(request.result === 'mathjax' ? 'mathjax' : 'katex');
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function saveMathEngine(engine: MathEngine): Promise<void> {
  const db = await openAppearanceDB();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('appearance', 'readwrite'); tx.objectStore('appearance').put(engine, 'math-engine');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
