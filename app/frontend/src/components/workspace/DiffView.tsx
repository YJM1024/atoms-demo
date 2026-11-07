import { useMemo } from 'react';
import { diffLines } from 'diff';
import { cn } from '@/lib/utils';

type RowType = 'add' | 'del' | 'same' | 'skip';
interface Row {
  type: RowType;
  text: string;
}

const CONTEXT = 3;

function buildRows(before: string, after: string) {
  const parts = diffLines(before, after);
  const rows: Row[] = [];
  let added = 0;
  let removed = 0;

  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added) {
      added += lines.length;
      lines.forEach((text) => rows.push({ type: 'add', text }));
      return;
    }
    if (part.removed) {
      removed += lines.length;
      lines.forEach((text) => rows.push({ type: 'del', text }));
      return;
    }
    const head = index === 0 ? 0 : CONTEXT;
    const tail = index === parts.length - 1 ? 0 : CONTEXT;
    if (lines.length > head + tail + 2) {
      lines.slice(0, head).forEach((text) => rows.push({ type: 'same', text }));
      rows.push({ type: 'skip', text: `${lines.length - head - tail} 行未改动` });
      lines.slice(lines.length - tail).forEach((text) => rows.push({ type: 'same', text }));
    } else {
      lines.forEach((text) => rows.push({ type: 'same', text }));
    }
  });

  return { rows, added, removed };
}

const SIGN: Record<RowType, string> = { add: '+', del: '−', same: ' ', skip: '⋯' };

export default function DiffView({ before, after }: { before: string; after: string }) {
  const { rows, added, removed } = useMemo(() => buildRows(before, after), [before, after]);

  if (before === after) {
    return <p className="p-6 text-center text-sm text-muted-foreground">两个版本的代码完全相同。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="flex items-center gap-3 border-b border-border px-4 py-2 font-mono text-xs tabular-nums">
        <span className="text-foreground">+{added} 行</span>
        <span className="text-destructive">−{removed} 行</span>
      </p>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.6]" role="table" aria-label="代码差异">
        {rows.map((row, i) => (
          <div
            key={i}
            role="row"
            className={cn(
              'flex',
              row.type === 'add' && 'bg-accent/15',
              row.type === 'del' && 'bg-destructive/10 text-muted-foreground',
              row.type === 'skip' && 'bg-muted text-muted-foreground',
            )}
          >
            <span aria-hidden="true" className="w-6 shrink-0 select-none text-center text-muted-foreground">
              {SIGN[row.type]}
            </span>
            <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-all pr-3', row.type === 'del' && 'line-through decoration-destructive/50')}>
              {row.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
