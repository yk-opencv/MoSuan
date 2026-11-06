import { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, type ParagraphChild } from 'docx';
import type { Notebook } from './storage';
import { exportContent, checkExport, WORD_MIME } from './documentExport';
import { renderMathjax } from './mathjaxRenderer';
import { editableWordMath } from './wordMath';

type Block = Paragraph | Table;
type Format = { bold?: boolean; italics?: boolean; font?: string; color?: string };
interface Raster { data: Uint8Array; width: number; height: number }

export async function wordDocument(book: Notebook, signal?: AbortSignal, progress: (text: string) => void = () => {}) {
  const html = await exportContent(book, 'word', signal, progress);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const cache = new Map<string, Promise<Raster>>();
  let count = 0, mathCount = 0, imageFallbacks = 0, sourceFallbacks = 0;
  async function raster(element: Element): Promise<Raster> {
    checkExport(signal);
    const svg = element.tagName.toLowerCase() === 'svg';
    const key = svg ? element.outerHTML : element.getAttribute('src') || '';
    const cached = cache.get(key); if (cached) return cached;
    const value = (async () => {
      let src = key, objectUrl = '';
      const image = new Image();
      try {
        if (svg) {
          const clone = element.cloneNode(true) as Element;
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('color', '#111'); clone.setAttribute('fill', '#111');
          const width = Math.max(1, parseFloat(element.getAttribute('width') || '10') * 8);
          const height = Math.max(1, parseFloat(element.getAttribute('height') || '3') * 8);
          const fit = Math.min(1, 600 / width, 780 / height);
          clone.setAttribute('width', String(width * fit * 3)); clone.setAttribute('height', String(height * fit * 3));
          objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })); src = objectUrl;
        }
        image.src = src; await image.decode(); checkExport(signal);
        const fit = Math.min(1, (svg ? 1800 : 1200) / image.naturalWidth, 2340 / image.naturalHeight);
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * fit)); canvas.height = Math.max(1, Math.round(image.naturalHeight * fit));
        const context = canvas.getContext('2d'); if (!context) throw new Error('设备无法生成公式图片');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('公式图片生成失败')), 'image/png'));
        const displayFit = svg ? 1 / 3 : Math.min(1, 600 / canvas.width, 780 / canvas.height);
        return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width * displayFit, height: canvas.height * displayFit };
      } finally { image.src = ''; if (objectUrl) URL.revokeObjectURL(objectUrl); }
    })();
    cache.set(key, value); if (cache.size > 100) cache.delete(cache.keys().next().value!); return value;
  }
  async function formula(node: Element): Promise<ParagraphChild> {
    if (++mathCount % 16 === 0) {
      progress('正在转换第 ' + mathCount + ' 个 Word 公式…');
      await new Promise(resolve => setTimeout(resolve, 0));
      checkExport(signal);
    }
    const tex = node.textContent || '', display = node.classList.contains('mathjax-display');
    if (tex.length <= 8000) {
      try {
        const editable = editableWordMath(tex, display);
        if (editable) return editable;
      } catch { /* Invalid or unsupported TeX; try the same visual fallback as PDF. */ }
      try {
        const svg = new DOMParser().parseFromString(renderMathjax(tex, display), 'text/html').querySelector('svg');
        if (svg) {
          const data = await raster(svg);
          const image = new ImageRun({ type: 'png', data: data.data, transformation: { width: data.width, height: data.height }, altText: { title: '数学公式', description: tex, name: '墨算公式' } });
          imageFallbacks++;
          return image;
        }
      } catch { checkExport(signal); }
    }
    sourceFallbacks++;
    return new TextRun({ text: (display ? '\\[' + tex + '\\]' : '$' + tex + '$'), font: 'Consolas' });
  }
  async function inline(nodes: Iterable<Node>, format: Format = {}): Promise<ParagraphChild[]> {
    const runs: ParagraphChild[] = [];
    for (const node of nodes) {
      checkExport(signal);
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) runs.push(new TextRun({ text: node.textContent, ...format })); continue; }
      if (!(node instanceof Element)) continue;
      const tag = node.tagName.toLowerCase();
      if (node.classList.contains('word-math')) runs.push(await formula(node));
      else if (node.classList.contains('math-pending')) {
        sourceFallbacks++;
        runs.push(new TextRun({ text: node.textContent || '', font: 'Consolas' }));
      } else if (tag === 'img') {
        const data = await raster(node);
        runs.push(new ImageRun({ type: 'png', data: data.data, transformation: { width: data.width, height: data.height }, altText: { title: '题目图片', description: node.getAttribute('alt') || '', name: '墨算图片' } }));
      } else if (tag === 'br') runs.push(new TextRun({ break: 1 }));
      else runs.push(...await inline(node.childNodes, { ...format, ...(['strong', 'b'].includes(tag) ? { bold: true } : {}), ...(['em', 'i'].includes(tag) ? { italics: true } : {}), ...(tag === 'code' ? { font: 'Consolas' } : {}) }));
    }
    return runs;
  }
  async function blocks(nodes: Iterable<Node>, depth = 0): Promise<Block[]> {
    const result: Block[] = [];
    for (const node of nodes) {
      checkExport(signal);
      if (!(node instanceof Element)) { if (node.textContent?.trim()) result.push(new Paragraph({ children: [new TextRun(node.textContent)] })); continue; }
      if (++count % 8 === 0) { progress(`正在生成 Word 内容 ${count}…`); await new Promise(resolve => setTimeout(resolve, 0)); }
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
        result.push(new Paragraph({ children: await inline(node.childNodes), heading: node.classList.contains('export-title') ? HeadingLevel.TITLE : headings[Number(tag[1]) - 1] }));
      } else if (tag === 'table') {
        const rows: TableRow[] = [];
        for (const row of Array.from(node.querySelectorAll('tr'))) {
          const cells: TableCell[] = [];
          for (const cell of Array.from(row.children)) cells.push(new TableCell({ children: [new Paragraph({ children: await inline(cell.childNodes, { bold: cell.tagName === 'TH' }) })] }));
          if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: row.parentElement?.tagName === 'THEAD' }));
        }
        if (rows.length) result.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      } else if (tag === 'ul' || tag === 'ol') {
        let index = Number(node.getAttribute('start')) || 1;
        for (const item of Array.from(node.children)) {
          const content = Array.from(item.childNodes).filter(child => !(child instanceof Element && ['UL', 'OL'].includes(child.tagName)));
          result.push(new Paragraph({ children: [new TextRun(tag === 'ol' ? `${index++}. ` : '• '), ...await inline(content)], indent: { left: 300 * (depth + 1), hanging: 200 } }));
          result.push(...await blocks(Array.from(item.children).filter(child => ['UL', 'OL'].includes(child.tagName)), depth + 1));
        }
      } else if (tag === 'pre') {
        const lines = (node.textContent || '').split('\n');
        result.push(new Paragraph({ children: lines.flatMap((text, i) => [new TextRun({ text, font: 'Consolas', size: 20, ...(i ? { break: 1 } : {}) })]), spacing: { after: 140 }, shading: { fill: 'F4F4F4' } }));
      } else if (['section', 'blockquote', 'div'].includes(tag) && !node.classList.contains('math-block')) result.push(...await blocks(node.childNodes, depth));
      else if (tag !== 'hr') result.push(new Paragraph({ children: await inline(node.childNodes), alignment: node.classList.contains('math-block') ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 160 } }));
    }
    return result;
  }
  const children = await blocks(dom.body.childNodes); checkExport(signal); progress('正在封装 Word 文件…');
  const wordFile = new Document({ title: book.title, creator: '墨算', styles: { default: { document: { run: { font: { ascii: 'Calibri', eastAsia: '宋体', hAnsi: 'Calibri' }, size: 24, color: '111111' }, paragraph: { spacing: { after: 140, line: 320 } } }, title: { run: { color: '111111', size: 40, bold: true } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } } }, children }] });
  const blob = await Packer.toBlob(wordFile);
  checkExport(signal);
  return { blob: new Blob([blob], { type: WORD_MIME }), imageFallbacks, sourceFallbacks };
}
