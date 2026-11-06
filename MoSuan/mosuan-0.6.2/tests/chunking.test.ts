import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMathjax, renderBlock, splitDocument } from '../src/lib/markdown';
import { MAX_BLOCK_FORMULAS } from '../src/lib/markdownChunks';

beforeAll(() => ensureMathjax());
describe('bounded chunks preserve parsed Markdown structure', () => {
  it('keeps bold, emphasis, links and inline code across chunk boundaries', () => {
    const text = '重点内容 '.repeat(700).trimEnd();
    for (const [source, selector] of [[`**${text}**`, 'strong'], [`*[${text}](https://example.com)*`, 'em a'], ['`' + text + '`', 'code']]) {
      const blocks = splitDocument(source); expect(blocks.length).toBeGreaterThan(1);
      const element = document.createElement('div'); element.innerHTML = blocks.map(block => renderBlock(block)).join('');
      expect(Array.from(element.querySelectorAll(selector), el => el.textContent).join('')).toBe(text);
      expect(element.textContent).not.toContain('**');
    }
  });
  it.each(['katex', 'mathjax'] as const)('bounds a dense single list item with %s without losing any formulas', engine => {
    const blocks = splitDocument('- ' + Array.from({ length: 400 }, (_, i) => `公式 $x_{${i}}^2+y_{${i}}^2=1$。`).join(''));
    expect(blocks.length).toBeGreaterThanOrEqual(50);
    let formulas = 0;
    for (const block of blocks) {
      const element = document.createElement('div'); element.innerHTML = renderBlock(block, engine);
      const count = element.querySelectorAll(engine === 'katex' ? '.katex' : '.mathjax-svg').length;
      expect(count).toBeLessThanOrEqual(MAX_BLOCK_FORMULAS); formulas += count;
      expect(element.querySelectorAll('*').length).toBeLessThan(2000);
      expect(element.querySelector('.math-fallback,.math-pending')).toBeNull();
    }
    expect(formulas).toBe(400);
  });
  it('preserves nested formatting and ordered item numbers in continued items', () => {
    const source = '3. **' + '结论 $x^2$。'.repeat(60) + '**\n4. 下一项';
    const element = document.createElement('div'); element.innerHTML = splitDocument(source).map(block => renderBlock(block)).join('');
    expect(element.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(element.querySelector('ol[start="4"]')).not.toBeNull();
    expect(element.querySelectorAll('.list-continuation').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('strong .katex')).toHaveLength(60);
    expect(element.textContent).not.toContain('**');
  });
  it('splits dense quoted lists and table cells without dropping content', () => {
    for (const source of ['> - ' + '$x$ '.repeat(80), '| A | B |\n|---|---|\n| ' + '$x$ '.repeat(80) + ' | end |']) {
      const blocks = splitDocument(source); let total = 0;
      for (const block of blocks) {
        const element = document.createElement('div'); element.innerHTML = renderBlock(block);
        const count = element.querySelectorAll('.katex').length; expect(count).toBeLessThanOrEqual(MAX_BLOCK_FORMULAS); total += count;
      }
      expect(total).toBe(80);
    }
  });
});
