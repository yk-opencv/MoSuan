import { useLocale } from '../lib/locale';
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { Notebook } from '../lib/storage';
import { downloadText } from '../lib/storage';
import { conversationDocument } from '../lib/sharing';

export function ExportDialog({ book, onClose }: { book: Notebook; onClose: () => void }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const job = useRef<AbortController | null>(null), dialog = useRef<HTMLElement>(null);
  useEffect(() => { dialog.current?.focus(); return () => job.current?.abort(); }, []);
  async function start(format: 'md' | 'pdf' | 'docx') {
    if (job.current) return;
    const controller = new AbortController(); job.current = controller; setBusy(true); setFeedback('正在准备导出…');
    try {
      const info = conversationDocument(book);
      if (format === 'md') { const saved = await downloadText(info.filename, info.text); setFeedback(saved ? 'Markdown 已交给保存位置。' : '已取消保存。'); }
      else {
        const exporter = await import('../lib/documentExport');
        if (format === 'pdf') { await exporter.printBook(book, controller.signal, setFeedback); setFeedback('已打开系统打印，请选择「另存为 PDF」并确认保存。'); }
        else {
          const { wordDocument } = await import('../lib/wordExport');
          const { blob, imageFallbacks, sourceFallbacks } = await wordDocument(book, controller.signal, setFeedback);
          setFeedback('请选择 Word 文件保存位置…');
          const saved = await exporter.saveBlob(info.filename.replace(/\.md$/, '.docx'), blob);
          const fallbacks = [imageFallbacks && imageFallbacks + ' 个保留为图片', sourceFallbacks && sourceFallbacks + ' 个保留为原文'].filter(Boolean);
          setFeedback(saved ? 'Word 文件已交给保存位置。' + (fallbacks.length ? ' 部分公式：' + fallbacks.join('，') + '。' : '') : '已取消保存。');
        }
      }
    } catch (error) { setFeedback((error as Error).name === 'AbortError' ? '已停止导出，原笔记保留。' : (error as Error).message || '导出失败，请重试。'); }
    finally { job.current = null; setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="modal export-dialog" role="dialog" aria-modal="true" aria-label={t('导出笔记')} ref={dialog} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); }}>
    <button className="modal-close icon-button" aria-label={t('关闭导出')} disabled={busy} onClick={onClose}><X size={20} /></button><div className="modal-icon"><Download size={24} /></div><h2>{t('导出这段笔记')}</h2><p className="source-book-title">{book.title}</p>
    <div className="export-options"><button className="button" disabled={busy} onClick={() => void start('md')}>Markdown (.md)<small>{t('保留原文，方便再次导入')}</small></button><button className="button" disabled={busy} onClick={() => void start('pdf')}>PDF (.pdf)<small>{t('系统打印中选择「另存为 PDF」')}</small></button><button className="button" disabled={busy} onClick={() => void start('docx')}>Word (.docx)<small>{t('正文与常用公式可编辑')}</small></button></div>
    <p>{t('在本机导出整段对话和题目图片。Word 中无法转换的公式会保留为图片或原文。')}</p><p role="status" aria-live="polite">{t(feedback)}</p>{busy && <button className="button subtle" onClick={() => { job.current?.abort(); setFeedback('正在停止；已打开的系统保存窗口请点取消。'); }}>{t('停止生成文件')}</button>}
  </section></div>;
}
