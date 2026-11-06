import { splitDocument } from '../lib/markdownSyntax';

self.onmessage = ({ data }: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = data;
  try {
    // Source-location metadata uses WeakMaps on the calling thread. The reader
    // rebuilds it on demand for search jumps, so only send renderable blocks.
    const blocks = splitDocument(source).map(({ raw, tokens }) => ({ raw, tokens }));
    self.postMessage({ id, blocks });
  } catch {
    self.postMessage({ id, failed: true });
  }
};
