// PoW ABI adapted from dekrezz/FreeDeepseekAPI lib/pow.js (Apache-2.0).
// License: public/licenses/FreeDeepseekAPI-LICENSE.txt. WASM is fetched by the
// native client from DeepSeek's HTTPS CDN, with no authentication headers.
import type { PowChallenge } from './pow';
self.onmessage = async (event: MessageEvent<{ challenge: PowChallenge; wasm: string }>) => {
  let stage = 'validate';
  try {
    const { challenge, wasm } = event.data;
    if (challenge.algorithm !== 'DeepSeekHashV1' || !Number.isFinite(challenge.difficulty) || challenge.difficulty <= 0 || challenge.difficulty > 1_000_000_000 || wasm.length > 3_000_000) throw new Error();
    const bytes = Uint8Array.from(atob(wasm), character => character.charCodeAt(0));
    stage = 'instantiate'; const { instance } = await WebAssembly.instantiate(bytes, { wbg: {} }); const exports = instance.exports as any;
    const encoder = new TextEncoder(), input = encoder.encode(challenge.challenge), prefix = encoder.encode(`${challenge.salt}_${challenge.expire_at}_`);
    const malloc = exports.__wbindgen_export_0;
    if (typeof malloc !== 'function' || typeof exports.wasm_solve !== 'function') throw new Error();
    stage = 'allocate'; const inputPtr = malloc(input.length, 1) >>> 0, prefixPtr = malloc(prefix.length, 1) >>> 0;
    new Uint8Array(exports.memory.buffer, inputPtr, input.length).set(input); new Uint8Array(exports.memory.buffer, prefixPtr, prefix.length).set(prefix);
    const pointer = exports.__wbindgen_add_to_stack_pointer(-16);
    stage = 'solve'; exports.wasm_solve(pointer, inputPtr, input.length, prefixPtr, prefix.length, challenge.difficulty);
    const result = new DataView(exports.memory.buffer), code = result.getInt32(pointer, true), answer = result.getFloat64(pointer + 8, true);
    stage = `result:${code}:${Number.isSafeInteger(answer)}`;
    if (!code || !Number.isSafeInteger(answer) || answer <= 0) throw new Error();
    self.postMessage({ answer });
  } catch { self.postMessage({ error: 'PoW 计算失败', stage }); }
};
