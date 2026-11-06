import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../lib/locale';
import { renderBlock, splitDocument, type MathEngine } from '../lib/markdown';
import { LONG_DOCUMENT_CHARS } from '../lib/longDocument';
import { inspectRepair, wrapMath, type MathRange, type RepairRequest, type RepairResult } from '../lib/mathRepair';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  limit: number;
  engine: MathEngine;
}

type Review = Extract<RepairResult, { kind: 'scan' }> & { source: string };

export function ImportSourceEditor({ value, onChange, disabled, limit, engine }: Props) {
  const { t, language } = useLocale();
  const editor = useRef<HTMLTextAreaElement>(null);
  const worker = useRef<Worker | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [review, setReview] = useState<Review>();
  const active = review?.source === value ? review : undefined;
  const candidate = active?.suggestions[0];
  const preview = useMemo(() => {
    if (!candidate) return '';
    const [block] = splitDocument('$$\n' + candidate.tex + '\n$$');
    return renderBlock(block, engine, language);
  }, [candidate, engine, language]);

  useEffect(() => () => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  function edit(text: string) {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setReview(undefined);
    setFeedback('');
    onChange(text);
  }

  function inspect(request: RepairRequest, accept: (result: RepairResult) => void) {
    setFeedback('');
    const finish = (result: RepairResult | null) => {
      if (editor.current?.value !== request.source || editor.current.disabled) return;
      if (result) accept(result);
      else setFeedback('公式检测未完成，可以在原文中手动补齐分隔符。');
    };
    if (request.source.length < LONG_DOCUMENT_CHARS) {
      try { finish(inspectRepair(request)); }
      catch { finish(null); }
      return;
    }

    try {
      const instance = new Worker(new URL('../workers/mathRepairWorker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      setBusy(true);
      const receive = (result: RepairResult | null) => {
        if (worker.current !== instance) return;
        instance.terminate();
        worker.current = null;
        setBusy(false);
        finish(result);
      };
      instance.onmessage = ({ data }: MessageEvent<RepairResult | null>) => receive(data);
      instance.onerror = instance.onmessageerror = () => receive(null);
      instance.postMessage(request);
    } catch {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      finish(null);
    }
  }

  function detect() {
    const source = editor.current!.value;
    setReview(undefined);
    inspect({ kind: 'scan', source }, result => {
      if (result.kind === 'scan') setReview({ ...result, source: value });
    });
  }

  function apply(range: MathRange, display: boolean) {
    const source = editor.current!.value;
    inspect({ kind: 'check', source, range, display }, result => {
      if (result.kind !== 'check') return;
      if (!result.valid) {
        setFeedback(display ? '此处的 Markdown 结构不适合直接补齐，请在原文中核对。' : '请选择正文中尚未排版的单行公式，避开代码和已有分隔符。');
        return;
      }
      const changed = wrapMath(value, range, display);
      if (changed.text.length > limit) {
        setFeedback('单份笔记最多支持 500 万字符，请拆分导入。');
        return;
      }
      onChange(changed.text);
      setFeedback('已补上公式分隔符。');
      setReview(display && active ? {
        ...active,
        source: changed.text,
        suggestions: active.suggestions.slice(1).map(item => ({
          ...item, start: item.start + changed.added, end: item.end + changed.added, line: item.line + 2,
        })),
      } : undefined);
    });
  }

  function wrapSelection() {
    const { value, selectionStart, selectionEnd } = editor.current!;
    const selected = value.slice(selectionStart, selectionEnd);
    const tex = selected.trim();
    if (!tex) {
      setFeedback('请先在原文中选中一段行内公式。');
      return;
    }
    const start = selectionStart + selected.length - selected.trimStart().length;
    apply({ start, end: start + tex.length }, false);
  }

  function skip() {
    if (!active) return;
    setReview({ ...active, suggestions: active.suggestions.slice(1) });
    setFeedback('已跳过这处公式。');
  }

  const toolsDisabled = disabled || busy || !value.trim() || value.length > limit;
  return <>
    <label>{t('Markdown / LaTeX 原文')}
      <textarea ref={editor} className="source-editor" value={value} disabled={disabled} onChange={event => edit(event.target.value)} placeholder={t('粘贴笔记或对话原文…')} />
    </label>
    <div className="import-math-tools">
      <div className="import-math-actions">
        <button className="button" disabled={toolsDisabled} onClick={detect}>{t('检测公式格式')}</button>
        <button className="button" disabled={toolsDisabled} onMouseDown={event => event.preventDefault()} onClick={wrapSelection}>{t('将选区设为行内公式')}</button>
      </div>
      <p className="import-math-status" aria-live="polite">
        {busy ? t('正在检查公式…') : feedback ? t(feedback) : active && !candidate ? t('未发现需要补齐的独立公式。') : ''}
      </p>
      {active && candidate && <div className="import-math-review">
        <p>{t('第 {0} 行 · 剩余 {1} 处候选', candidate.line, active.suggestions.length)}</p>
        <code className="import-math-source">{candidate.tex}</code>
        <div className="prose import-math-preview" aria-label={t('补齐后的公式预览')} dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="import-math-actions">
          <button className="button primary" disabled={toolsDisabled} onClick={() => apply(candidate, true)}>{t('补上 $$')}</button>
          <button className="button subtle" disabled={toolsDisabled} onClick={skip}>{t('跳过这处')}</button>
        </div>
      </div>}
      {active?.more && <p>{t('本次只列出前 50 处，补齐后可以再次检测。')}</p>}
    </div>
  </>;
}
