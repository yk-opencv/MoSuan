import { describe, it, expect } from 'vitest';
import { splitDocument, renderBlock, cacheInfo } from '../src/lib/markdown';
const render = (text: string) => splitDocument(text).map(block => renderBlock(block)).join('');
describe('formula boundaries and Markdown', () => {
  it.each([String.raw`$x^2$`, String.raw`$$\sum_{n=1}^{\infty}x^n$$`, String.raw`\(\frac{1}{1-x}\)`, String.raw`\[\int_0^x t\,dt\]`])('renders %s', source => {
    const html = render(source);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('math-fallback');
  });
  it('keeps fenced and inline code literal', () => {
    expect(render('```tex\n$x^2$\n```')).not.toContain('class="katex"');
    expect(render('`$x^2$`')).not.toContain('class="katex"');
    expect(render('`\\[x^2\\]`')).not.toContain('class="katex"');
    expect(render('```tex\n\\[x^2\\]\n```')).toContain('\\[x^2\\]');
  });
  it('keeps unfinished formulas visible, then renders once closed', () => {
    expect(render(String.raw`\[\frac{1}{`)).toContain('math-pending');
    expect(render(String.raw`\[\frac{1}{2}\]`)).toContain('class="katex"');
    expect(render(String.raw`$$\frac{1}{2}`)).toContain('math-pending');
  });
  it('retains unsupported formulas without losing surrounding text', () => {
    const html = render(String.raw`before $\unsupported{x}$ after`);
    expect(html).toContain('math-fallback'); expect(html).toContain('after');
  });
  it('preserves common Markdown and avoids interpreting currency', () => {
    const html = render('# Heading\n\n**bold** and $5\n\n| A | B |\n|---|---|\n|1|2|');
    expect(html).toContain('<h1>'); expect(html).toContain('<strong>bold</strong>'); expect(html).toContain('<table>'); expect(html).not.toContain('math-pending');
  });
  it('does not introduce executable HTML or remote image requests', () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n\n![x](https://example.com/a.png)\n\n$\\href{javascript:alert(1)}{x}$');
    const container = document.createElement('div'); container.innerHTML = html;
    expect(container.querySelector('script, img, [onerror], [href^="javascript:"]')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(html).toContain('[图片：x]');
  });
  it('chunks a long single paragraph without breaking its formulas', () => {
    const source = Array.from({ length: 800 }, () => String.raw`这是一个推导 $\frac{x^2}{2}$。`).join('');
    const blocks = splitDocument(source);
    expect(blocks.length).toBeGreaterThan(8);
    expect(blocks.map(b => b.raw).join('')).toBe(source);
    for (const b of blocks) expect(renderBlock(b)).not.toContain('math-pending');
  });
  it('bounds rendered cache size and handles oversized code', () => {
    for (let i = 0; i < 210; i++) render(`paragraph ${i}: $x^${i}$`);
    expect(cacheInfo().entries).toBeLessThanOrEqual(160);
    expect(cacheInfo().characters).toBeLessThanOrEqual(2_000_000);
    expect(splitDocument('```\n' + 'const x = 1;\n'.repeat(1500) + '```').length).toBeGreaterThan(5);
  });
});
