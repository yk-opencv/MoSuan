import { describe, it, expect } from 'vitest';
import { DeepSeekStream } from '../src/lib/deepseekStream';
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
describe('native DeepSeek web response protocol', () => {
  it('rebuilds split fragments without exposing thinking and waits for completion', () => {
    const stream = new DeepSeekStream();
    const input = frame({ v: { response: { fragments: [{ type: 'THINK', content: 'private thinking' }, { type: 'RESPONSE', content: '中文：$$' }] } } })
      + frame({ p: 'response/fragments/-1/content', v: '\\sum_{n=1}^\\infty x^n' })
      + frame({ v: '=\\frac{x}{1-x}$$' }) + frame({ p: 'response/status', v: 'FINISHED' });
    for (const character of input) stream.push(character);
    expect(stream.answer).toBe(String.raw`中文：$$\sum_{n=1}^\infty x^n=\frac{x}{1-x}$$`);
    expect(stream.finish()).toBe('stop'); expect(stream.answer).not.toContain('private thinking');
  });
  it('applies fragment patches and content replacement instead of duplicating text', () => {
    const stream = new DeepSeekStream();
    stream.push(frame({ p: 'response', v: [{ p: 'fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: 'old' }] }] }));
    stream.push(frame({ p: 'response/fragments/-1/content', o: 'SET', v: 'new' }));
    stream.push(frame({ p: 'response/finish_reason', v: 'length' }));
    expect(stream.answer).toBe('new'); expect(stream.finish()).toBe('length');
  });
  it('reports HTTP-200 rate limits and does not leak raw authentication details', () => {
    const stream = new DeepSeekStream();
    expect(() => stream.push(frame({ code: 40029, msg: 'TOO_MANY_REQUESTS' }))).toThrow('频繁');
    expect(() => stream.finish()).toThrow();
    expect(() => new DeepSeekStream().push(frame({ error: { message: 'Bearer protected-auth-detail' } }))).toThrow('接口返回异常');
  });
  it('does not mark a disconnected stream complete, including a partial final frame', () => {
    const stream = new DeepSeekStream(); stream.push(frame({ p: 'response/content', v: 'partial' }));
    expect(() => stream.finish()).toThrow('提前中断'); expect(stream.answer).toBe('partial');
    stream.push('data: {"p":"response/status","v":"FINISHED"}'); expect(stream.finish()).toBe('stop');
  });
});
