import { client } from './api';

/** Backend alias: the AI hub routes it to the DeepSeek provider configured server-side. */
export const AGENT_MODEL = 'agent';
/** Display label only; the real model name lives in the backend configuration. */
export const MODEL = 'DeepSeek';

/** Strips the backend "[ERROR]" stream marker so messages read naturally in the chat. */
export const cleanError = (message?: string) => (message || '模型调用失败').replace(/^\s*\[ERROR\]\s*/, '');

/** Backend notice emitted when the configured model is unavailable and a fallback took over. */
const NOTICE_RE = /^\s*\[提示\][^\n]*\n?/;
export const extractNotice = (text: string) => text.match(NOTICE_RE)?.[0].replace(/^\s*\[提示\]\s*/, '').trim() ?? null;
export const stripNotice = (text: string) => text.replace(NOTICE_RE, '');

type Role = 'system' | 'user' | 'assistant';
export interface Msg {
  role: Role;
  content: string;
}

/** Streams a completion; `onText` receives the accumulated text. */
export function streamText(messages: Msg[], onText: (full: string) => void, onNotice?: (notice: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let full = '';
    let settled = false;
    let noticed = false;
    client.ai
      .gentxt({
        messages,
        model: AGENT_MODEL,
        stream: true,
        onChunk: (chunk: { content?: string }) => {
          const piece = chunk?.content ?? '';
          if (/^\s*\[ERROR\]/.test(piece)) {
            settled = true;
            reject(new Error(cleanError(piece)));
            return;
          }
          full += piece;
          if (!noticed) {
            const notice = extractNotice(full);
            if (notice) {
              noticed = true;
              full = stripNotice(full);
              onNotice?.(notice);
            }
          }
          onText(full);
        },
        onComplete: (result: { content?: string }) => {
          settled = true;
          const final = result?.content ? stripNotice(result.content) : '';
          resolve(final.length >= full.length ? final : full);
        },
        onError: (error: { message?: string }) => {
          if (settled) return;
          settled = true;
          reject(new Error(cleanError(error?.message)));
        },
      })
      .then(() => {
        if (!settled) resolve(full);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        reject(new Error(cleanError((err as Error)?.message)));
      });
  });
}

const PM_SYSTEM = `你是一名资深产品经理，负责把用户的一句话需求拆解成可开发的单页网页应用需求。
输出要求（Markdown，使用用户的语言，总长度不超过 180 字）：
第一行必须是 "# 应用名称"（不超过 12 个字）。
随后用 3-5 个短列表项列出核心功能，最后一行以 "**体验目标：**" 开头描述一句交互体验目标。
不要写代码，不要寒暄。`;

const PM_ITERATE_SYSTEM = `你是一名资深产品经理。用户正在对已有的网页应用提出修改意见。
请用 2-4 个短列表项（Markdown，使用用户的语言，不超过 120 字）说明本次需要修改的具体点和验收标准。不要写代码，不要寒暄。`;

const ARCHITECT_SYSTEM = `你是一名前端架构师。根据产品需求，为一个"单文件 HTML/CSS/JS"网页应用给出简洁技术方案。
输出要求（Markdown，使用用户的语言，不超过 180 字）：
- **页面结构**：主要区域划分
- **数据与状态**：核心数据结构、是否使用 localStorage
- **关键交互**：2-3 个关键交互实现要点
- **视觉风格**：配色与排版建议
不要写代码，不要寒暄。`;

const ENGINEER_SYSTEM = `你是一名顶尖前端工程师。你只输出一个完整、可直接在浏览器 iframe 中运行的单文件 HTML 应用。
运行环境：沙箱 iframe（不同源），之后会有测试工程师自动运行并检测异常。
硬性要求：
1. 以 <!DOCTYPE html> 开头，必须完整输出到 </html> 结束；所有 CSS 写在 <style> 中，所有 JS 写在 <body> 末尾的 <script> 中。
2. 控制篇幅以免输出被截断：总长度不超过 550 行，CSS 精简复用，不写大段注释、重复代码或冗长数据。
3. 不引用任何外部或本地资源（脚本、样式、字体、图片）；图标用内联 SVG 或 Emoji，只用原生 HTML/CSS/JS。
4. 脚本中 getElementById / querySelector 用到的元素必须在 HTML 中真实存在；访问前确保 DOM 已就绪。
5. 表单提交必须调用 event.preventDefault()；不要使用 alert 阻塞流程。
6. localStorage 读写必须包在 try/catch 中，JSON.parse 失败时回退到默认数据。
7. 界面文案使用用户的语言；布局响应式，视觉精致现代，交互完整可用，无占位功能，不在控制台输出错误。
8. 只输出代码本身，不要任何解释，不要使用 Markdown 代码块标记。`;

