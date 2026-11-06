import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import { STATE } from 'mathjax-full/js/core/MathItem.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import type { MmlNode } from 'mathjax-full/js/core/MmlTree/MmlNode.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/amscd/AmsCdConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
function texInput() {
  // New TeX state per formula prevents user macros and equation labels leaking
  // between notes or depending on the order virtual blocks are mounted.
  return new TeX({ packages: ['base', 'ams', 'newcommand', 'mathtools', 'amscd', 'boldsymbol', 'cancel'], maxMacros: 500, maxBuffer: 8000, tags: 'none', formatError: (_jax: unknown, error: Error) => { throw error; } });
}
export function renderMathml(tex: string, display: boolean): string {
  const document = mathjax.document('', { InputJax: texInput() });
  return new SerializedMmlVisitor().visitTree(document.convert(tex, { display, end: STATE.CONVERT }) as MmlNode);
}
export function renderMathjax(tex: string, display: boolean): string {
  const output = new SVG({ fontCache: 'none' });
  const document = mathjax.document('', { InputJax: texInput(), OutputJax: output });
  const node = document.convert(tex, { display, em: 16, ex: 8, containerWidth: 1280 });
  const svg = adaptor.firstChild(node);
  if (!(svg instanceof LiteElement) || adaptor.kind(svg) !== 'svg') throw new Error('公式排版失败');
  const width = parseFloat(adaptor.getAttribute(svg, 'width') || '0');
  const height = parseFloat(adaptor.getAttribute(svg, 'height') || '0');
  if (width > 5000 || height > 2000) throw new Error('公式尺寸超出限制');
  return adaptor.innerHTML(node);
}
