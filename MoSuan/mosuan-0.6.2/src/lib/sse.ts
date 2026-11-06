export async function readEvents(stream: ReadableStream<Uint8Array>, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let pending = '';
  const consume = (frame: string) => {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (data && data !== '[DONE]') onEvent(JSON.parse(data));
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done }).replace(/\r/g, '');
      let end: number;
      while ((end = pending.indexOf('\n\n')) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 2); }
      if (done) { if (pending.trim()) consume(pending); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
