import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import katex from 'katex';
import { decodeImport, importEncodingMessage } from '../src/lib/textImport.ts';
import { renderMathjax } from '../src/lib/mathjaxRenderer.ts';

const root = new URL('../artifacts/mobile-encoding/', import.meta.url);
const { cases } = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
let formulas = 0;
for (const item of cases) {
  const data = await readFile(new URL(item.file, root));
  assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256);
  if (item.expectedError) {
    assert.throws(() => decodeImport(data, item.requested));
    continue;
  }
  const result = decodeImport(data, item.requested);
  assert.equal(result.text, item.expectedText, item.file);
  assert.equal(result.encoding, item.expectedEncoding, item.file);
  if (item.warning) assert(importEncodingMessage(result).includes('无法自动还原'));
  assert.equal(decodeImport(new TextEncoder().encode(result.text)).text, result.text);
  const text = result.text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g)) {
    const tex = match.slice(1).find(value => value !== undefined);
    const display = match[1] !== undefined || match[2] !== undefined;
    katex.renderToString(tex, { throwOnError: true, displayMode: display, trust: false });
    renderMathjax(tex, display);
    formulas++;
  }
}
const report = { fixtures: cases.length, currentAppDecoderVerified: true, utf8RoundTripVerified: true,
  formulaTypesettingChecks: formulas, engines: ['KaTeX', 'MathJax'], physicalDeviceTested: false };
await writeFile(new URL('../mobile-encoding-verification.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
