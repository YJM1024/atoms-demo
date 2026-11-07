"""Runs HTML samples inside a sandboxed (opaque-origin) iframe in Chromium and
reports page errors, with and without the localStorage shim used by the app."""
import json
import pathlib
import re

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/workspace/scripts/verify")
SHIM = re.search(
    r"STORAGE_SHIM = `([\s\S]*?)`;",
    pathlib.Path("/workspace/app/frontend/src/lib/sandbox.ts").read_text(encoding="utf-8"),
).group(1)

SAMPLES = {
    "truncated_todo (real 4096-token output)": (ROOT / "out/before_todo.html").read_text(encoding="utf-8"),
    "localStorage app (typical generated pattern)": """<!DOCTYPE html><html><head></head><body>
<ul id="list"></ul><button id="add">添加</button>
<script>
const items = JSON.parse(localStorage.getItem('todos') || '[]');
document.getElementById('add').onclick = () => { items.push('x'); localStorage.setItem('todos', JSON.stringify(items)); render(); };
function render(){ document.getElementById('list').innerHTML = items.map(i => '<li>'+i+'</li>').join(''); }
render(); document.body.dataset.ok = '1';
</script></body></html>""",
}


def inject(html: str, script: str) -> str:
    m = re.search(r"<head[^>]*>", html, re.I)
    tag = f"<script>{script}</script>"
    return html[: m.end()] + tag + html[m.end():] if m else tag + html


def run(page, html: str) -> list[str]:
    errors: list[str] = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text[:160]))
    page.on("pageerror", lambda e: errors.append(str(e)[:160]))
    page.set_content("<iframe id='f' sandbox='allow-scripts allow-forms' style='width:800px;height:600px'></iframe>")
    page.eval_on_selector("#f", "(f, html) => { f.srcdoc = html; }", html)
    page.wait_for_timeout(2500)
    return errors


with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, html in SAMPLES.items():
        for label, doc in (("before (raw)", html), ("after (shim)", inject(html, SHIM))):
            page = browser.new_page()
            errs = run(page, doc)
            print(json.dumps({"sample": name, "mode": label, "errors": len(errs), "first": errs[:2]}, ensure_ascii=False))
            page.close()
    browser.close()
