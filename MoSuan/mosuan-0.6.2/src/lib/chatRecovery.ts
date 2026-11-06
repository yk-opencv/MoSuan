import type { Message } from './storage';

export const CHAT_CHARACTER_LIMIT = 24_000;
const EMPTY_OLD_ANSWER = '本次未收到内容，可以重新发送问题。';
type ChatMessage = Pick<Message, 'role' | 'content' | 'images'>;

export function incomplete(message: Message) {
  return message.role === 'assistant' && (message.state === 'stopped' || message.state === 'error');
}

export function receivedText(message: Message) {
  return incomplete(message) && message.content === EMPTY_OLD_ANSWER ? '' : message.content;
}

export function recoveryTarget(messages: Message[], id: string) {
  const index = messages.findIndex(message => message.id === id);
  if (index < 0 || !incomplete(messages[index])) return;
  let start = index - 1;
  while (start >= 0 && messages[start].role !== 'user') start--;
  if (start < 0 || !messages[start].content.trim()) return;
  let end = index + 1;
  while (end < messages.length && messages[end].role === 'assistant') end++;
  return { answer: messages[index], question: messages[start], history: messages.slice(0, start), answers: messages.slice(start + 1, end), end };
}

function answerParts(answer: Message, turn: Message[]) {
  const byId = new Map(turn.map(message => [message.id, message]));
  const parts: string[] = [];
  let next: Message | undefined = answer;
  while (next && byId.delete(next.id)) {
    const text = receivedText(next);
    if (text.trim()) parts.push(text);
    next = next.recovery?.kind === 'continue' ? byId.get(next.recovery.from) : undefined;
  }
  return parts.reverse();
}

export function continuationQuestion(target: NonNullable<ReturnType<typeof recoveryTarget>>): string {
  const prefix = '请继续下面未完成的回答。只写接下来的部分，避免重复。若最后的公式或代码被截断，请从该公式或代码块开头完整重写。\n\n原问题：\n'
    + target.question.content + '\n\n已收到的回答末段：\n';
  const room = Math.min(6000, CHAT_CHARACTER_LIMIT - prefix.length);
  if (room < 128) throw new Error('原问题接近长度上限，无法加入续写上下文。可以点「重试」重新生成。');
  const parts = answerParts(target.answer, target.answers);
  let tail = '';
  for (let i = parts.length - 1; i >= 0 && tail.length < room; i--) {
    const separator = tail ? '\n\n' : '';
    if (separator.length + tail.length >= room) break;
    tail = parts[i].slice(-(room - tail.length - separator.length)) + separator + tail;
  }
  if (!tail.trim()) throw new Error('这条回答还没有正文，可以点「重试」。');
  if (/^[\udc00-\udfff]/.test(tail)) tail = tail.slice(1);
  return prefix + tail;
}

function payload(message: ChatMessage): ChatMessage {
  return { role: message.role, content: message.content, ...(message.images?.length ? { images: message.images } : {}) };
}

export function chatMessages(history: Message[], current: ChatMessage, rounds: number) {
  if (rounds <= 0) return [payload(current)];
  const turns: { question: Message; answers: Message[] }[] = [];
  for (const message of history) {
    if (message.role === 'user') turns.push({ question: message, answers: [] });
    else turns.at(-1)?.answers.push(message);
  }
  const selected: ChatMessage[] = [];
  let characters = current.content.length;
  let imageCharacters = (current.images || []).reduce((sum, image) => sum + image.dataUrl.length, 0);
  let imageCount = current.images?.length || 0;
  for (let index = turns.length - 1; index >= 0 && selected.length < rounds * 2; index--) {
    const { question, answers } = turns[index];
    let answer: Message | undefined;
    for (let i = answers.length - 1; i >= 0; i--) {
      if (!incomplete(answers[i]) && answers[i].content.trim()) { answer = answers[i]; break; }
    }
    if (!answer || !question.content.trim()) continue;
    const parts = answerParts(answer, answers);
    const size = parts.reduce((sum, text) => sum + text.length, question.content.length) + Math.max(0, (parts.length - 1) * 2);
    const attachments = question.images || [];
    const attachmentSize = attachments.reduce((sum, image) => sum + image.dataUrl.length, 0);
    if (characters + size > CHAT_CHARACTER_LIMIT || imageCharacters + attachmentSize > 6_000_000 || imageCount + attachments.length > 10) break;
    selected.unshift(payload(question), { role: 'assistant', content: parts.join('\n\n') });
    characters += size;
    imageCharacters += attachmentSize;
    imageCount += attachments.length;
  }
  return [...selected, payload(current)];
}
