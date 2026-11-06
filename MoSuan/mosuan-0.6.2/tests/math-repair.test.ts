import { expect, it } from 'vitest';
import { inspectRepair, wrapMath } from '../src/lib/mathRepair';
import { renderBlock, splitDocument } from '../src/lib/markdown';

const formula = String.raw`d = \frac{\left|\overrightarrow{P_0P}\cdot\vec{n}\right|}{\left|\vec{n}\right|}`;
const scan = (source: string) => {
  const result = inspectRepair({ kind: 'scan', source });
  if (result.kind !== 'scan') throw new Error('Expected suggestions');
  return result.suggestions;
};
const check = (source: string, start: number, end: number, display = false) =>
  inspectRepair({ kind: 'check', source, range: { start, end }, display });

it('finds the pasted display formula without changing the same TeX in code, math, or mixed prose', () => {
  const protectedSource = [
    '```tex', formula, '```', '',
    '    ' + formula, '',
    'Example `code', formula, 'continues`.', '',
    '$$', formula, '$$', '',
    '\\[', formula, '\\]', '',
    '\\(', formula, '\\)', '',
    '请注意 ' + formula + ' 的含义。', '',
  ].join('\n');
  const source = protectedSource + '\n' + formula + '\n\n下一步。';
  const [suggestion, ...others] = scan(source);
  expect(others).toHaveLength(0);
  expect(suggestion?.start).toBe(source.lastIndexOf(formula));
  expect(suggestion?.tex).toBe(formula);
  expect(check(source, suggestion.start, suggestion.end, true)).toEqual({ kind: 'check', valid: true });
  expect(wrapMath(source, suggestion, true).text).toBe(protectedSource + '\n$$\n' + formula + '\n$$\n\n下一步。');
});

it('keeps list indentation and CRLF when repairing a display formula', () => {
  const source = '1. 展开点乘\n\n   ' + formula + '  \n\n2. 代入坐标';
  const [suggestion] = scan(source);
  expect(check(source, suggestion.start, suggestion.end, true)).toEqual({ kind: 'check', valid: true });
  const expected = '1. 展开点乘\n\n   $$\n   ' + formula + '\n   $$  \n\n2. 代入坐标';
  const repaired = wrapMath(source.replaceAll('\n', '\r\n'), suggestion, true);
  expect(repaired.text).toBe(expected.replaceAll('\n', '\r\n'));
  const html = splitDocument(repaired.text).map(block => renderBlock(block)).join('');
  expect(html).toContain('<ol>');
  expect(html).toContain('class="katex"');
  expect(html).not.toContain('math-fallback');
  expect(scan(expected)).toHaveLength(0);
});

it('only wraps a selected inline expression in prose', () => {
  const tex = '\\vec{n}';
  const prose = '平面的法向量 ' + tex + ' 垂直于平面。';
  const start = prose.indexOf(tex);
  expect(check(prose, start, start + tex.length)).toEqual({ kind: 'check', valid: true });
  expect(wrapMath(prose, { start, end: start + tex.length }, false).text).toBe('平面的法向量 $\\vec{n}$ 垂直于平面。');
  for (const source of ['原文 `' + tex + '`。', '```tex\n' + tex + '\n```', '已排版 $' + tex + '$。', '示例 <code>' + tex + '</code>']) {
    const offset = source.indexOf(tex);
    expect(check(source, offset, offset + tex.length)).toEqual({ kind: 'check', valid: false });
  }
});
