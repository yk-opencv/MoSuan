import { describe, expect, it, vi } from 'vitest';
import { phonePrompt, phoneWebResponse, type PhoneWebPlugin } from '../src/lib/phoneWeb';
import { readEvents } from '../src/lib/sse';

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });
describe('phone-owned web conversation context and native stream', () => {
  it('keeps complete selected turns, supports zero history and excludes oversized old turns', () => {
    const messages = [assistant('Imported notes'), user('old'), assistant('old answer'), user('recent'), assistant('recent answer'), user('now')];
    expect(phonePrompt({ messages, rounds: 1 })).toMatchObject({ historyMessages: 2, characters: 22 });
    expect(phonePrompt({ messages, rounds: 0 }).prompt).not.toContain('old answer');
    expect(phonePrompt({ messages: [user('x'.repeat(24000)), assistant('old'), user('now')], rounds: 12 }).historyMessages).toBe(0);
    expect(() => phonePrompt({ messages: [user('x'.repeat(24001))] })).toThrow('24000');
  });
  it('rejects invalid images, limits image context and validates the current question', () => {
    const messages = [{ ...user('picture'), images: [{}] }, assistant('answer'), user('now')];
    expect(() => phonePrompt({ messages, rounds: 1 })).toThrow('图片');
    expect(phonePrompt({ messages, rounds: 0 }).historyMessages).toBe(0);
    expect(() => phonePrompt({ messages: [assistant('answer')] })).toThrow();
    const image = { name: '题目.jpg', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' };
    const attached = phonePrompt({ messages: [{ ...user('旧图片'), images: [image] }, assistant('旧解答'), { ...user('新图片'), images: [image] }], rounds: 1 });
    expect(attached.images).toEqual([image, image]);
    expect(attached.prompt).toContain('[附件 1：题目.jpg]'); expect(attached.prompt).toContain('[附件 2：题目.jpg]');
    expect(attached.prompt).not.toContain('base64');
    expect(phonePrompt({ messages: [{ ...user('旧图片'), images: [image] }, assistant('旧解答'), user('现在')], rounds: 0 }).images).toEqual([]);
    const full = { ...user('now'), images: Array(7).fill(image) };
    const overflow = { ...user('old'), images: Array(4).fill(image) };
    expect(phonePrompt({ messages: [overflow, assistant('old answer'), full], rounds: 12 }).images).toHaveLength(7);
    expect(() => phonePrompt({ messages: [{ ...full, images: [...full.images, image] }] })).toThrow('7 张');
  });
  it('accepts only its own native stream, supports replacement snapshots and releases listeners', async () => {
    let listener: any;
    const remove = vi.fn();
    const plugin: PhoneWebPlugin = {
      status: async () => ({ available: true, ready: true }), open: async () => {}, cancel: vi.fn(async () => {}), proof: vi.fn(async () => {}), forget: async () => {},
      addListener: async (_, callback) => { listener = callback; return { remove }; },
      ask: async ({ id }) => {
        listener({ id: 'unrelated', kind: 'answer', content: 'must not leak' });
        listener({ id, kind: 'answer', content: '半截 $x' });
        listener({ id, kind: 'answer', content: '完整 $x^2$' });
        listener({ id, kind: 'finish', content: '完整 $x^2$', complete: true });
      },
    };
    const response = await phoneWebResponse({ messages: [user('question')], rounds: 0 }, null, plugin);
    const events: any[] = []; await readEvents(response.body!, event => events.push(event));
    expect(JSON.stringify(events)).not.toContain('must not leak');
    expect(events.filter(event => event.answerSnapshot).at(-1).answerSnapshot).toBe('完整 $x^2$');
    expect(events.at(-1).choices[0].finish_reason).toBe('stop'); expect(remove).toHaveBeenCalledOnce();
  });
  it('abort cancels native work and a partial return stays explicitly incomplete', async () => {
    let listener: any, id = '';
    const cancel = vi.fn(async () => {}), remove = vi.fn(async () => {});
    const plugin: PhoneWebPlugin = { status: async () => ({ available: true, ready: true }), open: async () => {}, cancel, proof: vi.fn(async () => {}), forget: async () => {},
      addListener: async (_, callback) => { listener = callback; return { remove }; }, ask: async options => { id = options.id; } };
    const controller = new AbortController();
    const response = await phoneWebResponse({ messages: [user('question')] }, controller.signal, plugin);
    controller.abort();
    const events: any[] = []; await readEvents(response.body!, event => events.push(event));
    expect(events.at(-1).error).toContain('停止'); expect(cancel).toHaveBeenCalledWith({ id }); expect(remove).toHaveBeenCalledOnce();
    const partial = await phoneWebResponse({ messages: [user('question')] }, null, plugin);
    listener({ id, kind: 'finish', content: 'partial', complete: false });
    const result: any[] = []; await readEvents(partial.body!, event => result.push(event));
    expect(result.at(-1).choices[0].finish_reason).toBe('user_return');
  });
  it('computes a native challenge and consumes raw SSE directly without opening a page', async () => {
    let listener: any, id = '';
    const open = vi.fn(async () => {}), solver = vi.fn(async () => 7), proof = vi.fn(async () => {});
    const plugin: PhoneWebPlugin = { status: async () => ({ available: true, ready: true }), open, cancel: vi.fn(async () => {}), proof, forget: async () => {},
      addListener: async (_, callback) => { listener = callback; return { remove: async () => {} }; }, ask: async options => { id = options.id; } };
    const response = await phoneWebResponse({ messages: [user('question')] }, null, plugin, solver);
    listener({ id, kind: 'proof', challenge: { algorithm: 'DeepSeekHashV1', challenge: 'abc', salt: 's', expire_at: 1, difficulty: 1 }, wasm: 'test-module' });
    await vi.waitFor(() => expect(proof).toHaveBeenCalledWith({ id, answer: 7 }));
    listener({ id, kind: 'raw', content: 'data: {"p":"response/content","v":"直接回答"}\n\ndata: {"p":"response/status","v":"FINISHED"}\n\n' });
    listener({ id, kind: 'end' });
    const events: any[] = []; await readEvents(response.body!, event => events.push(event));
    expect(events.at(-1).choices[0].finish_reason).toBe('stop'); expect(JSON.stringify(events)).toContain('直接回答'); expect(open).not.toHaveBeenCalled();
  });
});
