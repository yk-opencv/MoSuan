import { LocaleProvider, useLocale } from './lib/locale';
import { LanguageSettings } from './components/LanguageSettings';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronRight, Code2, Download, FilePlus2, FileText, FlaskConical, FolderOpen, Menu, MessageSquare, MoreHorizontal, Pin, PinOff, Plus, Plug, Search, Share2, Sparkles, Square, Trash2, Type, Upload, X } from 'lucide-react';
import 'katex/dist/katex.min.css';
import './style.css';
import { renderBlock, type Block, type MathEngine } from './lib/markdown';
import { loadNotebooks, saveNotebook, deleteNotebook, restoreNotebooks, sortNotebooks, downloadText, watchNotebooks, NotebookConflict, type Notebook, type Message } from './lib/storage';
import { readEvents } from './lib/sse';
import { demoBook, stressBook } from './demo';
import { newId } from './lib/id';
import { ShareDialog } from './components/ShareDialog';
import { conversationDocument } from './lib/sharing';
import { useBackground } from './hooks/useBackground';
import { BackgroundSettings } from './components/BackgroundSettings';
import { useReadingColor } from './hooks/useReadingColor';
import { SettingsMenu, type SettingsCategory } from './components/SettingsMenu';
import { useLayout } from './hooks/useLayout';
import { LayoutControls } from './components/LayoutControls';
import { SidebarDivider } from './components/SidebarDivider';
import { useMathEngine } from './hooks/useMathEngine';
import { MathEngineSettings } from './components/MathEngineSettings';
import { useReaderPreferences, rememberedBook, rememberBook } from './hooks/useReaderPreferences';
import { useReadingPosition, type ReadingJump } from './hooks/useReadingPosition';
import { useDocumentBlocks } from './hooks/useDocumentBlocks';
import { apiFetch, isAndroidApp, mobileMode } from './lib/mobile';
import { MobileConnection } from './components/MobileConnection';
import { prepareAttachment, MAX_ATTACHMENTS, type Attachment } from './lib/attachments';
import { ImagePlus } from 'lucide-react';
import { App as NativeApp } from '@capacitor/app';
import { ExportDialog } from './components/ExportDialog';
import { ChevronDown } from 'lucide-react';
import { decodeImport, importEncodingMessage, importEncodings, type ImportEncoding } from './lib/textImport';
import { ImportSourceEditor } from './components/ImportSourceEditor';
import { NotebookSearch } from './components/NotebookSearch';
import { UsageGuide } from './components/UsageGuide';
import { BackupSettings } from './components/BackupSettings';
import type { NotebookBackup } from './lib/backup';
import { CHAT_CHARACTER_LIMIT, chatMessages, continuationQuestion, incomplete, receivedText, recoveryTarget } from './lib/chatRecovery';
import { blockAtSourceOffset } from './lib/markdownChunks';
import type { SearchHit } from './lib/search';
import { version } from '../package.json';

