import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileArchive, History, Loader2, MessageSquare, MonitorPlay, Plus, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import AccountMenu from '@/components/AccountMenu';
import Logo from '@/components/Logo';
import PromptComposer from '@/components/PromptComposer';
import ProjectList from '@/components/ProjectList';
import AgentMessage from '@/components/workspace/AgentMessage';
import AppViewer, { type ViewerTab } from '@/components/workspace/AppViewer';
import ShareDialog from '@/components/workspace/ShareDialog';
import VersionPanel from '@/components/workspace/VersionPanel';
import { useAuth } from '@/hooks/useAuth';
import { MODEL } from '@/lib/agents';
import { exportProjectZip } from '@/lib/export';
import { type PipelineHooks, type VersionMeta, fixHead, runRound as runPipelineRound } from '@/lib/pipeline';
import {
  createVersion,
  updateVersionRow,
  getErrorDetail,
  getProject,
  listProjects,
  listVersions,
  parseMessages,
  removeProject,
  saveProject,
} from '@/lib/projects';
import type { AgentRole, ChatMessage, Project, ProjectVersion, VersionMode } from '@/lib/types';
import { cn } from '@/lib/utils';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const LIVE_PREVIEW_INTERVAL = 900;

/** Throttles live-preview refreshes so the iframe is not rebuilt on every token. */
function useThrottledSetter(setter: (value: string) => void, interval: number) {
  const last = useRef(0);
  const timer = useRef<number | null>(null);
  const pending = useRef('');
  const push = useCallback(
    (value: string, force = false) => {
      pending.current = value;
      const now = Date.now();
      if (force || now - last.current >= interval) {
        last.current = now;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = null;
        setter(value);
        return;
      }
      if (!timer.current) {
        timer.current = window.setTimeout(() => {
          last.current = Date.now();
          timer.current = null;
          setter(pending.current);
        }, interval - (now - last.current));
      }
    },
    [setter, interval],
  );
  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return { push, cancel };
}

