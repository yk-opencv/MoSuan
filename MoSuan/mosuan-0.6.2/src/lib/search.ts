import type { Notebook } from './storage';

export const SEARCH_LIMIT = 100;
export const SEARCH_QUERY_LIMIT = 120;

interface Excerpt { before: string; match: string; after: string }
export interface SearchHit {
  bookId: string;
  title: string;
  excerpt: Excerpt;
  location?: { messageId: string; role: 'user' | 'assistant'; offset: number };
}

function excerpt(source: string, start: number, match: string): Excerpt {
  // Trim only the context. Keep the exact match and its original offset.
  const end = start + match.length;
  let from = Math.max(0, start - 35), to = Math.min(source.length, end + 55);
  const lead = source.slice(from, start);
  const previousBreak = Math.max(lead.lastIndexOf('\n'), lead.lastIndexOf('\r'));
  const nextBreak = source.slice(end, to).search(/[\r\n]/);
  if (previousBreak >= 0) from += previousBreak + 1;
  if (nextBreak >= 0) to = end + nextBreak;
  if (/[\udc00-\udfff]/.test(source[from])) from--;
  if (/[\ud800-\udbff]/.test(source[to - 1])) to++;
  const clean = (text: string) => text.replace(/\s+/g, ' ');
  return {
    before: (from && previousBreak < 0 ? '…' : '') + clean(source.slice(from, start)), match,
    after: clean(source.slice(end, to)) + (to < source.length && nextBreak < 0 ? '…' : ''),
  };
}

export async function searchNotebooks(books: Notebook[], input: string, signal: AbortSignal) {
  const query = input.trim().slice(0, SEARCH_QUERY_LIMIT);
  const hits: SearchHit[] = [];
  if (!query) return { hits, more: false };
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let sliceStarted = performance.now();

  // Titles first; then search the saved text. Images and credentials are never indexed.
  for (const titles of [true, false]) {
    for (const book of books) {
      const messages = titles ? [null] : book.messages;
      for (const message of messages) {
        if (performance.now() - sliceStarted > 8) {
          await new Promise(resolve => setTimeout(resolve, 0));
          sliceStarted = performance.now();
        }
        if (signal.aborted) return { hits: [], more: false };
        const source = message?.content ?? book.title;
        literal.lastIndex = 0;
        for (let found: RegExpExecArray | null; (found = literal.exec(source));) {
          if (hits.length === SEARCH_LIMIT) return { hits, more: true };
          hits.push({ bookId: book.id, title: book.title, excerpt: excerpt(source, found.index, found[0]), ...(message && { location: { messageId: message.id, role: message.role, offset: found.index } }) });
          if (titles) break;
        }
      }
    }
  }
  return { hits, more: false };
}
