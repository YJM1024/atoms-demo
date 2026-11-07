/**
 * Agent-team pipeline shared by the workspace page and the end-to-end harness:
 * PM → (Architect) → Engineer (full file or SEARCH/REPLACE patches, with
 * continuation on truncation) → Tester with an automatic repair loop.
 *
 * Version rule: one user request = one version. Generated code, failed test
 * results and every auto-fix attempt stay a draft; the version is saved once,
 * after testing (and fixing) has finished. A provider error or interruption
 * therefore never leaves a half-finished version behind.
 */
import {
  type Msg,
  architectMessages,
  cleanStreamingCode,
  continueMessages,
  countLines,
  engineerMessages,
  extractHtml,
  extractTitle,
  fixMessages,
  isComplete,
  isRunnableHtml,
  patchMessages,
  pmMessages,
  streamText,
  stripFence,
} from './agents';
import { applyPatch, normalizeEol, parsePatches } from './patch';
import { type TestReport, formatReport, runTests } from './tester';
import type { AgentRole, ChatMessage, VersionMode } from './types';

export const MAX_FIX_ROUNDS = 3;
export const MAX_CONTINUATIONS = 3;

/** Test outcome stored with a version. `fixRounds` counts the rounds of this run only. */
export interface VersionMeta {
  fixRounds: number;
  testPassed: boolean | null;
  testIssues: string;
}

export interface PipelineHooks {
  push: (role: AgentRole, content?: string, status?: ChatMessage['status']) => string;
  patch: (msgId: string, changes: Partial<ChatMessage>) => void;
  /** Code of the current head version (the base for incremental edits). */
  getCode: () => string;
  getVersion: () => number;
  /** Creates the next version; called once per user request. */
  saveVersion: (code: string, mode: VersionMode, summary: string, meta: VersionMeta, title?: string) => Promise<number>;
  /** Overwrites an existing version (manual "auto-fix again"); `meta.fixRounds` is added to the stored count. */
  updateVersion: (version: number, code: string, meta: VersionMeta) => Promise<void>;
  onStream?: (code: string) => void;
  onLive?: (code: string, force?: boolean) => void;
  onLiveCancel?: () => void;
  onEngineerStart?: () => void;
  /** Called when the backend had to fall back to another model. */
  onNotice?: (notice: string) => void;
}

export interface QualityResult {
  passed: boolean;
  fixRounds: number;
  reports: TestReport[];
  /** Final draft code after testing and fixing. */
  code: string;
}

export interface RoundResult extends QualityResult {
  mode: VersionMode;
  version: number;
  title: string | null;
  continuations: number;
}

interface PatchResult {
  code: string | null;
  reason: string;
  total: number;
}

export function metaOf(result: QualityResult): VersionMeta {
  const last = result.reports[result.reports.length - 1];
  return {
    fixRounds: result.fixRounds,
    testPassed: result.passed,
    testIssues: result.passed ? '' : (last?.issues ?? []).join('\n'),
  };
}

/** Streams a whole HTML file; when it stops before </html>, asks the model to continue. */
export async function writeFullFile(h: PipelineHooks, stepId: string, base: Msg[], label: string) {
  let code = '';
  let continuations = 0;
  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
    const prefix = code;
    const request = attempt === 0 ? base : continueMessages(base, prefix);
    const raw = await streamText(
      request,
      (t) => {
        const partial = attempt === 0 ? cleanStreamingCode(t) : prefix + stripFence(t);
        h.onStream?.(partial);
        if (/<body/i.test(partial)) h.onLive?.(partial);
        const note = attempt ? `（输出达到单次上限，第 ${attempt} 次续写）` : '';
        h.patch(stepId, { content: `${label}${note} 已写入 **${countLines(partial)}** 行` });
      },
      h.onNotice,
    );
    code = attempt === 0 ? cleanStreamingCode(raw) : prefix + stripFence(raw);
    if (isComplete(extractHtml(code))) break;
    continuations += 1;
  }
  const html = extractHtml(code);
  if (!isRunnableHtml(html)) throw new Error('模型没有返回可运行的 HTML，请重试。');
  return { html, continuations: Math.min(continuations, MAX_CONTINUATIONS) };
}

