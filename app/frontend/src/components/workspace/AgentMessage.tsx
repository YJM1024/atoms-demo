import Markdown from 'markdown-to-jsx';
import { ClipboardList, Code2, Eye, FlaskConical, Network, RotateCcw, User, Wrench } from 'lucide-react';
import type { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

export const AGENT_META = {
  user: { name: '你', task: '', Icon: User },
  pm: { name: '产品经理', task: '需求拆解', Icon: ClipboardList },
  architect: { name: '架构师', task: '技术方案', Icon: Network },
  engineer: { name: '工程师', task: '代码实现', Icon: Code2 },
  tester: { name: '测试工程师', task: '质量检测', Icon: FlaskConical },
} as const;

interface AgentMessageProps {
  message: ChatMessage;
  isCurrentVersion: boolean;
  onViewVersion: (message: ChatMessage) => void;
  onRetry?: () => void;
  onAutoFix?: () => void;
}

function StatusBadge({ message }: { message: ChatMessage }) {
  if (message.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        进行中
      </span>
    );
  }
  if (message.status === 'error') {
    return (
      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
        {message.role === 'tester' ? '未通过' : '失败'}
      </span>
    );
  }
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">已完成</span>;
}

export default function AgentMessage({ message, isCurrentVersion, onViewVersion, onRetry, onAutoFix }: AgentMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const meta = AGENT_META[message.role];
  const { Icon } = meta;
  const isTester = message.role === 'tester';

  return (
    <article className="flex gap-3" aria-label={`${meta.name} · ${meta.task}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{meta.name}</span>
          <span className="text-xs text-muted-foreground">{meta.task}</span>
          <StatusBadge message={message} />
        </div>
        <div
          className={cn(
            'rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 text-sm leading-relaxed',
            message.status === 'error' && 'border-destructive/40',
          )}
        >
          {message.content ? (
            <div className="prose prose-sm max-w-none break-words text-foreground prose-headings:mb-2 prose-headings:mt-0 prose-headings:text-base prose-headings:font-semibold prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-foreground">
              <Markdown options={{ forceBlock: true }}>{message.content}</Markdown>
            </div>
          ) : (
            <p className="text-muted-foreground">正在思考…</p>
          )}

          {message.status === 'error' && !isTester && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-85"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重新执行这一步
            </button>
          )}

          {isTester && message.needsFix && onAutoFix && (
            <button
              type="button"
              onClick={onAutoFix}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-85"
            >
              <Wrench className="h-3.5 w-3.5" />
              再次自动修复
            </button>
          )}

          {message.role === 'engineer' && message.status === 'done' && !!message.version && (
            <button
              type="button"
              onClick={() => onViewVersion(message)}
              className={cn(
                'mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition-colors',
                isCurrentVersion ? 'border-accent text-foreground' : 'border-border text-foreground hover:border-foreground/40',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              {isCurrentVersion ? `正在查看 v${message.version}` : `查看 v${message.version}`}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
