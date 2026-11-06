import type { Token, Tokens } from 'marked';
import { lexDocument } from './markdownSyntax';

export interface MathRange { start: number; end: number }
export interface FormulaSuggestion extends MathRange { line: number; tex: string }

export type RepairRequest = { source: string } & (
  { kind: 'scan' } | { kind: 'check'; range: MathRange; display: boolean }
);
export type RepairResult =
  | { kind: 'scan'; suggestions: FormulaSuggestion[]; more: boolean }
  | { kind: 'check'; valid: boolean };

const suggestionLimit = 50;
const maxFormulaLength = 8_000;
const texCommand = /\\(?:[dt]?frac|sqrt|overrightarrow|overleftarrow|vec|widehat|hat|dot|ddot|cdot|times|div|pm|mp|sin|cos|tan|log|ln|exp|sum|prod|i?i?int|lim|left|right|partial|nabla|infty|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|Omega|leq|geq|neq|approx|mathbb|mathbf|boldsymbol|boxed)(?![a-z])/i;
const unsafeSelection = /[$\n`]|\\(?:\(|\)|\[|\])/;

function* proseLeaves(tokens: Token[]): Generator<Token> {
  let inRawBlock = false;
  for (const token of tokens) {
    if (token.type === 'html') {
      inRawBlock = 'inRawBlock' in token && Boolean(token.inRawBlock);
    } else if (!inRawBlock) {
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) yield* proseLeaves(item.tokens);
      } else if (['paragraph', 'blockquote', 'text', 'strong', 'em', 'del'].includes(token.type) && 'tokens' in token && token.tokens) {
        yield* proseLeaves(token.tokens);
      } else if (token.type === 'text' || token.type === 'inlineMath' || token.type === 'blockMath') {
        yield token;
      }
    }
  }
}

function markerFor(source: string) {
  let marker: string;
  do { marker = '\uE000' + Math.random().toString(36).slice(2) + ':'; } while (source.includes(marker));
  return marker;
}

function standalone(tex: string) {
  if (tex.length > maxFormulaLength || !texCommand.test(tex) || unsafeSelection.test(tex)) return false;
  if (/^(?:[-+*]|\d{1,9}[.)])[ \t]|^[>#]|\\\\$/.test(tex)) return false;
  // Use strong math signals and leave prose, including mixed lines, to selection.
  const body = tex.replace(/\\(?:text|operatorname|mathrm|begin|end)\s*\{[^{}]*\}|\\[a-z]+/gi, '');
  return /^[\t -~\u0370-\u03FF\u2190-\u22FF]*$/.test(body) && !/[a-z]{3,}/i.test(body);
}

function findSuggestions(source: string): FormulaSuggestion[] {
  const candidates: FormulaSuggestion[] = [];
  let line = 0;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    line++;
    const tex = match[0].trim();
    if (!standalone(tex)) continue;
    const start = match.index + match[0].indexOf(tex);
    candidates.push({ start, end: start + tex.length, line, tex });
  }
  if (!candidates.length) return [];

  // Tag the end of each candidate without changing its Markdown delimiters.
  // A tag inside existing math, code, links or tables never reaches a prose leaf.
  const marker = markerFor(source);
  const tagged: string[] = [];
  let cursor = 0;
  for (const [index, { end }] of candidates.entries()) {
    tagged.push(source.slice(cursor, end), marker, String(index), '\uE001');
    cursor = end;
  }
  tagged.push(source.slice(cursor));
  const pattern = new RegExp(marker + '(\\d+)\\uE001', 'g');
  const found = new Set<number>();
  for (const token of proseLeaves(lexDocument(tagged.join('')))) {
    if (token.type !== 'text') continue;
    for (const match of token.raw.matchAll(pattern)) found.add(Number(match[1]));
  }
  return candidates.filter((_, index) => found.has(index));
}

function delimiters(source: string, { start, end }: MathRange, display: boolean) {
  if (!display) return ['$', '$'] as const;
  const lineStart = Math.max(source.lastIndexOf('\n', start - 1), source.lastIndexOf('\r', start - 1)) + 1;
  const indent = source.slice(lineStart, start);
  const newline = /^[ \t]*(\r\n?|\n)/.exec(source.slice(end))?.[1] ?? source.match(/\r\n?|\n/)?.[0] ?? '\n';
  return ['$$' + newline + indent, newline + indent + '$$'] as const;
}

function canWrap(source: string, range: MathRange, display: boolean) {
  const { start, end } = range;
  const tex = source.slice(start, end);
  if (!tex || tex.length > maxFormulaLength || unsafeSelection.test(tex)) return false;
  const marker = markerFor(source);
  const [open, close] = delimiters(source, range, display);
  const tagged = source.slice(0, start) + open + marker + tex + close + source.slice(end);
  for (const token of proseLeaves(lexDocument(tagged))) {
    const math = token.type === 'blockMath' || token.type === 'inlineMath';
    if (!math || token.pending || token.text !== marker + tex) continue;
    return display === (token.type === 'blockMath' || Boolean(token.display));
  }
  return false;
}

// Requests use the textarea's LF offsets. Saving maps them back to the original
// source, so a file's CRLF and unrelated text survive the edit.
export function inspectRepair(request: RepairRequest): RepairResult {
  if (request.kind === 'check') return { kind: 'check', valid: canWrap(request.source, request.range, request.display) };
  const candidates = findSuggestions(request.source);
  return { kind: 'scan', suggestions: candidates.slice(0, suggestionLimit), more: candidates.length > suggestionLimit };
}

export function wrapMath(source: string, range: MathRange, display: boolean) {
  let { start, end } = range;
  for (const match of source.matchAll(/\r\n/g)) {
    if (match.index >= end) break;
    if (match.index < start) start++;
    end++;
  }
  const [open, close] = delimiters(source, { start, end }, display);
  return {
    text: source.slice(0, start) + open + source.slice(start, end) + close + source.slice(end),
    added: (open + close).replaceAll('\r\n', '\n').length,
  };
}
