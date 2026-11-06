import type { Attachment } from './attachments';
import { isAndroidApp, NativeFiles } from './mobile';
import { planRestore, type NotebookBackup } from './backup';
import { newId } from './id';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  state?: 'complete' | 'stopped' | 'error';
  images?: Attachment[];
  recovery?: { kind: 'retry' | 'continue'; from: string };
}
export interface Notebook { id: string; title: string; updated: number; messages: Message[]; pinned?: boolean; revision?: number }
export class NotebookConflict extends Error { constructor() { super('对话已被其他页面修改或删除'); } }
const changeKey = 'mosuan-notebooks-change';
const writer = newId();
function announce(id: string) {
  try { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel(changeKey); channel.postMessage({ id, writer }); channel.close(); return; } } catch { /* Use the storage/focus fallback when channels are blocked. */ }
  try { localStorage.setItem(changeKey, JSON.stringify([id, Date.now(), Math.random()])); } catch { /* Focus refresh remains available. */ }
}
export function watchNotebooks(changed: (id?: string) => void) {
  let channel: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(changeKey); } catch { /* Storage/focus listeners below still refresh. */ }
  if (channel) channel.onmessage = ({ data }) => {
    if (typeof data === 'string') changed(data);
    else if (data?.writer !== writer && typeof data?.id === 'string') changed(data.id);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== changeKey) return;
    let id: string | undefined;
    try { id = JSON.parse(event.newValue || '[]')[0]; } catch { /* Refresh if a legacy event cannot be read. */ }
    changed(id);
  };
  const focused = () => changed();
  const visible = () => { if (document.visibilityState === 'visible') changed(); };
  window.addEventListener('storage', storage); window.addEventListener('focus', focused); document.addEventListener('visibilitychange', visible);
  return () => { channel?.close(); window.removeEventListener('storage', storage); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', visible); };
}
export function sortNotebooks(books: Notebook[]): Notebook[] {
  return [...books].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated - a.updated);
}
const DB_NAME = 'mosuan-reader';
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('notebooks', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function loadNotebooks(): Promise<Notebook[]> {
  const db = await openDB();
  try { return await new Promise((resolve, reject) => {
    const req = db.transaction('notebooks').objectStore('notebooks').getAll();
    req.onsuccess = () => resolve(sortNotebooks(req.result as Notebook[]));
    req.onerror = () => reject(req.error);
  }); } finally { db.close(); }
}
export async function saveNotebook(book: Notebook, create = false): Promise<Notebook> {
  const db = await openDB();
  try { const saved = await new Promise<Notebook>((resolve, reject) => {
    const tx = db.transaction('notebooks', 'readwrite');
    const store = tx.objectStore('notebooks'); const request = store.get(book.id);
    let result: Notebook; let conflict = false;
    request.onsuccess = () => {
      const previous = request.result as Notebook | undefined;
      if (create ? Boolean(previous) : !previous || (previous.revision || 0) !== (book.revision || 0)) { conflict = true; tx.abort(); return; }
      result = { ...book, revision: (previous?.revision || 0) + 1 }; store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(conflict ? new NotebookConflict() : tx.error);
  }); announce(book.id); return saved; } finally { db.close(); }
}
export async function deleteNotebook(id: string, replacement?: Notebook, revision = 0): Promise<void> {
  const db = await openDB();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notebooks', 'readwrite');
    const store = tx.objectStore('notebooks');
    let conflict = false;
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || (request.result.revision || 0) !== revision) { conflict = true; tx.abort(); return; }
      store.delete(id);
      if (replacement) store.add({ ...replacement, revision: 1 });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(conflict ? new NotebookConflict() : tx.error);
  }); announce(id); } finally { db.close(); }
}

export async function restoreNotebooks(backup: NotebookBackup) {
  const db = await openDB();
  try {
    const result = await new Promise<ReturnType<typeof planRestore>>((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks');
      const request = store.getAll();
      let plan: ReturnType<typeof planRestore>;
      let error: unknown;
      request.onsuccess = () => {
        try {
          plan = planRestore(request.result as Notebook[], backup);
          for (const book of plan.added) store.add(book);
        } catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => resolve(plan);
      tx.onabort = () => reject(error || tx.error || new Error('恢复未完成'));
    });
    if (result.added.length) announce('restore');
    return result;
  } finally { db.close(); }
}

export function downloadLocalFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadText(name: string, text: string) {
  if (isAndroidApp()) { return !(await NativeFiles.saveText({ filename: name, text })).cancelled; }
  downloadLocalFile(name, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  return true;
}
