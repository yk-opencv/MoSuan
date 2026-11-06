import { useLocale } from '../lib/locale';
import { BookOpenText } from 'lucide-react';
import { MAX_ATTACHMENTS } from '../lib/attachments';

export function UsageGuide({ android }: { android: boolean }) {
  const { t } = useLocale();
  return <>
    <div className="modal-icon"><BookOpenText size={24} /></div>
    <h2>{t('使用说明')}</h2>
    <p>{t('导入、搜索、阅读和导出可以在本机完成。以下说明可离线查看。')}</p>
    <div className="guide-sections">
      <details open>
        <summary>{t('导入与搜索')}</summary>
        <ol>
          <li>{t('打开左上角菜单，点「导入文本」。选择 Markdown / TXT 文件，编码明确时会直接打开。想先核对内容，可勾选「导入前预览」。')}</li>
          <li>{t('也可把 Markdown 原文粘贴到输入框，点「导入并阅读」。不填标题时优先使用原文的一级标题。')}</li>
          <li>{t('公式显示为原文时，可在导入预览点「检测公式格式」，核对后补齐独立公式。正文里的公式可以选中，再点「将选区设为行内公式」。')}</li>
          <li>{t('点「搜索笔记」，输入关键词或 LaTeX 原文，例如 ')}<code>\frac</code>{t('。选中一条结果即可打开笔记并定位到对应内容。')}</li>
        </ol>
      </details>
      <details>
        <summary>{t('阅读与公式')}</summary>
        <p>{t('在「字体与外观」里调整字号、颜色和背景，或切换 KaTeX / MathJax。公式显示为原文时，先检查分隔符是否成对，也可试用另一种渲染方式。宽公式可以横向滑动。')}</p>
      </details>
      <details>
        <summary>{t('连接 DeepSeek 与图片提问')}</summary>
        {android ? <><p>{t('在「API 与连接」选择「手机网页直连」，点「登录 / 打开 DeepSeek」，登录后点「保存登录并返回」。联网提问时，回答直接出现在墨算。该方式是实验功能；登录过期时请重新保存登录。')}</p><p>{t('也可使用「电脑转发」：在同一可信 Wi-Fi 下，填写电脑端显示的服务地址和配对码。')}</p></> : <p>{t('在「API 与连接」选择电脑上已配置的对话服务。手机浏览器需要能访问电脑上的墨算服务。')}</p>}
        <p>{t('连接支持图片时，点输入框左下角的图片按钮，每条问题可选最多 ')}{MAX_ATTACHMENTS}{t(' 张。')}</p>
        <p>{t('回答中断后，可在该段下方查看保存状态。「重试」会重新提交原问题和图片。「从这里继续」会带上已收到的末段，追加一段续写。')}</p>
      </details>
      <details>
        <summary>{t('导出与本机保存')}</summary>
        <p>{t('顶部下载图标导出 Markdown；旁边的格式菜单可选择 PDF 或 Word。')}{android && 'PDF 在系统打印页面选择「另存为 PDF」，Word 在系统窗口选择保存位置。'}</p>
        <p>{android ? t('笔记保存在此 App 中。') : t('笔记保存在当前浏览器中。')}{t('换设备时，在「设置 → 备份与恢复」保存 .mosuan.json 文件。目标设备选中该文件，检查预览后确认恢复。问答、题图和置顶状态会随笔记迁移。')}</p>
      </details>
      <details>
        <summary>{t('乱码或连接失败怎么办？')}</summary>
        <ul>
          <li>{t('导入预览中出现乱码时，试着切换「文件编码」，或将原文件另存为 UTF-8 再导入。')}</li>
          <li>{android ? t('手机网页直连失败时，检查网络后重新登录。电脑转发失败时，先用手机浏览器打开电脑服务地址，检查网络是否可达。') : t('检查电脑端的墨算服务是否运行，并在「API 与连接」点击「刷新状态」。')}</li>
        </ul>
      </details>
    </div>
  </>;
}
