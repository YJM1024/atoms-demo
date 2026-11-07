"""验证首页示例卡片点击/键盘填入输入框（匿名，桌面+移动）。"""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3000/"
VIEWPORTS = {"desktop": (1440, 900), "mobile": (390, 844)}

STATE_JS = """() => {
  const t = document.getElementById('composer-lg');
  const r = t.getBoundingClientRect();
  return {
    value: t.value,
    active: document.activeElement === t,
    selStart: t.selectionStart, selEnd: t.selectionEnd,
    inView: r.top >= 0 && r.bottom <= window.innerHeight,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    path: location.pathname,
  };
}"""


def check(name, ok, results):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name)


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for vp, (w, h) in VIEWPORTS.items():
            ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=(vp == "mobile"))
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(URL, wait_until="networkidle")
            prompts = page.evaluate("() => null")
            ta = page.locator("#composer-lg")
            ta.fill("旧内容 old")

            # 鼠标点击（暂停跑马灯后点击）
            page.add_style_tag(content=".marquee-track{animation-play-state:paused!important}")
            card = page.get_by_role("button", name="填入示例需求：BMI 计算器").first
            card.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            if vp == "mobile":
                card.tap()
            else:
                card.hover()
                card.click()
            page.wait_for_timeout(1200)
            s = page.evaluate(STATE_JS)
            check(f"{vp} 点击填入完整提示词且覆盖旧内容", s["value"].startswith("做一个 BMI 计算器") and "旧内容" not in s["value"] and len(s["value"]) > 40, results)
            check(f"{vp} 输入框聚焦且光标在末尾", s["active"] and s["selStart"] == s["selEnd"] == len(s["value"]), results)
            check(f"{vp} 输入框滚动到可视区", s["inView"], results)
            check(f"{vp} 未自动提交（仍在首页）", s["path"] == "/", results)
            check(f"{vp} 无横向溢出", not s["overflow"], results)

            # 键盘 Enter / Space
            for key, label in (("Enter", "2048 小游戏"), ("Space", "汇率换算器")):
                btn = page.get_by_role("button", name=f"填入示例需求：{label}").first
                btn.scroll_into_view_if_needed()
                btn.focus()
                page.keyboard.press(key)
                page.wait_for_timeout(1200)
                s = page.evaluate(STATE_JS)
                check(f"{vp} 键盘 {key} 填入 {label}", label.split()[0] in s["value"] and s["active"] and s["inView"] and s["path"] == "/", results)

            # 复制项不可 Tab 聚焦
            hidden = page.evaluate("""() => [...document.querySelectorAll('li[aria-hidden=true] button')].every(b => b.tabIndex === -1)""")
            check(f"{vp} 跑马灯复制项不可 Tab 聚焦", hidden, results)
            check(f"{vp} 无页面错误", not errors, results)
            page.screenshot(path=f"/workspace/scripts/verify/out/showcase_fill_{vp}.png")
            ctx.close()
        browser.close()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
