import { escHtml } from '../utils.js';

export function createDesktopSourcesRenderers({
  sourcePanelState, SOURCE_PANEL_SURFACE, sourcePanelWorkItems, sourcePanelMatchesItem,
  sourcePanelActiveSessionId, sourcePanelItemMarkup, sourcePanelWorkRowMarkup, sourcePanelAge,
  sourcePanelTimestamp, renderSourcePanelEnvironment, renderSourcePanelProcesses, renderSourcePanelBrowser,
  encodeInlineJsString
}) {
  function renderSourcePanelOverview(data) {
    if (sourcePanelState.surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT) {
      return `<section class="source-panel-section" title="Only sources from this subagent's chat"><h3 class="source-panel-section-title">Recent sources</h3>${data.recent.length ? `<div class="source-panel-list">${data.recent.slice(0, 8).map((item) => sourcePanelItemMarkup(item)).join('')}</div>` : '<div class="source-panel-empty">No sources yet.</div>'}</section>`;
    }
    return `${sourceDockEnvironment(data)}${sourceDockLineage()}${data.processes.length ? renderSourcePanelProcesses(data) : ''}${renderSourcePanelBrowser(data)}<section class="source-panel-section"><h3 class="source-panel-section-title">Recent sources</h3>${data.recent.slice(0,4).map(i => sourcePanelItemMarkup(i)).join('') || '<div class="source-panel-empty">No sources yet.</div>'}</section>`;
  }
  function sourceDockEnvironment(data, mini = false) {
    return data.environment.length ? `<details class="dock-env"><summary>Environment</summary>${renderSourcePanelEnvironment(data,{mini})}</details>` : '';
  }
  function sourceDockAgent(item) {
    const p = String(item.provider || '').toLowerCase();
    const mark = /anthropic|claude/.test(p) ? 'claude' : /openai|codex/.test(p) ? 'openai' : /xai|grok/.test(p) ? 'xai' : '';
    const icon = mark ? `<i role="img" aria-label="${escHtml(p)}" class="dock-provider" style="--mark:url('${new URL(`../assets/import-sources/${mark}.svg`, import.meta.url).href}')"></i>` : '<i aria-hidden="true">◌</i>';
    return `<details class="dock-agent" data-run="${escHtml(item.workId)}"><summary>${icon}<span>${escHtml(item.title)}</span><small>${escHtml(item.status)}</small></summary><div class="dock-agent-detail">${escHtml([item.model,item.effort && `${item.effort} reasoning`].filter(Boolean).join(' · '))}<button type="button" onclick="openSourcePanelWork('background', ${encodeInlineJsString(item.workId)})">Open run →</button></div></details>`;
  }
  function sourceDockLineage() {
    if (!sourcePanelActiveSessionId() || sourcePanelState.surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT) return '';
    const runs = sourcePanelWorkItems().filter(i => i.workType === 'background' && sourcePanelMatchesItem(i));
    const active = runs.filter(i => ['running','queued','starting'].includes(i.status));
    return runs.length ? `<section class="source-panel-section"><h3 class="source-panel-section-title">Lineage${active.length ? ` · ${active.length} running` : ''}</h3>${(active.length ? active : runs).slice(0,3).map(sourceDockAgent).join('')}</section>` : '';
  }
  function renderSourcePanelFiles(data) {
    const groups = [['Changed files',data.workspaceFiles],['Recorded edits',data.edits],['Inputs',data.inputs],['Outputs',data.outputs]];
    return groups.filter(([,items]) => items.length).map(([label,items]) => `<section class="source-panel-section"><h3 class="source-panel-section-title">${label} · ${items.length}</h3>${items.map(i => sourcePanelItemMarkup(i)).join('')}</section>`).join('') || '<div class="source-panel-empty">No files in this scope.</div>';
  }

  function renderSourcePanelTimeline(data) {
    const origins = {user_upload:'Uploaded', user_link:'Linked', web_fetch:'Fetched', browser_visit:'Visited', browser_save:'Saved', assistant_artifact:'Produced', external_import:'Imported', tool_observation:'Observed'};
    const events = data.resourceItems.filter(i => sourcePanelMatchesItem(i)).map(i => ({time:sourcePanelTimestamp(i.resource.attachedAt || i.resource.createdAt), group:'Sources', label:origins[i.resource.origin] || 'Added', row:sourcePanelItemMarkup(i)}));
    for (const i of data.edits) events.push({time:i.updatedAt, group:'Files', label:'Recorded edit', row:sourcePanelItemMarkup(i)});
    for (const i of sourcePanelWorkItems().filter(i => sourcePanelMatchesItem(i))) events.push({time:i.updatedAt, group:i.workType === 'background' ? 'Agents' : 'Work', label:i.workType === 'background' ? 'Agent run' : 'Linked work', row:i.workType === 'background' ? sourceDockAgent(i) : sourcePanelWorkRowMarkup(i)});
    const filter = sourcePanelState.timelineFilter || 'All';
    const groups = [...new Set(['All', ...events.map(e => e.group), filter])];
    const chips = groups.length < 2 ? '' : `<div class="dock-filters">${groups.map(g => `<button type="button" aria-pressed="${g === filter}" onclick="setDockTimelineFilter('${g}')">${g}</button>`).join('')}</div>`;
    const rows = events.filter(e => filter === 'All' || e.group === filter).sort((a,b) => b.time-a.time);
    return chips + (rows.map(e => `<div class="dock-event"><div class="dock-event-label">${e.label}<time title="${e.time ? escHtml(new Date(e.time).toLocaleString()) : ''}">${e.time ? escHtml(sourcePanelAge(e.time)) : ''}</time></div>${e.row}</div>`).join('') || '<div class="source-panel-empty">No recorded activity.</div>');
  }

  return { sourceDockEnvironment, sourceDockLineage, renderSourcePanelOverview, renderSourcePanelTimeline, renderSourcePanelFiles };
}
