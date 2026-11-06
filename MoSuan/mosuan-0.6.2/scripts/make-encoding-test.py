"""Generate byte-preserving mobile import fixtures and a self-contained test guide."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
out = root / 'artifacts' / 'mobile-encoding'
out.mkdir(parents=True, exist_ok=True)

common = r'''# 墨算手机中文编码验证

## 中文检查：TOP-ENCODING

你好，世界！数学笔记：积分、极限、幂级数、矩阵、傅里叶变换。

标点应保持：，。！？；：“中文”（括号）【方括号】

**中文加粗应正常**，*中文斜体应正常*。数字：0123456789；英文：Markdown / LaTeX。

## 四种公式分隔符

美元行内公式：$x^2+y^2=1$。

反斜杠行内公式：\(\lim_{x\to0}\frac{\sin x}{x}=1\)。

$$
\int_0^1 x\,dx=\frac{1}{2}
$$

\[
A=\begin{bmatrix}1&2\\3&4\end{bmatrix},\qquad \det(A)=-2
\]

## 代码保护

下面的代码应该保留美元符号、反斜杠和源码，不转换成公式：

```tex
$x^2+y^2=1$
\[\frac{1}{2}\]
```

行内代码 `$x^2$` 也应该保留源码。

## 检查表

| 检查项 | 预期 |
| --- | --- |
| 中文 | 数学笔记、积分、矩阵 |
| 行内公式 | $a_n=\frac{1}{n^2}$ |
| 文本 | 保存后重新打开仍然一致 |

## 全文末尾：ENCODING-FINAL-OK

看到这一行说明该小文件已完整读取。这里只测试编码与基本排版，不代表长文压力测试通过。
'''

traditional = r'''# Big5 繁體中文驗證

中文測試：數學公式、積分、矩陣、筆記保存。

請手動選擇「Big5（繁体中文）」，此後以上文字應正常顯示。

公式：$x^2+y^2=1$。

\[
\int_0^1 x\,dx=\frac{1}{2}
\]

## 全文末尾：BIG5-FINAL-OK
'''

cases = []

def fixture(name, text, codec, expected_encoding, requested='auto', warning=False):
    data = text.encode(codec, errors='strict')
    assert data.decode(codec) == text
    (out / name).write_bytes(data)
    cases.append(dict(file=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                      requested=requested, expectedEncoding=expected_encoding,
                      expectedText=text, warning=warning))

fixture('01-UTF8.md', common, 'utf-8', 'utf-8')
fixture('02-UTF8-BOM.md', common, 'utf-8-sig', 'utf-8')
fixture('03-GBK.md', common, 'gbk', 'gb18030')
extended = common.replace('## 中文检查：TOP-ENCODING', '## 中文检查：TOP-ENCODING\n\nGB18030 四字节扩展字符：😀 𠀀。字形取决于手机字体；导出后应保留这两个字符。')
fixture('04-GB18030.md', extended, 'gb18030', 'gb18030')
fixture('05-UTF16LE-BOM.md', '\ufeff' + common, 'utf-16-le', 'utf-16le')
cases[-1]['expectedText'] = common
fixture('06-UTF16BE-BOM.md', '\ufeff' + common, 'utf-16-be', 'utf-16be')
cases[-1]['expectedText'] = common
fixture('07-UTF16LE-noBOM.md', common, 'utf-16-le', 'utf-16le')
fixture('08-UTF16BE-noBOM.md', common, 'utf-16-be', 'utf-16be')
fixture('09-Big5-manual.md', traditional, 'big5', 'big5', requested='big5')
damaged = b'\xef\xbb\xbf# Broken UTF-8\n\x81'
(out / '10-damaged-expected-error.md').write_bytes(damaged)
cases.append(dict(file='10-damaged-expected-error.md', bytes=len(damaged), sha256=hashlib.sha256(damaged).hexdigest(),
                  requested='auto', expectedError=True))
fixture('11-existing-replacement.md', '# 原文已有替代字符\n\n这一行的 � 是测试数据，应该提示无法还原。\n\nREPLACEMENT-FINAL-OK\n',
        'utf-8', 'utf-8', warning=True)

guide = '''# 墨算 Android 0.3.1 文件编码实机验证

本包用于验证编码转换，不需要电脑服务、登录 DeepSeek 或调用 AI。
请先覆盖安装 0.3.1，保留旧版笔记。预计测试用时 5–10 分钟。

## 文件如何传到手机

将整个 ZIP 以“文件”形式传到手机后解压。直接用墨算选择解压出来的文件。
不要先用其他编辑器打开后另存，也不要复制内容到聊天窗口再粘贴，避免传输过程改变原编码。

## 第一步：先测试最重要的 GBK 文件

1. 打开墨算 → 左上角菜单 → 导入文本 → 选择文件 → 03-GBK.md。
2. 保持“自动识别（推荐）”。提示应包含“GBK / GB18030”，并说明导出使用 UTF-8。
3. 预览应显示“你好，世界！数学笔记：积分、极限、幂级数、矩阵、傅里叶变换。”，不能出现乱码或 �。
4. 点击“导入并阅读”。检查四种公式、矩阵、代码块，滚动到 ENCODING-FINAL-OK。
5. 先用 KaTeX，再切换 MathJax；公式都应显示，代码块和行内代码保留源码是正确行为。
6. 关闭墨算并重新打开该笔记，中文、公式和末尾标记仍应完整。
7. 导出 Markdown，将文件保存到手机；再导入这个导出文件。“自动识别”提示应为“已按 UTF-8 读取”，正文保持一致。

## 第二步：按表验证其他文件

01–08 默认均使用“自动识别”，逐个导入预览并阅读。03 的完整保存导出流程通过后，其他文件可先只检查预览与公式。

| 文件 | 预期编码 / 结果 |
| --- | --- |
| 01-UTF8.md | UTF-8，中文及公式正常 |
| 02-UTF8-BOM.md | UTF-8，标题前无多余符号 |
| 03-GBK.md | GBK / GB18030，中文及公式正常 |
| 04-GB18030.md | GBK / GB18030；包含 😀 和扩展汉字 𠀀 |
| 05-UTF16LE-BOM.md | UTF-16 LE，标题前无多余符号 |
| 06-UTF16BE-BOM.md | UTF-16 BE，中文正常 |
| 07-UTF16LE-noBOM.md | UTF-16 LE，提示自动识别仅供参考 |
| 08-UTF16BE-noBOM.md | UTF-16 BE，提示自动识别仅供参考 |
| 09-Big5-manual.md | 手动选择 Big5 后，“中文測試：數學公式、積分、矩陣、筆記保存。”完整，末尾 BIG5-FINAL-OK |
| 10-damaged-expected-error.md | 故意损坏：提示无法完整读取，预览为空，“导入并阅读”禁用；这是通过，不是失败 |
| 11-existing-replacement.md | 原文故意带 �：提示原文已有替代字符、转换无法还原；不要把这一项记录为意外乱码 |

04 的扩展汉字可能因手机字体缺字显示成方框，不等于解码失败；请连同截图反馈，并保留导出文件供核对。
09 不要求自动判断成 Big5；如果自动预览乱码，手动切换后正确即通过。
10 测试后再选择 01，应恢复正常预览并允许导入，不能保留旧错误。

## 第三步：反馈结果

使用“实机测试记录.txt”逐项填写，或直接回复以下信息：

- 手机型号、Android 版本、墨算版本：
- 01–08 哪些正常 / 哪些乱码（写文件编号）：
- 09 手动 Big5 是否正常：
- 10 是否提示错误并禁止导入；再选 01 是否恢复：
- 11 是否提示原文已含 �：
- GBK 笔记重启后是否保留：
- 导出后重新导入，是否识别为 UTF-8：
- KaTeX / MathJax 是否均正常：

如失败，请截图“文件编码提示 + 中文预览”，标明文件编号，不要只截正文末尾。
不要将这些文件发送给 AI。全部测试保留在手机本地，不产生 API 费用。

本包已在生成时校验原始编码往返，并由当前墨算解码函数验证；手机实机结果需要由使用者填写。
'''
(out / '先读我-手机测试步骤.md').write_text(guide, encoding='utf-8', newline='\n')
record = '''墨算文件编码实机测试记录（未填写不代表通过）
手机型号：
Android 版本：
墨算版本：
测试日期：

01 UTF-8：
02 UTF-8 BOM：
03 GBK：
04 GB18030（含扩展字符）：
05 UTF-16 LE BOM：
06 UTF-16 BE BOM：
07 UTF-16 LE 无 BOM：
08 UTF-16 BE 无 BOM：
09 手动 Big5：
10 损坏文件正确报错并禁止导入：
10 后改选 01 能恢复导入：
11 原文替代字符警告：

03 关闭 App 后重新打开，内容保留：
03 导出文件重新导入，显示 UTF-8 且内容一致：
KaTeX 公式显示：
MathJax 公式显示：
代码块保留源码：
异常截图 / 文件编号 / 说明：
'''
(out / '实机测试记录.txt').write_text(record, encoding='utf-8-sig', newline='\n')
(out / 'manifest.json').write_text(json.dumps(dict(physicalDeviceTested=False, cases=cases), ensure_ascii=False, indent=2), encoding='utf-8')
archive = root / 'artifacts' / '墨算手机编码验证包.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in sorted(out.iterdir()):
        if item.is_file():
            z.write(item, arcname=item.name)
print(json.dumps(dict(archive=str(archive), fixtures=len(cases), bytes=archive.stat().st_size), ensure_ascii=False))
