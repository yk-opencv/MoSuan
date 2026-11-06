import { useLocale } from '../lib/locale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Share2, X } from 'lucide-react';
import { conversationDocument } from '../lib/sharing';
import { downloadText, type Notebook } from '../lib/storage';
import { isAndroidApp, shareNativeText } from '../lib/mobile';

export function ShareDialog({ book, onClose }: { book: Notebook; onClose: () => void }) {
  const { t, language } = useLocale();
  const document = useMemo(() => conversationDocument(book), [book]);
  const preview = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');
  const nativeAvailable = isAndroidApp() || window.isSecureContext && typeof navigator.share === 'function';
  useEffect(() => {
    const previous = window.document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  function selectText() { preview.current?.focus(); preview.current?.select(); }
  async function copy() {
    setCopied(false);
    if (!navigator.clipboard?.writeText) {
      selectText(); setFeedback('已选中全部内容，请长按选择复制，或按 Ctrl+C / ⌘C；也可下载文件分享。'); return;
    }
    setBusy(true);
    try { await navigator.clipboard.writeText(document.text); setCopied(true); setFeedback('已复制整段对话，可粘贴到聊天或笔记应用。'); }
    catch { selectText(); setFeedback('无法自动复制，已选中全部内容，请手动复制或下载文件。'); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!nativeAvailable) return;
    setBusy(true); setFeedback('');
    try {
      if (isAndroidApp()) { await shareNativeText(document.filename, document.text, document.title); setFeedback('已交给系统分享，请在目标应用中确认。'); return; }
      const file = new File([document.text], document.filename, { type: 'text/markdown;charset=utf-8' });
      let acceptsFile = false;
      try { acceptsFile = Boolean(navigator.canShare?.({ files: [file] })); } catch { /* Try text instead. */ }
      // Keep the browser's user activation: no awaited operation before share().
      const data = acceptsFile ? { title: document.title, files: [file] } : { title: document.title, text: document.text };
      if (navigator.canShare && !navigator.canShare(data)) {
        setFeedback('系统不支持分享此内容，请使用复制或下载文件。'); return;
      }
      await navigator.share(data);
      setFeedback('已交给系统分享，请在目标应用中确认。');
    } catch (error) {
      setFeedback((error as Error).name === 'AbortError' ? '已取消系统分享。仍可复制或下载文件。' : '系统分享未完成，请使用复制或下载文件。');
    } finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} className="modal share-dialog" role="dialog" aria-modal="true" aria-label={t('分享对话')} tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const targets = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea');
        if (!targets?.length) return;
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <button className="modal-close icon-button" aria-label={t('关闭分享')} disabled={busy} onClick={onClose}><X size={20} /></button>
      <div className="modal-icon"><Share2 size={24} /></div><h2>{t('分享这段思路')}</h2>
      <p>{t('分享「{0}」的完整对话，保留 Markdown 与公式原文。对方可以导入墨算继续阅读。', document.title)}</p>
      <div className="share-summary">{book.messages.length}{t(' 条内容 · ')}{document.text.length.toLocaleString(language)}{t(' 字符')}</div>
      <div className="share-options">
        <button className="button primary" disabled={!nativeAvailable || busy} onClick={() => void share()}><Share2 size={16} />{t('系统分享')}</button>
        <button className="button" disabled={busy} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? t('已复制') : t('复制对话')}</button>
        <button className="button" disabled={busy} onClick={async () => { try { const saved = await downloadText(document.filename, document.text); setFeedback(isAndroidApp() ? saved ? t('文件已保存。') : t('已取消保存，笔记仍保留在墨算。') : t('已发起 Markdown 文件下载，可将文件发送给朋友。')); } catch { setFeedback('文件保存未完成，请重试。'); } }}><Download size={16} />{t('下载分享文件')}</button>
      </div>
      {!nativeAvailable && <p className="share-hint">{t('当前浏览器不支持系统分享，可复制对话或下载文件后发送。')}</p>}
      <p className="share-feedback" role="status" aria-live="polite">{t(feedback)}</p>
      <label>{t('分享内容（Markdown 原文）')}<textarea ref={preview} readOnly className="source-editor share-preview" aria-label={t('分享内容')} value={document.text} /></label>
      <p className="share-hint">{t('仅分享当前对话，不附带连接配置或其他对话；不会生成公开链接。发送前可在上方查看内容。')}</p>
    </section>
  </div>;
}
