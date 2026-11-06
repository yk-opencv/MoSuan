import type { Token, Tokens } from 'marked';

// Budget by formula count as well as source size: a short list item can create
// thousands of formula nodes. Never lex source fragments a second time.
export const MAX_BLOCK_FORMULAS = 8;
const MAX_TEXT = 1400;
const children = (token: Token): Token[] | undefined => 'tokens' in token ? token.tokens : undefined;
export interface DocumentBlock { raw: string; tokens: Token[]; sourceToken?: Token }
const originalLeaf = new WeakMap<Token, Token>();
const originalTopLevel = new WeakMap<Token, Token>();
function splitLeaf<T extends Token>(original: T, pieces: T[]) {
  for (const part of pieces) originalLeaf.set(part, original);
  return pieces;
}
function measure(token: Token): { chars: number; math: number } {
  if (token.type === 'inlineMath' || token.type === 'blockMath') return { chars: token.raw.length, math: 1 };
  if (token.type === 'list') return sum((token as Tokens.List).items.flatMap(item => item.tokens));
  if (token.type === 'table') { const table = token as Tokens.Table; return sum([...table.header, ...table.rows.flat()].flatMap(cell => cell.tokens)); }
  const nested = children(token);
  return nested ? sum(nested) : { chars: token.raw.length, math: 0 };
}
function sum(tokens: Token[]) { return tokens.reduce((n, token) => { const w = measure(token); return { chars: n.chars + w.chars, math: n.math + w.math }; }, { chars: 0, math: 0 }); }
function pack(tokens: Token[], chars = MAX_TEXT, formulas = MAX_BLOCK_FORMULAS): Token[][] {
  const groups: Token[][] = []; let current: Token[] = [], size = 0, count = 0;
  for (const token of tokens) {
    const w = measure(token);
    if (current.length && (size + w.chars > chars || count + w.math > formulas)) { groups.push(current); current = []; size = 0; count = 0; }
    current.push(token); size += w.chars; count += w.math;
  }
  if (current.length) groups.push(current);
  return groups;
}
function pieces(text: string, limit: number) {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + limit);
    // Preserve Unicode surrogate pairs and prefer a nearby word boundary.
    if (end < text.length) {
      const boundary = text.slice(Math.max(start, end - 160), end).search(/[\s。！？；][^\s。！？；]*$/);
      if (boundary >= 0) end = Math.max(start, end - 160) + boundary + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    result.push(text.slice(start, end)); start = end;
  }
  return result;
}
function inline(tokens: Token[], chars = MAX_TEXT, formulas = MAX_BLOCK_FORMULAS): Token[][] {
  const fragments: Token[] = [];
  for (const token of tokens) {
    const nested = children(token);
    if (nested) {
      const groups = inline(nested, chars, formulas);
      fragments.push(...groups.map(children => groups.length === 1 ? token : { ...token, tokens: children, raw: children.map(child => child.raw).join(''), text: children.map(child => child.raw).join('') }));
    } else if ((token.type === 'text' || token.type === 'codespan') && token.raw.length > chars) {
      const text = (token as Tokens.Text).text;
      fragments.push(...splitLeaf(token, pieces(text, chars).map(part => ({ ...token, raw: part, text: part }))));
    } else fragments.push(token);
  }
  return pack(fragments, chars, formulas);
}
function splitToken(token: Token): Token[] {
  const w = measure(token);
  if (w.chars <= MAX_TEXT && w.math <= MAX_BLOCK_FORMULAS) return [token];
  const nested = children(token);
  if (['paragraph', 'text', 'heading'].includes(token.type) && nested) {
    const groups = inline(nested);
    const fragments = groups.map(tokens => ({ ...token, tokens, text: tokens.map(t => t.raw).join(''), raw: tokens.map(t => t.raw).join('') }));
    const consumed = fragments.map(fragment => fragment.raw).join('');
    if (fragments.length && token.raw.startsWith(consumed)) fragments.at(-1)!.raw += token.raw.slice(consumed.length);
    return fragments;
  }
  if (token.type === 'code') {
    const code = token as Tokens.Code;
    return splitLeaf(code, pieces(code.text, 2400).map(text => ({ ...code, text, raw: text })));
  }
  if (token.type === 'blockquote') {
    return pack(nested!.flatMap(splitToken)).map(tokens => ({ ...token, tokens, raw: tokens.map(t => t.raw).join(''), text: tokens.map(t => t.raw).join('') }));
  }
  if (token.type === 'list') {
    const list = token as Tokens.List;
    return list.items.flatMap((item, index) => pack(item.tokens.flatMap(splitToken)).map((tokens, part) => {
      const raw = tokens.map(t => t.raw).join('');
      return { ...list, raw, start: typeof list.start === 'number' ? list.start + index : list.start, continued: part > 0, items: [{ ...item, raw, text: raw, tokens, task: part === 0 && item.task }] };
    }));
  }
  if (token.type === 'table') {
    const table = token as Tokens.Table;
    if (!table.rows.length) return [token];
    const rows = table.rows.flatMap(row => {
      const cells = row.map(cell => inline(cell.tokens, Math.max(200, Math.floor(MAX_TEXT / row.length)), Math.max(1, Math.floor(MAX_BLOCK_FORMULAS / row.length))));
      return Array.from({ length: Math.max(...cells.map(groups => groups.length)) }, (_, i) => row.map((cell, c) => ({ ...cell, tokens: cells[c][i] || [], text: (cells[c][i] || []).map(t => t.raw).join('') })));
    });
    // Repeat headers, but keep dense body rows separate and small.
    return rows.map(row => ({ ...table, rows: [row], raw: JSON.stringify([table.header, row]) }));
  }
  return [token];
}
export function chunkTokens(tokens: Token[]): DocumentBlock[] {
  const result: DocumentBlock[] = [];
  let current: Token[] = [];
  const flush = () => { if (current.length) result.push(...pack(current).map(tokens => ({ tokens, raw: tokens.map(t => t.raw).join('') }))); current = []; };
  for (const token of tokens) {
    if (token.type === 'heading' || token.type === 'blockMath') flush();
    const fragments = splitToken(token);
    if (fragments.length > 1 || token.type === 'blockMath') { flush(); result.push(...fragments.map(fragment => ({ tokens: [fragment], raw: fragment.raw, ...(fragment !== token && { sourceToken: token }) }))); }
    else {
      if (fragments[0] && fragments[0] !== token) originalTopLevel.set(fragments[0], token);
      current.push(...fragments);
    }
  }
  flush(); return result;
}

