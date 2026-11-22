import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const root = path.resolve("web-ui"),
  origin = "http://desktop-plan.test",
  out = process.env.PLAN_SHOTS;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const p = url.pathname;
    if (p.startsWith("/api/"))
      return route.fulfill({
        json:
          p === "/api/account/status"
            ? { authenticated: true, accountRequired: false }
            : p === "/api/onboarding/status"
              ? { nextStep: "done", modelConnected: true }
              : {},
      });
    const f = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
    if (!f.startsWith(root + path.sep) || !existsSync(f))
      return route.fulfill({ status: 404, body: "" });
    if (p === "/src/pages/ChatPage.js")
      return route.fulfill({
        contentType: "text/javascript",
        body:
          readFileSync(f, "utf8") +
          "\nwindow.planFixture={getSessionStreamState,getActiveQueuedPrompts,renderChatMessages,renderQueuedPromptsPanel,renderBackgroundSpawnDock,renderSlashCommandPopover,renderProgressPanel};",
      });
    return route.fulfill({ path: f });
  });
  await page.goto(origin + "/?desktop=1");
  await page.waitForFunction(() => !!window.planFixture);
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const id = "desktop-plan-preview",
      f = window.planFixture;
    const message = {
      role: "user",
      content: "Please check the desktop chat layout and send me a comparison.",
      ts: Date.now() - 60000,
    };
    window.chatSessions = [
      {
        id,
        title: "Desktop chat layout",
        messages: [message],
        processLog: [],
        createdAt: Date.now(),
      },
    ];
    window.activeChatSessionId = id;
    window.chatHistory = [message];
    window._sessionThinking[id] = true;
    window.isThinking = true;
    const st = f.getSessionStreamState(id);
    Object.assign(st, {
      turnStartedAt: Date.now() - 24000,
      streamingAIText:
        "IÃ¢â‚¬â„¢m checking how the plan sits alongside the other composer controls.",
      finalResponseStarted: true,
      runtimeProgressState: {
        source: "declared",
        activeIndex: 1,
        items: [
          { text: "Inspect the current desktop layout", status: "done" },
          { text: "Check spacing around the composer", status: "in_progress" },
          { text: "Capture the comparison screenshots", status: "pending" },
        ],
      },
    });
    f.renderChatMessages();
  });
  const slot = page.locator("#desktop-plan-slot");
  await slot.getByText("Inspect the current desktop layout").waitFor();
  assert.equal(
    await page.locator("#chat-messages .inline-runtime-plan").count(),
    0,
  );
  const shot = async (name) => {
    if (out) {
      mkdirSync(out, { recursive: true });
      await page.screenshot({
        path: path.join(out, name + ".png"),
        animations: "disabled",
      });
    }
  };
  const area = page.locator("#chat-view > .chat-input-area");
  const toolbar = (enabled) =>
    page.evaluate(async (enabled) => {
      const { mountMinimalAgentComposer } =
        await import("/src/chat/external-agent-composer.js");
      mountMinimalAgentComposer(enabled);
    }, enabled);
  await toolbar(true);
  const integrated = async () => {
    const shell = await area.boundingBox(),
      plan = await slot.boundingBox();
    assert.ok(
      plan.y >= shell.y && plan.y + plan.height <= shell.y + shell.height,
    );
    assert.equal(
      await slot.locator("..").evaluate((e) => getComputedStyle(e).boxShadow),
      "none",
    );
  };
  await integrated();
  await shot("after-plan");
  await page.evaluate(() => {
    const f = window.planFixture;
    f.getActiveQueuedPrompts().push({
      message: "Also check the narrow desktop window.",
    });
    f.renderQueuedPromptsPanel();
    window.backgroundSpawnDockMap = new Map([
      [
        "layout",
        {
          id: "layout",
          sessionId: window.activeChatSessionId,
          status: "running",
          startedAt: Date.now(),
          events: [],
          prompt: "Check the desktop layout",
        },
      ],
    ]);
    f.renderBackgroundSpawnDock();
  });
  await page.waitForTimeout(250);
  const rect = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    assert.ok(r?.height > 0, sel);
    return r;
  };
  const above = async (a, b) => {
    const x = await rect(a),
      y = await rect(b);
    assert.ok(
      x.y + x.height <= y.y + 1,
      `${a} overlaps ${b}: ${x.y + x.height} > ${y.y}`,
    );
  };
  const check = async () => {
    await above("#background-spawn-dock", "#desktop-plan-slot");
    await above("#desktop-plan-slot", ".queued-item-text");
    await above(".queued-item-text", "#chat-input");
    await page.locator(".queued-steer-btn").click({ trial: true });
  };
  await check();
  await shot("after-combined");
  await page.locator("[data-bg-collapse-all]").click();
  await check();
  await page.locator("[data-bg-open-all]").click();
  await check();
  await page.setViewportSize({ width: 900, height: 650 });
  await check();
  await toolbar(false);
  await integrated();
  await check();
  await page.evaluate(() => {
    const f = window.planFixture;
    f.getSessionStreamState(
      window.activeChatSessionId,
    ).runtimeProgressState.items[1].status = "done";
    f.renderProgressPanel();
  });
  await slot.getByText("2/3").waitFor();
  await page.locator("#chat-input").fill("/");
  await page.evaluate(() => window.planFixture.renderSlashCommandPopover("/"));
  await page
    .locator("#chat-slash-command-popover .chat-slash-command-item")
    .first()
    .waitFor();
  await above(".queued-item-text", "#chat-slash-command-popover");
  await page
    .locator("#chat-slash-command-popover button")
    .first()
    .click({ trial: true });
  await page.locator("#chat-input").fill("");
  await page.evaluate(() => window.planFixture.renderSlashCommandPopover(""));
  await page.locator(".queued-remove-btn").click();
  await slot.getByText("2/3").waitFor();
  assert.equal(await page.locator(".queued-item").count(), 0);
  await page.evaluate(() => {
    window._sessionThinking[window.activeChatSessionId] = false;
    window.planFixture.renderChatMessages();
  });
  assert.equal(await slot.isVisible(), false);
  assert.equal(
    await page
      .locator("#desktop-composer-shelf")
      .evaluate((e) => e.offsetHeight),
    0,
  );
  await toolbar(true);
  await shot("empty");
  const input = page.locator("#chat-input");
  const emptyHeight = (await area.boundingBox()).height;
  assert.ok(emptyHeight < 95, `empty composer is ${emptyHeight}px`);
  await input.fill("First line\nSecond line\nThird line\nFourth line");
  const grownHeight = (await area.boundingBox()).height;
  assert.ok(grownHeight > emptyHeight + 40);
  assert.ok(await input.evaluate((e) => e.scrollHeight <= e.clientHeight + 1));
  await above("#chat-input", ".ea-composer-plus");
  await input.fill("");
  assert.ok(Math.abs((await area.boundingBox()).height - emptyHeight) <= 1);
  await page.locator(".ea-composer-plus").click();
  await page
    .locator(".ea-composer-add-menu .chat-attach-btn")
    .click({ trial: true });
  console.log(
    `Empty ${emptyHeight}px, four lines ${grownHeight}px; + menu accessible`,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop plan, queue, agent toggle, slash suggestions, narrow window, progress update and cleanup",
  );
} finally {
  await browser.close();
}
