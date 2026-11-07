"""Reproduces engineer generation against the local backend.

Usage: python gen.py <tag> [max_tokens]
Omitting max_tokens reproduces the original (default 4096) behaviour.
"""
import json
import pathlib
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api/v1/aihub/gentxt"
OUT = pathlib.Path("/workspace/scripts/verify/out")
OUT.mkdir(parents=True, exist_ok=True)

ENGINEER_SYSTEM = """你是一名顶尖前端工程师。你只输出一个完整、可直接在浏览器 iframe 中运行的单文件 HTML 应用。
硬性要求：
1. 以 <!DOCTYPE html> 开头，以 </html> 结束；所有 CSS 写在 <style> 中，所有 JS 写在 <script> 中。
2. 不引用任何本地文件；尽量使用原生 HTML/CSS/JS，不依赖外部库。
3. 界面文案使用用户的语言；布局响应式，视觉精致现代，交互完整可用，无占位功能。
4. 需要持久化时使用 localStorage，并用 try/catch 包裹以兼容沙箱环境。
5. 只输出代码本身，不要任何解释，不要使用 Markdown 代码块标记。"""

PROMPTS = {
    "todo": "做一个待办清单应用：添加、完成、删除、按全部/进行中/已完成筛选，显示剩余数量，本地保存。",
    "calc": "做一个科学计算器：四则运算、括号、百分比、正负号、平方根、历史记录列表，支持键盘输入。",
    "snake": "做一个贪吃蛇小游戏：方向键控制，记录最高分，速度随分数递增，有暂停和重新开始按钮。",
}


def run(tag: str, max_tokens: int | None) -> None:
    for name, prompt in PROMPTS.items():
        body = {
            "model": "claude-opus-4.6",
            "stream": True,
            "messages": [
                {"role": "system", "content": ENGINEER_SYSTEM},
                {"role": "user", "content": f"用户需求：{prompt}\n\n请输出完整的 HTML 文件。"},
            ],
        }
        if max_tokens:
            body["max_tokens"] = max_tokens
        start = time.time()
        text = ""
        with httpx.stream("POST", BASE, json=body, timeout=600) as resp:
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    text += json.loads(data).get("content", "")
                except json.JSONDecodeError:
                    pass
        path = OUT / f"{tag}_{name}.html"
        path.write_text(text, encoding="utf-8")
        print(json.dumps({
            "tag": tag,
            "app": name,
            "chars": len(text),
            "lines": text.count("\n") + 1,
            "has_close_html": "</html>" in text.lower(),
            "has_error_marker": "[ERROR]" in text,
            "seconds": round(time.time() - start, 1),
        }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
