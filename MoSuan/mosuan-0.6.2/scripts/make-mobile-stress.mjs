import { mkdir, writeFile } from 'node:fs/promises';
import katex from 'katex';
import { renderMathjax } from '../src/lib/mathjaxRenderer.ts';

const formulas = [];
function math(tex, display = false, alternate = false) {
  katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, maxExpand: 500, maxSize: 20, strict: 'ignore' });
  renderMathjax(tex, display);
  formulas.push(tex);
  return display ? (alternate ? `\\[\n${tex}\n\\]` : `$$\n${tex}\n$$`) : (alternate ? `\\(${tex}\\)` : `$${tex}$`);
}
const sections = [];
for (let i = 1; i <= 120; i++) {
  const a = i % 9 + 1;
  sections.push(`## 第 ${String(i).padStart(3, '0')} 组 · ${i === 60 ? '中部检查点 MID-060' : `定位标记 G-${String(i).padStart(3, '0')}`}

本组参数 ${math(`a=${a}`)}，组号 ${math(`j=${i}`, false, true)}。**粗体应保留**，*斜体应保留*，中文「积分、收敛域、傅里叶级数」应正常显示。

### 幂级数与积分

${math(`S_a(x)=\\sum_{n=1}^{\\infty}\\frac{x^n}{n a^n}=-\\ln\\left(1-\\frac{x}{a}\\right),\\qquad |x|<a`, true, i % 2 === 0)}

${math(String.raw`\begin{aligned}S_a'(x)&=\sum_{n=1}^{\infty}\frac{x^{n-1}}{a^n}=\frac{1}{a-x},\\ S_a(x)&=\int_0^x\frac{1}{a-t}\,dt=-\ln\left(1-\frac{x}{a}\right).\end{aligned}`, true)}

### 矩阵、分段函数与极限

${math(`A_j=\\begin{bmatrix}${a}&1\\\\0&${a}\\end{bmatrix},\\qquad e^{tA_j}=e^{${a}t}\\begin{bmatrix}1&t\\\\0&1\\end{bmatrix}`, true, true)}

${math(String.raw`h(x)=\begin{cases}x^2,&x\geq0,\\-x,&x<0,\end{cases}\qquad \lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n=e`, true)}

${math(String.raw`\int_{-\infty}^{\infty}e^{-a x^2}\,dx=\sqrt{\frac{\pi}{a}},\qquad a>0`, true, true)}

### 列表与表格混排

1. **收敛半径**：${math('R=a')}。这条有序列表的编号不应与公式重叠。
2. **初值检查**：${math('S_a(0)=0', false, true)}。往返滚动后，这条列表仍应完整。
   - 内层检查：${math(`\\det(A_j)=${a * a}`)}。
   - 中文标点与公式 ${math(`x_{${i}}^2+y_{${i}}^2=1`)} 混排不应丢字。

| 检查量 | 应显示内容 |
| --- | --- |
| 组号 | ${math(`j=${i}`)} |
| 导数初值 | ${math(`S_a'(0)=\\frac{1}{${a}}`)} |
| 二项式 | ${math(String.raw`\binom{n}{k}=\frac{n!}{k!(n-k)!}`)} |

> 组尾标记 **END-G-${String(i).padStart(3, '0')}**。若标题能看到而这行始终看不到，请记录组号。

---`);
}
const dense = Array.from({ length: 400 }, (_, i) => `第 ${i + 1} 条 ${math(`u_{${i + 1}}(x)=\\frac{x^{${i % 9 + 1}}}{${i + 1}}`)}；`).join('');
const long = math('L_{28}(x)=' + Array.from({ length: 28 }, (_, i) => `\\frac{\\sin(${i + 1}x)}{${(i + 1) ** 2}}`).join('+'), true);
const content = `# 墨算手机公式压力测试 · 120 组推导

## 开始前：TOP-000

这是 UTF-8 Markdown 本地阅读测试，不需要登录 DeepSeek，也不需要联网。**请在墨算「导入文本 → 选择文件」中导入，不要把整份文档发给 AI。**

- 本文所有用于渲染的公式都经过 KaTeX、MathJax 排版检查；没有故意损坏的公式。
- 共有 **${formulas.length.toLocaleString('en-US')} 条公式**：120 组常规推导、单个列表项中的 400 条密集公式，以及一条超宽公式。
- 四种分隔符均有覆盖：行内美元符号、双美元符号、反斜杠圆括号、反斜杠方括号。
- 代码区中展示的公式源码应保持原样，不能算作渲染失败。
- 分阶段标记用于定位阅读位置；导入时仍会读取整份文档。

### 建议测试顺序

1. 先用 KaTeX 导入，记录从点击「导入并阅读」到出现正文的时间。
2. 检查页首 TOP-000，缓慢滚动，再连续快速滚动约 20 秒。
3. 找到第 060 组的 MID-060，检查矩阵、分数线、列表和中文是否完整。
4. 使用「跳到末尾」，确认能看到全文末尾的 FINAL-OK-20261105；再回到顶部。
5. 在「设置 → 字体与外观」中切换 MathJax，重复上述操作；首次加载引擎的等待时间单独记录。
6. 将字号改为 20 px，测试一次竖屏与横屏，再恢复原字号。
7. 关闭并重新打开 App，确认本文仍存在，阅读内容和公式正常。

### 如何判断异常

- 公式区出现「公式原文」或「等待公式闭合」：记录附近的组号；本文正常公式不应出现这些提示。
- 快速滚动时短暂等待与持续白屏分别记录；停下后超过 5 秒仍为空白，作为异常反馈。
- 公式重叠、大片文字丢失、无法到达末尾、整页左右溢出、App 闪退：记录位置和发生前操作。
- 最后的超宽公式应能在自己的区域左右滑动，整页正文不应被撑宽。
- 这是压力测试材料，不代表手机必须达到固定耗时；请记录实际现象。

### 手机测试记录（可复制填写）

手机型号：
Android 版本：
Android System WebView 版本（知道时填写）：
墨算版本：
引擎：KaTeX / MathJax
导入等待：约 ____ 秒
TOP-000：正常 / 异常
MID-060：正常 / 异常
密集列表：正常 / 异常
超宽公式独立滚动：正常 / 异常
FINAL-OK-20261105：能看到 / 看不到
快速滚动后持续白屏：无 / 有，约 ____ 秒
切换引擎、字号、横竖屏：正常 / 异常
重开 App：正常 / 异常
闪退：无 / 有
异常位置与操作：

---

${sections.join('\n\n')}

## 密集公式检查：DENSE-400

下面故意把 400 条公式放进**同一个列表项**，用于检查分块和粗体样式是否保留。请检查开头「第 1 条」和末尾「第 400 条」都能读到。

- **${dense}**
- **密集列表结束标记 DENSE-END-400**。此行不应与上一项重叠。

## 超宽公式检查：WIDE-028

这条公式故意超过手机屏幕宽度。请在公式内左右滑动，确认能看到最后的第 28 项。

${long}

公式后的正文标记 **WIDE-AFTER-028** 必须正常显示。

## 代码保护检查：CODE-LITERAL

下面两行位于代码块内，保留美元符号和反斜杠是正确行为：

\`\`\`tex
$x^2+y^2=1$
\\[\\int_0^1 x\\,dx=\\frac{1}{2}\\]
\`\`\`

行内代码 \`$x^2$\` 也应保留源码。

## 全文末尾：FINAL-OK-20261105

**如果你能看到这一行，说明已经滚动到全文真正末尾。**

请分别记录 KaTeX 和 MathJax 下是否能到达这里。本文不是手机测试报告，测试结果需要由你在实机填写。
`;
await mkdir('artifacts/mobile-stress', { recursive: true });
await writeFile('artifacts/mobile-stress/墨算手机公式压力测试.md', content, 'utf8');
await writeFile('artifacts/mobile-stress/metadata.json', JSON.stringify({ encoding: 'UTF-8', groups: 120, formulas: formulas.length, bytes: Buffer.byteLength(content), characters: content.length, katexSyntaxChecked: true, mathjaxTypesettingChecked: true, physicalDeviceTested: false }, null, 2));
console.log(JSON.stringify({ file: 'artifacts/mobile-stress/墨算手机公式压力测试.md', formulas: formulas.length, bytes: Buffer.byteLength(content) }));
