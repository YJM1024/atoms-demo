import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';
import { getErrorDetail, getSharedProject } from '@/lib/projects';
import { PREVIEW_SANDBOX, buildPreviewDoc } from '@/lib/sandbox';
import type { SharedProject } from '@/lib/types';

export default function SharePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<SharedProject | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSharedProject(token)
      .then(setData)
      .catch((err) => setError(getErrorDetail(err)));
  }, [token]);

  if (error) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Logo className="h-12 w-12" />
        <h1 className="text-2xl font-bold tracking-tight">无法打开这个分享</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <Link to="/" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-85">
          去构建我自己的应用
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="加载中" />
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Logo className="h-7 w-7" />
          <h1 className="truncate text-sm font-semibold sm:text-base">{data.title}</h1>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums">v{data.version}</span>
          <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">只读预览</span>
        </div>
        <Link to="/" className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-85">
          我也要做一个
        </Link>
      </header>
      <main className="min-h-0 flex-1">
        <iframe
          title={`${data.title} 公开预览`}
          srcDoc={buildPreviewDoc(data.code)}
          sandbox={PREVIEW_SANDBOX}
          className="h-full w-full border-0 bg-card"
        />
      </main>
    </div>
  );
}
