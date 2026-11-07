import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Eye, Loader2, RotateCcw } from 'lucide-react';
import DiffView from './DiffView';
import { MODE_LABEL, testLabel } from '@/lib/export';
import { parseDate } from '@/lib/projects';
import type { ProjectVersion } from '@/lib/types';
import { cn } from '@/lib/utils';

interface VersionPanelProps {
  versions: ProjectVersion[];
  headVersion: number;
  viewVersion: number;
  busy: boolean;
  rollingBack: number | null;
  onPreview: (version: ProjectVersion) => void;
  onRollback: (version: ProjectVersion) => void;
}

function VersionSelect({
  label,
  value,
  onChange,
  versions,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  versions: ProjectVersion[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-full border border-border bg-card px-3 font-mono text-xs text-foreground"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.version}>
            v{v.version}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function VersionPanel({
  versions,
  headVersion,
  viewVersion,
  busy,
  rollingBack,
  onPreview,
  onRollback,
}: VersionPanelProps) {
  const [base, setBase] = useState(0);
  const [target, setTarget] = useState(0);

  useEffect(() => {
    setTarget(versions[0]?.version ?? 0);
    setBase(versions[1]?.version ?? versions[0]?.version ?? 0);
  }, [versions]);

  const byVersion = useMemo(() => new Map(versions.map((v) => [v.version, v])), [versions]);

  if (!versions.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        每次提需求，从生成、测试到自动修复全部完成后才保存为一个版本，第一次完成后会出现在这里。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="max-h-[42%] shrink-0 divide-y divide-border overflow-y-auto border-b border-border" aria-label="版本列表">
        {versions.map((v) => {
          const isHead = v.version === headVersion;
          const date = parseDate(v.created_at);
          const test = testLabel(v);
          const issues = v.test_passed === false ? (v.test_issues ?? '').split('\n').filter(Boolean) : [];
          return (
            <li key={v.id} className={cn('flex items-center gap-3 px-4 py-2.5', v.version === viewVersion && 'bg-muted/60')}>
              <span className="w-10 shrink-0 font-mono text-sm font-bold tabular-nums">v{v.version}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground/80">
                    {MODE_LABEL[v.mode ?? ''] ?? '生成'}
                  </span>
                  {isHead && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">当前版本</span>}
                  {test && (
                    <span
                      title={issues.length ? `剩余问题：\n${issues.join('\n')}` : undefined}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px]',
                        v.test_passed ? 'bg-muted text-foreground/80' : 'bg-destructive/10 text-destructive',
                      )}
                    >
                      {test}
                      {issues.length ? ` · 剩余 ${issues.length} 个问题` : ''}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {v.summary}
                  {date ? ` · ${format(date, 'MM-dd HH:mm')}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPreview(v)}
                aria-label={`预览 v${v.version}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"
              >
                <Eye className="h-4 w-4" />
              </button>
              {!isHead && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRollback(v)}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-85 disabled:opacity-40"
                >
                  {rollingBack === v.version ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  回退
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <span className="text-sm font-semibold">版本对比</span>
        <VersionSelect label="从" value={base} onChange={setBase} versions={versions} />
        <VersionSelect label="到" value={target} onChange={setTarget} versions={versions} />
      </div>
      <div className="min-h-0 flex-1">
        <DiffView before={byVersion.get(base)?.code ?? ''} after={byVersion.get(target)?.code ?? ''} />
      </div>
    </div>
  );
}
