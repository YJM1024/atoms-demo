"""Verifies "one user request = one version" with the real pipeline and real DeepSeek.

The pipeline bundle runs in Chromium on the dev origin; version rows are kept in memory
with the same create/update semantics as the workspace page (DB writes require login).
Base app: a calculator seeded with real runtime errors so the tester must trigger auto-fix.
"""
import json
import pathlib
import subprocess

from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/workspace/scripts/verify/out")
OUT.mkdir(parents=True, exist_ok=True)
ESBUILD = "/workspace/app/frontend/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"

ENTRY = OUT / "version_entry.ts"
ENTRY.write_text(
    """import { runRound, fixHead } from '../../../app/frontend/src/lib/pipeline';
const w = window as any;
function makeState(seed: string) {
  const s: any = { code: seed, version: 1, seq: 0, messages: [], failOnTester: false,
    rows: [{ version: 1, mode: 'full', code: seed, fix_rounds: 0, test_passed: null, test_issues: '' }] };
  s.hooks = {
    push: (role: string, content = '', status = 'running') => {
      if (s.failOnTester && role === 'tester') throw new Error('模拟中断：用户在测试前停止了生成');
      const id = `m${++s.seq}`; s.messages.push({ id, role, content, status }); return id;
    },
    patch: (id: string, c: any) => { const m = s.messages.find((x: any) => x.id === id); if (m) Object.assign(m, c); },
    getCode: () => s.code, getVersion: () => s.version,
    saveVersion: async (code: string, mode: string, summary: string, meta: any) => {
      s.version += 1; s.code = code;
      s.rows.push({ version: s.version, mode, summary, code, fix_rounds: meta.fixRounds, test_passed: meta.testPassed, test_issues: meta.testIssues });
      return s.version;
    },
    updateVersion: async (version: number, code: string, meta: any) => {
      const row = s.rows.find((r: any) => r.version === version);
      row.code = code; row.fix_rounds += meta.fixRounds; row.test_passed = meta.testPassed; row.test_issues = meta.testIssues;
      if (version === s.version) s.code = code;
    },
  };
  // Same logic as Workspace.rollback: rollback is itself a new version.
  s.rollback = (target: number) => {
    const t = s.rows.find((r: any) => r.version === target);
    return s.hooks.saveVersion(t.code, 'rollback', `回退到 v${target}`, { fixRounds: 0, testPassed: t.test_passed, testIssues: t.test_issues });
  };
  return s;
}
const view = (s: any) => s.rows.map((r: any) => ({ v: r.version, mode: r.mode, fix_rounds: r.fix_rounds, test_passed: r.test_passed,
  issues: r.test_issues ? r.test_issues.split('\\n').length : 0, lines: r.code.split('\\n').length }));
const step = async (label: string, s: any, fn: () => Promise<any>) => {
  const before = s.rows.length; const t0 = performance.now(); let res: any = null; let error: string | null = null;
  try { res = await fn(); } catch (e: any) { error = String(e?.message || e); }
  return { label, added_versions: s.rows.length - before, head: s.version, error,
    passed: res?.passed, fixRounds: res?.fixRounds, tests: res?.reports?.map((r: any) => r.issues.length),
    seconds: Math.round((performance.now() - t0) / 1000), rows: view(s) };
};
w.__run = async (seed: string, prompt: string) => {
  const results: any[] = [];
  const a = makeState(seed);
  results.push(await step('A 需求（基础版本有运行时错误，需自动修复）', a, () => runRound(a.hooks, '把所有按钮改成蓝色')));
  const fixNotes = a.messages.filter((m: any) => m.role === 'engineer' && /轮修复完成/.test(m.content)).map((m: any) => m.content.slice(0, 80));
  results.push({ label: 'A 对话中展示的修复过程', fix_messages: fixNotes,
    tester_reports: a.messages.filter((m: any) => m.role === 'tester').length });
  results.push(await step('B 增量修改', a, () => runRound(a.hooks, '在顶部加一个标题“简易计算器”')));
  results.push(await step('C 回滚到 v2', a, () => a.rollback(2)));
  results.push({ label: 'C 回滚代码一致', same_as_v2: a.rows[a.rows.length - 1].code === a.rows[1].code });

  const b = makeState(seed);
  results.push(await step('D 修复上限为 0（测试未通过也只存一个版本）', b, () => runRound(b.hooks, prompt, { maxFixRounds: 0 })));
  results.push(await step('E 再次自动修复（更新同一版本）', b, () => fixHead(b.hooks, prompt)));

  const c = makeState(seed);
  c.failOnTester = true;
  results.push(await step('F 中途中断（测试前）', c, () => runRound(c.hooks, '把所有按钮改成蓝色')));
  return results;
};
""",
    encoding="utf-8",
)
subprocess.run([ESBUILD, str(ENTRY), "--bundle", "--format=iife", f"--outfile={OUT / 'version.bundle.js'}",
                "--define:import.meta.env={}", "--log-level=warning"], cwd="/workspace/app/frontend", check=True)

SEED = """<!DOCTYPE html><html><head><style>button{padding:12px;margin:4px}</style></head><body>
<h1>计算器</h1><input id="display" readonly value="0"><div id="keys"></div>
<script>
const keys=['7','8','9','+','4','5','6','-','1','2','3','*','0','C','=','/'];
keys.forEach(k=>{const b=document.createElement('button');b.textContent=k;b.onclick=()=>press(k);document.getElementById('keys').appendChild(b);});
function press(k){ if(k==='='){ document.getElementById('display').value=evaluateExpr(document.getElementById('display').value); return;}
  if(k==='C'){document.getElementById('display').value='0';return;}
  const d=document.getElementById('display'); d.value=d.value==='0'?k:d.value+k; document.getElementById('history').textContent=d.value; }
</script></body></html>"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.set_default_timeout(0)
    page.goto("http://127.0.0.1:3000/")
    page.add_script_tag(path=str(OUT / "version.bundle.js"))
    results = page.evaluate("([s, p]) => window.__run(s, p)", [SEED, "做一个计算器：四则运算、清除，显示计算历史。"])
    (OUT / "version_rule.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in results:
        print(json.dumps(r, ensure_ascii=False), flush=True)
    browser.close()
