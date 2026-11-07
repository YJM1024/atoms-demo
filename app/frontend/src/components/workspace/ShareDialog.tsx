import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createShare, getErrorDetail, getShareToken, revokeShare, shareUrl } from '@/lib/projects';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  hasCode: boolean;
}

export default function ShareDialog({ open, onOpenChange, projectId, hasCode }: ShareDialogProps) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getShareToken(projectId)
      .then(setToken)
      .catch((err) => toast.error(getErrorDetail(err)))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } catch (err) {
      toast.error(getErrorDetail(err));
    } finally {
      setLoading(false);
    }
  };

  const url = token ? shareUrl(token) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>分享公开预览</DialogTitle>
          <DialogDescription>
            拿到链接的人无需登录即可只读预览当前版本，看不到对话和历史版本。之后生成的新版本也会同步到这个链接。
          </DialogDescription>
        </DialogHeader>

        {!hasCode ? (
          <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">生成第一个版本后才能分享。</p>
        ) : token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background p-1 pl-4">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input readOnly value={url} aria-label="公开预览链接" className="min-w-0 flex-1 bg-transparent font-mono text-xs focus:outline-none" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    toast.success('链接已复制');
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    toast.error('复制失败，请手动选择链接复制');
                  }
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-85"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                复制链接
              </button>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium hover:bg-muted">
                <ExternalLink className="h-3.5 w-3.5" />
                打开预览页
              </a>
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  run(async () => {
                    await revokeShare(projectId);
                    setToken(null);
                    toast.success('已停止分享，旧链接立即失效');
                  })
                }
                className="inline-flex h-9 items-center rounded-full px-4 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                停止分享
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => run(async () => setToken(await createShare(projectId)))}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-85 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            生成公开链接
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
