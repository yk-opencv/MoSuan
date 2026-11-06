import { useEffect, useMemo, useRef, useState } from 'react';
import { splitDocument } from '../lib/markdownSyntax';
import type { DocumentBlock } from '../lib/markdownChunks';
import type { Message } from '../lib/storage';
import { LONG_DOCUMENT_CHARS, parseInBackground } from '../lib/longDocument';

interface ParsedMessage { content: string; blocks: DocumentBlock[]; sourceMapped: boolean }

export function useDocumentBlocks(bookId: string, messages: Message[] | undefined) {
  const cache = useRef(new Map<string, ParsedMessage>());
  const [revision, setRevision] = useState(0);
  const [fallback, setFallback] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef({ bookId, messages });
  latest.current = { bookId, messages };

  const result = useMemo(() => {
    const missing: Message[] = [];
    const retained = new Set<string>();
    const entries = (messages || []).map(message => {
      retained.add(message.id);
      let entry = cache.current.get(message.id);
      if (entry?.content === message.content) return { message, blocks: entry.blocks };
      if (!fallback && message.content.length >= LONG_DOCUMENT_CHARS) {
        missing.push(message);
        // While streaming, retain the most recent parsed prefix.
        return { message, blocks: entry && message.content.startsWith(entry.content) ? entry.blocks : [] };
      }
      entry = { content: message.content, blocks: splitDocument(message.content), sourceMapped: true };
      cache.current.set(message.id, entry);
      return { message, blocks: entry.blocks };
    });
    for (const id of cache.current.keys()) if (!retained.has(id)) cache.current.delete(id);
    return { entries, missing };
  }, [bookId, messages, revision, fallback]);

  useEffect(() => {
    const next = result.missing[0];
    if (!next || inFlight.current) return;
    inFlight.current = true;
    void parseInBackground(next.content).then(blocks => {
      const current = latest.current;
      if (current.bookId !== bookId) return;
      const message = current.messages?.find(message => message.id === next.id);
      if (!message?.content.startsWith(next.content)) return;
      const previous = cache.current.get(next.id);
      if (previous?.content === message.content) return; // A search may already have parsed this version.
      cache.current.set(next.id, { content: next.content, blocks, sourceMapped: false });
    }).catch(() => setFallback(true)).finally(() => {
      inFlight.current = false;
      // The next effect selects the latest requested content, not every chunk
      // that arrived while the worker was busy.
      setRevision(revision => revision + 1);
    });
  }, [bookId, result]);

  function blocksForSearch(message: Message) {
    const previous = cache.current.get(message.id);
    if (previous?.sourceMapped && previous.content === message.content) return previous.blocks;
    const blocks = splitDocument(message.content);
    cache.current.set(message.id, { content: message.content, blocks, sourceMapped: true });
    setRevision(revision => revision + 1);
    return blocks;
  }
  return { entries: result.entries, parsing: result.missing.length > 0, blocksForSearch };
}
