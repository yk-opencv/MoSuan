import type { Notebook } from './storage';
import { splitDocument, renderBlock, renderWordBlock, ensureMathjax, escapeHtml } from './markdown';
import { isAndroidApp, NativeFiles } from './mobile';
import { LONG_DOCUMENT_CHARS, parseInBackground } from './longDocument';

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
export function checkExport(signal?: AbortSignal) { signal?.throwIfAborted(); }
export async function exportContent(book: Notebook, format: 'pdf' | 'word', signal?: AbortSignal, progress: (text: string) => void = () => {}) {
  const size = book.messages.reduce((n, message) => n + message.content.length, 0);
  if (size > 5_000_000) throw new Error('导出内容超过 500 万字符，请拆分笔记后导出。');
  checkExport(signal); progress('正在准备导出内容…');
  if (format === 'pdf') await ensureMathjax();
  checkExport(signal);
  const parts = [`<h1 class="export-title">${escapeHtml(book.title)}</h1>`];
  let count = 0;
  for (const message of book.messages) {
    const state = message.state === 'stopped' ? '（输出未完成）' : message.state === 'error' ? '（连接异常）' : '';
    const role = message.role === 'user' ? '我的问题' : message.recovery?.kind === 'continue' ? '续写回答' : message.recovery ? '重试回答' : '学习笔记';
    parts.push(`<section><h2>${role}${state}</h2>`);
    const blocks = message.content.length >= LONG_DOCUMENT_CHARS
      ? await parseInBackground(message.content).catch(() => { checkExport(signal); return splitDocument(message.content); })
      : splitDocument(message.content);
    for (const block of blocks) {
      checkExport(signal); parts.push(format === 'word' ? renderWordBlock(block) : renderBlock(block, 'mathjax'));
      if (++count % 8 === 0) { progress(`正在排版第 ${count} 个阅读块…`); await yieldUI(); }
    }
    for (const image of message.images || []) {
      if (/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl) && image.dataUrl.length <= 750000) {
        parts.push(`<p class="attachment"><img src="${image.dataUrl}" alt="${escapeHtml(image.name)}"></p>`);
      } else parts.push(`<p>[图片无法导出：${escapeHtml(image.name)}]</p>`);
    }
    parts.push('</section>');
  }
  checkExport(signal);
  return parts.join('\n');
}

export async function exportHtml(book: Notebook, signal?: AbortSignal, progress?: (text: string) => void) {
  const content = await exportContent(book, 'pdf', signal, progress);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeHtml(book.title)}</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{color:#111;background:white;font:12pt/1.7 sans-serif;overflow-wrap:anywhere;margin:0}h1{font-size:22pt;line-height:1.35}h2{font-size:17pt}h3{font-size:14pt}h1,h2,h3,h4{page-break-after:avoid}section{margin-bottom:24pt}p{margin:9pt 0}table{width:100%;border-collapse:collapse;margin:12pt 0}th,td{border:1px solid #bbb;padding:6pt;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:10pt;font:10pt/1.5 monospace}code{font-family:monospace}.math-block,.mathjax-display{display:block;text-align:center;margin:12pt 0;break-inside:avoid}.mathjax-svg svg{max-width:100%;height:auto;vertical-align:middle}svg{color:#111}mjx-container{display:inline-block;max-width:100%}.attachment img{max-width:100%;max-height:220mm;object-fit:contain}.math-fallback,.math-pending{font-family:monospace;color:#555}blockquote{border-left:2pt solid #aaa;margin:10pt 0;padding-left:12pt}
</style></head><body>${content}</body></html>`;
}

export async function saveBlob(filename: string, blob: Blob) {
  if (blob.size > 30_000_000) throw new Error('导出文件超过 30 MB，请拆分后导出。');
  if (isAndroidApp()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取生成的文件'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
    });
    return !(await NativeFiles.saveBinary({ filename, base64, mime: blob.type })).cancelled;
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000); return true;
}

export async function printBook(book: Notebook, signal?: AbortSignal, progress?: (text: string) => void) {
  // Open immediately to preserve the browser's user activation.
  const popup = isAndroidApp() ? null : window.open('', '_blank');
  if (!isAndroidApp() && !popup) throw new Error('浏览器阻止了打印窗口，请允许弹出窗口后重试。');
  try {
    const html = await exportHtml(book, signal, progress); checkExport(signal);
    if (isAndroidApp()) await NativeFiles.printPdf({ title: book.title.slice(0, 80), html });
    else {
      popup!.document.open(); popup!.document.write(html); popup!.document.close();
      await Promise.all(Array.from(popup!.document.images).map(image => image.decode().catch(() => {})));
      await popup!.document.fonts.ready; checkExport(signal); popup!.focus(); popup!.print();
    }
  } catch (error) { popup?.close(); throw error; }
}
