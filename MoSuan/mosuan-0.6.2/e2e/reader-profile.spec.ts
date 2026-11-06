import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSidebar } from './helpers/navigation';

test('profiles first reading, streaming, scrolling and document export with a long math note', async ({ page, context }) => {
  const stage = process.env.MOSUAN_PROFILE;
  test.skip(stage !== 'before' && stage !== 'after', 'Opt in with MOSUAN_PROFILE=before or after');
  test.setTimeout(180_000);
  const fixture = await readFile('artifacts/mobile-stress/墨算手机公式压力测试.md', 'utf8');
  const content = fixture.replaceAll('FINAL-OK-20261105', 'PROFILE-END-20261106')
    + '\n\n| 公式 | 结果 |\n| --- | --- |\n| $x^2$ | $\\int_0^1 x^2 dx = 1/3$ |\n\nPROFILE-TAIL';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'mock' } }));
  await page.addInitScript(() => {
    const w = window as any;
    const actual = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input !== '/api/chat') return actual(input, init);
      const encoder = new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          w.__frame = (text: string, finish = false) => {
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish ? 'stop' : null }] }) + '\n\n'));
            if (finish) controller.close();
          };
        },
      })));
    };
  });
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const parse = await page.evaluate(async text => {
    const { splitDocument } = await import('/src/lib/markdown.ts');
    const times: number[] = [];
    let blocks = 0;
    for (let i = 0; i < 6; i++) {
      const started = performance.now();
      blocks = splitDocument(text).length;
      times.push(performance.now() - started);
    }
    return { samplesMs: times.map(value => Math.round(value)), blocks };
  }, content);
  await openSidebar(page);
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await page.evaluate(() => {
    const w = window as any;
    const input = document.querySelector('input[type=file][accept*=".md"]')!;
    input.addEventListener('change', () => {
      const start = performance.now();
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.virtual-document .prose')?.textContent?.includes('墨算手机公式压力测试')) return;
        observer.disconnect();
        requestAnimationFrame(() => { w.__firstReading = performance.now() - start; });
      });
      observer.observe(document.querySelector('.virtual-document')!, { childList: true, subtree: true });
    }, { capture: true, once: true });
  });
  await page.locator('input[type=file][accept*=".md"]').setInputFiles({ name: '120 组推导性能样本.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
  await page.waitForFunction(() => typeof (window as any).__firstReading === 'number');
  const firstReadingMs = Math.round(await page.evaluate(() => (window as any).__firstReading));
  const scroll = await page.evaluate(async () => {
    const reader = document.querySelector('.reader-scroll')!;
    const frames: number[] = [];
    let mounted = 0;
    for (let step = 1; step <= 16; step++) {
      const start = performance.now();
      reader.scrollTop = (reader.scrollHeight - reader.clientHeight) * step / 16;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      frames.push(Math.round(performance.now() - start));
      mounted = Math.max(mounted, reader.querySelectorAll('.virtual-row').length);
    }
    return { framesMs: frames, maxMounted: mounted };
  });
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect(page.getByText('PROFILE-TAIL', { exact: true })).toBeInViewport();
  expect(scroll.maxMounted).toBeLessThan(35);

  await openSidebar(page);
  await page.getByRole('button', { name: '新的学习对话' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('新的学习对话');
  await page.getByLabel('输入问题').fill('计时用合成回答');
  await page.getByRole('button', { name: '发送问题' }).click();
  await page.waitForFunction(() => typeof (window as any).__frame === 'function');
  const streaming = await page.evaluate(async text => {
    const w = window as any;
    const tasks: number[] = [];
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: 'longtask' });
    const start = performance.now();
    const step = Math.ceil(text.length / 18);
    for (let offset = 0; offset < text.length; offset += step) {
      w.__frame(text.slice(offset, offset + step), offset + step >= text.length);
      await new Promise(resolve => setTimeout(resolve, 130));
    }
    const finished = performance.now();
    observer.disconnect();
    return { elapsedMs: Math.round(finished - start), mainThreadLongTasks: tasks.length, longestTaskMs: Math.round(Math.max(0, ...tasks)), totalLongTaskMs: Math.round(tasks.reduce((sum, n) => sum + n, 0)) };
  }, content);
  await expect(page.locator('.save-status')).toContainText('已保存');
  await expect(page.getByText('PROFILE-TAIL', { exact: true })).toBeVisible();

  const exports = await page.evaluate(async text => {
    const { exportHtml } = await import('/src/lib/documentExport.ts');
    const { wordDocument } = await import('/src/lib/wordExport.ts');
    const { ensureMathjax } = await import('/src/lib/markdown.ts');
    await ensureMathjax();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 120;
    canvas.getContext('2d')!.fillText('Integral x^2', 60, 60);
    const book = { id: 'profile', title: '带题图的长文', updated: 0, messages: [
      { id: 'q', role: 'user' as const, content: '看图推导', images: [{ id: 'img', name: '题图.jpg', dataUrl: canvas.toDataURL('image/jpeg'), width: 320, height: 120 }] },
      { id: 'a', role: 'assistant' as const, content: text },
    ] };
    const start = performance.now();
    const html = await exportHtml(book);
    const pdfLayoutMs = Math.round(performance.now() - start);
    const wordStart = performance.now();
    const word = await wordDocument(book);
    return { pdfLayoutMs, wordMs: Math.round(performance.now() - wordStart), pdfHasLastMarker: html.includes('PROFILE-TAIL'), pdfHasPicture: html.includes('data:image/jpeg;base64,'), wordBytes: word.blob.size, wordSourceFallbacks: word.sourceFallbacks, wordImageFallbacks: word.imageFallbacks };
  }, content);
  expect(exports.pdfHasLastMarker && exports.pdfHasPicture).toBe(true);
  expect(exports.wordBytes).toBeGreaterThan(30_000);
  const result = { stage, device: 'Edge desktop, 390 × 844 viewport, CDP 4× CPU slowdown', inputBytes: Buffer.byteLength(content), characters: content.length, parse, firstReadingMs, scroll, streaming, exports };
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile(`artifacts/verification/reader-profile-${stage}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
