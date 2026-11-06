import { newId } from './lib/id';
import type { Notebook } from './lib/storage';
export function demoBook(): Notebook {
  return { id: newId(), title: '幂级数与它的和函数', updated: Date.now(), messages: [
    { id: 'demo-question', role: 'user', content: String.raw`求幂级数 $S(x)=\sum_{n=1}^{\infty}\frac{x^n}{n}$ 的收敛域与和函数，并解释逐项求导的思路。` },
    { id: 'demo-answer', role: 'assistant', content: String.raw`# 从无穷级数，到一个熟悉的函数

有些式子看起来很长，但只要换一个角度，就会变得简单。这里的关键是：**先求导，消去分母中的 $n$，再积分还原。**

## 01 · 先确定收敛半径

对一般项 $a_n=\frac{x^n}{n}$ 使用比值判别法：

$$
\lim_{n\to\infty}\left|\frac{a_{n+1}}{a_n}\right|
=\lim_{n\to\infty}\frac{n}{n+1}|x|=|x|
$$

因此收敛半径为 $R=1$。两个端点需要单独讨论：$x=1$ 时为调和级数，发散；$x=-1$ 时为交错调和级数，收敛。**收敛域是 $[-1,1)$。**

## 02 · 逐项求导，让结构显现

在收敛区间 $(-1,1)$ 内，幂级数可以逐项求导：

\[
S'(x)=\sum_{n=1}^{\infty}\left(\frac{x^n}{n}\right)'
=\sum_{n=1}^{\infty}x^{n-1}
=\frac{1}{1-x}
\]

> 为什么可以这样做？幂级数在收敛半径内部具有逐项求导与积分的性质。端点处不能直接照搬，需要另行验证。

## 03 · 积分还原，别忘了初值

由 $S(0)=0$，对导数从 $0$ 积分到 $x$：

\[
S(x)=S(0)+\int_0^x S'(t)\,dt
=\int_0^x\frac{1}{1-t}\,dt
=-\ln(1-x)
\]

## 04 · 把端点接回来

在 $x=-1$ 处，根据阿贝尔定理：

$$
\boxed{S(x)=-\ln(1-x),\qquad x\in[-1,1)}
$$

特别地，$S(-1)=-\ln 2$。注意交错调和级数的首项是 $-1$，不要把符号写反。

---

### 记住这条解题路径

| 步骤 | 目的 |
| --- | --- |
| 求收敛半径与端点 | 先确定操作范围 |
| 逐项求导 | 消去系数中的分母 |
| 定积分还原 | 自动确定积分常数 |
| 验证端点 | 补全和函数的定义域 |

你可以导入自己的 Markdown，或者点击「压力示例」试着阅读一份更长的笔记。` },
  ] };
}
export function stressBook(): Notebook {
  const example = demoBook().messages[1].content;
  return { id: newId(), title: '长文压力示例 · 120 组推导', updated: Date.now(), messages: [{ id: newId(), role: 'assistant', content: Array.from({ length: 120 }, (_, i) => `# 第 ${i + 1} 组推导\n\n${example}`).join('\n\n---\n\n') }] };
}
