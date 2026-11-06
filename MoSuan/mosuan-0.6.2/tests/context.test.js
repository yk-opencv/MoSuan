import { describe, it, expect } from 'vitest';
import { buildContext } from '../server/context.js';
const user = content => ({ role: 'user', content });
const ai = content => ({ role: 'assistant', content });
describe('context selection', () => {
  const conversation = [ai('Imported notebook is not a chat turn'), user('old'), ai('old answer'), user('recent'), ai('recent answer'), user('now')];
  it('sends only requested complete turns and current question', () => {
    const c = buildContext(conversation, 1);
    expect(c.messages.slice(1)).toEqual([user('recent'), ai('recent answer'), user('now')]);
    expect(c.historyMessages).toBe(2);
  });
  it('supports zero history', () => { expect(buildContext(conversation, 0).messages.slice(1)).toEqual([user('now')]); });
  it('does not split a turn when the character budget is reached', () => {
    expect(buildContext(conversation, 4, 10).messages.slice(1)).toEqual([user('now')]);
  });
  it('rejects oversized current input', () => { expect(() => buildContext([user('a'.repeat(25))], 4, 20)).toThrow(); });
  it('excludes interrupted responses', () => {
    const c = buildContext([user('incomplete'), { ...ai('partial'), state: 'stopped' }, user('now')], 4);
    expect(c.messages.slice(1)).toEqual([user('now')]);
  });
});