function* leaves(token: Token): Generator<Token> {
  if (token.type === 'list') {
    for (const item of (token as Tokens.List).items) yield* leaves(item);
  } else if (token.type === 'table') {
    const table = token as Tokens.Table;
    for (const cell of [...table.header, ...table.rows.flat()]) for (const child of cell.tokens) yield* leaves(child);
  } else {
    const nested = children(token);
    if (nested?.length) for (const child of nested) yield* leaves(child);
    else yield token;
  }
}

function boundedFind(source: string, text: string, from: number, to: number) {
  if (text.length > to - from) return -1;
  if (source.startsWith(text, from)) return from;
  const index = source.slice(from, to).indexOf(text);
  return index < 0 ? -1 : from + index;
}

function locateFragment(source: string, offset: number, from: number, to: number, original: Token, blocks: DocumentBlock[], first: number, last: number) {
  const parts = new Map<Token, { token: Token; block: number }[]>();
  const seen = new Set<Token>();
  for (let block = first; block <= last; block++) {
    for (const token of leaves(blocks[block].tokens[0])) {
      if (seen.has(token)) continue; // Table headers are repeated for readability.
      seen.add(token);
      const origin = originalLeaf.get(token) || token;
      const entries = parts.get(origin);
      if (entries) entries.push({ token, block });
      else parts.set(origin, [{ token, block }]);
    }
  }
  let cursor = from, nearest = first;
  // Walk original leaves in source order, even if table cells are continued in
  // parallel across different reading blocks. Match within this token only.
  for (const leaf of leaves(original)) {
    for (const { token, block } of parts.get(leaf) || []) {
      const raw = token.type === 'code' && token !== leaf ? (token as Tokens.Code).text : token.raw;
      if (!raw.trim()) continue;
      const start = boundedFind(source, raw, cursor, to);
      if (start >= 0) {
        cursor = start + raw.length;
        if (offset < cursor) return block;
        nearest = block;
      } else {
        // Quoted lines and indented code may have prefixes omitted by Marked.
        for (const line of raw.split('\n')) {
          const anchor = line.trim();
          if (!anchor) continue;
          let start = boundedFind(source, anchor, cursor, to), length = anchor.length;
          if (start < 0 && anchor.includes('|')) {
            const escaped = anchor.replaceAll('|', '\\|');
            start = boundedFind(source, escaped, cursor, to); length = escaped.length;
          }
          if (start < 0) continue;
          cursor = start + length;
          if (offset < cursor) return block;
          nearest = block;
        }
      }
    }
  }
  return nearest;
}

/** Resolve a raw Markdown match to a reading block without rendering any HTML. */
export function blockAtSourceOffset(blocks: DocumentBlock[], source: string, offset: number) {
  if (!blocks.length) return -1;
  // Marked normalizes CR and CRLF before lexing. A single CR keeps its width.
  if (source.includes('\r')) {
    offset = source.slice(0, offset).replaceAll('\r\n', '\n').length;
    source = source.replace(/\r\n?/g, '\n');
  }
  let cursor = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const topLevel = block.sourceToken ? [block.sourceToken] : block.tokens;
    for (const fragment of topLevel) {
      const token = originalTopLevel.get(fragment) || fragment;
      let last = i;
      if (block.sourceToken) while (blocks[last + 1]?.sourceToken === token) last++;
      const found = boundedFind(source, token.raw, cursor, source.length);
      const from = found < 0 ? cursor : found;
      const end = Math.min(source.length, from + token.raw.length);
      if (offset < end) return last === i ? i : locateFragment(source, offset, from, end, token, blocks, i, last);
      cursor = end;
      i = last;
    }
  }
  return blocks.length - 1;
}
