/** Decoder for the private web protocol; no page or login data is involved. */
export class DeepSeekStream {
  private pending = '';
  private path = '';
  private fragments: { type?: string; content?: string }[] = [];
  answer = '';
  complete = false;
  limited = false;
  private error = '';
  push(chunk: string) {
    this.pending += chunk.replace(/\r/g, '');
    if (this.pending.length > 1_000_000 || this.answer.length > 1_000_000) throw new Error('网页回答过长，已保留收到的内容。');
    let end: number;
    while ((end = this.pending.indexOf('\n\n')) >= 0) {
      const frame = this.pending.slice(0, end); this.pending = this.pending.slice(end + 2);
      const value = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!value) continue;
      if (value === '[DONE]') { if (!this.error) this.complete = true; continue; }
      let event: any;
      try { event = JSON.parse(value); } catch { throw new Error('网页回答格式变化，已保留收到的内容。'); }
      this.consume(event);
    }
    if (this.error) throw new Error(this.error);
    return this.answer;
  }
  finish() {
    if (this.pending.trim()) this.push('\n\n');
    if (this.error) throw new Error(this.error);
    if (!this.answer.trim()) throw new Error('网页接口未返回回答，请检查登录后重试。');
    if (!this.complete) throw new Error('网页回答流提前中断，已保留收到的内容。');
    return this.limited ? 'length' : 'stop';
  }
  private rebuild() {
    this.answer = this.fragments.filter(item => ['RESPONSE', 'ANSWER', 'TEXT'].includes(String(item.type).toUpperCase())).map(item => item.content || '').join('');
  }
  private append(value: any) { this.fragments.push(...(Array.isArray(value) ? value : [value]).filter(item => item && typeof item === 'object').map(item => ({ ...item }))); this.rebuild(); }
  private reason(reason: unknown) {
    if (['stop', 'FINISHED'].includes(String(reason))) this.complete = true;
    if (['length', 'max_tokens', 'max_length'].includes(String(reason))) { this.complete = true; this.limited = true; }
    if (/rate_limit/i.test(String(reason))) this.error = '网页版当前请求过于频繁，请稍后重试。';
  }
  private consume(event: any) {
    if (!event || typeof event !== 'object') return;
    if (event.error || event.code && Number(event.code) !== 0 || ['error', 'hint'].includes(event.type)) {
      this.error = /40029|429|TOO_MANY_REQUESTS|rate.limit/i.test(JSON.stringify(event.error || { code: event.code, msg: event.msg, finish_reason: event.finish_reason })) ? '网页版当前请求过于频繁，请稍后重试。' : '网页接口返回异常，请检查手机登录或网页服务。';
      return;
    }
    this.reason(event.finish_reason);
    if (typeof event.p === 'string') this.path = event.p;
    const response = event.v?.response;
    if (response && typeof response === 'object') {
      if (typeof response.content === 'string') this.answer = response.content;
      if (Array.isArray(response.fragments)) { this.fragments = []; this.append(response.fragments); }
      this.reason(response.finish_reason); this.reason(response.status);
    }
    if (this.path === 'response/fragments' && event.v !== undefined) this.append(event.v);
    if (this.path === 'response' && Array.isArray(event.v)) for (const operation of event.v) {
      if (operation.p === 'fragments' && operation.o === 'APPEND') this.append(operation.v);
      if (operation.p === 'status' || operation.p === 'finish_reason') this.reason(operation.v);
    }
    if (this.path === 'response/fragments/-1/content' && typeof event.v === 'string' && this.fragments.length) {
      const fragment = this.fragments.at(-1)!; fragment.content = (event.o === 'SET' ? '' : fragment.content || '') + event.v; this.rebuild();
    }
    if (this.path === 'response/content' && typeof event.v === 'string') this.answer = (event.o === 'SET' ? '' : this.answer) + event.v;
    if (this.path === 'response/status' || this.path === 'response/finish_reason') this.reason(event.v);
  }
}
