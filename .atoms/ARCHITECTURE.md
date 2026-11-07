---
last_updated: 2026-11-05T23:00:00Z
---

# Architecture Design

## System Overview
React SPA（Vite + shadcn）+ Atoms Cloud（认证、实体 CRUD、自定义 FastAPI 路由）。前端编排产品经理 → 架构师 → 工程师 → 测试工程师，所有模型调用走 client.ai.gentxt(model="agent")，后端 aihub 把 "agent" 路由到 DeepSeek（OpenAI 兼容，流式）。测试工程师把应用放进隐藏沙箱 iframe 运行检测，有问题就交回工程师修复（补丁优先），最多 3 轮；整轮结束后只保存一个版本。

## Tech Stack
React 18、TypeScript、Tailwind、shadcn/ui、GSAP、diff、jszip、@metagptx/web-sdk；后端 FastAPI + SQLAlchemy async + httpx（DeepSeek）。

## Module Design
| Module | Responsibility | Key Files |
|--------|---------------|-----------|
| 智能体 | 提示词、流式调用、[ERROR] 检测、HTML 提取 | src/lib/agents.ts |
| 流水线 | 整体编写 + 续写、补丁编写、质量循环、每轮编排（hooks） | src/lib/pipeline.ts |
| 测试工程师 | 静态检查、沙箱运行探针、交互冒烟、报告 | src/lib/tester.ts |
| 沙箱 | storage 适配注入、iframe sandbox 参数 | src/lib/sandbox.ts |
| 补丁引擎 | 解析 SEARCH/REPLACE、容错匹配 | src/lib/patch.ts |
| 认证与个人空间 | 会话查询（client.auth.me）、登录/登出、账号标识 | src/hooks/useAuth.ts, src/components/AccountMenu.tsx |
| 首页 | 首屏输入、四角色介绍（AGENTS 数组 + ASSETS 配图）、4 步工作流程（STEPS）、我的项目 | src/pages/Index.tsx, src/lib/assets.ts |
| 数据层 | projects / versions / shares；重命名、原地更新版本 | src/lib/projects.ts, src/lib/types.ts |
| 工作区 | 调用 pipeline、错误挂到当前步骤、回退、分享、导出 | src/pages/Workspace.tsx |
| App Viewer | 预览 / 代码 / 版本 | components/workspace/* |
| 模型提供方 | DeepSeek 流式 / 非流式、模型回退、中文错误映射、配置 | app/backend/services/agent_llm.py, services/aihub.py |
| 后端路由 | 分享、公开读取、级联删除；GET /api/v1/agent/config（含主/备模型名，不含密钥） | routers/workspace.py, routers/agent.py |

## Tech Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| 模型提供方 | DeepSeek deepseek-flash（DEEPSEEK_MODEL）；DEEPSEEK_BASE_URL/MAX_TOKENS(8192)/TEMPERATURE(0.4)/TIMEOUT(300) 可由环境变量覆盖 | 集中配置，密钥只在后端 |
| 模型回退 | 400/403/404 且报错指向 model（含「supported API model names…but you passed」）时，自动用 DEEPSEEK_FALLBACK_MODEL（deepseek-chat）重试一次，并先下发一行「[提示] …」；只回退一次，其他错误不回退 | 模型名不可用时不中断生成 |
| 输出长度 | 单次 8192 token + 缺 </html> 时续写最多 3 次 + 提示词 ≤550 行 | 消除截断 |
| 错误处理 | 401/402/429/400/422/5xx/超时/连接错误→中文提示，作为 [ERROR] 流块下发 | 对话中清晰显示 |
| 沙箱 storage | head 中最早注入内存 Storage | 不加 allow-same-origin 也能跑 |
| 运行检测 | 隐藏 iframe 探针 + 冒烟，postMessage 回报，15 秒超时 | 发现真实运行时问题 |
| 修复策略 | 截断则整体重写，否则补丁，补丁失败再重写；修复结果只作草稿，不单独保存 | 准确且有兜底 |
| 版本粒度 | runRound：草稿→qualityLoop(草稿)→saveVersion 一次（含 fix_rounds/test_passed/test_issues）；fixHead：qualityLoop(当前版本)→updateVersion 原地更新；异常时不保存 | 一次请求一个版本 |
| 用户隔离 | 实体接口（projects / project_versions）全部 Depends(get_current_user) 并按 current_user.id 过滤；workspace 自定义路由用 _owned_project 显式校验 user_id；仅 /workspace/public/{token} 免鉴权且只读 | 隔离在服务端强制，不依赖前端 |
| 会话保持 | 令牌由 SDK 持久化，useAuth 启动时调用 client.auth.me() 恢复账号；刷新页面不丢登录态 | 无需额外会话存储 |

## File Tree Plan
app/frontend/src/{pages/{Index,Workspace,Share}.tsx, components/{AccountMenu,ProjectList}.tsx, components/workspace/*, hooks/useAuth.ts, lib/{agents,pipeline,tester,sandbox,patch,projects,export,types,assets}.ts}; app/backend/{services/agent_llm.py, routers/{agent,workspace}.py}; scripts/verify/{gen,sandbox_check,tester_check,e2e,fix_loop,fallback_check,version_rule,auth_isolation,personal_space}.py

## Implementation Guide
换模型：改后端环境变量 DEEPSEEK_MODEL（主模型）与 DEEPSEEK_FALLBACK_MODEL（回退模型），前端无需改动。新增检测项：tester.ts 的 staticCheck 或 PROBE。调整修复/续写轮数：pipeline.ts 的 MAX_FIX_ROUNDS / MAX_CONTINUATIONS。端到端验证：python scripts/verify/e2e.py；回退验证：从 app/backend 运行 python ../../scripts/verify/fallback_check.py；自动修复验证：scripts/verify/fix_loop.py；版本粒度验证：scripts/verify/version_rule.py；用户隔离与个人空间验证：从 app/backend 运行 python ../../scripts/verify/auth_isolation.py 与 personal_space.py（结果在 scripts/verify/out/）。
