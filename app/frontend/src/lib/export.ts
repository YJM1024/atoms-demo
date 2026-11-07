import JSZip from 'jszip';
import type { ProjectVersion } from './types';

export const MODE_LABEL: Record<string, string> = {
  full: '初次生成',
  patch: '增量补丁',
  rewrite: '整体重写',
  rollback: '版本回退',
  fix: '自动修复',
};

/** Human-readable test outcome of a version; legacy rows without data return null. */
export function testLabel(v: Pick<ProjectVersion, 'fix_rounds' | 'test_passed'>): string | null {
  if (v.test_passed === null || v.test_passed === undefined) return null;
  const rounds = v.fix_rounds ?? 0;
  const fix = rounds ? `修复 ${rounds} 轮` : '未修复';
  return `${v.test_passed ? '测试通过' : '测试未通过'} · ${fix}`;
}

export function safeFileName(title: string): string {
  return (title || 'app').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) || 'app';
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Packs current code, every version snapshot and a README into one ZIP. */
export async function exportProjectZip(params: {
  title: string;
  prompt: string;
  code: string;
  version: number;
  versions: ProjectVersion[];
}) {
  const { title, prompt, code, version, versions } = params;
  const zip = new JSZip();
  zip.file('index.html', code);

  const folder = zip.folder('versions');
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  sorted.forEach((v) => folder?.file(`v${v.version}.html`, v.code));

  const readme = [
    `# ${title}`,
    '',
    `原始需求：${prompt}`,
    '',
    `当前版本：v${version}`,
    '',
    '## 使用方式',
    '',
    '用浏览器直接打开 `index.html` 即可运行，无需安装依赖。`versions/` 目录保存了每一轮生成的版本快照。',
    '',
    '## 版本记录',
    '',
    ...sorted.map((v) => {
      const test = testLabel(v);
      return `- v${v.version} · ${MODE_LABEL[v.mode ?? ''] ?? '生成'}${test ? ` · ${test}` : ''} · ${v.summary ?? ''}`;
    }),
    '',
  ].join('\n');
  zip.file('README.md', readme);

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${safeFileName(title)}-v${version}.zip`);
}
