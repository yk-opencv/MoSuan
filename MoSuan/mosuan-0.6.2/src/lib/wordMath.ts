import { Math as OfficeMath, XmlAttributeComponent, XmlComponent } from 'docx';
import { renderMathml } from './mathjaxRenderer';

class Attributes extends XmlAttributeComponent<Record<string, string>> {}
class MathElement extends XmlComponent {
  constructor(name: string, children: (XmlComponent | string)[], attributes?: Record<string, string>) {
    super('m:' + name);
    if (attributes) this.root.push(new Attributes(attributes));
    this.root.push(...children);
  }
}
class EditableMath extends OfficeMath {
  constructor(children: XmlComponent[]) {
    super({ children: [] });
    this.root.push(...children);
  }
}
const el = (name: string, ...children: (XmlComponent | string)[]) => new MathElement(name, children);
const prop = (name: string, value: string) => new MathElement(name, [], { 'm:val': value });
const children = (node: Element) => Array.from(node.children);
const content = (node: Element) => node.textContent || '';
const attr = (node: Element, name: string) => node.getAttribute(name);
const namespace = 'http://www.w3.org/1998/Math/MathML';
const naryOperators = /^[∫∬∭∮∯∰∑∏∐⋀⋁⋂⋃⨀⨁⨂⨄⨆]$/u;
const accents = new Map(Object.entries({ '^': '\u0302', 'ˆ': '\u0302', '~': '\u0303', '˜': '\u0303', '→': '\u20d7', '←': '\u20d6', '˙': '\u0307', '¨': '\u0308', '˘': '\u0306', 'ˇ': '\u030c', '´': '\u0301', '\u0060': '\u0300' }));
const scripts = new Map(Object.entries({ 'double-struck': 'double-struck', fraktur: 'fraktur', 'bold-fraktur': 'fraktur', script: 'script', 'bold-script': 'script', 'sans-serif': 'sans-serif', 'bold-sans-serif': 'sans-serif', 'sans-serif-italic': 'sans-serif', 'sans-serif-bold-italic': 'sans-serif', monospace: 'monospace' }));

class UnsupportedMath extends Error {}
function unsupported(): never { throw new UnsupportedMath('该公式结构暂不能转换为 Word 公式'); }

function run(value: string, style: string, script?: string, literal = false) {
  const text = new MathElement('t', [value], { 'xml:space': 'preserve' });
  return el('r', el('rPr', ...(literal ? [prop('nor', '1')] : []), ...(script ? [prop('scr', script)] : []), prop('sty', style)), text);
}

