import type { DocumentBlock } from './markdownChunks';

export const LONG_DOCUMENT_CHARS = 32_000;
let worker: Worker | undefined;
let nextId = 0;
const jobs = new Map<number, { resolve: (blocks: DocumentBlock[]) => void; reject: (error: Error) => void }>();

export async function parseInBackground(source: string): Promise<DocumentBlock[]> {
  if (!worker) {
    const instance = new Worker(new URL('../workers/markdownWorker.ts', import.meta.url), { type: 'module' });
    instance.onmessage = ({ data }: MessageEvent<{ id: number; blocks?: DocumentBlock[] }>) => {
      const job = jobs.get(data.id);
      jobs.delete(data.id);
      if (data.blocks) job?.resolve(data.blocks);
      else job?.reject(new Error('长文解析未完成'));
    };
    const fail = () => {
      instance.terminate(); worker = undefined;
      const error = new Error('无法启动后台解析');
      for (const job of jobs.values()) job.reject(error);
      jobs.clear();
    };
    instance.onerror = fail;
    instance.onmessageerror = fail;
    worker = instance;
  }
  const instance = worker;
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    jobs.set(id, { resolve, reject });
    try { instance.postMessage({ id, source }); }
    catch (error) { jobs.delete(id); reject(error); }
  });
}
