// Presentation gating. The full Viz Kit block is sent only when the routing
// text (the clean task, never wrapper boilerplate) asks for a visual. Everything
// else gets the compact core, and heartbeat gets none.
import { PROM_VIZ_REFERENCE } from '../gateway/prom-viz-reference';

const VISUAL_INTENT_RE = /\b(chart|graph|plot|visual(?:i[sz]e|s)?|diagram|dashboard|mermaid|svg|html|kpis?|heat ?map|treemap|sankey|timeline|trend|breakdown|compare|comparison|versus|vs|table|stats|statistics|metrics|numbers|percent(?:age)?|projection|forecast|simulat\w*|interactive|slider|quiz|flash ?cards?|poll|calculator|show me|price|prices|spend|spending|revenue|growth|roi)\b/i;
const VISUAL_FENCE_RE = /```(html|chart|mermaid|svg)\b/;
const SMALL_CONTEXT_PRESENTATION = 'Answer in plain text or markdown. Use tools to act; keep replies short.';

export function detectVisualOutputIntent(text: string, opts: { recentAssistantText?: string } = {}): { visual: boolean; reason: string } {
  if (VISUAL_INTENT_RE.test(String(text || ''))) return { visual: true, reason: 'visual_keyword' };
  // Continuations such as "make it bigger" follow a visual the assistant just wrote.
  if (VISUAL_FENCE_RE.test(String(opts.recentAssistantText || ''))) return { visual: true, reason: 'recent_visual_fence' };
  return { visual: false, reason: 'no_visual_intent' };
}

const PRESENTATION_CORE = "PRESENTATION: pick the simplest surface that fully answers. Plain text for simple answers; show_ui_card native cards for live data (weather, maps, places, products, stocks, sports, currency, news; place each with {{card:REF}} on its own line); a fenced chart, mermaid, svg or html visual for numbers, comparisons, trends, timelines or flows; or a self-authored fence: quiz, flashcards, poll, writing {\"kind\":\"Email\"|\"Post\"|\"Draft\",\"subject\"?,\"text\"} for drafts to copy, followups [\"q1\",\"q2\"] (2-4 items, last in the reply), reminder, convert, calculator. Never add a visual just to decorate. Before writing a non-trivial html visual when the Viz Kit reference is not in this prompt, call skill_read(\"interactive-visuals\") for the window.ui API and theme rules.";

const PRESENTATION_FULL = [
    'PRESENTATION SELECTION: choose the simplest response surface that fully solves the user\'s goal. First reason semantically about whether this is text, a deterministic native component, an interactive UI, an artifact, or an external action; do not jump straight to HTML.',
    'Prefer a trusted deterministic renderer/tool when it fully represents a known domain (for example weather, maps, products, stocks, sports, tables, or standard charts). Use the interactive-artifacts renderer when meaningful local interaction is the point and no existing native component is sufficient.',
    'Freeform interactive HTML is deliberately capable: it may be a rich self-contained fractal explorer, simulator, dashboard, lesson, configurable tracker, or mini-game. Do not reduce it to a tiny card or refuse complexity merely because it is generated UI. Keep it reasonably contained in the conversation, responsive from 320px upward, and update local state in place.',
    'Generated visuals run in a sandbox. They may use HTML, CSS, vanilla JavaScript, local state, and the Prometheus visual state bridge, but must never receive credentials or directly access Electron/Node, the filesystem, cookies, browser permissions, external accounts, arbitrary iframes, or unrestricted networking. External actions must go through an explicitly registered Prometheus tool and policy check.',
    'Theme contract: visual roots and controls must be transparent unless the visual itself intentionally creates an internal surface. Never hardcode a light/dark canvas or a fixed outer panel. Use Prometheus tokens such as --prom-bg, --prom-surface, --prom-surface-secondary, --prom-border, --prom-text, --prom-muted, --prom-accent, --prom-success, --prom-warning, and --prom-danger; charts and diagrams should inherit the host theme.',
    'Native interactive cards are fenced JSON blocks you write yourself (no tool call): ```quiz {"title","questions":[{"question","options":[..],"answer":<index>,"hint"?,"explanation"?}]}```; ```flashcards {"title","cards":[{"front","back"}]}```; ```poll {"question","options":[..],"multiple"?}```; ```writing {"kind":"Email"|"Post"|"Draft","subject"?,"text"}``` for any draft the user will copy; ```followups ["next question 1","next question 2"]``` (2-4 short items, last thing in a reply, only when genuinely useful); ```reminder {"title","when"}``` to offer a reminder; ```convert {"value":5,"from":"mi","to":"km"}``` for a live unit converter; ```calculator {"expression":"(12.5*4)+3^2"}``` for a live calculator. Live data (currency, clocks, sports, news, images, video, places, single products) comes from show_ui_card instead. Each show_ui_card result gives a ref: put {{card:REF}} on its own line in the final reply to place that card mid-answer (like an inline image); cards you do not place render after the reply.',
    'Viz kit: every ```html visual preloads window.ui (Prometheus Viz Kit) with ui.page, ui.kpis, ui.section, ui.chart (line/area/stacked/bar/stackedBar with crosshair tooltips, annotations, target lines), ui.bars, ui.heatmap, ui.treemap (zoomable), ui.donut, ui.table (sortable), ui.tabs, ui.segmented, ui.compare (design variants with a Pick button), ui.timeline, ui.sankey, ui.slider/ui.params + ui.loop (what-if sims), ui.form (returns JSON to chat), ui.exportBar (PNG/X post/CSV), ui.callout, ui.badge, ui.fmt and ui.state. ' + PROM_VIZ_REFERENCE + ' Pass ask:\'Why is {label} {value}?\' to views so tapping a data point drops a question into the composer. Build data visuals and UI-variant mocks with it instead of hand-rolled divs: lead with an insight headline (the finding, not the topic), a KPI strip, then 2-4 linked views over real data. Read the interactive-visuals skill before composing a non-trivial html visual.',
    'Inline visuals may sit between prose and should be one complete fenced chart, mermaid, svg, or html block when emitted. Keep surrounding explanation short. Use a larger artifact surface only when the experience is genuinely long-lived, multi-view, editing-heavy, or the deliverable itself should live independently of the message. Never generate a visual merely for decoration.',
  ].join('\n');

export function selectPresentationInstruction(input: {
  executionMode?: string;
  routingText?: string;
  recentAssistantText?: string;
  smallContext?: boolean;
}): string {
  if (input.smallContext) return SMALL_CONTEXT_PRESENTATION;
  if (input.executionMode === 'heartbeat') return '';
  const visual = detectVisualOutputIntent(input.routingText || '', { recentAssistantText: input.recentAssistantText }).visual;
  return visual ? PRESENTATION_FULL : PRESENTATION_CORE;
}
