// Node's web streams are used to simulate split network packets.
import { it, expect } from 'vitest';
import { readEvents } from '../src/lib/sse';
it('decodes SSE and Chinese UTF-8 across arbitrary byte boundaries', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"usage":{"total_tokens":12}}\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
  const events: Record<string, unknown>[] = [];
  await readEvents(stream, e => events.push(e));
  expect(events).toHaveLength(2);
  expect(events[0]).toEqual({ choices: [{ delta: { content: '你好' } }] });
});
