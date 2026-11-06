import { MAX_ATTACHMENTS } from '../shared/imageLimits.js';

export function validateImages(images) {
  if (!Array.isArray(images) || images.length > MAX_ATTACHMENTS) throw new Error('每条问题最多包含 ' + MAX_ATTACHMENTS + ' 张图片');
  return images.map(image => {
    if (!image || typeof image.dataUrl !== 'string' || image.dataUrl.length > 750_000 || !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) throw new Error('图片数据无效或过大，请重新选择图片');
    const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');
    const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(';'));
    const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0,6).toString()) : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!valid) throw new Error('图片格式与数据不一致');
    return { dataUrl: image.dataUrl, name: typeof image.name === 'string' ? image.name.slice(0,100) : '图片' };
  });
}
