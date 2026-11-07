import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import AccountMenu from '@/components/AccountMenu';
import Logo from '@/components/Logo';
import PromptComposer from '@/components/PromptComposer';
import ProjectList from '@/components/ProjectList';
import { AGENT_META } from '@/components/workspace/AgentMessage';
import { useAuth } from '@/hooks/useAuth';
import { MODEL } from '@/lib/agents';
import { ASSETS } from '@/lib/assets';
import { createProject, getErrorDetail, listProjects, pendingPrompt, removeProject, saveProject } from '@/lib/projects';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const EXAMPLES = [
  { label: '番茄钟', prompt: '做一个番茄钟专注应用：25/5 分钟循环、圆环进度、今日完成次数统计，数据保存在本地。' },
  { label: '记账本', prompt: '做一个个人记账本：可以添加收入和支出、按分类筛选、显示本月结余和分类占比条形图。' },
  { label: '贪吃蛇', prompt: '做一个贪吃蛇小游戏：键盘方向键控制，记录最高分，速度随分数递增，有暂停和重新开始。' },
  { label: '看板', prompt: '做一个任务看板：待办、进行中、已完成三列，支持拖拽卡片、添加和删除任务，本地保存。' },
];

const SHOWCASE = [
  {
    name: '习惯打卡日历',
    tag: '连续天数 · 热力图',
    prompt: '做一个习惯打卡日历：可以添加、编辑和删除习惯，每天点击打卡；显示每个习惯的当前连续天数和最长连续天数，用最近 12 周的日历热力图展示打卡记录，数据保存在本地。',
  },
  {
    name: '单词闪卡',
    tag: '翻转记忆 · 进度',
    prompt: '做一个单词闪卡应用：可以添加单词和释义，卡片点击翻转查看背面，标记“认识/不认识”，不认识的单词稍后重复出现；显示本轮学习进度和掌握率，单词列表保存在本地。',
  },
  {
    name: 'BMI 计算器',
    tag: '实时结果 · 建议',
    prompt: '做一个 BMI 计算器：输入身高（厘米）和体重（公斤）后实时计算 BMI，显示偏瘦、正常、超重、肥胖的分级和对应颜色刻度条，并给出简短的健康建议；输入不合法时给出提示。',
  },
  {
    name: 'Markdown 便签',
    tag: '双栏预览 · 本地存储',
    prompt: '做一个 Markdown 便签应用：左侧便签列表可新建、搜索、删除便签，右侧左右双栏编辑并实时预览 Markdown（标题、列表、代码块、链接），内容自动保存在本地。',
  },
  {
    name: '2048 小游戏',
    tag: '键盘操作 · 最高分',
    prompt: '做一个 2048 小游戏：4×4 棋盘，用键盘方向键移动和合并方块，手机上支持滑动操作；显示当前分数和本地保存的最高分，游戏结束时提示，并可一键重新开始。',
  },
  {
    name: '汇率换算器',
    tag: '多币种 · 快捷切换',
    prompt: '做一个汇率换算器：内置人民币、美元、欧元、日元、英镑、港币的参考汇率并允许手动修改，输入金额后实时换算，可一键交换源币种和目标币种，并同时列出换算成所有币种的结果，汇率设置保存在本地。',
  },
  {
    name: '会议倒计时',
    tag: '全屏显示 · 提醒',
    prompt: '做一个会议倒计时器：可设置分钟和秒数，支持开始、暂停、重置，倒计时用超大数字全屏显示；剩余 1 分钟时变色提醒，时间到时闪烁并显示“时间到”，提供几个常用时长的快捷按钮。',
  },
  {
    name: '菜谱随机抽',
    tag: '口味筛选 · 收藏',
    prompt: '做一个“今天吃什么”菜谱随机抽取应用：内置 20 道家常菜，包含口味（辣、清淡、酸甜等）和主要食材，可按口味筛选后随机抽一道并展示做法步骤，支持收藏菜谱并查看收藏列表，收藏保存在本地。',
  },
];

