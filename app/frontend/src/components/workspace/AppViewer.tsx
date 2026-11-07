import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { countLines } from '@/lib/agents';
import { downloadBlob, safeFileName } from '@/lib/export';
import { PREVIEW_SANDBOX, buildPreviewDoc } from '@/lib/sandbox';
import { cn } from '@/lib/utils';

export type ViewerTab = 'preview' | 'code' | 'versions';

interface AppViewerProps {
  code: string;
  liveCode: string;
  streamCode: string;
  generating: boolean;
  tab: ViewerTab;
  onTabChange: (tab: ViewerTab) => void;
  title: string;
  version: number;
  banner?: React.ReactNode;
  versionsPanel: React.ReactNode;
}

const TABS: [ViewerTab, string][] = [
  ['preview', '预览'],
  ['code', '代码'],
  ['versions', '版本'],
];

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export default function AppViewer({
  code,
  liveCode,
  streamCode,
  generating,
  tab,
  onTabChange,
  title,
  version,
  banner,
  versionsPanel,
}: AppViewerProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  const displayCode = generating && streamCode ? streamCode : code;
  const previewCode = generating && liveCode ? liveCode : code;
  const hasCode = code.trim().length > 0;

  useEffect(() => {
    if (generating && tab === 'code' && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [displayCode, generating, tab]);

  const fileName = `${safeFileName(title)}-v${version}.html`;
  const htmlBlob = () => new Blob([code], { type: 'text/html;charset=utf-8' });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('代码已复制到剪贴板');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('复制失败，请在代码视图中手动选择复制');
    }
  };

  return (
    <section aria-label="App Viewer" className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-md">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div role="tablist" aria-label="视图切换" className="inline-flex rounded-full bg-muted p-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => onTabChange(key)}
              className={cn(
                'h-8 rounded-full px-3 text-sm font-medium transition-colors sm:px-4',
                tab === key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-0.5">
          {version > 0 && (
            <span className="mr-1 hidden rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums xl:inline">
              v{version} · {countLines(code)} 行
            </span>
          )}
          <IconButton label="刷新预览" onClick={() => setReloadKey((k) => k + 1)} disabled={!hasCode}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <IconButton label="在新窗口打开" onClick={() => window.open(URL.createObjectURL(htmlBlob()), '_blank', 'noopener')} disabled={!hasCode}>
            <ExternalLink className="h-4 w-4" />
          </IconButton>
          <IconButton label="复制代码" onClick={handleCopy} disabled={!hasCode}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </IconButton>
          <IconButton label="下载 HTML 文件" onClick={() => downloadBlob(htmlBlob(), fileName)} disabled={!hasCode}>
            <Download className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      {banner}

      <div className="relative min-h-0 flex-1 bg-background/60">
        {tab === 'versions' ? (
          versionsPanel
        ) : tab === 'preview' ? (
          previewCode.trim() ? (
            <>
              <iframe
                key={reloadKey}
                title={`${title} 预览`}
                srcDoc={buildPreviewDoc(previewCode)}
                sandbox={PREVIEW_SANDBOX}
                className="h-full w-full border-0 bg-card"
              />
              {generating && (
                <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {liveCode ? '实时预览：随代码写入刷新' : '正在生成新版本'}
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              {generating ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-foreground" />
                  <p className="text-base font-semibold">智能体团队正在构建你的应用</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    工程师开始写入代码后，这里会随代码同步刷新；切换到「代码」视图可以看到逐字写入的过程。
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold">还没有可预览的版本</p>
                  <p className="max-w-sm text-sm text-muted-foreground">在左侧描述你想要的应用，生成过程中这里会实时渲染。</p>
                </>
              )}
            </div>
          )
        ) : displayCode ? (
          <pre ref={codeRef} className="h-full overflow-auto bg-primary p-4 font-mono text-[12.5px] leading-relaxed text-primary-foreground">
            <code>{displayCode}</code>
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {generating ? '等待工程师开始写入代码…' : '暂无代码'}
          </div>
        )}
      </div>
    </section>
  );
}
