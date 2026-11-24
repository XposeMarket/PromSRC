import { escHtml as E } from '../utils.js';
import { formatModelDisplayName } from '../model-display.js';
import { I } from './desktop-sources-icons.js';

const origins = new Map(
  Object.entries({
    user_upload: ['Uploaded by you', 'You', 'upload'],
    user_link: ['Linked by you', 'You', 'link'],
    web_fetch: ['Fetched by Prom', 'Prom', 'globe'],
    browser_visit: ['Visited in browser', 'Browser', 'browser'],
    browser_save: ['Saved from browser', 'Browser', 'browser'],
    assistant_artifact: ['Produced by Prom', 'Prom', 'file'],
    tool_observation: ['Tool observation', 'Prom', 'term'],
    external_import: ['Imported', 'Prom', 'file'],
  }),
);
const colors = { You: 'c-you', Prom: 'c-agent', Agents: 'c-agent', Changes: 'c-chg', Browser: 'c-browser' };
const sec = (name, body, count) =>
  `<section class="sec"><div class="sh"><h3>${name}</h3>${count == null ? '' : `<span class="cnt">${count}</span>`}</div>${body}</section>`;
const empty = (text) => `<div class="empty">${E(text)}</div>`;
const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const tab = (k) => `openFullSourcePanel();setSourcePanelTab('${k}')`;
const more = (text, k) => `<button type="button" class="more" onclick="${tab(k)}">${E(text)}</button>`;
const pathKey = (s) =>
  String(s || '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
const row = (glyph, label, value = '', action = '') => {
  const tag = action ? 'button' : 'div';
  return `<${tag} class="r${action ? '' : ' static'}" ${action ? `type="button" onclick="${action}"` : ''} title="${E([label, value].filter(Boolean).join(' · '))}">${I(glyph)}<span class="lbl trunc">${E(label)}</span><span class="val trunc">${E(value)}</span></${tag}>`;
};
const origin = (r) => origins.get(r.origin) || ['Added to thread', 'Other', 'file'];
const runState = (s) =>
  ({ completed: 'Done', running: 'Running', failed: 'Failed', queued: 'Queued', cancelled: 'Cancelled' })[s] ||
  String(s || 'Unknown');
function providerMark(p = '') {
  const name = /anthropic|claude/i.test(p) ? 'claude' : /openai|codex/i.test(p) ? 'openai' : /xai|grok/i.test(p) ? 'xai' : '';
  return name
    ? `<i role="img" aria-label="${E(p)}" class="dock-provider ${name}" style="--mark:url('${new URL(`../assets/import-sources/${name}.svg`, import.meta.url).href}')"></i>`
    : I('spark');
}
export function createDesktopSourcesRenderers({
  sourcePanelState: state,
  SOURCE_PANEL_SURFACE,
  sourcePanelActiveSessionId,
  sourcePanelWorkItems,
  sourcePanelMatchesItem,
  sourcePanelTimestamp: stamp,
  getChatSessionById,
  sourcePanelWorkspaceRoot,
  chatResourceTitle,
  chatResourceUrl,
  sourcePanelResourceMeta,
  sourcePanelSnapshot,
  runListState,
  encodeInlineJsString: J,
  sourcePanelRemoteReviewMarkup,
}) {
  function panelModel(d) {
    const sid = sourcePanelActiveSessionId(),
      sub = state.surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT,
      session = getChatSessionById(sid),
      repo = sub ? null : sourcePanelSnapshot();
    const root = sub
        ? ''
        : state.codingContext?.roots?.find((r) => r.repository?.vcs?.kind === 'git')?.root ||
          sourcePanelWorkspaceRoot(sid) ||
          state.codingContext?.root ||
          '',
      workspaceName = pathKey(root).split('/').pop();
    const name =
      (!sub && state.project?.name && !['Current project', 'workspace'].includes(state.project.name) ? state.project.name : '') ||
      (workspaceName !== 'workspace' && workspaceName) ||
      session?.title ||
      'This conversation';
    const work = sub || !sid ? [] : sourcePanelWorkItems(sid).filter((i) => sourcePanelMatchesItem(i));
    const runs = work.filter((i) => i.workType === 'background'),
      sources = d.recent,
      edits = d.edits;
    const canon = (p, base) => {
      let s = pathKey(p);
      if (s && !/^(?:\/|[a-z]:\/)/i.test(s)) s = pathKey(base) + '/' + s;
      return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s;
    };
    const editPaths = new Set(edits.map((i) => canon(i.path, root)));
    const isThreadFile = (i) => editPaths.has(canon(i.path, i.root || root));
    const disk = d.workspaceFiles.filter((i) => !isThreadFile(i));
    const turns = (Array.isArray(session?.history) ? session.history : [])
      .filter((m) => m.role === 'user')
      .map((m, i) => ({
        n: i + 1,
        at: stamp(m.timestamp),
        ask: String(m.text || m.content || m.message || '')
          .split(/\n\[UPLOADED FILES\]/)[0]
          .trim()
          .slice(0, 180),
      }));
    const events = [];
    for (const i of [...sources, ...d.outputs]) {
      const r = i.resource,
        [verb, group] = origin(r);
      events.push({
        i,
        verb,
        group,
        at: stamp(r.attachedAt || r.createdAt),
        loc: chatResourceUrl(r) || r.locator?.path || sourcePanelResourceMeta(r),
        title: chatResourceTitle(r),
      });
    }
    for (const i of edits)
      for (const e of i.events || [{ at: i.updatedAt }])
        events.push({
          i,
          at: e.at,
          turn: e.turn,
          group: 'Changes',
          runId: e.runId, anchor: e.startedAt,
          verb: `${(e.status || i.status) === 'added' ? 'Created' : 'Edited'} by ${e.runId ? e.label || 'child agent' : 'Prom'}`,
          loc: i.displayPath,
          title: i.title,
        });
    for (const i of work)
      events.push({
        i,
        at: i.updatedAt, anchor: i.startedAt,
        group: i.workType === 'background' ? 'Agents' : 'Prom',
        verb: i.workType === 'background' ? 'Child run' : 'Linked work',
        title: i.title,
        loc: [i.model, i.effort].filter(Boolean).join(' · ') || i.displayPath,
      });
    for (const e of events) {
      if (!e.turn && e.at) {
        const t = turns.findLast((t) => t.at && t.at <= (e.anchor || e.at));
        e.turn = t?.n || 0;
      }
    }
    const git = (state.codingContext?.roots || [])
      .filter((r) => r.repository?.vcs?.kind === 'git')
      .reduce((n, r) => n + (r.files?.length || 0), 0);
    return {
      ...d,
      sid,
      sub,
      repo,
      root,
      name,
      sources,
      edits,
      runs,
      turns,
      events,
      disk,
      isThreadFile,
      counts: { timeline: events.length, files: d.inputs.length + edits.length + disk.length + d.outputs.length, git },
    };
  }
  const attr = (i) => `data-source-item="${E(i.key)}" onclick="openSourcePanelItem(${J(i.key)})"`;
  function fileRow(i, mini = false, thread = false) {
    const st = { added: 'A', untracked: '?', deleted: 'D', renamed: 'R' }[i.status] || 'M',
      p = i.displayPath || i.path || '',
      name = mini ? p.split(/[\\/]/).pop() : p;
    const stat = `<span class="add">+${Number(i.insertions) || 0}</span> <span class="del">−${Number(i.deletions) || 0}</span>`;
    return `<button type="button" class="r${mini ? '' : ' two'}" ${attr(i)} title="${E(p)}"><span class="st ${st}">${st}</span>${mini ? `<span class="lbl trunc">${E(name)}</span>${thread ? '<span class="badge thread">this thread</span>' : ''}<span class="val">${stat}</span>` : `<span class="copy"><span class="trunc">${E(name)}</span><span class="sub trunc">${stat} · ${i.type === 'edit' ? 'recorded edit' : 'on disk · author unknown'}</span></span>${I('chev', 'go')}`}</button>`;
  }
  function resRow(i, mini = false) {
    const r = i.resource,
      name = chatResourceTitle(r),
      [verb, , glyph] = origin(r),
      at = clock(stamp(r.attachedAt || r.createdAt));
    return `<button type="button" class="r${mini ? '' : ' two'}" ${attr(i)} title="${E(name)}">${I(r.kind === 'image' ? 'image' : glyph)}${mini ? `<span class="lbl trunc">${E(name)}</span><span class="val">${at}</span>` : `<span class="copy"><span class="trunc">${E(name)}</span><span class="sub trunc">${E([verb, sourcePanelResourceMeta(r), at].filter(Boolean).join(' · '))}</span></span>${I('chev', 'go')}`}</button>`;
  }
  const isLiveProcess = i => ['starting', 'running', 'exiting'].includes(i.status) && !i.run.completedAt;
  function processList(d) {
    if (!d.processes.length) return '';
    const live = [], done = [];
    for (const p of d.processes) (isLiveProcess(p) ? live : done).push(p);
    const processRow = p => {
      const r = p.run;
      const status = r.timedOut || r.noOutputTimedOut ? 'Timed out' : r.terminationReason === 'manual_cancel' ? 'Cancelled' :
        p.status === 'exited' ? (r.exitCode === 0 ? 'Complete' : r.exitCode != null || r.failureSummary ? 'Failed' : 'Exited') : runState(p.status);
      return row('term', r.title || p.title, status, `openSourcePanelProcess(${J(r.runId || r.id)})`);
    };
    return sec('Background processes', (live.map(processRow).join('') || empty('No active processes.')) +
      (done.length ? `<details class="completed-processes"><summary class="r"><span class="lbl">Completed</span><span class="val">${done.length}</span>${I('down','chev')}</summary>${done.map(processRow).join('')}</details>` : ''), live.length);
  }
  function env(d) {
    if (d.sub) return '';
    const env = d.environment,
      repo = d.repo || {},
      branch = repo.branch || env[2]?.label || 'Branch';
    const ready = !!repo.branch,
      changed = repo.dirtyFiles?.length ?? d.counts.git,
      summary = ready
        ? [repo.ahead ? `${repo.ahead} ahead` : '', `${changed} changed`].filter(Boolean).join(' · ')
        : env[2]?.value || 'Not linked';
    const service = d.processes.find((i) => isLiveProcess(i) && /^(?:npm|pnpm|yarn) (?:run )?(?:dev|start|serve)(?:\s|$)/i.test(i.title));
    const rows = [
      ['diff', 'Changes vs HEAD', env[0]?.value || 'Unavailable'],
      ['folder', 'Working copy', ready ? `${changed} changed` : env[1]?.value || 'Unavailable'],
      ['branch', branch, env[2]?.value || 'Unavailable'],
      ['commit', 'Commit or push', 'in Git tab'],
      ['pr', 'Pull request', env[4]?.value || 'Not linked'],
    ];
    return sec(
      'Environment',
      `<details class="dock-env"><summary class="r" data-envtoggle>${I('branch')}<span class="lbl trunc">${E(branch)}</span><span class="val">${E(summary)}</span>${I('down', 'chev')}</summary><div class="envfold">${rows.map(([g, l, v]) => row(g, l, v, tab('git'))).join('')}${row('term', service ? 'Server · ' + service.title : 'Server', service?.status || 'None reported')}</div></details>`,
    );
  }
  function runLines(i) {
    const name = i.model ? formatModelDisplayName(i.model, i.provider) : i.provider;
    const meta = [name && `<b>${E(name)}</b>`, i.effort && E(i.effort)].filter(Boolean).join(' · ');
    const assignment = i.assignment || 'Assignment not recorded';
    return `<span class="run-lines"><strong class="trunc">${E(i.title)}</strong>${meta ? `<span class="run-model">${meta}</span>` : ''}<span class="run-assignment" title="${E(assignment)}">${E(assignment)}</span></span>`;
  }
  function lineage(d) {
    if (d.sub) return '';
    const n = d.runs.filter((i) => i.status === 'running').length;
    return (
      sec(
        `Lineage${n ? ` · <em>${n} running</em>` : ''}`,
        d.runs
          .slice(0, 3)
          .map(
            (i) =>
              `<button type="button" class="r lineage-row" onclick="openSourceRunInTimeline(${J(i.workId)})" title="${E(i.title)}">${providerMark(i.provider)}${runLines(i)}<span class="val run-${i.status === 'failed' ? 'failed' : 'normal'}">${E(runState(i.status))}</span></button>`,
          )
          .join('') || empty(({ready:'No child runs.', unavailable:'Run history unavailable. Refresh to retry.'})[runListState(d.sid)] || 'Loading child runs…'),
        d.runs.length,
      ) + (d.runs.length > 3 ? more(`+${d.runs.length - 3} more in Timeline`, 'timeline') : '')
    );
  }
  function changes(d, mini) {
    if (d.sub) return '';
    const rest = d.edits.length - 3;
    return sec(
      'Changed by this thread',
      d.edits
        .slice(0, 3)
        .map((i) => fileRow(i, mini))
        .join('') +
        (rest > 0 ? more(`+${rest} more in Files`, 'files') : '') +
        (!d.edits.length ? empty('No recorded edits.') : '') +
        (!mini && d.disk.length ? more(`${d.disk.length} other disk changes → Files`, 'files') : ''),
      d.edits.length,
    );
  }
  function resources(d, mini) {
    const cap = mini ? 2 : 4;
    return sec(
      mini ? 'Sources' : 'Recent sources',
      d.sources
        .slice(0, cap)
        .map((i) => resRow(i, mini))
        .join('') +
        (!d.sources.length ? empty('No sources yet.') : '') +
        (!d.sub && d.sources.length > cap ? more(`+${d.sources.length - cap} more in Timeline`, 'timeline') : ''),
      d.sources.length,
    );
  }
  const jump = (d, k, label) => `<button type="button" onclick="${tab(k)}"><b>${d.counts[k] ?? I('expand')}</b>${label}</button>`;
  function renderSourcesPeek(d) {
    return `<div class="sources-minimized-card"><div class="ph2"><strong>Sources</strong><button class="ibtn" type="button" aria-label="Open Sources" onclick="openFullSourcePanel()">${I('expand')}</button><button class="ibtn" type="button" aria-label="Close minimized sources" onclick="hideSourcesMinimizedPanel()">${I('x')}</button></div><div class="scope-line">${I('folder')}<b>This thread</b><span class="trunc">· ${E(d.name)}</span></div><div class="scroll">${env(d)}${lineage(d)}${changes(d, true)}${resources(d, true)}${processList(d)}</div><nav class="jump" aria-label="Open Sources tab">${(d.sub ? ['Overview'] : ['Overview', 'Timeline', 'Files', 'Git']).map((l) => jump(d, l.toLowerCase(), l)).join('')}</nav></div>`;
  }
  function renderSourcePanelOverview(d) {
    if (d.sub) return resources(d, false);
    const stats = [
      [d.sources.length, 'Sources'],
      [d.edits.length, 'Changed here'],
      [d.outputs.length, 'Outputs'],
      [d.runs.length, 'Child runs'],
    ];
    const browser = d.browserItems.filter((i) => i.record && i.title !== 'New tab');
    return (
      `<section class="proj"><p class="name">${E(d.name)}</p>${d.root ? `<p class="root mono trunc" title="${E(d.root)}">${E(d.root)}</p>` : ''}<div class="counts">${stats.map(([n, l]) => `<span><b>${n}</b>${l}</span>`).join('')}</div></section>` +
      env(d) +
      lineage(d) +
      changes(d, false) +
      resources(d, false) +
      processList(d) +
      (browser.length
        ? sec(
            'Browser',
            browser
              .map((i) =>
                row(
                  'browser',
                  i.title,
                  'this chat',
                  `followBrowserCanvasSession(${J(i.record.sessionId)});openBrowserCanvasSurface()`,
                ),
              )
              .join(''),
          )
        : '')
    );
  }
  function renderSourcePanelFiles(d) {
    return [
      ['Inputs', d.inputs, resRow],
      ['Changed by this thread', d.edits, fileRow],
      ['Also changed on disk', d.disk, fileRow],
      ['Outputs', d.outputs, resRow],
    ]
      .map(([name, items, fn]) =>
        sec(name, items.length ? items.map((i) => fn(i)).join('') : empty('None recorded.'), items.length),
      )
      .join('');
  }
  function eventRow(e) {
    const i = e.i,
      isRun = e.group === 'Agents',
      isRes = i.type === 'resource',
      detail = isRun || isRes;
    const body = `<span class="t">${clock(e.at)}</span><span class="rail2"><span class="pip"></span></span><span class="body"><span class="verb">${isRun ? providerMark(i.provider) : ''}<span class="trunc">${E(e.verb)}</span>${isRun ? `<em>${E(runState(i.status))}</em>` : ''}</span>${isRun ? runLines(i) : `<span class="ttl trunc">${E(e.title)}</span><span class="loc trunc">${E(e.loc)}</span>`}</span>`;
    const cl = `ev ${colors[e.group] || 'c-base'}`;
    if (!detail)
      return `<button type="button" class="${cl}" ${i.type === 'work' ? `onclick="openSourcePanelWork(${J(i.workType)},${J(i.workId)})"` : attr(i)}>${body}</button>`;
    return `<details class="dock-agent" data-run="${E(isRun ? i.workId : i.key)}"><summary class="${cl}">${body}</summary><div class="x">${isRun ? `<p class="summary"><b>Assignment${i.taskTitle ? ` · ${E(i.taskTitle)}` : ''}</b><br>${E(i.assignment || 'Not recorded')}</p>${i.preview ? `<p class="summary"><b>Outcome</b><br>${E(i.preview)}</p>` : ''}<button class="btn" type="button" onclick="openSourcePanelWork('background',${J(i.workId)})">Open child run</button>` : `<p class="summary">${E(e.loc)}</p><p class="hint">Attached, not confirmed read.</p><button class="btn" type="button" ${attr(i)}>Open</button>`}</div></details>`;
  }
  function renderSourcePanelTimeline(d) {
    let f = state.timelineFilter || 'All';
    const filters = ['All', 'You', 'Prom', 'Agents', 'Changes', 'Browser', 'Other'];
    const matches = (e, k) => k === 'All' || e.group === k || (k === 'Agents' && !!e.runId);
    if (!d.events.some((e) => matches(e, f))) f = 'All';
    const chips = filters
      .map((k) => {
        const n = k === 'All' ? d.events.length : d.events.filter((e) => matches(e, k)).length;
        return n
          ? `<button type="button" class="fchip ${colors[k] || ''}" aria-pressed="${k === f}" onclick="setDockTimelineFilter('${k}')">${k === 'All' ? '' : '<i></i>'}${k} <b>${n}</b></button>`
          : '';
      })
      .join('');
    const groups = new Map();
    for (const e of d.events.filter((e) => matches(e, f))) {
      const k = e.turn || 0;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return (
      `<div class="chips dock-filters">${chips}</div>` +
      [...groups]
        .sort(([a], [b]) => b - a)
        .map(([k, items]) => {
          const t = d.turns[k - 1];
          return `<div class="turn"><b>${t ? `Turn ${k}` : 'Thread activity'}</b>${t ? `<span>${clock(t.at)}</span><q class="trunc">${E(t.ask)}</q>` : ''}</div><div class="trail">${items
            .sort((a, b) => b.at - a.at)
            .map(eventRow)
            .join('')}</div>`;
        })
        .join('') +
      (!groups.size ? empty('No recorded activity.') : '') +
      `<p class="legend">${I('info')}<span>How things entered or changed in this thread. Attached isn’t read; git status isn’t authorship.</span></p>`
    );
  }
  function renderReferenceGit(d) {
    if (!state.gitLoaded || state.gitLoading) return sec('Environment', empty('Loading workspace and Git status…'));
    if (state.gitError)
      return sec(
        'Environment unavailable',
        empty(String(state.gitError)) +
          `<button type="button" class="more" onclick="refreshSourcePanel()">Retry workspace</button>`,
      );
    const roots = (state.codingContext?.roots || []).filter((r) => r.repository?.vcs?.kind === 'git');
    if (!roots.length)
      return sec(
        'Filesystem workspace',
        empty('No Git repository linked to this scope.') + d.disk.map((i) => fileRow(i)).join(''),
      );
    return roots
      .map((r) => {
        const repo = r.repository,
          files = r.files || [],
          manage = `openCodingWorkspace(${J(r.root)})`,
          branches = [repo.ahead && `${repo.ahead} ahead`, repo.behind && `${repo.behind} behind`].filter(Boolean).join(' · ');
        return (
          sec(
            'Repository',
            row(
              'branch',
              repo.repoFullName || repo.name || r.label || 'Repository',
              repo.vcs.remoteConnected ? 'origin' : 'local',
            ) +
              row('branch', repo.branch || 'Detached HEAD', branches) +
              row('diff', 'Working copy vs HEAD', `${files.length} changed`) +
              row('upload', 'Staged', `${files.filter((f) => f.staged).length} files`) +
              row('file', 'Untracked', `${files.filter((f) => f.untracked).length} files`),
          ) +
          sec(
            'Working copy vs HEAD',
            files
              .map((f) => {
                const i = { ...f, key: `workspace-file:${f.id || f.path}`, root: r.root };
                return fileRow(i, true, d.isThreadFile(i));
              })
              .join('') +
              `<p class="hint">${I('info')}<span>Git status shows what differs from HEAD, not who changed it.</span></p>`,
            files.length,
          ) +
          sec('Commit &amp; push', row('commit', 'Open Git workspace', 'Stage, commit or push', manage)) +
          sec('Compare branch', row('branch', repo.branch || 'Detached HEAD', 'Open workspace', manage)) +
          sec(
            'Recent commits',
            (repo.commits || [])
              .slice(0, 8)
              .map((c) =>
                row(
                  'commit',
                  c.message,
                  c.shortHash || String(c.hash || '').slice(0, 7),
                  `openSourcePanelItem(${J('git:commit:' + (c.hash || c.shortHash || c.message))})`,
                ),
              )
              .join('') || empty('No commits reported.'),
          ) +
          sourcePanelRemoteReviewMarkup(r.root)
        );
      })
      .join('');
  }
  return {
    renderSourcesPeek,
    renderSourcePanelOverview,
    renderSourcePanelTimeline,
    renderSourcePanelFiles,
    renderReferenceGit,
    panelModel,
  };
}
