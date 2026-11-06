import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { newId } from './id';
import { DeepSeekStream } from './deepseekStream';
import { solvePow, type PowChallenge } from './pow';
import { MAX_ATTACHMENTS } from '../../shared/imageLimits.js';

interface WebEvent { id: string; kind: 'answer' | 'finish' | 'error' | 'progress' | 'raw' | 'end' | 'proof'; content?: string; complete?: boolean; message?: string; challenge?: PowChallenge; wasm?: string }
export interface PhoneWebPlugin {
  status(): Promise<{ available: boolean; ready: boolean }>;
  open(): Promise<void>;
  ask(options: { id: string; prompt: string; images?: { name: string; dataUrl: string }[] }): Promise<void>;
  cancel(options: { id: string }): Promise<void>;
  proof(options: { id: string; answer?: number; error?: string }): Promise<void>;
  forget(): Promise<void>;
  addListener(name: 'webEvent', listener: (event: WebEvent) => void): Promise<PluginListenerHandle>;
}
export const PhoneWeb = registerPlugin<PhoneWebPlugin>('MosuanWeb');
const instructions = '你是一位严谨的中文理工科学习助手。请用 Markdown 回答下面的当前问题，行内公式用 $...$，独立公式用 $$...$$。下方历史仅供理解上下文，不要重新回答历史问题。';
export function phonePrompt(input: { messages: { role: string; content: string; images?: unknown[] }[]; rounds?: number }) {
  if (!Array.isArray(input.messages) || input.messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new Error('问题格式无效');
  const latest = input.messages.at(-1);
  if (!latest || latest.role !== 'user' || !latest.content.trim()) throw new Error('请输入当前问题');
  if (latest.content.length > 24000) throw new Error('当前问题最多 24000 字符');
  const turns: typeof input.messages[] = [];
  for (const message of input.messages.slice(0, -1)) {
    if (message.role === 'user') turns.push([message]);
    else if (turns.at(-1)?.length === 1) turns.at(-1)!.push(message);
  }
  const rounds = Math.max(0, Math.min(12, Math.floor(Number(input.rounds) || 0)));
  const selected: typeof input.messages = [];
  let characters = latest.content.length;
  let imageCount = latest.images?.length || 0;
  let imageSize = (latest.images || []).reduce<number>((sum, image) => sum + String((image as { dataUrl?: string })?.dataUrl || '').length, 0);
  if (imageCount > MAX_ATTACHMENTS) throw new Error('当前问题最多支持 ' + MAX_ATTACHMENTS + ' 张图片');
  for (const turn of (rounds ? turns.filter(turn => turn.length === 2).slice(-rounds) : []).reverse()) {
    const size = turn.reduce((sum, message) => sum + message.content.length, 0);
    const count = turn.reduce((sum, message) => sum + (message.images?.length || 0), 0);
    const bytes = turn.reduce((sum, message) => sum + (message.images || []).reduce<number>((n, image) => n + String((image as { dataUrl?: string })?.dataUrl || '').length, 0), 0);
    if (characters + size > 24000 || imageCount + count > 10 || imageSize + bytes > 6_000_000) break;
    selected.unshift(...turn); characters += size; imageCount += count; imageSize += bytes;
  }
  const images: { name: string; dataUrl: string }[] = [];
  function content(message: NonNullable<typeof latest>) {
    const labels = (message.images || []).map(value => {
      const image = value as { name?: unknown; dataUrl?: unknown };
      if (!image || typeof image.dataUrl !== 'string' || image.dataUrl.length > 750000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) throw new Error('图片数据无效，请移除后重新选择图片。');
      const name = typeof image.name === 'string' ? image.name.slice(0, 100).replace(/[\r\n]/g, '_') : '图片';
      images.push({ name, dataUrl: image.dataUrl });
      return `[附件 ${images.length}：${name}]`;
    });
    return message.content + (labels.length ? '\n' + labels.join('\n') : '');
  }
  const history = selected.length ? `\n\n<历史对话>\n${selected.map(message => `${message.role === 'user' ? '用户' : '助手'}：${content(message)}`).join('\n\n')}\n</历史对话>` : '';
  const current = content(latest);
  return { prompt: `${instructions}${history}\n\n<当前问题>\n${current}\n</当前问题>`, characters, historyMessages: selected.length, images };
}

export async function phoneWebResponse(input: Parameters<typeof phonePrompt>[0], signal?: AbortSignal | null, plugin: PhoneWebPlugin = PhoneWeb, solver = solvePow): Promise<Response> {
  const context = phonePrompt(input), id = newId(), encoder = new TextEncoder();
  const protocol = new DeepSeekStream(), computation = new AbortController();
  let listener: PluginListenerHandle | undefined, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { stop(); } });
  const emit = (event: object) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
  const cleanup = () => { clearTimeout(timer); computation.abort(); signal?.removeEventListener('abort', stop); void listener?.remove(); };
  const close = () => { if (closed) return; closed = true; cleanup(); controller.close(); };
  const stop = () => { if (closed) return; emit({ error: '已停止手机网页提问，已收到的内容保留。' }); close(); void plugin.cancel({ id }).catch(() => {}); };
  if (signal?.aborted) { stop(); throw new DOMException('Aborted', 'AbortError'); }
  try {
    listener = await plugin.addListener('webEvent', event => {
      if (closed || event.id !== id) return;
      try {
        if (event.kind === 'progress') emit({ progress: event.message || '正在连接网页版…' });
        if (event.kind === 'proof' && event.challenge && event.wasm) {
          void solver(event.challenge, event.wasm, computation.signal).then(answer => { if (!closed) return plugin.proof({ id, answer }); }).catch(() => { if (!closed) void plugin.proof({ id, error: 'PoW 计算未完成' }).catch(() => {}); });
        }
        if (event.kind === 'raw' && typeof event.content === 'string') { protocol.push(event.content); if (protocol.answer) emit({ answerSnapshot: protocol.answer }); }
        if (event.kind === 'end') { emit({ answerSnapshot: protocol.answer }); emit({ choices: [{ delta: {}, finish_reason: protocol.finish() }] }); close(); }
        if (event.kind === 'answer' && typeof event.content === 'string') emit({ answerSnapshot: event.content });
        if (event.kind === 'error') { emit({ error: event.message || '手机网页接口连接未完成，请重新保存登录后重试。' }); close(); }
        if (event.kind === 'finish') { if (typeof event.content === 'string') emit({ answerSnapshot: event.content }); emit({ choices: [{ delta: {}, finish_reason: event.complete ? 'stop' : 'user_return' }] }); close(); }
      } catch (error) { if (protocol.answer) emit({ answerSnapshot: protocol.answer }); emit({ error: (error as Error).message }); close(); void plugin.cancel({ id }).catch(() => {}); }
    });
    if (closed || signal?.aborted) { stop(); await listener.remove(); throw new DOMException('Aborted', 'AbortError'); }
    signal?.addEventListener('abort', stop, { once: true });
    emit({ context: { characters: context.characters, historyMessages: context.historyMessages, provider: 'phone-web' } });
    await plugin.ask({ id, prompt: context.prompt, ...(context.images.length ? { images: context.images } : {}) });
    if (!closed) timer = setTimeout(() => { emit({ error: '手机网页等待超时，问题与已收到的内容已保留。' }); close(); void plugin.cancel({ id }).catch(() => {}); }, 15 * 60 * 1000);
  } catch (error) { if (!closed) { emit({ error: error instanceof Error ? error.message : '手机网页无法打开' }); close(); } }
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