/** Streams SEARCH/REPLACE patches against `baseCode` and applies completed blocks to the live preview. */
export async function writePatches(
  h: PipelineHooks,
  stepId: string,
  request: Msg[],
  label: string,
  baseCode: string,
): Promise<PatchResult> {
  const base = normalizeEol(baseCode);
  let applied = 0;
  const raw = await streamText(
    request,
    (t) => {
      h.onStream?.(t);
      const blocks = parsePatches(t);
      if (blocks.length > applied) {
        let working = base;
        let ok = 0;
        for (const block of blocks) {
          const next = applyPatch(working, block);
          if (next === null) break;
          working = next;
          ok += 1;
        }
        applied = blocks.length;
        h.onLive?.(working);
        h.patch(stepId, { content: `${label} 已生成 **${blocks.length}** 个补丁，成功应用 ${ok} 个` });
      }
    },
    h.onNotice,
  );

  const blocks = parsePatches(raw);
  if (!blocks.length) return { code: null, reason: '没有生成有效的补丁块', total: 0 };
  let working = base;
  for (let i = 0; i < blocks.length; i += 1) {
    const next = applyPatch(working, blocks[i]);
    if (next === null) return { code: null, reason: `第 ${i + 1} 个补丁无法在当前代码中定位`, total: blocks.length };
    working = next;
  }
  if (working === base) return { code: null, reason: '补丁没有改变任何代码', total: blocks.length };
  return { code: working, reason: '', total: blocks.length };
}

/**
 * Tester loop on a draft: test it; on failure let the engineer repair it and re-test.
 * Nothing is persisted here — intermediate drafts are shown in the conversation only.
 */
export async function qualityLoop(
  h: PipelineHooks,
  userText: string,
  startCode: string,
  version: number,
  maxRounds = MAX_FIX_ROUNDS,
): Promise<QualityResult> {
  const reports: TestReport[] = [];
  let code = startCode;
  for (let round = 0; ; round += 1) {
    const testerId = h.push('tester', `正在检测 v${version}…`);
    const report = await runTests(code, (step) => h.patch(testerId, { content: `正在检测 v${version}：${step}…` }));
    reports.push(report);
    const ctx = { version, round, maxRounds };

    if (report.passed) {
      h.patch(testerId, { status: 'done', content: formatReport(report, { ...ctx, outcome: 'pass' }) });
      return { passed: true, fixRounds: round, reports, code };
    }
    if (round >= maxRounds) {
      h.patch(testerId, { status: 'error', needsFix: true, content: formatReport(report, { ...ctx, outcome: 'fail' }) });
      return { passed: false, fixRounds: round, reports, code };
    }
    h.patch(testerId, { status: 'done', content: formatReport(report, { ...ctx, outcome: 'fixing' }) });

    const fixRound = round + 1;
    const engId = h.push('engineer', `第 ${fixRound} 轮修复：正在分析测试报告…`);
    h.onEngineerStart?.();
    let html: string | null = null;
    let how = '';
    if (!report.truncated) {
      const result = await writePatches(
        h,
        engId,
        fixMessages({ userText, currentCode: normalizeEol(code), issues: report.issues }),
        `第 ${fixRound} 轮修复：`,
        code,
      );
      html = result.code;
      how = result.code ? `通过 **${result.total}** 个补丁修复` : `补丁修复失败（${result.reason}），已改为整体重写`;
    }
    if (!html) {
      h.onLive?.(code, true);
      const full = await writeFullFile(
        h,
        engId,
        engineerMessages({
          userText,
          pmPlan: '修复测试工程师报告的问题，保持原有功能与界面。',
          currentCode: code,
          issues: report.issues,
        }),
        `第 ${fixRound} 轮修复：正在整体重写…`,
      );
      html = full.html;
      how = how || (report.truncated ? '代码被截断，已整体重写' : '已整体重写');
    }
    code = html;
    h.onLive?.(code, true);
    h.patch(engId, {
      status: 'done',
      content: `第 ${fixRound} 轮修复完成：${how}。修复结果仍属于 v${version} 的草稿，不单独保存为版本，交给测试工程师复测。`,
    });
  }
}

function verdict(q: QualityResult, version: number): string {
  if (q.passed) {
    const how = q.fixRounds ? `经过 **${q.fixRounds}** 轮自动修复后测试通过` : '测试一次通过';
    return `${how}，已保存为 **v${version}**。`;
  }
  const left = q.reports[q.reports.length - 1]?.issues.length ?? 0;
  return `经过 **${q.fixRounds}** 轮自动修复仍有 ${left} 个问题未解决，已保存为 **v${version}**（测试未通过）。点击测试报告下方的按钮可再次自动修复，结果会更新 v${version}，不会新增版本。`;
}

