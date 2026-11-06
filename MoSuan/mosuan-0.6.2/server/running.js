export async function isReaderRunning(url) {
  try {
    const res = await fetch(new URL('/', url), { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!res.ok) { await res.body?.cancel(); return false; }
    if (res.headers.get('x-mosuan-service') === 'reader') { await res.body?.cancel(); return true; }
    // Recognize the earlier build as well when upgrading an already running app.
    return /<title>[^<]*墨算/.test(await res.text());
  } catch { return false; }
}
