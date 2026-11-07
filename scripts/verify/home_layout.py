"""Checks the homepage at desktop and mobile widths in Chromium (anonymous visitor)."""
import json
import pathlib

from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/workspace/scripts/verify/out")
OUT.mkdir(parents=True, exist_ok=True)
VIEWPORTS = {"desktop": (1440, 900), "tablet": (820, 1100), "mobile": (390, 844)}

MEASURE = """() => {
  const root = document.documentElement;
  const rectOf = (el) => el.getBoundingClientRect();
  const cards = [...document.querySelectorAll('.step-card')];
  const overflowing = [...document.querySelectorAll('main *')]
    .filter((el) => !el.closest('.marquee') && !el.closest('.agent-visual') && !el.closest('.sr-only'))
    .filter((el) => { const r = rectOf(el); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); })
    .slice(0, 5).map((el) => el.tagName + ':' + (el.textContent || '').slice(0, 24));
  const text = document.body.innerText;
  return {
    page_overflow_px: root.scrollWidth - root.clientWidth,
    overflowing,
    step_cards: cards.length,
    step_columns: new Set(cards.map((c) => Math.round(rectOf(c).left))).size,
    step_titles: cards.map((c) => c.querySelector('h3')?.textContent),
    card_text_clipped: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
    agent_buttons: [...document.querySelectorAll('#agents ul button')].map((b) => b.querySelector('span span')?.textContent),
    hidden_reveal: [...document.querySelectorAll('.reveal, .step-card')].filter((el) => getComputedStyle(el).visibility === 'hidden' || Number(getComputedStyle(el).opacity) < 0.5).length,
    has_copy: ['四个智能体协作', '四个角色接力', '自动测试与修复', '下一个应用，从一句描述开始'].filter((t) => !text.includes(t)),
    stale_copy: ['三个智能体', '三个角色', '几十秒', '那一步重新执行'].filter((t) => text.includes(t)),
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, (width, height) in VIEWPORTS.items():
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        page.goto("http://127.0.0.1:3000/", wait_until="networkidle")
        total = page.evaluate("document.documentElement.scrollHeight")
        for y in range(0, total, height // 2):
            page.evaluate("(v) => window.scrollTo(0, v)", y)
            page.wait_for_timeout(150)
        page.wait_for_timeout(900)
        result = page.evaluate(MEASURE)

        tester = page.locator("#agents ul button").nth(3)
        tester.scroll_into_view_if_needed()
        tester.click()
        page.wait_for_timeout(1200)
        result["tester_image"] = page.evaluate(
            "() => { const i = document.querySelector('.agent-visual img'); return { src_ok: i.src.includes('agent-tester'), loaded: i.complete && i.naturalWidth > 0, alt: i.alt }; }"
        )
        result["tester_detail_shown"] = "交付之前" in page.locator("#agents").inner_text()
        page.locator("#agents").screenshot(path=str(OUT / f"home_{name}_agents.png"))
        page.locator("#how").screenshot(path=str(OUT / f"home_{name}_how.png"))
        result["page_errors"] = errors
        print(json.dumps({"viewport": name, "width": width, **result}, ensure_ascii=False), flush=True)
        page.close()
    browser.close()
