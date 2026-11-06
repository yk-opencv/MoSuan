import { useLocale } from '../lib/locale';
import { useState } from 'react';
import { apiFetch, disconnectMobile, isAndroidApp, mobileConnection, saveMobileConnection, mobileMode, saveMobileMode, type MobileMode } from '../lib/mobile';
import { PhoneWeb } from '../lib/phoneWeb';

export function MobileConnection({ changed, disabled = false }: { changed: () => void; disabled?: boolean }) {
  const { t } = useLocale();
  const [mode, setMode] = useState(mobileMode);
  const [initial] = useState(mobileConnection);
  const [url, setUrl] = useState(initial?.url || ''); const [token, setToken] = useState(initial?.token || '');
  const [feedback, setFeedback] = useState(''); const [pairing, setPairing] = useState<{ urls: string[]; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  function choose(mode: MobileMode) {
    try { saveMobileMode(mode); setMode(mode); setFeedback(''); changed(); }
    catch { setFeedback('连接方式保存失败，请检查手机存储空间后重试。'); }
  }
  async function login() {
    setBusy(true); setFeedback('正在打开手机登录页…');
    try { await PhoneWeb.open(); const status = await PhoneWeb.status(); setFeedback(status.ready ? '直连登录已加密保存在手机，可以直接提问。' : '尚未保存直连登录，请完成登录后点击网页上方“保存登录并返回”。'); changed(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : '手机网页无法打开，请更新墨算和 Android System WebView。'); }
    finally { setBusy(false); }
  }
  async function save() {
    try {
      saveMobileConnection(url, token); setBusy(true); changed();
      const res = await apiFetch('/api/status'); const data = await res.json();
      if (!res.ok) throw new Error(data.error || '连接失败');
      setFeedback('已连接电脑端墨算，连接设置已保存在本机。');
    } catch (error) { setFeedback(error instanceof Error ? error.message : '连接失败，请检查地址、配对码和电脑服务。'); }
    finally { setBusy(false); }
  }
  if (isAndroidApp()) return <section className="mobile-connection" aria-label={t('手机连接方式')}>
    <h3>{t('手机连接方式')}</h3><div className="connection-choices" role="group" aria-label={t('手机连接方式')}>
      <button className={mode === 'phone-web' ? 'chosen' : ''} aria-pressed={mode === 'phone-web'} disabled={busy || disabled} onClick={() => choose('phone-web')}><strong>{t('手机网页直连')}</strong><small>{t('原生接口请求 · 无需电脑')}</small></button>
      <button className={mode === 'computer' ? 'chosen' : ''} aria-pressed={mode === 'computer'} disabled={busy || disabled} onClick={() => choose('computer')}><strong>{t('电脑转发')}</strong><small>{t('通过已配对的电脑服务')}</small></button>
    </div>
    {mode === 'phone-web' ? <><p>{t('首次登录 DeepSeek 后，点击登录页上方「保存登录并返回」。以后在墨算输入问题直接接收回答，聊天时不打开网页。')}</p><button className="button primary" disabled={busy || disabled} onClick={() => void login()}>{busy ? t('登录页已打开…') : t('登录 / 打开 DeepSeek')}</button><button className="button" disabled={busy || disabled} onClick={async () => { try { await PhoneWeb.forget(); setFeedback('已清除直连登录，笔记保留；下次使用请重新保存登录。'); changed(); } catch { setFeedback('清除登录未完成，请重试。'); } }}>{t('清除直连登录')}</button><p>{t('本机原生接口使用个人网页登录，不需要配对码或开放平台 Key。登录资料加密保存在手机。此实验模式暂支持文字对话，验证或限流时按提示重新处理，不会自动重发或改用付费 API。')}</p></> : <><h3>{t('连接电脑端墨算')}</h3><p>{t('让手机和电脑连接同一可信局域网，在电脑运行 start-mobile-server.cmd，再打开电脑端「API 与连接 → Android 配对」。')}</p><label>{t('电脑服务地址')}<input aria-label={t('电脑服务地址')} value={url} disabled={busy || disabled} onChange={event => setUrl(event.target.value)} placeholder="http://192.168.1.10:3001" inputMode="url" autoCapitalize="none" /></label><label>{t('配对码')}<input aria-label={t('配对码')} type="password" value={token} disabled={busy || disabled} onChange={event => setToken(event.target.value)} autoCapitalize="none" autoComplete="off" /></label><div className="modal-buttons"><button className="button" disabled={busy || disabled} onClick={() => { disconnectMobile(); setToken(''); setFeedback('已断开连接，笔记继续保留在手机。'); changed(); }}>{t('断开连接')}</button><button className="button primary" disabled={busy || disabled} onClick={() => void save()}>{busy ? t('正在连接…') : t('保存并检查连接')}</button></div></>}
    {feedback && <p role="status">{t(feedback)}</p>}
  </section>;
  return <section className="mobile-connection" aria-label={t('Android 配对')}><h3>{t('Android 配对')}</h3><p>{t('手机 App 的笔记保存在手机。连接电脑端服务后，可使用电脑上已配置的 DeepSeek 服务。')}</p><a className="button" href="/api/android-apk" download>{t('下载 Android 安装包')}</a><button className="button" onClick={async () => {
    try { const res = await fetch('/api/mobile-info'); const data = await res.json(); if (!res.ok) throw new Error(data.error); setPairing(data); setFeedback(''); }
    catch (error) { setFeedback((error as Error).message || '请在这台电脑的 http://127.0.0.1:3001 打开配对设置。'); }
  }}>{t('显示 Android 配对信息')}</button>{pairing && <><p>{t('先用 start-mobile-server.cmd 启动局域网服务，再在手机 App 输入以下地址之一和配对码：')}</p><ul>{pairing.urls.map(address => <li key={address}><code>{address}</code></li>)}</ul><label>{t('手机配对码')}<input aria-label={t('手机配对码')} readOnly value={pairing.token} onFocus={event => event.currentTarget.select()} /></label><p>{t('配对码仅用于你的墨算服务，请只提供给自己的设备。')}</p></>}{feedback && <p role="status">{t(feedback)}</p>}</section>;
}
