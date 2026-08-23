import { chromium } from 'playwright';

function round(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null;
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50: null, p95: null, p99: null, max: null };
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

async function readCdpMetrics(session) {
  try {
    const response = await session.send('Performance.getMetrics');
    return Object.fromEntries((response.metrics || []).map((entry) => [entry.name, entry.value]));
  } catch {
    return {};
  }
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
    isMobile: scenario.viewport.mobile === true,
    hasTouch: scenario.viewport.mobile === true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});
  await page.setContent(`<!doctype html>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{margin:0;font:14px system-ui;background:#111;color:#eee}
      #layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.7fr);height:100vh}
      #transcript,#background{overflow:auto;padding:12px;contain:layout style paint}
      .turn{border-bottom:1px solid #333;padding:8px}.user{font-weight:600}.assistant{white-space:pre-wrap}
      .reasoning{color:#aaa}.tool{margin:4px 0;padding:5px;border:1px solid #555;border-radius:5px}
      #composer{position:fixed;bottom:4px;left:4px;width:260px}
      @media(max-width:600px){#layout{grid-template-columns:1fr}#background{display:none}}
    </style>
    <main id="layout"><section id="transcript"></section><aside id="background"></aside></main>
    <input id="composer" aria-label="benchmark composer">`);

  const beforeMetrics = await readCdpMetrics(cdp);
  const result = await page.evaluate(async (input) => {
    const transcript = document.getElementById('transcript');
    const background = document.getElementById('background');
    const composer = document.getElementById('composer');
    const longTasks = [];
    const inputLatency = [];
    const updateToPaint = [];
    let transcriptCommits = 0;
    let mutationBatches = 0;
    let mutationRecords = 0;
    const mutationObserver = new MutationObserver((records) => {
      mutationBatches += 1;
      mutationRecords += records.length;
    });
    mutationObserver.observe(document.getElementById('layout'), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    let longTaskObserver = null;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {}

    const memoryBefore = performance.memory?.usedJSHeapSize || null;
    const renderStartedAt = performance.now();
    const fragment = document.createDocumentFragment();
    for (const turn of input.turns) {
      const row = document.createElement('article');
      row.className = 'turn';
      row.dataset.key = turn.key;
      const user = document.createElement('div');
      user.className = 'user';
      user.textContent = turn.user;
      row.append(user);
      if (turn.reasoning) {
        const reasoning = document.createElement('details');
        reasoning.className = 'reasoning';
        const summary = document.createElement('summary');
        summary.textContent = 'Reasoning';
        const body = document.createElement('div');
        body.textContent = turn.reasoning;
        reasoning.append(summary, body);
        row.append(reasoning);
      }
      const assistant = document.createElement('div');
      assistant.className = 'assistant';
      assistant.textContent = turn.assistant;
      row.append(assistant);
      for (const tool of turn.tools) {
        const card = document.createElement('section');
        card.className = 'tool';
        card.dataset.key = tool.key;
        card.textContent = `${tool.name} · ${tool.state} · ${tool.summary}`;
        row.append(card);
      }
      fragment.append(row);
    }
    transcript.append(fragment);
    transcriptCommits += 1;
    const initialRenderMs = performance.now() - renderStartedAt;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const streamHosts = new Map();
    for (const stream of input.streams) {
      const host = document.createElement('article');
      host.className = 'turn stream';
      host.dataset.key = stream.id;
      host.textContent = '';
      (stream.surface === 'foreground' ? transcript : background).append(host);
      streamHosts.set(stream.id, host);
      transcriptCommits += 1;
    }

    const runStartedAt = performance.now();
    const typingPromise = new Promise((resolve) => {
      let completed = 0;
      for (const event of input.typing) {
        const scheduledAt = runStartedAt + event.dueMs;
        setTimeout(() => {
          const deliveredAt = performance.now();
          inputLatency.push(Math.max(0, deliveredAt - scheduledAt));
          composer.value += event.text;
          composer.dispatchEvent(new InputEvent('input', { data: event.text, bubbles: true }));
          completed += 1;
          if (completed === input.typing.length) resolve();
        }, event.dueMs);
      }
    });

    const streamPromises = input.streams.map((stream, streamIndex) => new Promise((resolve) => {
      let chunkIndex = 0;
      const tick = () => {
        const chunk = stream.chunks[chunkIndex];
        const updateStartedAt = performance.now();
        const host = streamHosts.get(stream.id);
        host.textContent += `${host.textContent ? ' ' : ''}${chunk.text}`;
        host.dataset.state = chunk.structural || 'streaming';
        transcriptCommits += 1;
        if (chunkIndex % 12 === 0 || chunk.structural) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            updateToPaint.push(performance.now() - updateStartedAt);
          }));
        }
        chunkIndex += 1;
        if (chunkIndex >= stream.chunks.length) {
          resolve();
          return;
        }
        setTimeout(tick, 6 + (streamIndex % 3));
      };
      setTimeout(tick, streamIndex * 2);
    }));

    await Promise.all([typingPromise, ...streamPromises]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sessionSwitchStartedAt = performance.now();
    transcript.hidden = true;
    background.hidden = false;
    void background.offsetHeight;
    background.hidden = input.viewport.mobile === true;
    transcript.hidden = false;
    const sessionSwitchMs = performance.now() - sessionSwitchStartedAt;
    await new Promise((resolve) => setTimeout(resolve, 40));

    mutationObserver.takeRecords();
    mutationObserver.disconnect();
    longTaskObserver?.disconnect();
    return {
      initialRenderMs,
      totalRunMs: performance.now() - runStartedAt,
      sessionSwitchMs,
      domNodes: document.querySelectorAll('*').length,
      transcriptRows: transcript.querySelectorAll('.turn').length,
      toolCards: document.querySelectorAll('.tool').length,
      transcriptCommits,
      mutationBatches,
      mutationRecords,
      longTasks,
      inputLatency,
      updateToPaint,
      memoryBefore,
      memoryAfter: performance.memory?.usedJSHeapSize || null,
      composerLength: composer.value.length,
    };
  }, scenario);

  const afterMetrics = await readCdpMetrics(cdp);
  await context.close();
  return {
    id: scenario.id,
    version: scenario.version,
    seed: scenario.seed,
    viewport: scenario.viewport,
    expected: scenario.expected,
    measurements: {
      initialRenderMs: round(result.initialRenderMs),
      totalRunMs: round(result.totalRunMs),
      sessionSwitchMs: round(result.sessionSwitchMs),
      domNodes: result.domNodes,
      transcriptRows: result.transcriptRows,
      toolCards: result.toolCards,
      transcriptCommits: result.transcriptCommits,
      mutationBatches: result.mutationBatches,
      mutationRecords: result.mutationRecords,
      longTasks: distribution(result.longTasks),
      inputLatencyMs: distribution(result.inputLatency),
      updateToPaintMs: distribution(result.updateToPaint),
      jsHeapBeforeBytes: result.memoryBefore,
      jsHeapAfterBytes: result.memoryAfter,
      cdpJsHeapBeforeBytes: round((beforeMetrics.JSHeapUsedSize || 0)),
      cdpJsHeapAfterBytes: round((afterMetrics.JSHeapUsedSize || 0)),
      cdpNodes: round(afterMetrics.Nodes || 0),
      cdpLayoutCount: round((afterMetrics.LayoutCount || 0) - (beforeMetrics.LayoutCount || 0)),
      cdpRecalcStyleCount: round((afterMetrics.RecalcStyleCount || 0) - (beforeMetrics.RecalcStyleCount || 0)),
      composerLength: result.composerLength,
    },
  };
}

export async function runDeterministicBrowserScenarios(scenarios) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--enable-precise-memory-info'],
  });
  try {
    const results = [];
    for (const scenario of scenarios) results.push(await runScenario(browser, scenario));
    return {
      available: true,
      mode: 'foundation-full-dom-reference',
      browser: browser.version(),
      scenarios: results,
    };
  } catch (error) {
    return { available: false, reason: String(error?.message || error) };
  } finally {
    await browser.close().catch(() => {});
  }
}
