import { useLocale } from '../lib/locale';
import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { SEARCH_LIMIT, SEARCH_QUERY_LIMIT, searchNotebooks, type SearchHit } from '../lib/search';
import type { Notebook } from '../lib/storage';

export function NotebookSearch({ books, query, setQuery, choose }: { books: Notebook[]; query: string; setQuery: (query: string) => void; choose: (hit: SearchHit) => void }) {
  const { t } = useLocale();
  const [result, setResult] = useState<{ books: Notebook[]; query: string; hits: SearchHit[]; more: boolean }>();
  const [failed, setFailed] = useState(false);
  const term = query.trim();
  useEffect(() => {
    if (!term) return;
    setFailed(false);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchNotebooks(books, term, controller.signal);
        if (!controller.signal.aborted) setResult({ books, query: term, ...response });
      } catch { if (!controller.signal.aborted) setFailed(true); }
    }, 110);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [books, term]);
  const current = result?.query === term && result.books === books ? result : undefined;
  const hits = current?.hits || [];
  return <>
    <div className="modal-icon"><Search size={24} /></div>
    <h2>{t('搜索笔记')}</h2>
    <label className="search-field">{t('关键词或公式原文')}<input id="notebook-search-input" type="search" value={query} maxLength={SEARCH_QUERY_LIMIT} autoComplete="off" onChange={e => setQuery(e.target.value)} placeholder={t('例如：傅里叶变换、x^2')} onKeyDown={e => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing && hits[0]) choose(hits[0]);
    }} /></label>
    <p className="search-status" role="status">{!term ? t('查找本机笔记的标题、问题与回答。') : failed ? t('搜索暂未完成，请修改关键词后重试。') : !current ? t('正在搜索…') : !hits.length ? t('没有找到匹配内容。试试更短的关键词，或输入公式原文。') : current.more ? t('已显示前 {0} 条结果，请输入更具体的关键词。', SEARCH_LIMIT) : t('找到 {0} 条结果，选中即可跳转。', hits.length)}</p>
    {!!hits.length && <ul className="search-results">
      {hits.map(hit => <li key={JSON.stringify([hit.bookId, hit.location?.messageId, hit.location?.offset])}>
        <button type="button" className="search-result" onClick={() => choose(hit)}>
          <span><strong>{hit.title}</strong><small>{hit.location?.role === 'user' ? t('我的问题') : hit.location ? t('笔记正文') : t('笔记标题')}</small></span>
          <span className="search-excerpt">{hit.excerpt.before}<mark>{hit.excerpt.match}</mark>{hit.excerpt.after}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </li>)}
    </ul>}
  </>;
}