// Build OMML structurally from MathJax's MathML. Only known presentation
// elements are translated; silently flattening unknown nodes can change math.
export function editableWordMath(tex: string, display: boolean): OfficeMath | null {
  if (tex.length > 8000) return null;
  const mml = new DOMParser().parseFromString(renderMathml(tex, display), 'application/xml').documentElement;
  if (mml.namespaceURI !== namespace || mml.localName !== 'math') return null;
  const nodes = mml.getElementsByTagName('*');
  if (nodes.length > 3500) return null;
  for (const node of nodes) {
    if (node.namespaceURI !== namespace || ['mathcolor', 'mathbackground'].some(name => attr(node, name) !== null)) return null;
  }

  function list(nodes: Element[], depth: number): XmlComponent[] {
    const result: XmlComponent[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const parts = children(node);
      const isScript = /^(?:msub|msup|msubsup|munder|mover|munderover)$/.test(node.localName);
      const next = nodes[i + 1];
      // A native n-ary operator needs a nonempty operand. Use the next atom
      // when unambiguous; otherwise keep the operator and its scripts editable.
      if (isScript && parts[0]?.localName === 'mo' && naryOperators.test(content(parts[0])) &&
          next && /^(?:mi|mn|mfrac|mrow|msqrt|mroot|msup|msub|msubsup)$/.test(next.localName) &&
          !naryOperators.test(content(next.firstElementChild || next))) {
        const name = node.localName;
        const sub = /sub|under/.test(name) ? parts[1] : undefined;
        const sup = /sup|over/.test(name) ? parts[sub ? 2 : 1] : undefined;
        result.push(el('nary',
          el('naryPr', prop('chr', content(parts[0])), prop('limLoc', /under|over/.test(name) ? 'undOvr' : 'subSup'),
            prop('subHide', sub ? '0' : '1'), prop('supHide', sup ? '0' : '1')),
          el('sub', ...(sub ? convert(sub, depth + 1) : [])), el('sup', ...(sup ? convert(sup, depth + 1) : [])),
          el('e', ...convert(next, depth + 1))));
        i++;
      } else result.push(...convert(node, depth + 1));
    }
    return result;
  }

  function convert(node: Element, depth: number): XmlComponent[] {
    if (depth > 64) unsupported();
    const parts = children(node);
    const name = node.localName;
    const nested = (n: Element) => convert(n, depth + 1);
    const arg = (tag: string, index: number) => el(tag, ...nested(parts[index] ?? unsupported()));
    if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(name)) {
      const value = content(node).replace(/[\u2061-\u2064]/g, '');
      if (!value) return [];
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) unsupported();
      const variant = attr(node, 'mathvariant');
      const script = variant ? scripts.get(variant) : undefined;
      if (variant && !script && !['normal', 'italic', 'bold', 'bold-italic'].includes(variant)) unsupported();
      const style = variant ? (variant.includes('bold') ? (variant.includes('italic') ? 'bi' : 'b') : variant.includes('italic') ? 'i' : 'p')
        : name === 'mi' && [...value].length === 1 ? 'i' : 'p';
      return [run(value, style, script, name === 'mtext' || name === 'ms')];
    }
    if (name === 'mspace') {
      const width = attr(node, 'width') || '';
      const em = width.endsWith('em') ? Number.parseFloat(width) : 0;
      return em > 0 ? [run(em >= 0.8 ? '\u2003' : em >= 0.4 ? '\u2002' : '\u2009', 'p')] : [];
    }
    if (name === 'math' || name === 'mstyle' || name === 'mrow') {
      const first = parts[0], last = parts.at(-1);
      const fence = (part: Element | undefined, side: string): string | undefined => {
        if (part && attr(part, 'data-mjx-texclass') === side && (part.localName === 'mo' || part.children.length === 1 && part.firstElementChild?.localName === 'mo')) return content(part);
      };
      const left = fence(first, 'OPEN'), right = fence(last, 'CLOSE');
      if (parts.length > 2 && left !== undefined && right !== undefined) {
        return [el('d', el('dPr', prop('begChr', left), prop('endChr', right), prop('grow', '1')), el('e', ...list(parts.slice(1, -1), depth)))];
      }
      return list(parts, depth);
    }
    if (name === 'mfrac') {
      const noBar = /^0(?:\.0+)?(?:em|px|pt|%)?$/.test(attr(node, 'linethickness') || '');
      const type = noBar ? 'noBar' : attr(node, 'bevelled') === 'true' ? 'skw' : 'bar';
      return [el('f', el('fPr', prop('type', type)), arg('num', 0), arg('den', 1))];
    }
    if (name === 'msqrt' || name === 'mroot') {
      const root = name === 'mroot';
      return [el('rad', el('radPr', prop('degHide', root ? '0' : '1')), root ? arg('deg', 1) : el('deg'), root ? arg('e', 0) : el('e', ...list(parts, depth)))];
    }
    if (name === 'msub') return [el('sSub', arg('e', 0), arg('sub', 1))];
    if (name === 'msup') return [el('sSup', arg('e', 0), arg('sup', 1))];
    if (name === 'msubsup') return [el('sSubSup', arg('e', 0), arg('sub', 1), arg('sup', 2))];
    if (name === 'menclose' && attr(node, 'notation') === 'box') return [el('borderBox', el('e', ...list(parts, depth)))];
    if (name === 'munder' || name === 'mover' || name === 'munderover') {
      const below = name === 'munder', marker = parts[1], glyph = marker ? content(marker) : '';
      if (name === 'munderover') return [el('limUpp', el('e', el('limLow', arg('e', 0), arg('lim', 1))), arg('lim', 2))];
      if (marker?.localName === 'mo' && /^[\u00af\u203e\u0332\u2015]$/.test(glyph)) return [el('bar', el('barPr', prop('pos', below ? 'bot' : 'top')), arg('e', 0))];
      if (marker?.localName === 'mo' && /^[⏞⏟]$/.test(glyph)) return [el('groupChr', el('groupChrPr', prop('chr', glyph), prop('pos', below ? 'bot' : 'top'), prop('vertJc', below ? 'top' : 'bot')), arg('e', 0))];
      const accent = accents.get(glyph) ?? (/^\p{Mark}$/u.test(glyph) ? glyph : undefined);
      if (!below && accent && marker?.localName === 'mo' && (attr(marker, 'stretchy') === 'false' || attr(node, 'accent') === 'true')) return [el('acc', el('accPr', prop('chr', accent)), arg('e', 0))];
      if (attr(node, below ? 'accentunder' : 'accent') === 'true' || marker?.localName === 'mo' && /^[→←↔]$/.test(glyph)) unsupported();
      return [el(below ? 'limLow' : 'limUpp', arg('e', 0), arg('lim', 1))];
    }
    if (name === 'mtable') {
      if (['frame', 'rowlines', 'columnlines'].some(key => attr(node, key)?.split(/\s+/).some(value => value !== 'none'))) unsupported();
      const rows = parts.map(children);
      const columns = Math.max(0, ...rows.map(row => row.length));
      if (!columns || columns > 64 || parts.some(row => row.localName !== 'mtr') || rows.some(row => row.some(cell => cell.localName !== 'mtd' || attr(cell, 'rowspan') || attr(cell, 'columnspan')))) unsupported();
      const aligns = (attr(node, 'columnalign') || 'center').trim().split(/\s+/);
      const props = Array.from({ length: columns }, (_, index) => {
        const align = aligns[Math.min(index, aligns.length - 1)];
        return el('mc', el('mcPr', prop('count', '1'), prop('mcJc', align === 'left' || align === 'right' ? align : 'center')));
      });
      const matrixRows = rows.map(row => {
        const cells = Array.from({ length: columns }, (_, index) => el('e', ...(row[index] ? list(children(row[index]), depth + 1) : [])));
        return el('mr', ...cells);
      });
      return [el('m', el('mPr', el('mcs', ...props)), ...matrixRows)];
    }
    return unsupported();
  }

  try {
    const result = convert(mml, 0);
    return result.length ? new EditableMath(result) : null;
  } catch (error) {
    if (error instanceof UnsupportedMath) return null;
    throw error;
  }
}