export default function Workspace() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [headVersion, setHeadVersion] = useState(0);
  const [viewVersion, setViewVersion] = useState(0);
  const [viewCode, setViewCode] = useState('');
  const [streamCode, setStreamCode] = useState('');
  const [liveCode, setLiveCode] = useState('');
  const [generating, setGenerating] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<ViewerTab>('preview');
  const [mobilePane, setMobilePane] = useState<'chat' | 'viewer'>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [history, setHistory] = useState<Project[]>([]);

  const msgsRef = useRef<ChatMessage[]>([]);
  const codeRef = useRef('');
  const versionRef = useRef(0);
  const versionsRef = useRef<ProjectVersion[]>([]);
  const autoStarted = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const live = useThrottledSetter(setLiveCode, LIVE_PREVIEW_INTERVAL);

  const commit = useCallback((next: ChatMessage[]) => {
    msgsRef.current = next;
    setMessages(next);
  }, []);

  const patch = useCallback(
    (msgId: string, changes: Partial<ChatMessage>) => {
      commit(msgsRef.current.map((m) => (m.id === msgId ? { ...m, ...changes } : m)));
    },
    [commit],
  );

  const push = useCallback(
    (role: AgentRole, content = '', status: ChatMessage['status'] = 'running') => {
      const msg: ChatMessage = { id: uid(), role, content, status, createdAt: Date.now() };
      commit([...msgsRef.current, msg]);
      return msg.id;
    },
    [commit],
  );

  const setVersionList = useCallback((list: ProjectVersion[]) => {
    versionsRef.current = list;
    setVersions(list);
  }, []);

  /** Persists a new head version: snapshot row first, then the project's current pointer. */
  const saveVersion = useCallback(
    async (code: string, mode: VersionMode, summary: string, meta: VersionMeta, title?: string) => {
      const nextVersion = versionRef.current + 1;
      const snapshot = await createVersion({
        project_id: Number(id),
        version: nextVersion,
        code,
        summary,
        mode,
        fix_rounds: meta.fixRounds,
        test_passed: meta.testPassed,
        test_issues: meta.testIssues,
      });
      codeRef.current = code;
      versionRef.current = nextVersion;
      setVersionList([snapshot, ...versionsRef.current]);
      setHeadVersion(nextVersion);
      setViewVersion(nextVersion);
      setViewCode(code);
      if (title) setProject((p) => (p ? { ...p, title } : p));
      await saveProject(id, {
        code,
        version: nextVersion,
        messages: JSON.stringify(msgsRef.current),
        ...(title ? { title } : {}),
      });
      return nextVersion;
    },
    [id, setVersionList],
  );

  /** Overwrites the code and test outcome of an existing version (no new version is created). */
  const updateVersion = useCallback(
    async (versionNumber: number, code: string, meta: VersionMeta) => {
      const row = versionsRef.current.find((v) => v.version === versionNumber);
      if (!row) throw new Error(`没有找到 v${versionNumber} 的快照`);
      const updated = await updateVersionRow(row.id, {
        code,
        fix_rounds: (row.fix_rounds ?? 0) + meta.fixRounds,
        test_passed: meta.testPassed,
        test_issues: meta.testIssues,
      });
      setVersionList(versionsRef.current.map((v) => (v.id === row.id ? { ...v, ...updated, code } : v)));
      if (versionNumber === versionRef.current) {
        codeRef.current = code;
        setViewVersion(versionNumber);
        setViewCode(code);
        await saveProject(id, { code, messages: JSON.stringify(msgsRef.current) });
      }
    },
    [id, setVersionList],
  );

  const persistMessages = useCallback(async () => {
    try {
      await saveProject(id, { messages: JSON.stringify(msgsRef.current) });
    } catch (err) {
      toast.error(`对话保存失败：${getErrorDetail(err)}`);
    }
  }, [id]);

  const hooks = useMemo<PipelineHooks>(
    () => ({
      push,
      patch,
      getCode: () => codeRef.current,
      getVersion: () => versionRef.current,
      saveVersion,
      updateVersion,
      onStream: setStreamCode,
      onLive: live.push,
      onLiveCancel: live.cancel,
      onEngineerStart: () => setTab((t) => (t === 'versions' ? 'preview' : t)),
      onNotice: (notice) => patch(push('tester', notice, 'done'), { content: notice }),
    }),
    [live.cancel, live.push, patch, push, saveVersion, updateVersion],
  );

  /** Wraps a pipeline action with loading state, error surfacing and persistence. */
  const execute = useCallback(
    async (action: () => Promise<{ passed: boolean }>) => {
      setGenerating(true);
      setStreamCode('');
      setLiveCode('');
      try {
        const { passed } = await action();
        setTab('preview');
        setMobilePane('viewer');
        if (passed) toast.success(`v${versionRef.current} 测试通过，已交付`);
        else toast.error('自动修复已达上限，仍有问题未解决');
      } catch (err) {
        live.cancel();
        const detail = getErrorDetail(err);
        const running = [...msgsRef.current].reverse().find((m) => m.status === 'running');
        if (running) patch(running.id, { status: 'error', content: `执行失败：${detail}` });
        toast.error(detail);
      } finally {
        await persistMessages();
        setGenerating(false);
        setStreamCode('');
        setLiveCode('');
      }
    },
    [live, patch, persistMessages],
  );

  const runRound = useCallback((userText: string) => execute(() => runPipelineRound(hooks, userText)), [execute, hooks]);

  /** Manual trigger after the auto-fix budget was exhausted: grants a fresh budget. */
  const autoFixAgain = useCallback(() => {
    if (generating || !codeRef.current.trim()) return;
    const userMsg = [...msgsRef.current].reverse().find((m) => m.role === 'user');
    commit(msgsRef.current.map((m) => (m.needsFix ? { ...m, needsFix: false } : m)));
    void execute(() => fixHead(hooks, userMsg?.content ?? project?.prompt ?? ''));
  }, [commit, execute, generating, hooks, project?.prompt]);

  const rollback = useCallback(
    async (target: ProjectVersion) => {
      if (generating || rollingBack !== null) return;
      setRollingBack(target.version);
      try {
        const msgId = push('engineer', `正在回退到 v${target.version}…`);
        const version = await saveVersion(target.code, 'rollback', `回退到 v${target.version}`, {
          fixRounds: 0,
          testPassed: target.test_passed ?? null,
          testIssues: target.test_issues ?? '',
        });
        patch(msgId, {
          status: 'done',
          version,
          content: `已回退到 **v${target.version}** 的代码，并保存为新版本 **v${version}**，之前的版本仍然保留，可以随时切回。`,
        });
        await persistMessages();
        setTab('preview');
        toast.success(`已回退到 v${target.version}`);
      } catch (err) {
        toast.error(`回退失败：${getErrorDetail(err)}`);
      } finally {
        setRollingBack(null);
      }
    },
    [generating, patch, persistMessages, push, rollingBack, saveVersion],
  );

  const retryLast = useCallback(() => {
    const list = msgsRef.current;
    const lastUserIdx = list.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx < 0) return;
    const text = list[lastUserIdx].content;
    commit(list.slice(0, lastUserIdx));
    void runRound(text);
  }, [commit, runRound]);

  useEffect(() => {
    if (auth.state !== 'authenticated' || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, list] = await Promise.all([getProject(id), listVersions(id)]);
        if (cancelled) return;
        let snapshots = list;
        const head = p.version ?? 0;
        // Projects created before version snapshots existed: seed their current code as a snapshot.
        if (!snapshots.length && (p.code ?? '').trim() && head > 0) {
          const seeded = await createVersion({
            project_id: Number(id),
            version: head,
            code: p.code ?? '',
            summary: '历史版本',
            mode: 'full',
            fix_rounds: 0,
            test_passed: null,
            test_issues: '',
          });
          snapshots = [seeded];
        }
        if (cancelled) return;
        // A reload during a run leaves steps "running" forever; surface them as interrupted.
        const msgs = parseMessages(p.messages).map((m) =>
          m.status === 'running' ? { ...m, status: 'error' as const, content: `${m.content}\n\n（该步骤在页面刷新时中断）` } : m,
        );
        setProject(p);
        commit(msgs);
        setVersionList(snapshots);
        codeRef.current = p.code ?? '';
        versionRef.current = head;
        setHeadVersion(head);
        setViewCode(p.code ?? '');
        setViewVersion(head);
        const autostart = (location.state as { autostart?: string } | null)?.autostart;
        if (autostart && msgs.length === 0 && !autoStarted.current) {
          autoStarted.current = true;
          navigate(location.pathname, { replace: true, state: null });
          void runRound(autostart);
        }
      } catch (err) {
        if (!cancelled) setLoadError(getErrorDetail(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.state, id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!historyOpen) return;
    listProjects()
      .then(setHistory)
      .catch((err) => toast.error(getErrorDetail(err)));
  }, [historyOpen]);

  const showVersion = (versionNumber: number) => {
    const snap = versionsRef.current.find((v) => v.version === versionNumber);
    const legacy = msgsRef.current.find((m) => m.version === versionNumber)?.code;
    const code = snap?.code ?? legacy;
    if (!code) {
      toast.error(`没有找到 v${versionNumber} 的快照`);
      return;
    }
    setViewCode(code);
    setViewVersion(versionNumber);
    setTab('preview');
    setMobilePane('viewer');
  };

  const submit = () => {
    const text = input.trim();
    if (!text || generating) return;
    setInput('');
    setViewCode(codeRef.current);
    setViewVersion(versionRef.current);
    void runRound(text);
  };

  const handleExport = async () => {
    if (!codeRef.current.trim()) return;
    setExporting(true);
    try {
      await exportProjectZip({
        title: project?.title ?? 'app',
        prompt: project?.prompt ?? '',
        code: codeRef.current,
        version: versionRef.current,
        versions: versionsRef.current,
      });
    } catch (err) {
      toast.error(`导出失败：${getErrorDetail(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (pid: string) => {
    try {
      await removeProject(pid);
      setHistory((h) => h.filter((p) => String(p.id) !== pid));
      toast.success('项目已删除');
      if (pid === id) navigate('/');
    } catch (err) {
      toast.error(getErrorDetail(err));
    }
  };

  const handleRename = async (pid: string, title: string) => {
    try {
      await saveProject(pid, { title });
      setHistory((h) => h.map((p) => (String(p.id) === pid ? { ...p, title } : p)));
      if (pid === id) setProject((p) => (p ? { ...p, title } : p));
      toast.success('项目已重命名');
    } catch (err) {
      toast.error(`重命名失败：${getErrorDetail(err)}`);
    }
  };

  if (auth.state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="加载中" />
      </div>
    );
  }

  if (auth.state === 'anonymous') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Logo className="h-12 w-12" />
        <h1 className="text-2xl font-bold tracking-tight">登录后继续你的项目</h1>
        <p className="max-w-sm text-sm text-muted-foreground">项目和每个版本都保存在你的个人空间里，登录后即可重新打开并继续迭代。</p>
        <button onClick={auth.login} className="h-11 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-85">
          登录并打开项目
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">无法打开这个项目</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{loadError}</p>
        <Link to="/" className="h-11 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground">
          返回工作台
        </Link>
      </div>
    );
  }

  const hasCode = headVersion > 0;
  const viewingOld = viewVersion !== headVersion && viewVersion > 0 && !generating;

  return (
    <div className="flex h-screen flex-col bg-background">
      <a href="#chat-panel" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        跳到对话区
      </a>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" aria-label="返回工作台" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Logo className="h-7 w-7" />
          <h1 className="truncate text-sm font-semibold sm:text-base">{project?.title ?? '加载中…'}</h1>
          <span className="hidden rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground xl:inline">{MODEL}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="inline-flex rounded-full bg-muted p-1 lg:hidden" role="tablist" aria-label="面板切换">
            <button role="tab" aria-selected={mobilePane === 'chat'} aria-label="对话" onClick={() => setMobilePane('chat')} className={cn('inline-flex h-8 w-9 items-center justify-center rounded-full', mobilePane === 'chat' && 'bg-card shadow-xs')}>
              <MessageSquare className="h-4 w-4" />
            </button>
            <button role="tab" aria-selected={mobilePane === 'viewer'} aria-label="预览" onClick={() => setMobilePane('viewer')} className={cn('inline-flex h-8 w-9 items-center justify-center rounded-full', mobilePane === 'viewer' && 'bg-card shadow-xs')}>
              <MonitorPlay className="h-4 w-4" />
            </button>
          </div>
          <button onClick={() => setHistoryOpen(true)} aria-label="项目历史" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-muted">
            <History className="h-4 w-4" />
            <span className="hidden md:inline">项目历史</span>
          </button>
          <button onClick={handleExport} disabled={!hasCode || exporting} aria-label="导出 ZIP" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-muted disabled:opacity-40">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
            <span className="hidden md:inline">导出 ZIP</span>
          </button>
          <button onClick={() => setShareOpen(true)} aria-label="分享" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted">
            <Share2 className="h-4 w-4" />
            <span className="hidden md:inline">分享</span>
          </button>
          <Link to="/#composer" aria-label="新建应用" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-85 sm:px-4">
            <Plus className="h-4 w-4" />
            <span className="hidden lg:inline">新建应用</span>
          </Link>
          <AccountMenu displayName={auth.displayName} email={auth.user?.email} onLogout={auth.logout} compact />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 gap-4 p-3 sm:p-4">
        <section id="chat-panel" aria-label="对话与智能体过程" className={cn('min-h-0 w-full flex-col lg:flex lg:w-[440px] lg:shrink-0', mobilePane === 'chat' ? 'flex' : 'hidden')}>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pr-1" aria-live="polite">
            {messages.length === 0 && !generating && (
              <div className="rounded-3xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                这个项目还没有对话。描述你想要的应用，产品经理、架构师、工程师和测试工程师会依次接手。
              </div>
            )}
            {messages.map((m) => (
              <AgentMessage
                key={m.id}
                message={m}
                isCurrentVersion={m.version === viewVersion}
                onViewVersion={(msg) => msg.version && showVersion(msg.version)}
                onRetry={!generating ? retryLast : undefined}
                onAutoFix={!generating ? autoFixAgain : undefined}
              />
            ))}
          </div>
          <PromptComposer
            size="sm"
            label="输入修改意见"
            value={input}
            onChange={setInput}
            onSubmit={submit}
            loading={generating}
            disabled={rollingBack !== null}
            placeholder={hasCode ? '继续提需求，例如：把按钮改成蓝色（会以增量补丁方式修改）' : '描述你想要的应用…'}
            footer={
              <span className="text-[11px] text-muted-foreground">
                {generating ? '智能体团队工作中…' : hasCode ? `基于 v${headVersion} 增量修改 · Enter 发送` : 'Enter 发送 · Shift+Enter 换行'}
              </span>
            }
          />
        </section>

        <div className={cn('min-h-0 min-w-0 flex-1 lg:block', mobilePane === 'viewer' ? 'block' : 'hidden')}>
          <AppViewer
            code={viewCode}
            liveCode={liveCode}
            streamCode={streamCode}
            generating={generating}
            tab={tab}
            onTabChange={setTab}
            title={project?.title ?? 'app'}
            version={viewVersion}
            banner={
              viewingOld ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-xs">
                  <span>正在查看历史版本 v{viewVersion}（当前版本为 v{headVersion}）</span>
                  <div className="flex gap-2">
                    <button onClick={() => showVersion(headVersion)} className="h-8 rounded-full border border-border bg-card px-3 font-medium hover:bg-background">
                      返回当前版本
                    </button>
                    <button
                      onClick={() => {
                        const snap = versionsRef.current.find((v) => v.version === viewVersion);
                        if (snap) void rollback(snap);
                      }}
                      disabled={rollingBack !== null}
                      className="h-8 rounded-full bg-primary px-3 font-medium text-primary-foreground hover:opacity-85 disabled:opacity-40"
                    >
                      回退到此版本
                    </button>
                  </div>
                </div>
              ) : null
            }
            versionsPanel={
              <VersionPanel
                versions={versions}
                headVersion={headVersion}
                viewVersion={viewVersion}
                busy={generating || rollingBack !== null}
                rollingBack={rollingBack}
                onPreview={(v) => showVersion(v.version)}
                onRollback={(v) => void rollback(v)}
              />
            }
          />
        </div>
      </main>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} projectId={id} hasCode={hasCode} />

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[360px] overflow-y-auto bg-background sm:max-w-md">
          <SheetHeader>
            <SheetTitle>项目历史</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {history.length ? (
              <ProjectList projects={history} onDelete={handleDelete} onRename={handleRename} compact activeId={id} />
            ) : (
              <p className="text-sm text-muted-foreground">还没有其他项目。</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
