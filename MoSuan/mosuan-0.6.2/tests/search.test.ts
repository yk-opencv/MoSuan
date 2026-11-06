import { expect, test } from 'vitest';
import { splitDocument } from '../src/lib/markdown';
import { blockAtSourceOffset } from '../src/lib/markdownChunks';
import { SEARCH_LIMIT, searchNotebooks } from '../src/lib/search';
import type { Notebook } from '../src/lib/storage';

const signal = new AbortController().signal;
function note(content: string, title = '积分练习'): Notebook {
  return { id: 'study', title, updated: 0, messages: [{ id: 'answer', role: 'assistant', content }] };
}

test('searches title, question and answer locally using literal, case-insensitive matches', async () => {
  const source = '前面的内容\r\n\r\n公式：$x^2+1$。 Fourier 与 FOURIER。';
  const book = note(source);
  book.messages.unshift({ id: 'question', role: 'user', content: '怎样证明积分公式？', images: [{ id: 'image', name: '附件.png', dataUrl: 'data:image/png;base64,NOT_INDEXED', width: 1, height: 1 }] });
  const title = await searchNotebooks([book], '积分', signal);
  expect(title.hits.map(hit => hit.location?.messageId)).toEqual([undefined, 'question']);
  const formula = await searchNotebooks([book], 'x^2+1', signal);
  expect(formula.hits[0].location?.offset).toBe(source.indexOf('x^2+1'));
  const mixed = await searchNotebooks([book], 'fourier', signal);
  expect(mixed.hits.map(hit => hit.excerpt.match)).toEqual(['Fourier', 'FOURIER']);
  expect((await searchNotebooks([book], 'NOT_INDEXED', signal)).hits).toEqual([]);
});

test('limits result output and distinguishes more results from an exact fit', async () => {
  const entries = (n: number) => note('例题 '.repeat(n));
  expect(await searchNotebooks([entries(SEARCH_LIMIT)], '例题', signal)).toMatchObject({ more: false });
  const result = await searchNotebooks([entries(SEARCH_LIMIT + 1)], '例题', signal);
  expect(result.hits).toHaveLength(SEARCH_LIMIT);
  expect(result.more).toBe(true);
});

test('locates the correct occurrence in a dense list, including CRLF source', () => {
  const source = '# 大量推导\r\n\r\n- ' + Array.from({ length: 65 }, (_, i) => `第${i}步定位 $x_{${i}}^2$`).join('，');
  const blocks = splitDocument(source);
  const index = blockAtSourceOffset(blocks, source, source.indexOf('第54步定位') + '第54步'.length);
  expect(blocks[index].raw).toContain('第54步定位');
  expect(blocks[index].raw).not.toContain('第1步定位');
});

test('finds source positions in both columns of a table continued across reading blocks', () => {
  const cell = (name: string) => Array.from({ length: 24 }, (_, i) => `$x_{${i}}$ ${name}-${i} `).join('');
  const source = `| 左列 | 右列 |\n| --- | --- |\n| ${cell('L')} | ${cell('R')} |`;
  const blocks = splitDocument(source);
  for (const match of ['L-20', 'R-10', 'R-21']) {
    expect(blocks[blockAtSourceOffset(blocks, source, source.indexOf(match))].raw).toContain(match);
  }
});
