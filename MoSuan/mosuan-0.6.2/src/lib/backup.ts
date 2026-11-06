import { newId } from './id';
import type { Message, Notebook } from './storage';
import { MAX_ATTACHMENTS, type Attachment } from './attachments';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const format = 'mosuan-notebooks';
export interface NotebookBackup {
  format: typeof format;
  version: 1;
  createdAt: string;
  activeId?: string;
  notebooks: Notebook[];
}

function invalid(): never {
  throw new Error('备份内容不完整或格式无效，未恢复任何笔记。');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) invalid();
  return value;
}
function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1600) invalid();
  return value;
}
function attachment(value: unknown): Attachment {
  const image = record(value);
  const { dataUrl, name } = image;
  if (typeof name !== 'string' || name.length > 100 || typeof dataUrl !== 'string' || dataUrl.length > 750_000
    || !/^data:image\/(?:jpeg;base64,\/9j\/|png;base64,iVBORw0KGgo)[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)
    || (dataUrl.length - dataUrl.indexOf(',') - 1) % 4 !== 0) invalid();
  return { id: identifier(image.id), name, dataUrl, width: dimension(image.width), height: dimension(image.height) };
}

function notebook(value: unknown): Notebook {
  const input = record(value);
  const { title, updated, pinned } = input;
  if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof updated !== 'number'
    || !Number.isFinite(updated) || updated < 0 || updated > 8.64e15 || (pinned !== undefined && typeof pinned !== 'boolean')
    || !Array.isArray(input.messages)) invalid();
  const ids = new Set<string>();
  const earlierAnswers = new Set<string>();
  const messages = input.messages.map((value): Message => {
    const item = record(value);
    const { role, content, state } = item;
    const id = identifier(item.id);
    if (ids.has(id) || (role !== 'user' && role !== 'assistant') || typeof content !== 'string' || content.length > 5_000_000
      || (state !== undefined && state !== 'complete' && state !== 'stopped' && state !== 'error')) invalid();
    ids.add(id);
    if (role === 'user') earlierAnswers.clear();
    const message: Message = { id, role, content };
    if (state !== undefined) message.state = state;
    if (item.images !== undefined) {
      if (!Array.isArray(item.images) || item.images.length > MAX_ATTACHMENTS) invalid();
      message.images = item.images.map(attachment);
      if (new Set(message.images.map(image => image.id)).size !== message.images.length) invalid();
    }
    if (item.recovery !== undefined) {
      const { kind, from } = record(item.recovery);
      if (role !== 'assistant' || (kind !== 'retry' && kind !== 'continue') || typeof from !== 'string' || !earlierAnswers.has(from)) invalid();
      message.recovery = { kind, from };
    }
    if (role === 'assistant') earlierAnswers.add(id);
    return message;
  });
  return { id: identifier(input.id), title, updated, pinned: Boolean(pinned), messages };
}

export async function readBackup(file: Blob): Promise<NotebookBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 64 MiB，当前设备无法导入。');
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); }
  catch { throw new Error('无法读取备份文件，请选择完整的墨算 .mosuan.json 文件。'); }
  const data = record(decoded);
  if (data.format !== format) throw new Error('这不是墨算的整库备份文件。');
  if (data.version !== 1) throw new Error('此备份版本不受支持，请使用生成备份的版本或更新的墨算。');
  if (typeof data.createdAt !== 'string' || data.createdAt.length > 40 || !Number.isFinite(Date.parse(data.createdAt))
    || !Array.isArray(data.notebooks) || !data.notebooks.length) invalid();
  const notebooks = data.notebooks.map(notebook);
  const ids = new Set(notebooks.map(book => book.id));
  const activeId = data.activeId === undefined ? undefined : identifier(data.activeId);
  if (ids.size !== notebooks.length || (activeId && !ids.has(activeId))) invalid();
  return { format, version: 1, createdAt: data.createdAt, activeId, notebooks };
}

export async function createBackup(books: Notebook[], activeId: string) {
  const header = JSON.stringify({ format, version: 1, createdAt: new Date().toISOString(), ...(books.some(book => book.id === activeId) && { activeId }) });
  const parts: BlobPart[] = [header.slice(0, -1), ',"notebooks":['];
  let bytes = 0;
  for (const [index, book] of books.entries()) {
    const entry = new Blob([JSON.stringify(notebook(book))]);
    bytes += entry.size + 1;
    if (bytes > MAX_BACKUP_BYTES) throw new Error('整库备份超过 64 MiB。请先单篇导出需要单独留存的大笔记。');
    if (parts.length > 2) parts.push(',');
    parts.push(entry);
    // Give mobile time to paint feedback between large conversations.
    if (index % 8 === 7 || entry.size > 1_000_000) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const blob = new Blob([...parts, ']}'], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('整库备份超过 64 MiB。');
  return blob;
}

function sameContent(book: Notebook, incoming: Notebook, title = incoming.title) {
  if (book.title !== title || Boolean(book.pinned) !== Boolean(incoming.pinned) || book.messages.length !== incoming.messages.length) return false;
  return book.messages.every((message, index) => {
    const next = incoming.messages[index];
    const images = message.images || [], otherImages = next.images || [];
    return message.id === next.id && message.role === next.role && message.content === next.content && message.state === next.state
      && message.recovery?.kind === next.recovery?.kind && message.recovery?.from === next.recovery?.from
      && images.length === otherImages.length && images.every((image, i) => {
        const other = otherImages[i];
        return image.id === other.id && image.name === other.name && image.width === other.width && image.height === other.height && image.dataUrl === other.dataUrl;
      });
  });
}

// Compute against the live IndexedDB records in the same write transaction.
export function planRestore(current: Notebook[], backup: NotebookBackup) {
  const byId = new Map(current.map(book => [book.id, book]));
  const reservedIds = new Set(backup.notebooks.map(book => book.id));
  const added: Notebook[] = [];
  let skipped = 0, copies = 0, openId: string | undefined;
  for (const book of backup.notebooks) {
    const existing = byId.get(book.id);
    const copyTitle = book.title.slice(0, 70) + '（备份副本）';
    const same = existing && (sameContent(existing, book) ? existing : current.find(other => sameContent(other, book, copyTitle)));
    let id = book.id;
    if (same) {
      skipped++;
      id = same.id;
    } else {
      if (existing) {
        do { id = newId(); } while (byId.has(id) || reservedIds.has(id));
        copies++;
      }
      const restored = { ...book, id, title: existing ? copyTitle : book.title, revision: 1 };
      added.push(restored);
      byId.set(id, restored);
    }
    if (backup.activeId === book.id) openId = id;
  }
  return { added, skipped, copies, openId: openId || added[0]?.id };
}
