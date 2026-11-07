import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ArrowUpRight, Loader2, Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProjectListProps {
  projects: Project[];
  onDelete: (projectId: string) => Promise<void>;
  /** Renames a project; omit to hide the rename action. */
  onRename?: (projectId: string, title: string) => Promise<void>;
  compact?: boolean;
  activeId?: string;
}

function timeAgo(value?: string) {
  if (!value) return '';
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
}

export default function ProjectList({ projects, onDelete, onRename, compact, activeId }: ProjectListProps) {
  const [pending, setPending] = useState<Project | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const startRename = (project: Project) => {
    setRenaming(project);
    setDraft(project.title);
  };

  const submitRename = async () => {
    const title = draft.trim();
    if (!renaming || !onRename || !title || title === renaming.title) {
      setRenaming(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(String(renaming.id), title.slice(0, 60));
      setRenaming(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ul className={cn('grid gap-4', compact ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3')}>
        {projects.map((p) => {
          const pid = String(p.id);
          return (
            <li
              key={p.id}
              className={cn(
                'project-card group relative flex flex-col rounded-3xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-foreground/30',
                activeId === pid && 'border-accent',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 text-base font-semibold leading-snug">{p.title}</h3>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground/80">
                  v{p.version ?? 0}
                </span>
              </div>
              {!compact && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.prompt}</p>}
              <div className="mt-4 flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-muted-foreground">更新于 {timeAgo(p.updated_at || p.created_at)}</span>
                <div className="flex items-center gap-1">
                  {onRename && (
                    <button
                      type="button"
                      aria-label={`重命名项目 ${p.title}`}
                      onClick={() => startRename(p)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`删除项目 ${p.title}`}
                    onClick={() => setPending(p)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <Link
                    to={`/project/${pid}`}
                    className="inline-flex h-9 items-center gap-1 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-85"
                  >
                    打开项目
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个项目？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pending?.title}」的所有版本和对话记录都会被删除，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">保留项目</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (pending) await onDelete(String(pending.id));
                setPending(null);
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!renaming} onOpenChange={(open) => !open && !saving && setRenaming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重命名项目</AlertDialogTitle>
            <AlertDialogDescription>只改项目名称，不影响已生成的代码和版本。</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-sm font-medium">
            <span className="sr-only">项目名称</span>
            <input
              value={draft}
              autoFocus
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitRename();
                }
              }}
              placeholder="输入新的项目名称"
              className="h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none focus:border-foreground/40"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} className="rounded-full">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || !draft.trim()}
              className="rounded-full"
              onClick={(e) => {
                e.preventDefault();
                void submitRename();
              }}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              保存名称
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
