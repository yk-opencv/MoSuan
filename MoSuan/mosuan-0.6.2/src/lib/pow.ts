export interface PowChallenge { algorithm: string; challenge: string; salt: string; expire_at: number; difficulty: number }
export function solvePow(challenge: PowChallenge, wasm: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, answer?: number) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(answer!);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('PoW 计算超时')), 30000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => Number.isSafeInteger(event.data.answer) && event.data.answer > 0 ? finish(undefined, event.data.answer) : finish(new Error('PoW 计算失败'));
    worker.onerror = () => finish(new Error('PoW 计算组件无法运行'));
    worker.postMessage({ challenge, wasm });
  });
}
