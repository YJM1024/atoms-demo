"""Bundles src/lib/tester.ts and runs it in Chromium against sample apps."""
import json
import pathlib
import subprocess

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/workspace/scripts/verify")
FRONT = pathlib.Path("/workspace/app/frontend")
BUNDLE = ROOT / "out/tester.bundle.js"

ENTRY = ROOT / "out/tester_entry.ts"
ENTRY.write_text(
    "import { runTests, formatReport } from '../../../app/frontend/src/lib/tester';\n"
    "(window as any).__runTests = runTests; (window as any).__formatReport = formatReport;\n",
    encoding="utf-8",
)
subprocess.run(
    ["/workspace/app/frontend/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild", str(ENTRY), "--bundle", "--format=iife", f"--outfile={BUNDLE}"],
    cwd=FRONT, check=True,
)

GOOD = """<!DOCTYPE html><html><head><style>body{font-family:sans-serif}</style></head><body>
<h1>计数器</h1><p id="n">0</p><button id="inc">+1</button>
<script>let n=0;document.getElementById('inc').onclick=()=>{n++;document.getElementById('n').textContent=n;};
try{localStorage.setItem('k','1');}catch(e){}</script></body></html>"""

SAMPLES = {
    "truncated_todo（真实 4096 token 截断输出）": (ROOT / "out/before_todo.html").read_text(encoding="utf-8"),
    "直接读 localStorage（沙箱下典型崩溃）": """<!DOCTYPE html><html><head></head><body><ul id="list"></ul><button id="add">添加</button>
<script>const items=JSON.parse(localStorage.getItem('todos')||'[]');
document.getElementById('add').onclick=()=>{items.push('x');localStorage.setItem('todos',JSON.stringify(items));};</script></body></html>""",
    "点击按钮抛异常 + console.error + Promise 拒绝": """<!DOCTYPE html><html><head></head><body><h1>计算器</h1><button id="eq">=</button>
<script>document.getElementById('eq').onclick=()=>{ calculateResult(); };
console.error('init failed');Promise.reject(new Error('fetch rates failed'));</script></body></html>""",
    "引用不存在的元素 + 表单未阻止提交": """<!DOCTYPE html><html><head></head><body><form id="f"><input id="t"><button>提交</button></form>
<script>document.getElementById('score').textContent='0';</script></body></html>""",
    "正常应用": GOOD,
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:3000/")
    page.add_script_tag(path=str(BUNDLE))
    for name, html in SAMPLES.items():
        result = page.evaluate("async (h) => { const r = await window.__runTests(h); return r; }", html)
        fails = [f"{i['name']}: {'; '.join(i['details'][:2])}" for i in result["items"] if i["status"] == "fail"]
        print(json.dumps({"sample": name, "passed": result["passed"], "truncated": result["truncated"],
                          "fail_items": fails}, ensure_ascii=False))
    browser.close()