const PATCH_SYSTEM = `你是一名顶尖前端工程师，正在对一个已有的单文件 HTML 应用做"增量修改"。
只输出 SEARCH/REPLACE 补丁块，绝对不要输出完整文件，不要任何解释，不要使用 Markdown 代码块标记。
补丁块格式（标记行必须原样输出）：
<<<<<<< SEARCH
从当前代码中原样复制的连续若干行（逐字一致，包括缩进和空格）
=======
替换后的内容
>>>>>>> REPLACE

规则：
1. SEARCH 内容必须能在当前代码中唯一定位，通常 2-12 行；不要整段复制大块代码。
2. 只改需要改的地方；多处修改就输出多个补丁块，按在代码中出现的先后顺序排列。
3. 新增内容时，SEARCH 选取插入点附近的已有行，REPLACE 中保留这些行并加入新内容。
4. 删除内容时，REPLACE 留空或只保留需要的行。
5. 保持现有功能不被破坏，界面文案使用用户的语言。`;

export function patchMessages(params: { userText: string; pmPlan: string; currentCode: string }): Msg[] {
  return [
    { role: 'system', content: PATCH_SYSTEM },
    {
      role: 'user',
      content: `当前应用的完整代码：\n${params.currentCode}\n\n用户的修改意见：${params.userText}\n\n产品经理整理的修改点：\n${params.pmPlan}\n\n请只输出 SEARCH/REPLACE 补丁块。`,
    },
  ];
}

/** Asks the engineer to repair tester-reported problems as SEARCH/REPLACE patches. */
export function fixMessages(params: { userText: string; currentCode: string; issues: string[] }): Msg[] {
  return [
    { role: 'system', content: PATCH_SYSTEM },
    {
      role: 'user',
      content: `当前应用的完整代码：\n${params.currentCode}\n\n用户的原始需求：${params.userText}\n\n测试工程师在沙箱中运行该应用，发现以下问题：\n${params.issues
        .map((issue, i) => `${i + 1}. ${issue}`)
        .join('\n')}\n\n请找出根本原因并只输出 SEARCH/REPLACE 补丁块修复全部问题，不要改动无关代码。`,
    },
  ];
}

const CONTINUE_PROMPT =
  '你的输出在中途被截断了。请从中断处直接接着输出剩余代码，直到 </html> 结束。不要重复已输出的内容，不要任何解释，不要使用 Markdown 代码块标记。';

/** Builds a continuation request for output that stopped before </html>. */
export function continueMessages(base: Msg[], partial: string): Msg[] {
  return [...base, { role: 'assistant', content: partial }, { role: 'user', content: CONTINUE_PROMPT }];
}

export const stripFence = (text: string) => text.replace(/^\s*```(?:html)?[ \t]*\n?/i, '').replace(/```\s*$/, '');

export const isComplete = (html: string) => /<\/html>\s*$/i.test(html.trim());

export function pmMessages(userText: string, iterate: boolean): Msg[] {
  return [
    { role: 'system', content: iterate ? PM_ITERATE_SYSTEM : PM_SYSTEM },
    { role: 'user', content: userText },
  ];
}

export function architectMessages(userText: string, pmPlan: string): Msg[] {
  return [
    { role: 'system', content: ARCHITECT_SYSTEM },
    { role: 'user', content: `用户原始需求：${userText}\n\n产品需求拆解：\n${pmPlan}` },
  ];
}

export function engineerMessages(params: {
  userText: string;
  pmPlan: string;
  archPlan?: string;
  currentCode?: string;
  issues?: string[];
}): Msg[] {
  const { userText, pmPlan, archPlan, currentCode, issues } = params;
  const issueText = issues?.length
    ? `\n\n测试工程师发现的问题（必须全部修复）：\n${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`
    : '';
  const content = currentCode
    ? `以下是当前应用的完整代码：\n${currentCode}\n\n用户的修改意见：${userText}\n\n产品经理整理的修改点：\n${pmPlan}${issueText}\n\n请在保留现有功能的基础上完成修改，输出修改后的完整 HTML 文件。`
    : `用户需求：${userText}\n\n产品需求：\n${pmPlan}\n\n技术方案：\n${archPlan ?? ''}${issueText}\n\n请输出完整的 HTML 文件。`;
  return [
    { role: 'system', content: ENGINEER_SYSTEM },
    { role: 'user', content },
  ];
}

/** Strips markdown fences / chatter from a (possibly partial) model output. */
export function cleanStreamingCode(raw: string): string {
  let s = raw.replace(/^[\s\S]*?```(?:html)?\s*\n/i, (m) => (m.includes('```') ? '' : m));
  const start = s.search(/<!DOCTYPE|<html/i);
  if (start > 0) s = s.slice(start);
  return s.replace(/```\s*$/, '');
}

export function extractHtml(raw: string): string {
  const fence = raw.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  let s = fence ? fence[1] : raw;
  const start = s.search(/<!DOCTYPE|<html/i);
  if (start > 0) s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) s = s.slice(0, end + '</html>'.length);
  return s.trim();
}

export function isRunnableHtml(html: string): boolean {
  return html.length > 120 && /<(html|body|div|main|canvas|script)/i.test(html);
}

export function extractTitle(pmPlan: string): string | null {
  const match = pmPlan.match(/^#\s+(.+)$/m);
  return match ? match[1].trim().slice(0, 30) : null;
}

export function countLines(code: string): number {
  return code ? code.split('\n').length : 0;
}
