import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { openSidebar } from './helpers/navigation';

test('phone-sized Word export contains native editable equations and preserves unsupported formulas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await openSidebar(page);
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await page.getByLabel('笔记标题').fill('手机导出验证');
  const formulas = [
    String.raw`$$\sum_{n=1}^\infty\frac{1}{n^2}+\int_0^1\sqrt[3]{x}\,dx$$`,
    String.raw`$$\begin{cases}x^2 & x>0\\0 & x\le 0\end{cases}$$`,
    String.raw`$$\cancel{x}+1$$`,
    String.raw`$$\notAMosuanMacro{x}$$`,
  ];
  await page.getByLabel('Markdown / LaTeX 原文').fill((await readFile('artifacts/mobile-encoding/01-UTF8.md', 'utf8')) + '\n\n' + formulas.join('\n\n'));
  await page.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.getByRole('button', { name: '选择导出格式' }).click();
  await page.screenshot({ path: 'artifacts/verification/export-formats-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Word \(\.docx\)/ }).click();
  const download = await downloading; expect(download.suggestedFilename()).toBe('手机导出验证.docx');
  await download.saveAs('artifacts/verification/mosuan-editable-formulas.docx');
  const zipped = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const xml = strFromU8(zipped['word/document.xml']);
  expect(xml).toContain('你好，世界！数学笔记'); expect(xml).toContain('ENCODING-FINAL-OK');
  expect(xml).toContain('<w:tbl>'); expect(xml).toContain('$x^2+y^2=1$');
  const equations = await page.evaluate(source => {
    const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    const count = (name: string) => doc.getElementsByTagNameNS(math, name).length;
    return { errors: doc.getElementsByTagName('parsererror').length, equations: count('oMath'), fractions: count('f'), radicals: count('rad'), matrices: count('m'), nary: count('nary') };
  }, xml);
  expect(equations).toEqual({ errors: 0, equations: 7, fractions: 4, radicals: 1, matrices: 2, nary: 3 });
  expect(xml).toContain('\\notAMosuanMacro{x}');
  const pictures = Object.keys(zipped).filter(name => /^word\/media\/.+\.png$/.test(name));
  expect(pictures).toHaveLength(1); // only the unsupported cancellation notation
  expect(Buffer.from(zipped[pictures[0]]).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 个保留为图片，1 个保留为原文');
});

test('Android export boundary handles PDF, DOCX, attachment inclusion and file save cancellation', async ({ page, context }) => {
  await page.addInitScript(() => {
    const w = window as any; w.CapacitorCustomPlatform = { name: 'android' }; w.__nativeExports = [];
    w.Capacitor = { PluginHeaders: [{ name: 'MosuanFiles', methods: ['saveText', 'saveBinary', 'printPdf'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin: string, method: string, options: any) => { if (plugin !== 'MosuanFiles') throw new Error('No server'); w.__nativeExports.push({ method, options }); return method === 'printPdf' ? { opened: true } : { cancelled: true }; } };
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(async () => {
    const { loadNotebooks, saveNotebook } = await import('/src/lib/storage.ts');
    const book = (await loadNotebooks())[0];
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 100; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 100); ctx.fillStyle = 'black'; ctx.font = '24px serif'; ctx.fillText('Picture: 1+1=?', 20, 60);
    book.messages[0].images = [{ id: 'export-pic', name: '题目.jpg', dataUrl: canvas.toDataURL('image/jpeg'), width: 320, height: 100 }]; await saveNotebook(book);
  });
  await page.reload(); await expect(page.locator('.katex').first()).toBeVisible();
  await page.getByRole('button', { name: '选择导出格式' }).click();
  await page.getByRole('button', { name: /^PDF \(\.pdf\)/ }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('另存为 PDF');
  const html = await page.evaluate(() => (window as any).__nativeExports.find((call: any) => call.method === 'printPdf').options.html);
  expect(html).toContain('<svg'); expect(html).toContain('data:image/jpeg;base64,');
  expect(html).toContain('学习笔记');
  await writeFile('artifacts/verification/mobile-export-sample.html', html);
  const preview = await context.newPage(); await preview.setContent(html);
  await preview.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
  await preview.pdf({ path: 'artifacts/verification/mobile-export-sample.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await preview.screenshot({ path: 'artifacts/verification/mobile-export-content.png', fullPage: true }); await preview.close();
  await page.getByRole('button', { name: /^Word \(\.docx\)/ }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已取消保存');
  const binary = await page.evaluate(() => (window as any).__nativeExports.find((call: any) => call.method === 'saveBinary').options);
  expect(binary.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const files = unzipSync(Buffer.from(binary.base64, 'base64'));
  const xml = strFromU8(files['word/document.xml']);
  expect(xml).toContain('学习笔记'); expect(xml).toContain('<m:oMath>'); expect(xml).toContain('<m:f>');
  expect(Object.keys(files).filter(name => /^word\/media\/.+\.png$/.test(name))).toHaveLength(1);
});
