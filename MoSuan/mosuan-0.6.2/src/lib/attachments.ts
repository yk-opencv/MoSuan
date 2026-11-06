import { newId } from './id';
export interface Attachment { id: string; name: string; dataUrl: string; width: number; height: number }
export { MAX_ATTACHMENTS } from '../../shared/imageLimits.js';
export async function prepareAttachment(file: File): Promise<Attachment> {
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('每张图片需为 12 MB 以内的非空文件。');
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片。');
  const url = URL.createObjectURL(file); const image = new Image();
  try {
    image.src = url; try { await image.decode(); } catch { throw new Error('图片无法读取，请换一张图片。'); }
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('图片分辨率过大，请先缩小后上传。');
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    if (!context) throw new Error('当前设备无法处理图片。');
    let dataUrl = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', 0.85 - attempt * 0.08);
      if (dataUrl.length <= 750_000) break;
      scale *= 0.8;
    }
    if (dataUrl.length > 750_000) throw new Error('图片压缩后仍然过大，请选择较小的图片。');
    return { id: newId(), name: file.name.slice(0, 100) || '图片', dataUrl, width: canvas.width, height: canvas.height };
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}
