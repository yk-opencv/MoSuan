import type { Notebook } from './storage';

export function conversationDocument(book: Notebook) {
  const title = book.title.replace(/[\r\n]+/g, ' ').trim() || '学习对话';
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || '学习对话';
  const messages = book.messages.map(message => {
    const role = message.role === 'user' ? '我的问题' : message.recovery?.kind === 'continue' ? '续写回答' : message.recovery ? '重试回答' : '学习笔记';
    const state = message.state === 'stopped' ? '（输出未完成）' : message.state === 'error' ? '（连接异常）' : '';
    const images = message.images?.map(image => `![${image.name.replace(/[\[\]\\\r\n]/g, '_')}](${image.dataUrl})`).join('\n\n');
    return `## ${role}${state}\n\n${message.content}${images ? '\n\n' + images : ''}`;
  });
  return { title, filename: `${name}.md`, text: `# ${title}\n\n${messages.join('\n\n---\n\n')}` };
}
