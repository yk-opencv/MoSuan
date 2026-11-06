import { expect, test } from 'vitest';
import { CHAT_CHARACTER_LIMIT, chatMessages, continuationQuestion, recoveryTarget } from '../src/lib/chatRecovery';
import type { Message } from '../src/lib/storage';

const question: Message = { id: 'q', role: 'user', content: '最初的题目' };
const partial: Message = { id: 'a', role: 'assistant', content: '第一段推导', state: 'stopped' };
const failedRetry: Message = { id: 'r', role: 'assistant', content: '', state: 'error', recovery: { kind: 'retry', from: 'a' } };
const continuation: Message = { id: 'c', role: 'assistant', content: '第二段推导', state: 'complete', recovery: { kind: 'continue', from: 'a' } };
const next: Message = { id: 'next', role: 'user', content: '接着问' };

test('a finished continuation contributes the previous partial answer as a single turn', () => {
  const history = [question, partial, failedRetry, continuation];
  expect(chatMessages(history, next, 1)).toEqual([
    { role: 'user', content: question.content },
    { role: 'assistant', content: '第一段推导\n\n第二段推导' },
    { role: 'user', content: next.content },
  ]);
  expect(chatMessages(history, next, 0)).toEqual([{ role: 'user', content: next.content }]);
});

test('continuing an older answer retains its original question and excludes later dialogue', () => {
  const long: Message = { ...partial, content: '很早的文本🙂'.repeat(2000) + '最后一步 $x^2$' };
  const target = recoveryTarget([question, long, next], long.id)!;
  const prompt = continuationQuestion(target);
  expect(target.end).toBe(2);
  expect(prompt.length).toBeLessThan(CHAT_CHARACTER_LIMIT);
  expect(prompt).toContain(question.content);
  expect(prompt).toMatch(/最后一步 \$x\^2\$$/);
  expect(prompt).not.toContain(next.content);
  expect(prompt).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
});
