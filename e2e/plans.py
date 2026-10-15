"""
计划卡片完整回归测试（需要后端 + 前端已启动）。

运行：
  cd web && npm run dev         # 或 npm run build + cd ../server && npm start
  python3 e2e/plans.py

覆盖：新建 / 编辑 / 切换启用暂停 / 位置稳定性 / 快速连点 / Cron 预览 /
      删除 / 表单校验 / 执行并检查逐机结果
"""
import asyncio
import sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
API = BASE.rstrip("/")


class Checker:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, cond, label):
        if cond:
            self.passed += 1
            print(f"  ✓ {label}")
        else:
            self.failed += 1
            print(f"  ✗ {label}")

    def summary(self):
        print(f"\n通过 {self.passed} / 失败 {self.failed}")
        return self.failed == 0


async def plans_via_api(page):
    return await page.evaluate(
        """async () => (await (await fetch('/api/plans')).json()).plans"""
    )


async def main():
    c = Checker()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1500, "height": 1000})
        console_errors = []
        # 测试会故意触发 400（无效 Cron 校验），浏览器会把它记为 console error，
        # 这类预期内的校验响应需要排除。
        def on_console(m):
            if m.type != "error":
                return
            txt = m.text
            if "Failed to load resource" in txt and "400" in txt:
                return
            console_errors.append(txt)

        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("console", on_console)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1500)

        # ---------- 1. 新建 ----------
        print("\n[1] 新建计划")
        await page.get_by_role("button", name="+ 新建").click()
        await page.wait_for_timeout(500)
        modal = page.locator(".modal")
        c.check(await modal.count() == 1, "模态框打开")
        await modal.locator(".input").nth(0).fill("E2E计划")
        await modal.locator(".textarea").first.fill("echo e2e")
        boxes = modal.locator(".host-select-item input")
        c.check(await boxes.count() >= 1, "存在可选主机")
        await boxes.first.check()
        await modal.locator(".modal-foot button", has_text="保存").click()
        await page.wait_for_timeout(1500)
        c.check(await page.locator(".modal").count() == 0, "保存后模态框关闭")
        names = await page.locator(".plan-card .name").all_inner_texts()
        c.check("E2E计划" in names, "新计划出现在列表")

        # ---------- 2. 编辑 ----------
        print("\n[2] 编辑计划")
        card = page.locator(".plan-card", has_text="E2E计划").first
        await card.locator("button", has_text="配置").click()
        await page.wait_for_timeout(500)
        modal = page.locator(".modal")
        c.check(
            await modal.locator(".input").nth(0).input_value() == "E2E计划",
            "名称正确回填",
        )
        c.check(
            await modal.locator(".textarea").first.input_value() == "echo e2e",
            "命令正确回填",
        )
        await modal.locator(".textarea").first.fill("echo e2e-edited")
        await modal.locator(".modal-foot button", has_text="保存").click()
        await page.wait_for_timeout(1500)
        plan = next((x for x in await plans_via_api(page) if x["name"] == "E2E计划"), None)
        c.check(plan and plan["command"] == "echo e2e-edited", "编辑已持久化")

        # ---------- 3. 切换 + 位置稳定 ----------
        print("\n[3] 切换启用/暂停")
        order_before = await page.locator(".plan-card .name").all_inner_texts()
        card = page.locator(".plan-card", has_text="E2E计划").first
        idx_before = order_before.index("E2E计划")
        await card.locator("button", has_text="暂停").first.click()
        await page.wait_for_timeout(1200)
        plan = next((x for x in await plans_via_api(page) if x["name"] == "E2E计划"), None)
        c.check(plan and plan["enabled"] is False, "状态已变为暂停")
        order_after = await page.locator(".plan-card .name").all_inner_texts()
        c.check(order_after.index("E2E计划") == idx_before, "卡片位置未跳动")
        # 切回启用
        card = page.locator(".plan-card", has_text="E2E计划").first
        await card.locator("button", has_text="启用").first.click()
        await page.wait_for_timeout(1200)
        plan = next((x for x in await plans_via_api(page) if x["name"] == "E2E计划"), None)
        c.check(plan and plan["enabled"] is True, "状态已变回启用")

        # ---------- 4. 快速连点只影响同一卡片 ----------
        print("\n[4] 同一位置快速连点")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1200)
        first_name = await page.locator(".plan-card .name").first.inner_text()
        before = {
            x["name"]: x["enabled"] for x in await plans_via_api(page)
        }
        for _ in range(3):
            card = page.locator(".plan-card").first
            b = card.locator("button", has_text="暂停")
            if await b.count() == 0:
                b = card.locator("button", has_text="启用")
            await b.first.click()
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(1500)
        after = {x["name"]: x["enabled"] for x in await plans_via_api(page)}
        changed = sorted(k for k in before if before[k] != after[k])
        c.check(changed in ([], [first_name]), f"仅首张卡片受影响（实际: {changed}）")

        # ---------- 5. Cron 预览 ----------
        print("\n[5] Cron 预览")
        card = page.locator(".plan-card", has_text="E2E计划").first
        await card.locator("button", has_text="配置").click()
        await page.wait_for_timeout(500)
        modal = page.locator(".modal")
        await modal.locator(".select").nth(1).select_option("cron")
        await page.wait_for_timeout(300)
        await modal.locator(".field", has_text="Cron").locator("input.input").fill("*/5 * * * *")
        await modal.locator("button", has_text="预览").click()
        await page.wait_for_timeout(900)
        hints = await modal.locator(".hint").all_inner_texts()
        c.check(any("下次执行" in h for h in hints), "Cron 预览返回下次时间")
        await modal.locator(".modal-foot button", has_text="保存").click()
        await page.wait_for_timeout(1500)
        plan = next((x for x in await plans_via_api(page) if x["name"] == "E2E计划"), None)
        c.check(plan and plan["cronExpression"] == "*/5 * * * *", "Cron 已保存")
        # 暂停的计划不应有下次执行时间；启用后应自动算出，先确保处于启用态。
        if plan and not plan["enabled"]:
            await page.locator(".plan-card", has_text="E2E计划").first.locator(
                "button", has_text="启用"
            ).click()
            await page.wait_for_timeout(1200)
            plan = next(
                (x for x in await plans_via_api(page) if x["name"] == "E2E计划"), None
            )
        c.check(plan and plan["enabled"], "计划处于启用状态")
        c.check(plan and plan["nextRunAt"] is not None, "已启用计划计算了下次执行时间")

        # ---------- 6. 无效 Cron 被拒 ----------
        print("\n[6] 无效 Cron 校验")
        card = page.locator(".plan-card", has_text="E2E计划").first
        await card.locator("button", has_text="配置").click()
        await page.wait_for_timeout(500)
        modal = page.locator(".modal")
        await modal.locator(".field", has_text="Cron").locator("input.input").fill("bad cron")
        await modal.locator("button", has_text="预览").click()
        await page.wait_for_timeout(800)
        toasts = await page.locator(".toast").all_inner_texts()
        c.check(any("无效" in t for t in toasts), "无效 Cron 给出提示")
        await modal.locator(".modal-foot button", has_text="取消").click()
        await page.wait_for_timeout(400)

        # ---------- 7. 未选主机被拦截 ----------
        print("\n[7] 表单校验")
        await page.get_by_role("button", name="+ 新建").click()
        await page.wait_for_timeout(400)
        modal = page.locator(".modal")
        await modal.locator(".input").nth(0).fill("无目标")
        await modal.locator(".textarea").first.fill("echo x")
        await modal.locator(".modal-foot button", has_text="保存").click()
        await page.wait_for_timeout(800)
        c.check(await page.locator(".modal").count() == 1, "未选主机被拦截，模态框保持")
        toasts = await page.locator(".toast").all_inner_texts()
        c.check(any("目标主机" in t for t in toasts), "提示需要选择主机")
        await modal.locator(".modal-foot button", has_text="取消").click()
        await page.wait_for_timeout(400)

        # ---------- 8. 执行并检查逐机结果 ----------
        print("\n[8] 立即执行")
        card = page.locator(".plan-card", has_text="E2E计划").first
        await card.locator("button", has_text="执行").click()
        await page.wait_for_timeout(4000)
        rows = page.locator(".result-row")
        c.check(await rows.count() >= 1, "产生逐机结果行")
        if await rows.count():
            txt = await rows.first.inner_text()
            c.check("成功" in txt, "首台主机执行成功")
        chips = dict(
            zip(
                await page.locator(".col-center .chip .l").all_inner_texts(),
                await page.locator(".col-center .chip .n").all_inner_texts(),
            )
        )
        c.check(chips.get("总计") == "1", "汇总总计正确")

        # ---------- 9. 删除 ----------
        print("\n[9] 删除计划")
        before_n = len(await plans_via_api(page))
        await page.locator(".plan-card", has_text="E2E计划").first.locator(
            "button", has_text="删除"
        ).click()
        await page.wait_for_timeout(1500)
        after_n = len(await plans_via_api(page))
        c.check(after_n == before_n - 1, "计划已删除")

        # ---------- 10. 控制台无错误 ----------
        print("\n[10] 控制台")
        c.check(len(console_errors) == 0, f"无控制台错误（{len(console_errors)}）")
        for e in console_errors[:5]:
            print("    ", e[:160])

        await browser.close()
    sys.exit(0 if c.summary() else 1)


if __name__ == "__main__":
    asyncio.run(main())
