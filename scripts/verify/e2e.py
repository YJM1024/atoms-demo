"""End-to-end run of the real agent pipeline (src/lib/pipeline.ts) against DeepSeek.

The pipeline is bundled and executed inside Chromium on the dev server origin, so it
uses the same SDK, backend /api/v1/aihub/gentxt route, tester and patch engine as the
workspace page. Version snapshots are kept in memory (DB writes require a login).
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/workspace/scripts/verify")
OUT = ROOT / "out"
OUT.mkdir(parents=True, exist_ok=True)
ESBUILD = "/workspace/app/frontend/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"

ENTRY = OUT / "e2e_entry.ts"
ENTRY.write_text(
    """import { runRound } from '../../../app/frontend/src/lib/pipeline';
const w = window as any;
w.__runCase = async (prompts: string[]) => {
  const messages: any[] = [];
  const versions: any[] = [];
  let code = '';
  let version = 0;
  let seq = 0;
  const hooks = {
    push: (role: string, content = '', status = 'running') => {
      const id = `m${++seq}`;
      messages.push({ id, role, content, status });
      return id;
    },
    patch: (id: string, changes: any) => {
      const m = messages.find((x) => x.id === id);
      if (m) Object.assign(m, changes);
    },
    getCode: () => code,
    getVersion: () => version,
    saveVersion: async (c: string, mode: string, summary: string) => {
      version += 1;
      code = c;
      versions.push({ version, mode, summary, lines: c.split('\\n').length, code: c });
      return version;
    },
  };
  const rounds: any[] = [];
  for (const p of prompts) {
    const t0 = performance.now();
    try {
      const r = await runRound(hooks as any, p);
      rounds.push({ prompt: p, ok: true, passed: r.passed, fixRounds: r.fixRounds, mode: r.mode,
        continuations: r.continuations, title: r.title, headVersion: version,
        reports: r.reports.map((x: any) => ({ passed: x.passed, issues: x.issues })),
        seconds: Math.round((performance.now() - t0) / 1000) });
    } catch (e: any) {
      rounds.push({ prompt: p, ok: false, error: String(e?.message || e) });
      break;
    }
  }
  return { rounds, versions, messages: messages.map((m) => ({ role: m.role, status: m.status, content: m.content.slice(0, 600) })) };
};
""",
    encoding="utf-8",
)
subprocess.run(
    [ESBUILD, str(ENTRY), "--bundle", "--format=iife", f"--outfile={OUT / 'e2e.bundle.js'}",
     "--define:import.meta.env={}", "--log-level=warning"],
    cwd="/workspace/app/frontend", check=True,
)

CASES = {
    "todo": "做一个待办清单应用：添加、完成、删除、按全部/进行中/已完成筛选，显示剩余数量，本地保存。",
    "calc": "做一个计算器：四则运算、括号、百分比、正负号、清除和退格，显示计算历史，支持键盘输入。",
    "snake": "做一个贪吃蛇小游戏：方向键控制，记录最高分，速度随分数递增，有开始、暂停和重新开始按钮。",
}
ITERATE = "把所有按钮改成蓝色"

selected = sys.argv[1:] or list(CASES)
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name in selected:
        page = browser.new_page()
        page.set_default_timeout(0)
        page.goto("http://127.0.0.1:3000/")
        page.add_script_tag(path=str(OUT / "e2e.bundle.js"))
        start = time.time()
        result = page.evaluate("(ps) => window.__runCase(ps)", [CASES[name], ITERATE])
        for v in result["versions"]:
            (OUT / f"e2e_{name}_v{v['version']}.html").write_text(v.pop("code"), encoding="utf-8")
        (OUT / f"e2e_{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        summary = {
            "case": name,
            "total_seconds": round(time.time() - start),
            "rounds": [{k: r.get(k) for k in ("prompt", "ok", "passed", "fixRounds", "mode", "continuations", "headVersion", "seconds", "error")}
                       | {"test_runs": [len(x["issues"]) for x in r.get("reports", [])]} for r in result["rounds"]],
            "versions": [{k: v[k] for k in ("version", "mode", "lines")} for v in result["versions"]],
        }
        print(json.dumps(summary, ensure_ascii=False), flush=True)
        page.close()
    browser.close()