/** One full round for a user message. Throws on provider errors; callers mark the running step. */
export async function runRound(h: PipelineHooks, userText: string, options: { maxFixRounds?: number } = {}): Promise<RoundResult> {
  const iterate = h.getCode().trim().length > 0;
  const candidate = h.getVersion() + 1;
  h.push('user', userText, 'done');

  let stepId = h.push('pm');
  const pmPlan = await streamText(pmMessages(userText, iterate), (t) => h.patch(stepId, { content: t }), h.onNotice);
  h.patch(stepId, { content: pmPlan, status: 'done' });

  let html: string;
  let mode: VersionMode;
  let report: string;
  let title: string | null = null;
  let continuations = 0;

  if (!iterate) {
    stepId = h.push('architect');
    const archPlan = await streamText(architectMessages(userText, pmPlan), (t) => h.patch(stepId, { content: t }), h.onNotice);
    h.patch(stepId, { content: archPlan, status: 'done' });

    stepId = h.push('engineer', '正在写入代码…');
    h.onEngineerStart?.();
    const full = await writeFullFile(h, stepId, engineerMessages({ userText, pmPlan, archPlan }), '正在写入代码…');
    html = full.html;
    continuations = full.continuations;
    mode = 'full';
    report = `共 ${countLines(html)} 行单文件 HTML/CSS/JS${continuations ? `（含 ${continuations} 次续写）` : ''}`;
    title = extractTitle(pmPlan);
  } else {
    stepId = h.push('engineer', '正在定位需要修改的代码…');
    h.onEngineerStart?.();
    const base = h.getCode();
    const result = await writePatches(h, stepId, patchMessages({ userText, pmPlan, currentCode: normalizeEol(base) }), '增量修改中…', base);
    if (result.code) {
      html = result.code;
      mode = 'patch';
      report = `通过 **${result.total}** 个 SEARCH/REPLACE 补丁完成增量修改，未改动的代码保持原样`;
    } else {
      h.patch(stepId, { content: `补丁应用失败（${result.reason}），改为基于当前代码整体重写…` });
      h.onLive?.(base, true);
      const full = await writeFullFile(
        h,
        stepId,
        engineerMessages({ userText, pmPlan, currentCode: base }),
        `补丁应用失败（${result.reason}），正在整体重写…`,
      );
      html = full.html;
      continuations = full.continuations;
      mode = 'rewrite';
      report = `补丁未能完整应用（${result.reason}），已自动改为整体重写，共 ${countLines(html)} 行`;
    }
  }

  h.onLive?.(html, true);
  h.patch(stepId, { status: 'done', content: `${report}。已交给测试工程师检测，测试与修复全部完成后才保存为 **v${candidate}**。` });

  const quality = await qualityLoop(h, userText, html, candidate, options.maxFixRounds ?? MAX_FIX_ROUNDS);
  h.onLiveCancel?.();
  const version = await h.saveVersion(quality.code, mode, userText.replace(/\s+/g, ' ').slice(0, 80), metaOf(quality), title ?? undefined);
  h.patch(stepId, { version, content: `${report}。\n\n${verdict(quality, version)}` });
  return { ...quality, mode, version, title, continuations };
}

/** "Auto-fix again" for a head version that failed testing: repairs it in place, no new version. */
export async function fixHead(h: PipelineHooks, userText: string, maxRounds = MAX_FIX_ROUNDS): Promise<QualityResult & { version: number }> {
  const version = h.getVersion();
  const quality = await qualityLoop(h, userText, h.getCode(), version, maxRounds);
  h.onLiveCancel?.();
  await h.updateVersion(version, quality.code, metaOf(quality));
  const left = quality.reports[quality.reports.length - 1]?.issues.length ?? 0;
  const msgId = h.push(
    'engineer',
    quality.passed
      ? `再次自动修复后测试通过，已更新 **v${version}**（没有新增版本）。`
      : `再次自动修复后仍有 ${left} 个问题未解决，已更新 **v${version}** 的代码，仍标记为测试未通过。`,
    'done',
  );
  h.patch(msgId, { version });
  return { ...quality, version };
}