const AGENTS = [
  {
    key: 'pm' as const,
    image: ASSETS.pm,
    alt: '手绘应用线框草图的笔记本与便签',
    detail: '把一句话需求整理成应用名称、3–5 个核心功能和一句体验目标。迭代时只列出这次要改的点与验收标准。',
  },
  {
    key: 'architect' as const,
    image: ASSETS.architect,
    alt: '白板上的系统架构草图',
    detail: '基于需求给出页面结构、数据与状态、关键交互和视觉风格，约束成一个可在浏览器直接运行的单文件方案。',
  },
  {
    key: 'engineer' as const,
    image: ASSETS.engineer,
    alt: '笔记本电脑上的代码编辑器与应用预览',
    detail: `由 ${MODEL} 流式编写完整 HTML/CSS/JS，代码实时出现在「代码」视图，预览随写入同步刷新。迭代时用补丁只改相关代码，写完交给测试工程师。`,
  },
  {
    key: 'tester' as const,
    image: ASSETS.tester,
    alt: '笔记本电脑上的应用预览、放大镜与打勾的检查清单',
    detail:
      '在工程师之后、交付之前接手：把应用放进沙箱运行，检查报错、白屏和按钮交互。发现问题自动交给工程师修复，最多 3 轮；通过才交付，修满仍未通过会标出剩余问题。整个修复过程只算一个版本。',
  },
];

const STEPS = [
  { n: '01', title: '描述你的想法', body: '用日常语言写下应用要做什么、给谁用。越具体，产出越贴近预期，例如字段、交互和配色偏好。' },
  { n: '02', title: '看团队分步协作', body: '对话流按角色展示每一步的产出，代码流式写入，预览实时刷新；出错时可以一键重试这一轮。' },
  { n: '03', title: '自动测试与修复', body: '测试工程师在沙箱里运行应用，把问题交给工程师自动修复后再复测。测试报告和修复轮次都留在对话里，但只生成一个版本。' },
  { n: '04', title: '预览、迭代、带走', body: '继续提修改意见，按补丁增量修改；版本可以对比和回滚。项目保存在你的个人空间，可生成只读分享链接，或下载 HTML / 导出 ZIP。' },
];