interface Row { key: string; block?: Block; message: Message; heading?: boolean; recovery?: boolean }
interface ChatRun {
  book: Notebook;
  responseId: string;
  controller: AbortController;
  answer: string;
  queuedAnswer?: string;
  checkpointPending?: boolean;
  checkpointAgain?: boolean;
}
interface PendingNotebook {
  snapshot: Notebook;
  answerIds: Set<string>;
}
function chatSnapshot(run: ChatRun, state?: Message['state']): Notebook {
  return {
    ...run.book,
    messages: run.book.messages.map(message => message.id === run.responseId ? { ...message, content: run.answer, state } : message),
  };
}
const modalLabels = { import: '导入学习笔记', search: '搜索笔记', source: 'Markdown 原文', appearance: '字体与外观', connection: 'API 与连接', backup: '备份与恢复', guide: '使用说明', language: '语言' } as const;
const importLimit = 5_000_000;
function importProblem(text: string) {
  if (text.length > importLimit) return '单份笔记最多支持 500 万字符，请拆分导入。';
  if (!text.trim()) return '没有可导入的内容，请粘贴原文或选择其他文件。';
  return '';
}
function importedNote(text: string, title: string, fallback: string): Notebook {
  const name = title.trim() || /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/m.exec(text)?.[1]?.trim() || fallback;
  return { id: newId(), title: name.slice(0, 80), updated: Date.now(), messages: [{ id: newId(), role: 'assistant', content: text }] };
}
const FormulaBlock = memo(function FormulaBlock({ block, engine }: { block: Block; engine: MathEngine }) {
  const { language } = useLocale();
  const html = renderBlock(block, engine, language);
  const content = useMemo(() => ({ __html: html }), [html]);
  return <div className="prose" dangerouslySetInnerHTML={content} />;
});
function App() {
  const { t, language } = useLocale();
  const layout = useLayout();
  const android = isAndroidApp();
  const renderer = useMathEngine();
  const appearance = useBackground();
  const readingColor = useReadingColor();
  const [books, setBooks] = useState<Notebook[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saving');
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const imageLock = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const [viewImage, setViewImage] = useState<Attachment | null>(null);
  const [supportsImages, setSupportsImages] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<keyof typeof modalLabels | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [readingJump, setReadingJump] = useState<ReadingJump>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const importBytes = useRef<Uint8Array | null>(null);
  const importReadVersion = useRef(0);
  const [importEncoding, setImportEncoding] = useState<ImportEncoding>('auto');
  const [importFileName, setImportFileName] = useState('');
  const [importInfo, setImportInfo] = useState('');
  const [importError, setImportError] = useState('');
  const [pendingImport, setPendingImport] = useState('');
  const importBusy = !!pendingImport;
  const [importPreview, setImportPreview] = useState(false);
  const [menu, setMenu] = useState(false);
  const [bookMenu, setBookMenu] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);
  const [shareBook, setShareBook] = useState<Notebook | null>(null);
  const [exportTarget, setExportTarget] = useState<Notebook | null>(null);
  const [sourceBook, setSourceBook] = useState<Notebook | null>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const modalElement = useRef<HTMLElement>(null);
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const notebookLock = useRef(false);
  const { rounds, setRounds, fontSize, setFontSize, feedback: preferenceFeedback } = useReaderPreferences();
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<'official' | 'deepseek-web' | 'phone-web'>('official');
  const [nativeMode, setNativeMode] = useState(mobileMode);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const statusVersion = useRef(0);
  const [model, setModel] = useState('deepseek-chat');
  const [streaming, setStreaming] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [context, setContext] = useState<{ characters: number; historyMessages: number }>();
  const [chatProgress, setChatProgress] = useState('');
  const [mountedCount, setMountedCount] = useState(0);
  const running = useRef<ChatRun | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const virtualContent = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const following = useRef(false);
  const persistence = useRef<Promise<unknown>>(Promise.resolve());
  const revisions = useRef(new Map<string, number>());
  const dirty = useRef(new Map<string, PendingNotebook>());
  const conflicted = useRef(new Set<string>());
  const saveVersion = useRef(0);
  const active = books.find(b => b.id === activeId);
  const sortedBooks = useMemo(() => sortNotebooks(books), [books]);
  const nativeBack = useRef(() => {});
  const nativeBackground = useRef(false);
  const lastBack = useRef(0);
  nativeBack.current = () => {
    if (viewImage) { setViewImage(null); return; }
    if (shareBook) { setShareBook(null); return; }
    if (exportTarget) { setExportTarget(null); return; }
    if (deleteTarget) { setDeleteTarget(null); return; }
    if (modal) { closeModal(); return; }
    if (bookMenu || settingsOpen) { setBookMenu(null); setSettingsOpen(false); return; }
    if (menu) { setMenu(false); return; }
    if (Date.now() - lastBack.current < 1800) { void NativeApp.exitApp(); return; }
    lastBack.current = Date.now(); setNotice('再次按返回键退出墨算。');
  };
  useEffect(() => {
    if (!isAndroidApp()) return;
    const listener = NativeApp.addListener('backButton', () => nativeBack.current());
    const state = NativeApp.addListener('appStateChange', ({ isActive }) => {
      nativeBackground.current = !isActive;
      if (!isActive) window.dispatchEvent(new Event('pagehide'));
    });
    return () => { void listener.then(handle => handle.remove()); void state.then(handle => handle.remove()); };
  }, []);

  const refreshStatus = useCallback(() => {
    const version = ++statusVersion.current;
    if (isAndroidApp()) setNativeMode(mobileMode());
    setConnectionBusy(true);
    apiFetch('/api/status').then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || '服务连接失败'); return data; }).then(s => {
      if (version !== statusVersion.current) return;
      setConfigured(s.configured); setModel(s.model); setProvider(s.provider || 'official'); setConnectionMessage(s.message || ''); setSupportsImages(s.supportsImages === true);
    }).catch((error) => { if (version !== statusVersion.current) return; setConfigured(false); setSupportsImages(false); setConnectionMessage(isAndroidApp() ? error.message || '连接未完成，请检查当前连接方式。' : '无法连接墨算服务，请检查启动窗口。'); }).finally(() => { if (version === statusVersion.current) setConnectionBusy(false); });
  }, []);
  async function chooseConnection(next: 'official' | 'deepseek-web') {
    if (streaming || connectionBusy) return;
    setConnectionBusy(true);
    try {
      const res = await apiFetch('/api/connection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: next }) });
      const s = await res.json();
      if (!res.ok) throw new Error(s.error || '切换失败');
      setProvider(s.provider); setConfigured(s.configured); setModel(s.model); setConnectionMessage(s.message || ''); setSupportsImages(s.supportsImages === true); setUsage(null);
    } catch (err) { setNotice((err as Error).message); }
    finally { setConnectionBusy(false); }
  }
  useEffect(() => {
    let live = true;
    loadNotebooks().then(async items => {
      if (!live) return;
      const loaded = items.length ? items : [await saveNotebook(demoBook(), true)];
      if (!live) return;
      loaded.forEach(book => revisions.current.set(book.id, book.revision || 0));
      const remembered = rememberedBook();
      setBooks(loaded); setActiveId(loaded.some(book => book.id === remembered) ? remembered : loaded[0].id); setReady(true); setSaveState('saved');
    }).catch(() => { if (live) { const b = demoBook(); setBooks([b]); setActiveId(b.id); setReady(true); setSaveState('error'); setNotice('本地数据库不可用，请及时导出备份。'); } });
    refreshStatus();
    return () => { live = false; running.current?.controller.abort(); };
  }, [refreshStatus]);

  const queueWrite = useCallback(<T,>(operation: () => Promise<T>) => {
    const version = ++saveVersion.current;
    setSaveState('saving');
    const work = persistence.current.catch(() => {}).then(operation);
    persistence.current = work;
    work.then(() => { if (version === saveVersion.current) setSaveState('saved'); }, () => {
      if (version === saveVersion.current) setSaveState('error');
    });
    return work;
  }, []);
  const persist = useCallback(async (snapshot: Notebook) => {
    try { await queueWrite(async () => {
      if (conflicted.current.has(snapshot.id)) return;
      try {
        const saved = await saveNotebook({ ...snapshot, revision: revisions.current.get(snapshot.id) ?? snapshot.revision });
        revisions.current.set(saved.id, saved.revision!);
        if (dirty.current.get(saved.id)?.snapshot === snapshot) dirty.current.delete(saved.id);
        setBooks(previous => previous.map(book => book.id === saved.id ? { ...book, revision: saved.revision } : book));
      } catch (error) {
        if (!(error instanceof NotebookConflict)) throw error;
        conflicted.current.add(snapshot.id);
        const run = running.current;
        const current = run?.book.id === snapshot.id ? chatSnapshot(run, 'stopped') : dirty.current.get(snapshot.id)?.snapshot || snapshot;
        if (run?.book.id === snapshot.id) run.controller.abort();
        const copy = await saveNotebook({ ...current, id: newId(), revision: undefined, updated: Date.now(), title: t('{0}（冲突副本）', current.title.slice(0, 65)) }, true);
        revisions.current.set(copy.id, copy.revision!);
        dirty.current.delete(snapshot.id);
        setBooks(previous => [copy, ...previous.filter(book => book.id !== snapshot.id)]); setActiveId(copy.id);
        setNotice('原对话已在其他页面修改或删除；本页未保存的内容已另存为“冲突副本”。');
      }
    }); return true; }
    catch { setNotice('保存失败，收到的内容仍在当前页面，请先备份或导出。'); return false; }
  }, [queueWrite]);
  const refreshBooks = useCallback(async () => {
    if (running.current || dirty.current.size) return;
    const items = await loadNotebooks();
    if (running.current || dirty.current.size || !items.length) return;
    items.forEach(book => revisions.current.set(book.id, book.revision || 0));
    setBooks(items);
    setActiveId(id => items.some(book => book.id === id) ? id : items[0].id);
    setSourceBook(book => book ? items.find(item => item.id === book.id) || null : null);
    setShareBook(book => book ? items.find(item => item.id === book.id) || null : null);
    setDeleteTarget(book => book ? items.find(item => item.id === book.id) || null : null);
  }, []);
  useEffect(() => { if (preferenceFeedback) setNotice(preferenceFeedback); }, [preferenceFeedback]);
  useEffect(() => { if (ready && activeId) rememberBook(activeId); }, [ready, activeId]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('.notebook-entry')) setBookMenu(null);
      if (!(event.target as Element).closest?.('.settings-entry')) setSettingsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setBookMenu(null); setSettingsOpen(false); if (!notebookLock.current) setDeleteTarget(null); }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    if (modal === 'search') modalElement.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    else if (modal) modalElement.current?.focus();
  }, [modal]);
  useEffect(() => { if (viewImage) document.querySelector<HTMLElement>('.image-dialog')?.focus(); }, [viewImage]);
  useEffect(() => { if (ready && !streaming) void persistence.current.catch(() => {}).then(refreshBooks).catch(() => {}); }, [streaming, ready, refreshBooks]);
  const checkpointChat: () => void = useCallback(() => {
    const run = running.current;
    if (!run || run.answer === run.queuedAnswer || conflicted.current.has(run.book.id)) return;
    if (run.checkpointPending) { run.checkpointAgain = true; return; }
    const received = run.answer;
    run.queuedAnswer = received;
    run.checkpointPending = true;
    void persist(chatSnapshot(run, 'stopped')).then(saved => {
      run.checkpointPending = false;
      if (!saved && run.queuedAnswer === received) run.queuedAnswer = undefined;
      if (run.checkpointAgain) {
        run.checkpointAgain = false;
        if (saved && running.current === run) checkpointChat();
      }
    });
  }, [persist]);
  useEffect(() => watchNotebooks(id => {
    void persistence.current.catch(() => {}).then(() => {
      const run = running.current;
      if (run && id === run.book.id) {
        run.queuedAnswer = undefined;
        checkpointChat();
        return;
      }
      return refreshBooks();
    }).catch(() => setNotice('其他页面的更新暂未同步，请刷新后重试。'));
  }), [checkpointChat, refreshBooks]);
  useEffect(() => {
    if (!streaming) return;
    const visibility = () => { if (document.hidden) checkpointChat(); };
    const timer = setInterval(checkpointChat, 1000);
    window.addEventListener('pagehide', checkpointChat);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', checkpointChat);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [streaming, checkpointChat]);

  const { entries: parsedMessages, parsing, blocksForSearch } = useDocumentBlocks(activeId, active?.messages);
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    let hasQuestion = false;
    for (const { message: m, blocks } of parsedMessages) {
      if (m.role === 'user') hasQuestion = !!m.content.trim();
      result.push({ key: m.id + ':header', message: m, heading: true });
      blocks.forEach((block, i) => result.push({ key: m.id + ':' + i, block, message: m }));
      if (hasQuestion && incomplete(m)) result.push({ key: m.id + ':recovery', message: m, recovery: true });
    }
    return result;
  }, [parsedMessages]);

  useLayoutEffect(() => {
    const element = cover.current;
    if (!element) return;
    const measure = () => {
      const padding = viewport.current ? parseFloat(getComputedStyle(viewport.current).paddingTop) || 0 : 0;
      setScrollMargin(padding + (element.hidden ? 0 : element.getBoundingClientRect().height + 18));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [layout.preferences.cover, layout.preferences.header, layout.preferences.toolbar]);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => viewport.current, estimateSize: i => rows[i]?.heading ? 58 : rows[i]?.recovery ? 72 : 230, overscan: layout.desktop ? 3 : 2, getItemKey: i => rows[i].key, scrollMargin });
  const visible = virtual.getVirtualItems();
  const rowKeys = useMemo(() => rows.map(row => row.key), [rows]);
  const activeJump = readingJump?.bookId === activeId ? readingJump : undefined;
  const { rememberPosition, cancelRestore } = useReadingPosition(activeId, ready, viewport, rowKeys, index => virtual.scrollToIndex(index, { align: 'start' }), `${renderer.engine}:${fontSize}`, activeJump, parsing);
  useEffect(() => setMountedCount(visible.length), [visible.length]);
  useLayoutEffect(() => {
    virtual.measure();
    // Rebuild the estimated layout before measuring: otherwise TanStack may
    // compare against the previous layout and skip unchanged item heights.
    virtual.getTotalSize();
    // Unchanged text blocks do not trigger ResizeObserver when only the math
    // engine changes. Refill their measured heights before the next paint.
    virtualContent.current?.querySelectorAll<HTMLElement>('.virtual-row').forEach(element => virtual.measureElement(element));
  }, [fontSize, activeId, renderer.engine]);
  useLayoutEffect(() => {
    const element = virtualContent.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!following.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    if (!streaming || !following.current) return;
    const frame = requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [rows, streaming]);

  function selectBook(id: string, jump?: ReadingJump) { if (streaming) return; rememberPosition(); following.current = false; setReadingJump(jump); setActiveId(id); setMenu(false); setBookMenu(null); setSettingsOpen(false); setUsage(null); setContext(undefined); setChatProgress(''); }
  function openNotebookTool(tool: 'search' | 'import', trigger: HTMLElement) {
    actionTrigger.current = trigger;
    setBookMenu(null); setSettingsOpen(false); setModal(tool);
  }
  function chooseSearchHit(hit: SearchHit) {
    if (running.current || notebookLock.current) return;
    const book = books.find(book => book.id === hit.bookId);
    if (!book) return;
    const jump: ReadingJump = { bookId: book.id };
    if (hit.location) {
      const { messageId, offset } = hit.location;
      const message = book.messages.find(m => m.id === messageId);
      if (!message || message.content.slice(offset, offset + hit.excerpt.match.length) !== hit.excerpt.match) {
        setNotice('这条笔记刚刚更新，请重新选择搜索结果。'); return;
      }
      const blocks = blocksForSearch(message);
      const index = blockAtSourceOffset(blocks, message.content, offset);
      jump.key = `${messageId}:${index < 0 ? 'header' : index}`;
    }
    setModal(null); selectBook(book.id, jump);
  }
  function openSettings(category: SettingsCategory) {
    const focused = document.activeElement;
    actionTrigger.current = focused instanceof HTMLElement && focused.closest('.composer') ? focused : document.querySelector('.settings-trigger');
    setSettingsOpen(false); setBookMenu(null); setModal(category);
  }
  function restoreActionFocus() { requestAnimationFrame(() => { if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); }); }
  function openBookAction(book: Notebook, action: 'share' | 'source') {
    actionTrigger.current = document.querySelector(`[data-book-id="${CSS.escape(book.id)}"] .notebook-more`);
    setBookMenu(null);
    if (action === 'share') setShareBook(book);
    else { setSourceBook(book); setModal('source'); }
  }
  function closeModal() {
    if (modal === 'backup' && backupBusy) return;
    if (modal === 'import') {
      if (notebookLock.current) return;
      importReadVersion.current++; setPendingImport('');
    }
    setModal(null); setSourceBook(null); restoreActionFocus();
  }
  async function applyBackup(backup: NotebookBackup) {
    if (notebookLock.current || running.current || !ready) throw new Error('请等待当前操作完成后再恢复。');
    notebookLock.current = true; setNotebookBusy(true);
    try {
      const result = await queueWrite(() => restoreNotebooks(backup));
      for (const book of result.added) revisions.current.set(book.id, book.revision!);
      const ids = new Set(result.added.map(book => book.id));
      if (ids.size) {
        setBooks(current => [...result.added, ...current.filter(book => !ids.has(book.id))]);
        if (result.openId) selectBook(result.openId);
      }
      return result;
    } catch { throw new Error('恢复失败，现有笔记已保留。请检查本机存储空间后重试。'); }
    finally { notebookLock.current = false; setNotebookBusy(false); }
  }
  async function addBook(book: Notebook, requireSave = false) {
    if (notebookLock.current || running.current || !ready) return false;
    notebookLock.current = true; setNotebookBusy(true);
    try {
      // Persist before switching so quick navigation cannot discard a new notebook.
      try {
        book = await queueWrite(() => saveNotebook(book, true));
        revisions.current.set(book.id, book.revision!);
      } catch {
        setNotice(requireSave ? '保存失败，导入内容仍保留在窗口中。请检查本机空间后重试。' : '笔记暂存于内存，保存失败，请导出备份。');
        if (requireSave) return false;
      }
      setBooks(prev => [book, ...prev.filter(item => item.id !== book.id)]); selectBook(book.id);
      return true;
    } finally { notebookLock.current = false; setNotebookBusy(false); }
  }
  function newBook() { void addBook({ id: newId(), title: t('新的学习对话'), updated: Date.now(), messages: [] }); }
  async function togglePinned(book: Notebook) {
    if (streaming || notebookLock.current) return;
    notebookLock.current = true; setNotebookBusy(true); setBookMenu(null);
    const pinned = !book.pinned;
    try {
      const saved = await queueWrite(() => saveNotebook({ ...book, pinned }));
      revisions.current.set(book.id, saved.revision!);
      setBooks(prev => prev.map(b => b.id === book.id ? { ...b, pinned, revision: saved.revision } : b));
    } catch { setNotice('置顶状态保存失败或对话已在其他页面变更，请重试。'); void refreshBooks(); }
    finally { notebookLock.current = false; setNotebookBusy(false); }
  }
  async function confirmDelete() {
    if (!deleteTarget || streaming || notebookLock.current) return;
    notebookLock.current = true; setNotebookBusy(true);
    const id = deleteTarget.id;
    const remaining = sortNotebooks(books.filter(b => b.id !== id));
    const replacement: Notebook | undefined = remaining.length ? undefined : { id: newId(), title: t('新的学习对话'), updated: Date.now(), messages: [] };
    try {
      // Queue after every pending snapshot so a late save cannot recreate a
      // deleted conversation. The last deletion and replacement are atomic.
      await queueWrite(() => deleteNotebook(id, replacement, deleteTarget.revision || 0));
      revisions.current.delete(id); dirty.current.delete(id);
      if (replacement) { replacement.revision = 1; revisions.current.set(replacement.id, 1); }
      setBooks(replacement ? [replacement] : remaining);
      if (activeId === id) selectBook((replacement || remaining[0]).id);
      setDeleteTarget(null); setBookMenu(null);
      setNotice('对话已从本机删除。');
    } catch { setNotice('删除失败，对话仍保留；如其他页面已更新，请重新确认。'); void refreshBooks(); }
    finally { notebookLock.current = false; setNotebookBusy(false); }
  }
  function finishImport() {
    setModal(null); setImportText(''); setImportTitle('');
    importBytes.current = null; setImportFileName(''); setImportInfo(''); setImportError(''); setImportEncoding('auto'); setImportPreview(false);
  }
  async function importBook() {
    if (importBusy || importError || notebookLock.current) return;
    const problem = importProblem(importText);
    if (problem) { setImportError(problem); return; }
    if (await addBook(importedNote(importText, importTitle, t('导入的学习笔记')), true)) finishImport();
  }
  function changeImportEncoding(encoding: ImportEncoding) {
    setImportEncoding(encoding);
    if (!importBytes.current) return;
    try {
      const result = decodeImport(importBytes.current, encoding);
      setImportText(result.text.length <= importLimit ? result.text : ''); setImportInfo(importEncodingMessage(result, t)); setImportError(importProblem(result.text));
    } catch (error) { setImportText(''); setImportInfo(''); setImportError((error as Error).message); }
  }
  async function importFile(file?: File) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file || modal !== 'import' || importBusy || running.current || notebookLock.current) return;
    if (file.size > 15_000_000) { setNotice('文件过大，请拆分后导入（最多 15 MB）。'); return; }
    const version = ++importReadVersion.current;
    setPendingImport(file.name || t('文件'));
    const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
    try {
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await file.arrayBuffer()); }
      catch { if (version === importReadVersion.current) setNotice('文件读取失败，请重新选择。'); return; }
      if (version !== importReadVersion.current) return;
      let result: ReturnType<typeof decodeImport> | undefined, decodeError = '';
      try { result = decodeImport(bytes); }
      catch (error) { decodeError = (error as Error).message; }
      const problem = result ? importProblem(result.text) : decodeError;
      if (result && !importPreview && !problem && !result.uncertain && !result.text.includes('\ufffd')) {
        if (await addBook(importedNote(result.text, title, t('导入的学习笔记')), true)) { finishImport(); return; }
      }
      importBytes.current = bytes; setImportFileName(file.name || t('所选文件')); setImportEncoding('auto'); setImportTitle(title);
      setImportText(result && result.text.length <= importLimit ? result.text : '');
      setImportInfo(result ? importEncodingMessage(result, t) : ''); setImportError(problem);
    } finally { if (version === importReadVersion.current) setPendingImport(''); }
  }
  async function chooseImages(files: File[]) {
    if (streaming || imageLock.current) return;
    const available = MAX_ATTACHMENTS - images.length;
    if (files.length > available) setNotice(t('每条问题最多 {0} 张图片，超出的图片未添加。', MAX_ATTACHMENTS));
    imageLock.current = true; setImageBusy(true);
    try { for (const file of files.slice(0, available)) {
      try { const prepared = await prepareAttachment(file); setImages(previous => [...previous, prepared]); }
      catch (error) { setNotice((error as Error).message || '图片添加失败'); }
    } } finally { imageLock.current = false; setImageBusy(false); if (imageInput.current) imageInput.current.value = ''; }
  }
  function showChatSnapshot(snapshot: Notebook) {
    if (conflicted.current.has(snapshot.id)) return;
    setBooks(current => current.map(book => book.id === snapshot.id ? { ...snapshot, revision: book.revision } : book));
  }
  async function send(recovery?: { kind: 'retry' | 'continue'; answerId: string }) {
    if (!active || running.current || imageLock.current || notebookLock.current) return;
    const target = recovery ? recoveryTarget(active.messages, recovery.answerId) : undefined;
    if (recovery ? !target : !draft.trim() && !images.length) return;
    if (!configured) { openSettings('connection'); return; }
    const pictures = target ? target.question.images || [] : images;
    if (pictures.length && !supportsImages) { setNotice('当前连接未提供图片能力。请在“API 与连接”中登录手机网页直连，或选择支持图片的网页版代理，再刷新状态。'); return; }
    const question: Message = target?.question ?? {
      id: newId(), role: 'user', content: draft.trim() || t('请分析图片中的题目，给出详细解答。'), ...(pictures.length ? { images: pictures } : {}),
    };
    let text = question.content;
    if (recovery?.kind === 'continue' && target) {
      try { text = continuationQuestion(target); }
      catch (error) { setNotice((error as Error).message); return; }
    }
    if (text.length > CHAT_CHARACTER_LIMIT) { setNotice('当前问题最多 24000 字符，请缩短后发送。'); return; }
    const input = chatMessages(target?.history ?? active.messages, { role: 'user', content: text, images: pictures }, rounds);
    const response: Message = {
      id: newId(), role: 'assistant', content: '',
      ...(target && recovery && { recovery: { kind: recovery.kind, from: target.answer.id } }),
    };
    const end = target?.end ?? active.messages.length;
    const book: Notebook = {
      ...active, updated: Date.now(), title: active.messages.length ? active.title : question.content.slice(0, 24),
      messages: [...active.messages.slice(0, end), ...(target ? [] : [question]), response, ...active.messages.slice(end)],
    };
    const run: ChatRun = { book, responseId: response.id, controller: new AbortController(), answer: '' };
    running.current = run;
    if (!target) { setDraft(''); setImages([]); }
    setUsage(null); setNotice(''); setStreaming(true);
    following.current = end === active.messages.length;
    if (!following.current) setReadingJump({ bookId: book.id, key: response.id + ':header' });
    showChatSnapshot(book);
    checkpointChat();

    let finish = '', status: Message['state'] = 'complete';
    let lastPaint = -Infinity, paintTimer: number | undefined;
    const paint = () => {
      paintTimer = undefined;
      lastPaint = performance.now();
      showChatSnapshot(chatSnapshot(run));
    };
    const schedulePaint = () => {
      if (paintTimer !== undefined) return;
      const wait = 100 - (performance.now() - lastPaint);
      if (wait <= 0) paint();
      else paintTimer = window.setTimeout(paint, wait);
    };
    try {
      const res = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: run.controller.signal, body: JSON.stringify({ messages: input, rounds }) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || t('请求失败 {0}', res.status)); }
      if (!res.body) throw new Error('浏览器未提供可读数据流');
      await readEvents(res.body, event => {
        if (event.error) throw new Error(typeof event.error === 'string' ? event.error : String((event.error as { message?: string }).message || '上游响应异常，收到的内容已保留。'));
        if (event.context) { setContext(event.context as { characters: number; historyMessages: number }); setChatProgress(''); }
        if (typeof event.progress === 'string') setChatProgress(event.progress);
        if (event.usage) setUsage((event.usage as { total_tokens: number }).total_tokens);
        const choice = (event.choices as { delta?: { content?: string }; finish_reason?: string }[] | undefined)?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const next = (typeof event.answerSnapshot === 'string' ? event.answerSnapshot : run.answer) + (choice?.delta?.content || '');
        if (next !== run.answer) {
          run.answer = next;
          if (nativeBackground.current || document.hidden) checkpointChat();
          schedulePaint();
        }
      });
      if (!finish) throw new Error('连接提前结束。可以在回答下方重试或继续。');
      if (!run.answer.trim()) throw new Error('模型返回了空内容，请重试。');
      if (finish === 'length') { status = 'stopped'; setNotice('本次输出达到长度限制。可在回答下方点「从这里继续」。'); }
      if (finish === 'user_return') { status = 'stopped'; setNotice('已带回网页内容，回答已标记为未完成。'); }
    } catch (err) {
      status = run.controller.signal.aborted ? 'stopped' : 'error';
      setNotice(run.controller.signal.aborted ? '已停止生成，收到的内容仍可查看。' : (err as Error).message);
      if (!target && !run.answer.trim()) { setDraft(question.content); setImages(pictures); }
    } finally {
      window.clearTimeout(paintTimer);
      if (!conflicted.current.has(book.id)) {
        const final = chatSnapshot(run, status);
        const answerIds = new Set(dirty.current.get(book.id)?.answerIds);
        answerIds.add(run.responseId);
        dirty.current.set(book.id, { snapshot: final, answerIds });
        showChatSnapshot(final);
        void persist(final);
      }
      running.current = null; setStreaming(false);
      setChatProgress('');
    }
  }

  const characters = active?.messages.reduce((sum, m) => sum + m.content.length, 0) || 0;
  const currentUnsaved = dirty.current.has(activeId);
  const saveLabel = streaming ? '接收中' : saveState === 'saving' ? '保存中' : currentUnsaved || saveState === 'error' ? '保存失败' : '已保存到本机';
  function recoveryStatus(message: Message) {
    if (dirty.current.get(activeId)?.answerIds.has(message.id)) {
      return t(saveState === 'saving' ? '正在保存本次回答…' : '最新内容未全部保存，仍可在当前页面查看。');
    }
    const length = receivedText(message).length;
    return length ? t('本机已保存 {0} 字符', length.toLocaleString(language)) : t('本机已保存问题，暂未收到正文。');
  }
  async function exportBook(book: Notebook) { const doc = conversationDocument(book); try { await downloadText(doc.filename, doc.text); } catch { setNotice('导出未完成，请重新选择保存位置后重试。'); } }
  const exportMarkdown = () => { if (active) exportBook(active); };
  return <div className={`app-shell ${appearance.url ? 'custom-background' : ''} ${layout.preferences.sidebar ? '' : 'layout-hide-sidebar'} ${layout.preferences.header ? '' : 'layout-hide-header'} ${layout.preferences.scrollbars ? '' : 'layout-hide-scrollbars'}`} data-reading-color={readingColor.color} style={{ '--sidebar-width': `${layout.width}px` } as React.CSSProperties}>
    {appearance.url && <div className="app-background" aria-hidden="true" style={{ backgroundImage: `url("${appearance.url}")`, ...appearance.imageStyle }} />}
    {menu && <div className="sidebar-shade" onClick={() => setMenu(false)} />}
    <aside id="conversation-sidebar" className={`sidebar ${menu ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark">∑</span><span>{t('墨算')}<small>MOSUAN / READER</small></span></a>
      <button className="new-note" onClick={newBook} disabled={!ready || streaming || notebookBusy}><Plus size={18} />{t(' 新的学习对话 ')}<span>↗</span></button>
      <div className="nav-caption">{t('工作空间')}</div>
      <button className="nav-item selected" onClick={() => setMenu(false)}><BookOpen size={18} />{t(' 我的笔记 ')}<span>{books.length.toString().padStart(2, '0')}</span></button>
      <button className="nav-item" disabled={!ready || streaming || notebookBusy} onClick={event => openNotebookTool('import', event.currentTarget)}><FolderOpen size={18} />{t(' 导入文本')}</button>
      <button className="nav-item search-nav" disabled={!ready || streaming || notebookBusy} onClick={event => openNotebookTool('search', event.currentTarget)}><Search size={18} />{t(' 搜索笔记')}</button>
      <div className="nav-caption notes-caption">{t('最近阅读 ')}<span>{t('本机保存')}</span></div>
      <div className="notebook-list">{sortedBooks.map(book => <div key={book.id} data-book-id={book.id} className={`notebook-entry ${book.id === activeId ? 'active' : ''}`}>
        <div className="notebook-main"><button disabled={streaming || notebookBusy} className={`notebook ${book.id === activeId ? 'active' : ''}`} onClick={() => selectBook(book.id)}>{book.pinned ? <Pin size={16} /> : <FileText size={16} />}<span>{book.title}<small>{book.pinned ? t('置顶 · ') : ''}{new Date(book.updated).toLocaleDateString(language, { month: '2-digit', day: '2-digit' })} · {book.messages.length}{t(' 条内容')}</small></span></button>
        <button className="notebook-more" aria-label={t('对话操作：{0}', book.title)} aria-expanded={bookMenu === book.id} aria-haspopup="menu" disabled={streaming || notebookBusy} onClick={() => setBookMenu(prev => prev === book.id ? null : book.id)}><MoreHorizontal size={18} /></button></div>
        {bookMenu === book.id && <div className="notebook-actions" role="menu" aria-label={t('管理对话：{0}', book.title)}><button role="menuitem" disabled={!book.messages.length} onClick={() => openBookAction(book, 'share')}><Share2 size={14} />{t('分享对话')}</button><button role="menuitem" onClick={() => openBookAction(book, 'source')}><Code2 size={14} />{t('查看原文')}</button><button role="menuitem" onClick={() => void togglePinned(book)}>{book.pinned ? <PinOff size={14} /> : <Pin size={14} />}{book.pinned ? t('取消置顶') : t('置顶对话')}</button><button role="menuitem" className="delete-action" onClick={() => { setBookMenu(null); setDeleteTarget(book); }}><Trash2 size={14} />{t('删除对话')}</button></div>}
      </div>)}</div>
      <div className="sidebar-bottom"><div className="local-card"><span className="status-dot" /><strong>{t('专注于推导本身')}</strong><p>{t('让长对话，也能轻松阅读。')}<br />{android ? t('笔记存储于此 App。') : t('笔记存储于当前浏览器。')}</p></div><SettingsMenu open={settingsOpen} showGuide={android || !layout.desktop} onToggle={() => { setBookMenu(null); setSettingsOpen(value => !value); }} onChoose={openSettings} /><div className="sidebar-foot">{t('墨算 ')}<span>{t('本地版 · v')}{version}</span></div></div>
    </aside>
    {layout.desktop && layout.preferences.sidebar && <SidebarDivider layout={layout} />}
    <main id="reading-workspace" className="workspace">
      <LayoutControls layout={layout} />
      {!layout.preferences.header && <button className="icon-button floating-mobile-menu" aria-label={t('打开菜单')} onClick={() => setMenu(true)}><Menu size={20} /></button>}
      <header className="topbar" hidden={!layout.preferences.header}><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={t('打开菜单')} onClick={() => setMenu(true)}><Menu size={20} /></button><BookOpen size={16} /><span>{t('我的笔记')}</span><ChevronRight size={14} /><strong>{active?.title || t('正在加载')}</strong></div><div className="top-actions"><span className="save-status"><Check size={14} />{t(saveLabel)}</span><div className="export-controls"><button className="button subtle export" aria-label={t('导出 Markdown')} onClick={exportMarkdown} disabled={!active || streaming}><Download size={16} /><span>{t('导出 Markdown')}</span></button><button className="button subtle export-formats" aria-label={t('选择导出格式')} title={t('导出 PDF / Word')} disabled={!active || streaming} onClick={() => { if (active) setExportTarget(active); }}><ChevronDown size={16} /><span>PDF / Word</span></button></div></div></header>
      <div className="reader-toolbar" hidden={!layout.preferences.toolbar}><div className="reader-tabs"><button className="tab active"><BookOpen size={15} />{t(' 阅读')}</button></div><div className="reader-controls"><span className="block-badge">{t('按需渲染')}</span></div></div>
      <div className={`reader-scroll ${!layout.preferences.header && !layout.preferences.toolbar && !layout.preferences.cover ? 'minimal-reader' : ''}`} ref={viewport} tabIndex={-1} data-reading-book-id={activeId} onWheel={e => { if (e.deltaY < 0) following.current = false; }} onTouchStart={() => { following.current = false; }} style={{ '--reader-font': `${fontSize}px` } as React.CSSProperties}>
        <div className="document-cover" ref={cover} hidden={!layout.preferences.cover}><div className="eyebrow"><span /> LEARNING NOTE <span className="cover-number">{String(books.findIndex(b => b.id === activeId) + 1).padStart(2, '0')}</span></div><h1>{active?.title || t('准备你的学习空间')}</h1><div className="document-meta"><span><FileText size={14} />{characters.toLocaleString(language)}{t(' 字符')}</span><i /> <span>{parsing ? t('正在解析长文…') : t('{0} 个阅读块', rows.length)}</span><i /><span>Markdown + LaTeX</span></div></div>
        {!ready && <div className="empty-state">{t('正在读取本地笔记…')}</div>}
        {ready && !rows.length && <div className="empty-state"><span className="empty-symbol">∫</span><h2>{t('从一个问题开始')}</h2><p>{t('粘贴一段推导，或连接 DeepSeek 开始学习。')}</p><button className="button" onClick={event => openNotebookTool('import', event.currentTarget)}><Upload size={16} />{t(' 导入已有内容')}</button></div>}
        <div className="virtual-document" ref={virtualContent} data-testid="virtual-document" style={{ height: virtual.getTotalSize() }}>
          {visible.map(item => { const row = rows[item.index]; return <div key={item.key} data-index={item.index} data-row-key={row.key} data-search-hit={activeJump?.key === row.key ? true : undefined} ref={virtual.measureElement} className={`virtual-row ${row.message.role}`} style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
            {row.heading ? <div className="message-heading"><span className={row.message.role === 'user' ? 'user-avatar' : 'assistant-avatar'}>{row.message.role === 'user' ? <MessageSquare size={14} /> : '∑'}</span><strong>{row.message.role === 'user' ? t('我的问题') : row.message.recovery?.kind === 'continue' ? t('续写回答') : row.message.recovery ? t('重试回答') : t('墨算笔记')}</strong><span>{row.message.role === 'user' ? 'QUESTION' : 'EXPLANATION'}</span>{incomplete(row.message) && <small>{row.message.state === 'stopped' ? t('输出未完成') : t('连接异常')}</small>}</div> : row.recovery ? <div className="response-recovery">
              <p>{recoveryStatus(row.message)}</p>
              <div>
                <button type="button" className="button subtle" disabled={streaming || notebookBusy || imageBusy} onClick={() => void send({ kind: 'retry', answerId: row.message.id })}>{t('重试')}</button>
                {!!receivedText(row.message).trim() && <button type="button" className="button subtle" disabled={streaming || notebookBusy || imageBusy} onClick={() => void send({ kind: 'continue', answerId: row.message.id })}>{t('从这里继续')}</button>}
              </div>
            </div> : <FormulaBlock block={row.block!} engine={renderer.engine} />}
            {row.heading && !!row.message.images?.length && <div className="message-images">{row.message.images.map(image => <button key={image.id} aria-label={t('查看图片：{0}', image.name)} onClick={() => setViewImage(image)}><img src={image.dataUrl} alt={image.name} loading="lazy" /></button>)}</div>}
          </div>; })}
        </div>
        {!!rows.length && <div className="reading-end"><span /> {streaming ? t('正在写下新的思路…') : parsing ? t('正在解析长文…') : t('思考不停，阅读不止。')} <span /></div>}
      </div>
      <div className="composer-region"><div className="jump-actions" hidden={!layout.preferences.jumps}><button aria-label={t('回到顶部')} title={t('回到顶部')} onClick={() => { cancelRestore(); following.current = false; viewport.current?.scrollTo({ top: 0 }); rememberPosition(); }}><ArrowUp size={16} /></button><button aria-label={t('跳到末尾')} title={t('跳到末尾')} onClick={() => { cancelRestore(); following.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}><ArrowDown size={16} /></button></div>
        <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void chooseImages(Array.from(event.dataTransfer.files)); } }}>
          {!!images.length && <div className="attachment-previews" aria-label={t('待发送图片')}>{images.map(image => <div className="attachment-preview" key={image.id}><button type="button" className="image-open" aria-label={t('查看图片：{0}', image.name)} onClick={() => setViewImage(image)}><img src={image.dataUrl} alt={image.name} /></button><button type="button" className="attachment-remove" aria-label={t('移除图片：{0}', image.name)} disabled={streaming || imageBusy} onClick={() => setImages(previous => previous.filter(item => item.id !== image.id))}><X size={13} /></button></div>)}</div>}
          {imageBusy && <p className="attachment-help" role="status">{t('正在处理图片…')}</p>}
          <textarea aria-label={t('输入问题')} placeholder={configured ? t('继续追问，让思路更进一步…') : t('输入问题，或先导入已有的数学对话…')} value={draft} onChange={event => setDraft(event.target.value)} disabled={streaming} onPaste={event => { const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => Boolean(file)); if (files.length) { event.preventDefault(); void chooseImages(files); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} rows={2} />
          <div className="composer-tools"><div>
            <button type="button" className="attach-button" aria-label={t('上传图片')} title={t('上传题目图片，最多 {0} 张，单张不超过 12 MB', MAX_ATTACHMENTS)} disabled={streaming || imageBusy || images.length >= MAX_ATTACHMENTS} onClick={() => imageInput.current?.click()}><ImagePlus size={18} /></button>
            <button type="button" className="composer-model" onClick={() => openSettings('connection')}><Sparkles size={14} />{provider === 'phone-web' ? t('手机网页直连') : provider === 'deepseek-web' ? t('网页版代理') : configured ? model : t('连接 DeepSeek')}<ChevronRight size={12} /></button>
            <span className="context-control">{t('最近 ')}<select aria-label={t('上下文轮数')} value={rounds} disabled={streaming} onChange={event => setRounds(Number(event.target.value))}>{[0, 2, 4, 8, 12].map(n => <option key={n} value={n}>{n}</option>)}</select>{t(' 轮')}</span>
          </div>{streaming ? <button type="button" className="send-button stop" aria-label={t('停止生成')} onClick={() => running.current?.controller.abort()}><Square size={17} fill="currentColor" /></button> : <button className="send-button" aria-label={t('发送问题')} disabled={(!draft.trim() && !images.length) || !ready || imageBusy || notebookBusy}><ArrowUp size={21} /></button>}</div>
        </form>
        <div className="composer-foot"><span><span className="status-dot" />{chatProgress ? t(chatProgress) : context ? t('本次发送 {0} 轮历史 · {1} 字符', context.historyMessages / 2, context.characters.toLocaleString(language)) : t('历史保留本机 · 仅发送选中的最近对话')}</span><span>{usage !== null ? `${provider === 'deepseek-web' ? t('代理统计') : t('API 返回')} ${usage.toLocaleString(language)} tokens` : t('视口 {0} / {1} 块', mountedCount, rows.length)}</span></div>
      </div>
    </main>
    {notice && <div className="notice" role="alert"><span>{t(notice)}</span><button aria-label={t('关闭提示')} onClick={() => setNotice('')}><X size={16} /></button></div>}
    <input type="file" ref={fileInput} className="hidden" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={e => void importFile(e.target.files?.[0])} />
    <input type="file" ref={imageInput} className="hidden" aria-label={t('选择题目图片')} accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={event => void chooseImages(Array.from(event.currentTarget.files || []))} />
    {viewImage && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setViewImage(null); }}><section className="modal image-dialog" role="dialog" aria-modal="true" aria-label={t('图片预览')} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') setViewImage(null); }}><button className="modal-close icon-button" aria-label={t('关闭图片预览')} onClick={() => setViewImage(null)}><X size={20} /></button><h2>{viewImage.name}</h2><img src={viewImage.dataUrl} alt={viewImage.name} /></section></div>}
    {shareBook && <ShareDialog book={shareBook} onClose={() => { setShareBook(null); restoreActionFocus(); }} />}
    {exportTarget && <ExportDialog book={exportTarget} onClose={() => setExportTarget(null)} />}
    {deleteTarget && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !notebookBusy) setDeleteTarget(null); }}><section className="modal delete-dialog" role="dialog" aria-modal="true" aria-label={t('删除对话确认')}><button className="modal-close icon-button" aria-label={t('关闭删除确认')} disabled={notebookBusy} onClick={() => setDeleteTarget(null)}><X size={20} /></button><div className="modal-icon"><Trash2 size={24} /></div><h2>{t('删除这段对话？')}</h2><p>{t('「{0}」及其中的内容将从此浏览器删除，无法恢复。需要保留时，请先导出 Markdown。此操作不会删除 DeepSeek 网页端的历史。', deleteTarget.title)}</p><div className="modal-buttons"><button className="button subtle" disabled={notebookBusy} onClick={() => setDeleteTarget(null)}>{t('取消')}</button><button className="button danger" disabled={notebookBusy} onClick={() => void confirmDelete()}>{notebookBusy ? t('正在删除…') : t('确认删除')}</button></div></section></div>}
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeModal(); }}><section ref={modalElement} tabIndex={-1} className={`modal ${modal === 'source' ? 'wide' : modal === 'search' ? 'search-dialog' : modal === 'import' ? 'import-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={t(modalLabels[modal])} onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); closeModal(); } }}><button className="modal-close icon-button" aria-label={t('关闭窗口')} disabled={(modal === 'import' && notebookBusy) || (modal === 'backup' && backupBusy)} onClick={closeModal}><X size={20} /></button>
      {modal === 'search' && <NotebookSearch books={sortedBooks} query={searchQuery} setQuery={setSearchQuery} choose={chooseSearchHit} />}
      {modal === 'import' && <>
        <div className="modal-icon"><FilePlus2 size={24} /></div><h2>{t('导入学习笔记')}</h2>
        <div className="import-fields"><div className="import-picker">
          <div><button className="button" disabled={importBusy || notebookBusy} onClick={() => fileInput.current?.click()}><Upload size={16} />{t('选择文件')}</button><label className="import-preview-toggle"><input type="checkbox" checked={importPreview} onChange={event => setImportPreview(event.target.checked)} disabled={importBusy || notebookBusy} />{t('导入前预览')}</label></div>
          {importBusy ? <p role="status">{t('正在导入「{0}」…', pendingImport)}</p> : <p>{t('支持 Markdown / TXT。能确认编码时直接打开，其他文件会先显示预览。')}</p>}
        </div>
        {!importBusy && importFileName && <div className="import-encoding">
          <p className="import-file-name">{importFileName}</p>
          <p role="status">{t(importInfo || '请检查文件编码。')}</p>
          <label>{t('文件编码')}<select value={importEncoding} onChange={e => changeImportEncoding(e.target.value as ImportEncoding)} disabled={notebookBusy || !importBytes.current}>{importEncodings.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        </div>}
        {!importBusy && importError && <p className="import-error" role="alert">{t(importError)}</p>}
        <ImportSourceEditor key={importReadVersion.current + ':' + importEncoding} value={importText} disabled={importBusy || notebookBusy} limit={importLimit} engine={renderer.engine} onChange={text => {
          setImportText(text);
          setImportError('');
          if (importFileName) setImportInfo('已手动编辑预览；导出使用 UTF-8。');
        }} />
        <label>{t('笔记标题（可选）')}<input value={importTitle} onChange={e => setImportTitle(e.target.value)} disabled={importBusy || notebookBusy} placeholder={t('留空时自动取标题')} maxLength={80} /></label></div>
        <div className="modal-buttons"><button className="button primary" disabled={importBusy || notebookBusy || !!importError || !importText.trim()} onClick={() => void importBook()}>{notebookBusy ? t('正在保存…') : t('导入并阅读')} <ArrowUpRight size={16} /></button></div>
      </>}
      {modal === 'source' && <><div className="modal-icon"><Code2 size={24} /></div><h2>{t('Markdown 原文')}</h2><p className="source-book-title">{sourceBook?.title}</p><p>{t('保留导入与模型返回的原始内容。需要调整公式时，可复制到「导入文本」生成新笔记。')}</p><textarea readOnly className="source-editor large" aria-label={t('Markdown 原文')} value={sourceBook?.messages.map(m => m.content).join('\n\n---\n\n') || ''} /><div className="modal-buttons"><span>{sourceBook?.messages.reduce((sum, message) => sum + message.content.length, 0).toLocaleString(language)}{t(' 字符')}</span><button className="button primary" disabled={!sourceBook} onClick={() => { if (sourceBook) exportBook(sourceBook); }}><Download size={16} />{t(' 导出原文')}</button></div></>}
      {(modal === 'appearance' || modal === 'connection' || modal === 'backup' || modal === 'guide' || modal === 'language') && <button className="settings-back" disabled={modal === 'backup' && backupBusy} onClick={() => { setModal(null); setMenu(true); setSettingsOpen(true); }}><ArrowLeft size={14} />{t('返回设置菜单')}</button>}
      {modal === 'backup' && <BackupSettings books={sortedBooks} activeId={activeId} disabled={!ready || streaming || notebookBusy} onBusy={setBackupBusy} restore={applyBackup} />}
      {modal === 'language' && <LanguageSettings />}
      {modal === 'guide' && <UsageGuide android={android} />}
      {modal === 'appearance' && <><div className="modal-icon"><Type size={24} /></div><h2>{t('字体与外观')}</h2><p>{t('调整阅读字号、字体颜色和背景图片。')}</p><MathEngineSettings renderer={renderer} /><BackgroundSettings appearance={appearance} readingColor={readingColor} fontSize={fontSize} onFontSizeChange={setFontSize} />
        <div className="settings-row"><span>{t('长文压力示例')}<small>{t('120 组数学推导，验证按需渲染')}</small></span><button className="button" disabled={streaming} onClick={() => { void addBook(stressBook()); setModal(null); }}><FlaskConical size={16} />{t('加载示例')}</button></div></>}
      {modal === 'connection' && <><div className="modal-icon"><Plug size={24} /></div><h2>{t('API 与连接')}</h2><p>{t('选择对话服务并检查连接状态。')}</p><MobileConnection changed={refreshStatus} disabled={streaming} />
        {(!isAndroidApp() || nativeMode === 'computer') && <div className="connection-choices" role="group" aria-label={t('连接方式')}>
          <button className={provider === 'official' ? 'chosen' : ''} aria-pressed={provider === 'official'} disabled={streaming || connectionBusy} onClick={() => void chooseConnection('official')}><strong>{t('官方 API')}</strong><small>{t('使用 API Key · 按量计费')}</small></button>
          <button className={provider === 'deepseek-web' ? 'chosen' : ''} aria-pressed={provider === 'deepseek-web'} disabled={streaming || connectionBusy} onClick={() => void chooseConnection('deepseek-web')}><strong>{t('网页版代理')}</strong><small>{t('使用个人网页登录 · 实验功能')}</small></button>
        </div>}
        <div className="connection-status"><span className={`status-dot ${configured ? '' : 'muted'}`} /><strong>{connectionBusy ? t('检查连接中…') : provider === 'phone-web' ? configured ? t('手机网页登录已保存') : t('请先在手机登录') : provider === 'deepseek-web' ? configured ? t('网页版代理已就绪') : t('网页版代理尚未就绪') : configured ? t('DeepSeek 已配置') : t('DeepSeek 尚未配置')}</strong><button disabled={connectionBusy || streaming} onClick={refreshStatus}>{t('刷新状态')}</button></div>
        {connectionMessage && <p className="connection-message" role="status">{t(connectionMessage)}</p>}
        {isAndroidApp() ? <p className="settings-note">{nativeMode === 'phone-web' ? t('此模式直接调用网页版非公开接口。仅登录时打开网页，聊天通过手机原生网络发送所选历史并接收流式回答。登录过期或协议变化需要重新登录或更新 App；网页端可能记录这些对话。') : t('电脑转发需要先配对，使用电脑上已配置的服务。首次配置和电脑代理登录在电脑端完成。')}</p> : provider === 'deepseek-web' ? <><ol className="setup-steps"><li>{t('在项目文件夹双击 ')}<code>login-deepseek-web.cmd</code>{t('。')}</li><li>{t('在打开的专用浏览器中登录 DeepSeek，发送一句「你好」，然后回到登录窗口按 Enter。')}</li><li>{t('双击 ')}<code>start-web-proxy.cmd</code>{t('，保持代理窗口运行。')}</li><li>{t('点击「刷新状态」，就绪后关闭此窗口即可提问。')}</li></ol><p className="settings-note">{t('使用你自己的网页版登录，不使用开放平台 API Key。连接失败时不会自动转向收费 API。当前选择会保存在本机，切换后无需重启墨算。网页登录过期时，需要重新登录并重启代理。')}</p><p className="settings-note">{t('仅发送你选中的最近对话，不复用网页版的旧对话。此功能依赖非官方网页适配，代理就绪表示已加载登录信息，实际可用性以发送结果为准。代理统计不等同于官方精确用量。')}</p></> : <><ol className="setup-steps"><li>{t('将项目中的 ')}<code>.env.example</code>{t(' 复制为 ')}<code>.env</code>{t('（已有则直接编辑）。')}</li><li>{t('填入 ')}<code>{t('DEEPSEEK_API_KEY=你的密钥')}</code>{t('。')}</li><li>{t('重启本地服务，然后点击「刷新状态」。')}</li></ol><p className="settings-note">{t('密钥只由本地服务读取。API 调用按服务商规则计费；已导入的笔记不会自动作为上下文发送。')}</p></>}
        <div className="settings-row"><span>{t('上下文策略')}<small>{t('最多 24,000 字符，保留完整问答轮次')}</small></span><span className="pill">{t('最近 ')}{rounds}{t(' 轮')}</span></div><p className="settings-note">{t('字符上限并非精确 token 计数。旧历史不会自动总结；跨轮依赖需要在新问题中补充。导入来源缺失的公式分隔符需手动修正。本版本供本地使用，尚无公网账号鉴权。')}</p></>}
    </section></div>}
  </div>;
}

if (isAndroidApp()) document.documentElement.classList.add('native-android');
createRoot(document.getElementById('root')!).render(<LocaleProvider><App /></LocaleProvider>);
