"""Exercises the tester → engineer auto-fix loop against real DeepSeek with seeded broken apps."""
import json
import pathlib
import subprocess

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/workspace/scripts/verify")
OUT = ROOT / "out"
ESBUILD = "/workspace/app/frontend/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"

ENTRY = OUT / "fix_entry.ts"
ENTRY.write_text(
    """import { qualityLoop } from '../../../app/frontend/src/lib/pipeline';
(window as any).__fixCase = async (seed: string, prompt: string) => {
  let code = seed; let version = 1; let seq = 0; const messages: any[] = []; const versions: any[] = [];
  const hooks = {
    push: (role: string, content = '', status = 'running') => { const id = `m${++seq}`; messages.push({ id, role, content, status }); return id; },
    patch: (id: string, c: any) => { const m = messages.find((x) => x.id === id); if (m) Object.assign(m, c); },
    getCode: () => code, getVersion: () => version,
    saveVersion: async (c: string, mode: string) => { version += 1; code = c; versions.push({ version, mode, lines: c.split('\\n').length }); return version; },
  };
  try {
    const r = await qualityLoop(hooks as any, prompt);
    return { ok: true, passed: r.passed, fixRounds: r.fixRounds, issuesPerRun: r.reports.map((x: any) => x.issues), versions,
      lastTester: messages.filter((m) => m.role === 'tester').pop()?.content };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
};
""",
    encoding="utf-8",
)
subprocess.run([ESBUILD, str(ENTRY), "--bundle", "--format=iife", f"--outfile={OUT / 'fix.bundle.js'}",
                "--define:import.meta.env={}", "--log-level=warning"], cwd="/workspace/app/frontend", check=True)

CASES = {
    "截断的待办清单（修复前真实输出）": ((OUT / "before_todo.html").read_text(encoding="utf-8"),
                         "做一个待办清单应用：添加、完成、删除、按全部/进行中/已完成筛选，显示剩余数量，本地保存。"),
    "运行时错误的计算器": ("""<!DOCTYPE html><html><head><style>button{padding:12px;margin:4px}</style></head><body>
<h1>计算器</h1><input id="display" readonly value="0"><div id="keys"></div>
<script>
const keys=['7','8','9','+','4','5','6','-','1','2','3','*','0','C','=','/'];
keys.forEach(k=>{const b=document.createElement('button');b.textContent=k;b.onclick=()=>press(k);document.getElementById('keys').appendChild(b);});
function press(k){ if(k==='='){ document.getElementById('display').value=evaluateExpr(document.getElementById('display').value); return;}
  if(k==='C'){document.getElementById('display').value='0';return;}
  const d=document.getElementById('display'); d.value=d.value==='0'?k:d.value+k; document.getElementById('history').textContent=d.value; }
</script></body></html>""", "做一个计算器：四则运算、清除，显示计算历史。"),
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, (seed, prompt) in CASES.items():
        page = browser.new_page()
        page.set_default_timeout(0)
        page.goto("http://127.0.0.1:3000/")
        page.add_script_tag(path=str(OUT / "fix.bundle.js"))
        r = page.evaluate("([s, p]) => window.__fixCase(s, p)", [seed, prompt])
        print(json.dumps({"case": name, **{k: r.get(k) for k in ("ok", "passed", "fixRounds", "versions", "error")},
                          "issues_per_run": [len(x) for x in r.get("issuesPerRun", [])],
                          "first_run_issues": (r.get("issuesPerRun") or [[]])[0][:4]}, ensure_ascii=False), flush=True)
        page.close()
    browser.close()

# Did "把所有按钮改成蓝色" really change button colours?
import difflib, re  # noqa: E402
for name in ("todo", "calc", "snake"):
    a = (OUT / f"e2e_{name}_v1.html").read_text(encoding="utf-8").splitlines()
    b = (OUT / f"e2e_{name}_v2.html").read_text(encoding="utf-8").splitlines()
    added = [l.strip() for l in difflib.unified_diff(a, b, lineterm="", n=0) if l.startswith("+") and not l.startswith("+++")]
    blue = [l for l in added if re.search(r"#(1e40af|1d4ed8|2563eb|3b82f6|0d6efd|007bff|1e88e5|1976d2|0066ff|1a73e8)|blue|rgb\(\s*(37|59|29|0)\s*,", l, re.I)]
    print(json.dumps({"iterate_case": name, "added_lines": len(added), "blue_lines": len(blue), "sample": blue[:3]}, ensure_ascii=False))