export default function Index() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeAgent, setActiveAgent] = useState(0);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (auth.state !== 'authenticated') return;
    const saved = pendingPrompt.take();
    if (saved) setPrompt(saved);
    listProjects()
      .then(setProjects)
      .catch((err) => setProjectsError(getErrorDetail(err)));
  }, [auth.state]);

  useEffect(() => {
    if (window.location.hash === '#composer') {
      document.getElementById('composer')?.scrollIntoView();
    }
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline();
        tl.from('.hero-title', { y: 24, autoAlpha: 0, duration: 0.7, ease: 'power3.out' })
          .from('.hero-announce', { y: 16, autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, '-=0.4')
          .from('.hero-composer', { y: 20, autoAlpha: 0, duration: 0.7, ease: 'power3.out' }, '-=0.4')
          .from('.hero-chip', { y: 10, autoAlpha: 0, duration: 0.6, stagger: 0.06, ease: 'power2.out' }, '-=0.4');

        gsap.utils.toArray<HTMLElement>('.reveal').forEach((el) => {
          gsap.from(el, {
            y: 24,
            autoAlpha: 0,
            duration: 0.6,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 80%', once: true },
          });
        });
        ScrollTrigger.batch('.step-card', {
          start: 'top 85%',
          once: true,
          onEnter: (els) => gsap.from(els, { y: 20, autoAlpha: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out' }),
        });
        gsap.to('.agent-visual img', {
          yPercent: -6,
          ease: 'none',
          scrollTrigger: { trigger: '.agent-visual', start: 'top bottom', end: 'bottom top', scrub: 1 },
        });
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const start = async () => {
    const text = prompt.trim();
    if (!text) return;
    if (auth.state !== 'authenticated') {
      pendingPrompt.set(text);
      toast('登录后即可开始生成，你的描述已保留。');
      auth.login();
      return;
    }
    setCreating(true);
    try {
      const project = await createProject(text);
      navigate(`/project/${project.id}`, { state: { autostart: text } });
    } catch (err) {
      toast.error(`创建项目失败：${getErrorDetail(err)}`);
      setCreating(false);
    }
  };

  const handleDelete = async (pid: string) => {
    try {
      await removeProject(pid);
      setProjects((list) => (list ?? []).filter((p) => String(p.id) !== pid));
      toast.success('项目已删除');
    } catch (err) {
      toast.error(getErrorDetail(err));
    }
  };

  const handleRename = async (pid: string, title: string) => {
    try {
      await saveProject(pid, { title });
      setProjects((list) => (list ?? []).map((p) => (String(p.id) === pid ? { ...p, title } : p)));
      toast.success('项目已重命名');
    } catch (err) {
      toast.error(`重命名失败：${getErrorDetail(err)}`);
    }
  };

  const scrollToComposer = () => {
    document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('composer-lg')?.focus();
  };

  const fillPrompt = (text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => {
      const el = document.getElementById('composer-lg') as HTMLTextAreaElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const headerHeight = 64;
      const inView = rect.top >= headerHeight && rect.bottom <= window.innerHeight;
      if (!inView) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById('composer')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
      el.focus({ preventScroll: true });
      el.setSelectionRange(text.length, text.length);
    });
  };

  const agent = AGENTS[activeAgent];

  return (
    <div ref={rootRef} className="min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        跳到主要内容
      </a>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 md:px-8">
          <a href="#main" className="flex items-center gap-2" aria-label="返回顶部">
            <Logo />
          </a>
          <nav aria-label="主导航" className="hidden items-center gap-7 text-sm text-foreground/80 md:flex">
            <a href="#agents" className="whitespace-nowrap transition-colors hover:text-accent">智能体团队</a>
            <a href="#how" className="whitespace-nowrap transition-colors hover:text-accent">工作流程</a>
            <a href="#projects" className="whitespace-nowrap transition-colors hover:text-accent">我的项目</a>
          </nav>
          <div className="flex items-center gap-2">
            {auth.state === 'authenticated' ? (
              <AccountMenu displayName={auth.displayName} email={auth.user?.email} onLogout={auth.logout} />
            ) : (
              <button
                onClick={auth.login}
                disabled={auth.state === 'loading'}
                className="h-10 whitespace-nowrap rounded-full border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                登录
              </button>
            )}
            <button
              onClick={scrollToComposer}
              className="h-10 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-85"
            >
              开始构建
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="px-3 pt-3 md:px-4">
          <div className="relative overflow-hidden rounded-[32px] bg-[hsl(0_0%_8%)] text-[hsl(66_24%_90%)]">
            <img src={ASSETS.hero} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            <div className="absolute inset-0 bg-[hsl(0_0%_8%/0.55)]" aria-hidden="true" />
            <div className="relative mx-auto flex max-w-[880px] flex-col items-center px-5 pb-16 pt-16 text-center md:pb-24 md:pt-24">
              <p className="hero-announce mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                四个智能体协作 · 测试通过才交付
              </p>
              <h1 className="hero-title text-balance text-[44px] font-bold leading-[1.02] tracking-[-0.03em] md:text-[72px]">
                说出你的想法，
                <br />
                智能体团队把它做成应用
              </h1>
              <p className="hero-announce mt-5 max-w-xl text-[15px] leading-relaxed text-[hsl(66_24%_90%/0.78)]">
                产品经理拆解需求，架构师规划方案，工程师编写代码，测试工程师在沙箱里运行检查并自动修复。通常一两分钟，一个经过测试的网页应用就出现在你的预览窗口里。
              </p>

              <div id="composer" className="hero-composer mt-10 w-full scroll-mt-28 text-left">
                <PromptComposer
                  label="描述你想要的应用"
                  value={prompt}
                  onChange={setPrompt}
                  onSubmit={start}
                  loading={creating}
                  placeholder="例如：做一个习惯打卡应用，可以添加习惯、每天打卡，并用日历热力图展示连续天数…"
                  footer={
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground/80">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      {MODEL}
                    </span>
                  }
                />
              </div>

              <div className="mt-5 flex flex-wrap justify-center gap-2" aria-label="示例需求">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => fillPrompt(ex.prompt)}
                    className="hero-chip h-9 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-medium transition-colors hover:border-white/40 hover:bg-white/10"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
              {creating && (
                <p className="mt-4 inline-flex items-center gap-2 text-xs text-[hsl(66_24%_90%/0.78)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在创建项目…
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Showcase marquee */}
        <section aria-label="可以构建的应用示例" className="py-16 md:py-20">
          <p className="eyebrow reveal mb-6 text-center">这些应用，一句话就能开始</p>
            <div className="marquee overflow-hidden py-1">
              <ul className="marquee-track flex w-max gap-4 px-1" aria-label="示例应用，点击填入输入框">
                {[...SHOWCASE, ...SHOWCASE].map(({ name, tag, prompt: examplePrompt }, i) => (
                  <li key={`${name}-${i}`} aria-hidden={i >= SHOWCASE.length || undefined} className="w-[260px] shrink-0">
                    <button
                      type="button"
                      tabIndex={i >= SHOWCASE.length ? -1 : undefined}
                      aria-label={`填入示例需求：${name}`}
                      title="点击填入输入框"
                      onClick={() => fillPrompt(examplePrompt)}
                      className="group block w-full cursor-pointer rounded-3xl border border-border bg-card p-4 text-left text-card-foreground shadow-xs transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                    <div className="mb-3 space-y-2 rounded-2xl bg-muted p-3" aria-hidden="true">
                      <div className="h-2 w-1/2 rounded-full bg-foreground/20" />
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="h-8 rounded-lg bg-card" />
                        <div className={cn('h-8 rounded-lg', i % 3 === 0 ? 'bg-accent/70' : 'bg-card')} />
                        <div className="h-8 rounded-lg bg-card" />
                      </div>
                      <div className="h-2 w-3/4 rounded-full bg-foreground/10" />
                    </div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{tag}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-foreground/70 transition-colors group-hover:text-accent group-focus-visible:text-accent">
                        填入
                        <ArrowRight className="h-3 w-3 -rotate-90" aria-hidden="true" />
                      </span>
                    </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
        </section>

        {/* Agents split story */}
        <section id="agents" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 md:px-8 md:py-24">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_1.1fr] md:gap-14">
            <div>
              <p className="eyebrow reveal">智能体团队</p>
              <h2 className="reveal mt-3 text-[32px] font-bold leading-[1.08] tracking-[-0.02em] md:text-[44px]">
                四个角色接力，
                <br />
                每一步都看得见
              </h2>
              <ul className="mt-8 border-t border-border">
                {AGENTS.map((a, i) => {
                  const meta = AGENT_META[a.key];
                  const active = i === activeAgent;
                  return (
                    <li key={a.key} className="border-b border-border">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setActiveAgent(i)}
                        onMouseEnter={() => setActiveAgent(i)}
                        className="flex w-full gap-4 py-5 text-left"
                      >
                        <span className={cn('font-mono text-xs tabular-nums', active ? 'text-accent' : 'text-muted-foreground')}>
                          0{i + 1}
                        </span>
                        <span>
                          <span className={cn('block text-xl font-semibold', active ? 'text-foreground' : 'text-foreground/60')}>
                            {meta.name} · {meta.task}
                          </span>
                          <span className={cn('mt-1.5 block text-sm leading-relaxed', active ? 'text-foreground/80' : 'text-muted-foreground')}>
                            {a.detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="agent-visual overflow-hidden rounded-3xl border border-border shadow-md">
              <img key={agent.key} src={agent.image} alt={agent.alt} className="aspect-[4/3] w-full scale-110 object-cover" />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 pb-16 md:px-8 md:pb-24">
          <p className="eyebrow reveal">工作流程</p>
          <h2 className="reveal mt-3 max-w-2xl text-[32px] font-bold leading-[1.08] tracking-[-0.02em] md:text-[44px]">从一句话到可运行的应用</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <article key={s.n} className="step-card rounded-3xl border border-border bg-card p-7 transition-colors hover:border-foreground/30">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.n}</span>
                <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Projects */}
        <section id="projects" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 pb-16 md:px-8 md:pb-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">项目历史</p>
              <h2 className="mt-3 text-[32px] font-bold leading-[1.08] tracking-[-0.02em] md:text-[44px]">我的项目</h2>
            </div>
            {projects && projects.length > 0 && (
              <span className="text-sm tabular-nums text-muted-foreground">共 {projects.length} 个项目</span>
            )}
          </div>
          <div className="mt-8">
            {auth.state === 'loading' && <div className="h-32 animate-pulse rounded-3xl bg-muted" />}
            {auth.state === 'anonymous' && (
              <div className="rounded-3xl border border-dashed border-border p-8 text-center">
                <p className="text-base font-semibold">登录后查看你生成过的应用</p>
                <p className="mt-2 text-sm text-muted-foreground">每个项目都会保存对话过程和所有版本，只有你自己的账号能看到，可以随时重新打开继续迭代。</p>
                <button onClick={auth.login} className="mt-5 h-10 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-85">
                  登录查看项目
                </button>
              </div>
            )}
            {auth.state === 'authenticated' &&
              (projectsError ? (
                <p className="rounded-3xl border border-destructive/40 p-6 text-sm text-destructive">项目加载失败：{projectsError}</p>
              ) : projects === null ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-36 animate-pulse rounded-3xl bg-muted" />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border p-8 text-center">
                  <p className="text-base font-semibold">还没有项目</p>
                  <p className="mt-2 text-sm text-muted-foreground">在上方输入框描述一个应用，第一个项目会出现在这里。</p>
                </div>
              ) : (
                <ProjectList projects={projects} onDelete={handleDelete} onRename={handleRename} />
              ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-3 pb-3 md:px-4">
          <div className="reveal rounded-[32px] bg-[hsl(0_0%_8%)] px-6 py-16 text-center text-[hsl(66_24%_90%)] md:py-24">
            <Logo className="mx-auto h-12 w-12" />
            <h2 className="mx-auto mt-6 max-w-2xl text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.02em] md:text-[44px]">
              下一个应用，从一句描述开始
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[15px] text-[hsl(66_24%_90%/0.75)]">
              不需要写代码。描述、预览、提意见，每一版都先经过测试，满意后分享链接或导出 ZIP 带走。
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={scrollToComposer}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[hsl(66_24%_90%)] px-6 text-sm font-medium text-[hsl(0_0%_8%)] hover:opacity-90"
              >
                描述我的应用
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="#projects"
                className="inline-flex h-11 items-center rounded-full border border-white/25 px-6 text-sm font-medium hover:border-white/50"
              >
                打开已有项目
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-muted-foreground md:px-8">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span>多智能体网页应用生成工作台</span>
        </div>
        <nav aria-label="页脚导航" className="flex gap-5">
          <a href="#agents" className="hover:text-accent">智能体团队</a>
          <a href="#how" className="hover:text-accent">工作流程</a>
          <a href="#projects" className="hover:text-accent">我的项目</a>
        </nav>
      </footer>
    </div>
  );
}
