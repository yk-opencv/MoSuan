import { translator, type Translate } from './translate';

export const importEncodings = [
  ['auto', '自动识别（推荐）'], ['utf-8', 'UTF-8'], ['gb18030', 'GBK / GB18030'],
  ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'], ['big5', 'Big5（繁体中文）'],
] as const;
export type ImportEncoding = typeof importEncodings[number][0];
type Encoding = Exclude<ImportEncoding, 'auto'>;
export interface DecodedImport { text: string; encoding: Encoding; uncertain: boolean }

function decode(bytes: Uint8Array, encoding: Encoding, uncertain = false): DecodedImport {
  // Fatal decoding keeps invalid bytes from silently becoming replacement characters.
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('文件包含非文本数据或编码不匹配，请选择其他编码；仅支持文本 Markdown / TXT。');
  }
  return { text, encoding, uncertain };
}

export function decodeImport(bytes: Uint8Array, requested: ImportEncoding = 'auto'): DecodedImport {
  if (bytes.length >= 4 && ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff))) {
    throw new Error('暂不支持 UTF-32 文件，请先另存为 UTF-8 后导入。');
  }
  try {
    if (requested !== 'auto') return decode(bytes, requested);
    // A BOM is authoritative: never reinterpret a damaged UTF file as GBK.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode(bytes, 'utf-8');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes, 'utf-16le');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes, 'utf-16be');
    // Recognize common BOM-less UTF-16 notes by alternating ASCII high bytes.
    const pairs = Math.min(Math.floor(bytes.length / 2), 2048);
    let evenZero = 0, oddZero = 0;
    for (let i = 0; i < pairs; i++) {
      if (bytes[2 * i] === 0) evenZero++;
      if (bytes[2 * i + 1] === 0) oddZero++;
    }
    if (pairs >= 4 && oddZero / pairs > 0.25 && evenZero / pairs < 0.05) return decode(bytes, 'utf-16le', true);
    if (pairs >= 4 && evenZero / pairs > 0.25 && oddZero / pairs < 0.05) return decode(bytes, 'utf-16be', true);
    try { return decode(bytes, 'utf-8'); } catch { /* Try common Chinese legacy encoding next. */ }
    return decode(bytes, 'gb18030', true);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('文件包含')) throw error;
    throw new Error('无法按当前编码完整读取文件，请切换「文件编码」检查预览，或将原文件另存为 UTF-8。');
  }
}

const defaultTranslation = translator('zh-CN');
export function importEncodingMessage(result: DecodedImport, t: Translate = defaultTranslation): string {
  const name = importEncodings.find(([value]) => value === result.encoding)![1];
  const conversion = result.encoding === 'utf-8' ? t('已按 UTF-8 读取。') : t('已按 {0} 转换为可保存的文本，导出使用 UTF-8。', t(name));
  return conversion + (result.uncertain ? t('自动识别仅供参考；若预览中文不正确，请手动切换文件编码。') : '') +
    (result.text.includes('\ufffd') ? t('原文中已有 � 字符，转换编码无法自动还原丢失的文字。') : '');
}
