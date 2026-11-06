import { Marked } from 'marked';
import { chunkTokens } from './markdownChunks';

const parser = new Marked({ gfm: true, breaks: true });
parser.use({
  extensions: [
    {
      name: 'blockMath', level: 'block',
      // Only interrupt at a real newline. Leading code spans must stay literal.
      start: source => source.search(/\n {0,3}(?:\$\$|\\\[)/),
      tokenizer(source) {
        const opening = /^ {0,3}(\$\$|\\\[)/.exec(source);
        if (!opening) return;
        const close = opening[1] === '$$' ? '$$' : '\\]';
        const end = source.indexOf(close, opening[0].length);
        const raw = end < 0 ? source : source.slice(0, end + close.length);
        return { type: 'blockMath', raw, text: source.slice(opening[0].length, end < 0 ? undefined : end).trim(), pending: end < 0 };
      },
    },
    {
      name: 'inlineMath', level: 'inline',
      start: source => source.search(/\$|\\[([]/),
      tokenizer(source) {
        const opening = source.startsWith('\\[') ? '\\[' : source.startsWith('$$') ? '$$' : source.startsWith('\\(') ? '\\(' : source.startsWith('$') && !/^\$\s/.test(source) ? '$' : '';
        if (!opening) return;
        const close = opening === '$' || opening === '$$' ? opening : opening === '\\[' ? '\\]' : '\\)';
        let end = source.indexOf(close, opening.length);
        while (end > 0 && source[end - 1] === '\\') end = source.indexOf(close, end + close.length);
        if (opening === '$' && end >= 0 && /\s/.test(source[end - 1])) return;
        if (end < 0 && opening === '$' && !/[\\^_{}=]/.test(source)) return;
        const raw = end < 0 ? source : source.slice(0, end + close.length);
        return { type: 'inlineMath', raw, text: source.slice(opening.length, end < 0 ? undefined : end), pending: end < 0, display: opening === '$$' || opening === '\\[' };
      },
    },
  ],
});

export function lexDocument(source: string) {
  return parser.lexer(source);
}

export function splitDocument(source: string) {
  return chunkTokens(lexDocument(source));
}
