import { describe, it, expect } from 'vitest';
import { exportHtml } from '../src/lib/documentExport';
import type { Notebook } from '../src/lib/storage';

const book: Notebook = { id: 'test-export', title: '中文 <script>标题</script>', updated: 1, messages: [
  { id: '1', role: 'user', content: '问题 $x^2$，<img src="https://evil.test/track">', images: [{ id: 'pic', name: '题目', width: 1, height: 1, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }] },
  { id: '2', role: 'assistant', content: '# 结论\n\n$$\\int_0^1x\\,dx=\\frac12$$\n\n```tex\n$x^2$\n```\n\nFINAL-EXPORT', state: 'stopped' },
] };
describe('whole-conversation printable export', () => {
  it('includes full text, math, literal code, unfinished state and local attachments without active HTML', async () => {
    const html = await exportHtml(book);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script,iframe')).toHaveLength(0);
    expect(doc.querySelectorAll('svg').length).toBe(2);
    expect(doc.querySelectorAll('img')).toHaveLength(1);
    expect(doc.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/jpeg/);
    expect(doc.body.textContent).toContain('FINAL-EXPORT');
    expect(doc.body.textContent).toContain('输出未完成');
    expect(doc.querySelector('pre')!.textContent).toContain('$x^2$');
    expect(doc.querySelector('h1')!.textContent).toBe(book.title);
    expect(doc.querySelector('[http-equiv]')!.getAttribute('content')).toContain("default-src 'none'");
  });
  it('aborts and excludes external or malformed attachment URLs', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(exportHtml(book, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const other = structuredClone(book); other.messages[0].images![0].dataUrl = 'https://evil.test/image.jpg';
    const doc = new DOMParser().parseFromString(await exportHtml(other), 'text/html');
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.body.textContent).toContain('图片无法导出');
  });
});
