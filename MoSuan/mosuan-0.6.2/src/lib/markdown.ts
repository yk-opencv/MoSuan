import { Marked, Renderer } from 'marked';
import type { DocumentBlock } from './markdownChunks';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { translator, type Language, type Translate } from './translate';

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export type MathEngine = 'katex' | 'mathjax';
let mathjaxRenderer: ((tex: string, display: boolean) => string) | undefined;
let mathjaxLoading: Promise<void> | undefined;
export function ensureMathjax(): Promise<void> {
  if (!mathjaxLoading) mathjaxLoading = import('./mathjaxRenderer').then(module => { mathjaxRenderer = module.renderMathjax; }).catch(error => { mathjaxLoading = undefined; throw error; });
  return mathjaxLoading;
}

function mathHtml(tex: string, display: boolean, pending: boolean, engine: MathEngine | 'word', t: Translate): string {
  if (pending) return `<span class="math-pending" title="${escapeHtml(t('公式尚未闭合，保留原文'))}">${escapeHtml(tex)}<small> · ${escapeHtml(t('等待公式闭合'))}</small></span>`;
  if (engine === 'word') return `<span class="word-math${display ? ' mathjax-display' : ''}">${escapeHtml(tex)}</span>`;
  try {
    if (tex.length > 8000) throw new Error('公式过长，请拆分');
    if (engine === 'mathjax') {
      if (!mathjaxRenderer) throw new Error('MathJax 尚未加载');
      return `<span class="mathjax-svg ${display ? 'mathjax-display' : ''}" role="math" aria-label="${escapeHtml(tex)}">${mathjaxRenderer(tex, display)}</span>`;
    }
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, maxExpand: 500, maxSize: 20, strict: 'ignore' });
  } catch {
    return `<span class="math-fallback" title="${escapeHtml(t('公式语法错误、超出限制或暂不支持；可打开原文修改'))}">${escapeHtml(tex)}<small> · ${escapeHtml(t('公式原文'))}</small></span>`;
  }
}

function createParser(engine: MathEngine | 'word', language: Language = 'zh-CN') {
const t = translator(language);
const parser = new Marked({ gfm: true, breaks: true });
parser.use({
  extensions: [
    {
      name: 'blockMath',
      renderer: token => `<div class="math-block">${mathHtml(token.text as string, true, token.pending as boolean, engine, t)}</div>`,
    },
    {
      name: 'inlineMath',
      renderer: token => token.display ? `<span class="math-block inline-display">${mathHtml(token.text as string, true, token.pending as boolean, engine, t)}</span>` : mathHtml(token.text as string, false, token.pending as boolean, engine, t),
    },
  ],
  renderer: {
    list(token) {
      const html = Renderer.prototype.list.call(this, token);
      return (token as typeof token & { continued?: boolean }).continued ? html.replace(/^<(ul|ol)/, '<$1 class="list-continuation"') : html;
    },
    // Imported material must not cause automatic external network requests.
    image({ text }) { return `<span class="image-placeholder">${escapeHtml(t('[图片：{0}]', text))}</span>`; },
    html({ text }) { return escapeHtml(text); },
  },
});
return parser;
}
const wordParser = createParser('word');
const parsers = new Map<string, Marked>();
export type Block = DocumentBlock;
export { splitDocument } from './markdownSyntax';

function sanitizeBlock(html: string) {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true }, FORBID_TAGS: ['img', 'style', 'iframe', 'form'] });
}

export function renderWordBlock(block: Block): string {
  return sanitizeBlock(wordParser.parser(block.tokens));
}

// Bounded cache: neither all historical HTML nor all formula DOM is retained.
const cache = new Map<string, string>();
let cacheSize = 0;
export function renderBlock(block: Block, engine: MathEngine = 'katex', language: Language = 'zh-CN'): string {
  // Token structure matters (e.g. list numbering and repeated table headers).
  const parserKey = `${language}:${engine}`;
  const key = `${parserKey}:${JSON.stringify(block.tokens)}`;
  const cached = cache.get(key);
  if (cached !== undefined) { cache.delete(key); cache.set(key, cached); return cached; }
  let parser = parsers.get(parserKey);
  if (!parser) {
    parser = createParser(engine, language);
    parsers.set(parserKey, parser);
  }
  const html = sanitizeBlock(parser.parser(block.tokens));
  if (!(engine === 'mathjax' && !mathjaxRenderer) && !html.includes('math-pending') && html.length + key.length < 2_000_000) {
    cache.set(key, html); cacheSize += html.length + key.length;
    while (cache.size > 160 || cacheSize > 2_000_000) {
      const first = cache.keys().next().value!;
      cacheSize -= first.length + cache.get(first)!.length; cache.delete(first);
    }
  }
  return html;
}

export function cacheInfo() { return { entries: cache.size, characters: cacheSize }; }
