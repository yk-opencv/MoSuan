import { beforeAll, describe, it, expect } from 'vitest';
import { ensureMathjax, splitDocument, renderBlock, cacheInfo, type MathEngine } from '../src/lib/markdown';

const render = (source: string, engine: MathEngine = 'mathjax') => splitDocument(source).map(block => renderBlock(block, engine)).join('');
beforeAll(() => ensureMathjax(), 15000);

describe('MathJax SVG and engine switching', () => {
  it.each([String.raw`$x^2$`, String.raw`$$\sum_{n=1}^{\infty}x^n$$`, String.raw`\(\frac{1}{1-x}\)`, String.raw`\[\int_0^x t\,dt\]`])('renders %s as self-contained SVG', source => {
    const element = document.createElement('div'); element.innerHTML = render(source);
    expect(element.querySelector('.mathjax-svg svg path')).not.toBeNull();
    expect(element.querySelector('.katex,.math-fallback,img,use')).toBeNull();
  });
  it('keeps the two engines separate in the bounded cache', () => {
    const source = String.raw`\[\frac{1}{2}\]`;
    expect(render(source, 'katex')).toContain('class="katex"');
    expect(render(source)).toContain('mathjax-svg');
    expect(render(source)).not.toContain('class="katex"');
    expect(render(source, 'katex')).not.toContain('mathjax-svg');
    for (let i = 0; i < 170; i++) render(`$x^{${i}}$`);
    expect(cacheInfo().entries).toBeLessThanOrEqual(160);
    expect(cacheInfo().characters).toBeLessThanOrEqual(2_000_000);
  });
  it('protects code and pending formulas and supports AMS and mathtools', () => {
    expect(render('```tex\n$x^2$\n```\n\n`\\[x\\]`')).not.toContain('mathjax-svg');
    expect(render(String.raw`\[\frac{1}{`)).toContain('math-pending');
    expect(render(String.raw`\[\begin{aligned}a&=b+c\\d&=e\end{aligned}\]`)).not.toContain('math-fallback');
    expect(render(String.raw`$\coloneqq$`)).toContain('mathjax-svg');
    expect(render(String.raw`$\unsupported{x}$`)).toContain('math-fallback');
  });
  it('does not retain user macros across formulas or expand forever', () => {
    expect(render(String.raw`$\def\leak{z}\leak$`)).not.toContain('math-fallback');
    expect(render(String.raw`$\leak$`)).toContain('math-fallback');
    expect(render(String.raw`$\def\x{\x}\x$`)).toContain('math-fallback');
    expect(render('$' + 'x'.repeat(8001) + '$')).toContain('math-fallback');
  });
  it('does not allow external resource macros, links or executable HTML', () => {
    const html = render(String.raw`$\href{javascript:alert(1)}{x}$ $\require{html}$ $\includegraphics{https://example.com/x.png}$` + '\n\n<script>alert(1)</script>\n\n![x](https://example.com/x.png)');
    const element = document.createElement('div'); element.innerHTML = html;
    expect(element.querySelector('script,img,iframe,foreignObject,[href^="http"],[href^="javascript:"],[onload]')).toBeNull();
    expect(element.textContent).toContain('<script>alert(1)</script>');
    expect(element.querySelectorAll('.math-fallback').length).toBeGreaterThan(0);
  });
});
