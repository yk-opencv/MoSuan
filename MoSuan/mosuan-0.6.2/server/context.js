export const SYSTEM_PROMPT = '你是一位严谨的中文理工科学习助手。用 Markdown 作答。行内公式用 $...$，独立公式用 $$...$$，确保定界符闭合。不要把数学公式放进代码块。上下文可能只包含最近的对话；信息不足时向用户说明，不要编造历史内容。';
export const MAX_CONTEXT_CHARS = 24000;

export function buildContext(messages, rounds = 4, budget = MAX_CONTEXT_CHARS) {
  const history = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() && !['error', 'stopped'].includes(m.state));
  if (!history.length || history.at(-1).role !== 'user') throw new Error('最后一条消息必须是用户问题');
  const turns = [];
  for (const m of history.slice(0, -1)) {
    if (m.role === 'user') turns.push([{ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) }]);
    else if (turns.length && turns.at(-1).length === 1) turns.at(-1).push({ role: m.role, content: m.content });
  }
  const latest = history.at(-1);
  if (latest.content.length > budget) throw new Error(`当前问题超过 ${budget} 字符，请缩短后重试`);
  const selected = [];
  let characters = latest.content.length;
  let imageCharacters = latest.images?.reduce((sum, image) => sum + image.dataUrl.length, 0) || 0;
  let imageCount = latest.images?.length || 0;
  for (const turn of (rounds > 0 ? turns.filter(t => t.length === 2).slice(-rounds) : []).reverse()) {
    const size = turn.reduce((sum, m) => sum + m.content.length, 0);
    const imageSize = turn.reduce((sum, m) => sum + (m.images?.reduce((n, image) => n + image.dataUrl.length, 0) || 0), 0);
    const count = turn.reduce((sum, message) => sum + (message.images?.length || 0), 0);
    if (characters + size > budget || imageCharacters + imageSize > 6_000_000 || imageCount + count > 10) break;
    imageCount += count;
    imageCharacters += imageSize;
    selected.unshift(...turn); characters += size;
  }
  return { messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...selected, { role: 'user', content: latest.content, ...(latest.images?.length ? { images: latest.images } : {}) }], characters, historyMessages: selected.length };
}
