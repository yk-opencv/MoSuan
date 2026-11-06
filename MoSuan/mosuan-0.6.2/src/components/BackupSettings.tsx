import { useLocale } from '../lib/locale';
import { useRef, useState } from 'react';
import { Archive, Download, Upload } from 'lucide-react';
import { createBackup, readBackup, type NotebookBackup } from '../lib/backup';
import { saveBackupFile } from '../lib/backupFile';
import type { Notebook } from '../lib/storage';

interface Props {
  books: Notebook[];
  activeId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  restore: (backup: NotebookBackup) => Promise<{ added: Notebook[]; skipped: number; copies: number }>;
}

export function BackupSettings({ books, activeId, disabled, onBusy, restore }: Props) {
  const { t, language } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; backup: NotebookBackup }>();
  const blocked = disabled || busy;

  async function run(label: string, task: () => Promise<void>) {
    if (disabled || running.current) return;
    running.current = true; setBusy(true); onBusy(true); setFeedback(label); setError('');
    try { await task(); }
    catch (cause) { setFeedback(''); setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { running.current = false; setBusy(false); onBusy(false); }
  }

  async function choose(file: File) {
    await run('正在检查备份…', async () => {
      setPreview(undefined);
      const backup = await readBackup(file);
      setPreview({ name: file.name, backup }); setFeedback('');
    });
  }

  const notes = preview?.backup.notebooks || [];
  const totals = notes.reduce((sum, book) => {
    sum.messages += book.messages.length;
    sum.images += book.messages.reduce((count, message) => count + (message.images?.length || 0), 0);
    sum.pinned += Number(Boolean(book.pinned));
    return sum;
  }, { messages: 0, images: 0, pinned: 0 });
  return <>
    <div className="modal-icon"><Archive size={24} /></div>
    <h2>{t('备份与恢复')}</h2>
    <p>{t('用一份文件迁移本机笔记。备份包含问答、公式原文、题目图片和置顶状态。')}</p>
    <div className="backup-options">
      <button className="button" disabled={blocked || !books.length} onClick={() => void run('正在准备备份…', async () => {
        const blob = await createBackup(books, activeId);
        const saved = await saveBackupFile(blob);
        setFeedback(saved ? t('备份已导出。请保留 .mosuan.json 文件。') : t('已取消保存备份。'));
      })}><Download size={16} />{t('备份全部笔记')}</button>
      <button className="button" disabled={blocked} onClick={() => input.current?.click()}><Upload size={16} />{t('选择备份文件')}</button>
    </div>
    <input ref={input} type="file" className="hidden" aria-label={t('选择墨算备份')} accept=".mosuan.json,.json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void choose(file);
    }} />
    {disabled && !busy && <p>{t('当前操作完成后即可备份或恢复。')}</p>}
    {preview && <div className="backup-preview">
      <h3>{t('恢复预览')}</h3>
      <p>{preview.name}<br />{new Date(preview.backup.createdAt).toLocaleString(language)}</p>
      <p><strong>{notes.length}{t(' 本笔记')}</strong> · {totals.messages}{t(' 条内容 · ')}{totals.images}{t(' 张图片 · ')}{totals.pinned}{t(' 本置顶')}</p>
      <ul>{notes.slice(0, 6).map(book => <li key={book.id}>{book.title}{book.pinned && '（置顶）'}</li>)}</ul>
      {notes.length > 6 && <p>{t('还有 ')}{notes.length - 6}{t(' 本笔记。')}</p>}
      <p>{t('相同笔记会跳过，有差异的同一笔记会另存副本，现有笔记会保留。')}</p>
      <div className="modal-buttons">
        <button className="button subtle" disabled={blocked} onClick={() => { setPreview(undefined); setError(''); setFeedback('已取消恢复。'); }}>{t('取消恢复')}</button>
        <button className="button primary" disabled={blocked} onClick={() => void run('正在恢复笔记…', async () => {
          const result = await restore(preview.backup);
          setPreview(undefined);
          setFeedback(t('恢复完成。新增 {0} 本（含 {1} 本副本），跳过 {2} 本相同笔记。', result.added.length, result.copies, result.skipped));
        })}>{t('确认恢复')}</button>
      </div>
    </div>}
    <p role="status" className="backup-feedback">{t(feedback)}</p>
    {error && <p role="alert" className="import-error">{t(error)}</p>}
  </>;
}
