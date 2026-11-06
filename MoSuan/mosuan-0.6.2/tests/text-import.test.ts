import { describe, expect, it } from 'vitest';
import { decodeImport, importEncodingMessage } from '../src/lib/textImport';

const hex = (value: string) => new Uint8Array(Buffer.from(value.replaceAll(' ', ''), 'hex'));
const source = '# 中文笔记\n\n公式：$x^2$，\\[\\frac{1}{2}\\]\n```tex\n$x^2$\n```';

describe('text file encoding conversion', () => {
  it('preserves UTF-8 Chinese, emoji, formulas and code with or without BOM', () => {
    for (const prefix of ['', '\ufeff']) {
      const result = decodeImport(new TextEncoder().encode(prefix + source + '😀'));
      expect(result).toEqual({ text: source + '😀', encoding: 'utf-8', uncertain: false });
    }
    expect(decodeImport(new Uint8Array()).text).toBe('');
  });
  it('decodes GBK Chinese and GB18030 four-byte characters without changing TeX', () => {
    const bytes = new Uint8Array([...hex('d6d0cec4'), ...new TextEncoder().encode(' $x^2$ \\[x\\] '), ...hex('9439fc36')]);
    const result = decodeImport(bytes);
    expect(result).toEqual({ text: '中文 $x^2$ \\[x\\] 😀', encoding: 'gb18030', uncertain: true });
    expect(importEncodingMessage(result)).toContain('请手动切换');
  });
  it('honors both UTF-16 BOMs and detects common BOM-less notes', () => {
    const le = hex('230020002d4e87650a00240078005e0032002400'); // # 中文\n$x^2$
    const be = new Uint8Array(le.length);
    for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i]; }
    for (const [bytes, encoding, bom] of [[le, 'utf-16le', [0xff, 0xfe]], [be, 'utf-16be', [0xfe, 0xff]]] as const) {
      expect(decodeImport(new Uint8Array([...bom, ...bytes]))).toEqual({ text: '# 中文\n$x^2$', encoding, uncertain: false });
      expect(decodeImport(bytes)).toEqual({ text: '# 中文\n$x^2$', encoding, uncertain: true });
    }
  });
  it('allows explicitly selecting Big5 and non-BOM UTF-16 for ambiguous input', () => {
    expect(decodeImport(hex('a4a4a4e5'), 'big5').text).toBe('中文');
    expect(decodeImport(hex('2d4e8765'), 'utf-16le').text).toBe('中文');
    expect(decodeImport(hex('d6d0cec4'), 'gb18030').uncertain).toBe(false);
  });
  it('rejects incomplete data, malformed BOM files, binary controls and UTF-32', () => {
    for (const bytes of ['81', 'ff', 'efbbbf81', 'fffe2d', 'feff00', 'fffe000041000000', '0000feff00000041', '00010203']) {
      expect(() => decodeImport(hex(bytes))).toThrow();
    }
    expect(() => decodeImport(hex('d6d0cec4'), 'utf-8')).toThrow('无法按当前编码');
  });
  it('warns about replacement characters already in the source', () => {
    expect(importEncodingMessage(decodeImport(new TextEncoder().encode('中文�')))).toContain('无法自动还原');
  });
});
