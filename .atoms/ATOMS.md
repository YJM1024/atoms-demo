---
last_updated: 2026-11-05T23:00:00Z
status: active
---

# Project Context

## Project Overview
多智能体网页应用生成工作台（类 Atoms Demo）。产品经理 → 架构师 → 工程师 → 测试工程师依次流式工作，模型统一走后端 DeepSeek（默认 deepseek-flash，不可用时自动回退 deepseek-chat），生成单文件 HTML。测试工程师在沙箱中检测应用，发现问题就自动交给工程师修复，最多 3 轮；通过后才交付。App Viewer 提供预览、代码、版本三个视图。迭代修改用 SEARCH/REPLACE 补丁，失败时整体重写。一次用户请求（生成→测试→自动修复全部结束）只保存一个版本快照，支持 diff 对比和回退。另有公开分享链接和 ZIP 导出，项目按 Atoms Auth 用户隔离。Theme: Forgewell.

## Key Decisions
| Date | Decision | By | Rationale |
|------|----------|-----|-----------|
| 2026-11-05 | 前端用 client.ai.gentxt（stream:true）编排各智能体 | Alex | 实时显示过程 |
| 2026-11-05 | projects / project_versions / project_shares 设为 create_only，按 user_id 隔离 | Alex | 用户之间数据隔离 |
| 2026-11-05 | 迭代时补丁优先（精确匹配，再逐行忽略空白匹配），失败则整体重写 | Alex | 增量修改且结果稳定 |
| 2026-11-05 | 回退会新建一个 mode=rollback 的版本 | Alex | 回退本身也能撤销 |
| 2026-11-05 | 公开分享用随机 token 和只读的公开接口 | Alex | 安全分享 |
| 2026-11-05 | 输出缺少 </html> 时自动续写（最多 3 次） | Alex | 防止输出上限导致截断 |
| 2026-11-05 | 预览 iframe 注入内存版 localStorage/sessionStorage | Alex | 无 allow-same-origin 的沙箱中访问 localStorage 会抛 SecurityError |
| 2026-11-05 | 测试工程师：静态检查 + 沙箱运行探针 + 交互冒烟；自动修复上限 3 轮，之后提供「再次自动修复」按钮 | Alex | 不用等用户反馈就能发现并修复问题 |
| 2026-11-05 | 所有智能体调用改走 DeepSeek：前端用模型别名 "agent"，后端 aihub 将其路由到 services/agent_llm.py；密钥 DEEPSEEK_API_KEY 只在后端读取 | Alex | 平台 AI 余额不足；用户提供自有密钥 |
| 2026-11-05 | DeepSeek 错误（401/402/429/超时等）映射为中文提示，以 [ERROR] 流块下发，前端任意位置检测到即中断并显示在当前步骤 | Alex | 错误清晰可见，不混入代码 |
| 2026-11-05 | 默认模型改为 deepseek-flash；模型名被拒（400/403/404 且报错指向 model）时自动回退 DEEPSEEK_FALLBACK_MODEL（deepseek-chat）并重试一次 | Alex | flash 为较新模型名，不同账号可用性可能不同 |
| 2026-11-05 | 回退时后端先下发一行 "[提示] …" 流块，前端从流中剥离并作为独立说明消息展示，不写进生成代码 | Alex | 用户能看到实际在用哪个模型 |
| 2026-11-05 | 版本粒度改为"一次用户请求 = 一个版本"：生成代码与每轮修复都只是草稿，测试/修复结束后才 saveVersion 一次；出错或中断不保存 | Alex | 用户要求测试未通过的中间结果不算版本 |
| 2026-11-05 | project_versions 新增 fix_rounds / test_passed / test_issues（用户已确认）；旧数据为空，界面不显示测试标签 | Alex | 版本列表展示修复轮数与测试结论 |
| 2026-11-05 | 「再次自动修复」原地更新当前版本（代码、累计修复轮数、测试结论），不新增版本；回滚仍新建 mode=rollback 版本 | Alex | 保持一请求一版本，回滚可撤销 |
| 2026-11-05 | 用户隔离靠后端实体接口按 current_user.id 过滤 + 自定义路由显式校验 user_id，不依赖前端过滤；未配置数据库 RLS | Alex | 实体接口是唯一数据入口，已用双账号实测 |
| 2026-11-05 | 账号信息统一由 client.auth.me() 提供，新增 AccountMenu 展示当前账号与登出入口 | Alex | 原来只有一个无署名的登出图标 |
| 2026-11-05 | 首页改为四角色介绍：新增测试工程师（配图沿用同系列桌面静物摄影风格，lib/assets.ts tester），工作流程扩为 4 步；文案只描述已实现功能 | Alex | 新增角色后首页需同步 |
| 2026-11-05 | 首页示例卡片改为原生按钮：点击/Enter/Space 填入完整提示词（覆盖原内容）、聚焦并将光标置于末尾，输入框不在视口时平滑滚动（尊重减少动效）；不自动提交，匿名发送沿用登录逻辑；跑马灯复制项 tabIndex=-1 | Alex | 示例需可直接生成，避免误提交 |

## Constraints
- 不在界面上编造品牌名；全站只用一个珊瑚色强调色；使用语义化 CSS 变量；GSAP 动效需尊重 reduced-motion。
- 后端受保护目录（core/、models/、main.py、lambda_handler.py）不得修改。
- DeepSeek 密钥不得出现在前端或日志中；模型名、上限等配置只在后端（环境变量可覆盖）。
