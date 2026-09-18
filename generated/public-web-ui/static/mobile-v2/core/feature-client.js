function listFrom(body, key) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.[key]) ? body[key] : [];
}
const TASK_LIST_CACHE_MS = 8_000;
const TASK_LIST_TIMEOUT_MS = 9_000;
function scheduleRows(schedulesBody, brainBody) {
  const raw = listFrom(schedulesBody, 'schedules').length ? listFrom(schedulesBody, 'schedules') : listFrom(schedulesBody, 'jobs');
  const rows = raw.map((item) => ({
    ...item,
    kind: 'cron',
    id: String(item.id || item.scheduleId || ''),
    name: String(item.name || item.title || 'Schedule'),
    enabled: item.enabled !== false && item.status !== 'disabled',
    pattern: String(item.pattern || item.schedule || item.cron || item.run_at || ''),
    description: String(item.prompt || item.description || '').slice(0, 160),
    next: item.next_run || item.nextRun || '—',
    last: item.last_run || item.lastRun || 'Never',
    assignedTo: String(item.subagent_id || item.subagentId || '').trim(),
    sessionId: String(item.last_output_session_id || item.lastOutputSessionId || '').trim() || null,
    raw: item,
  }));
  const brain = brainBody?.brain || brainBody || {};
  const thought = brain.thought;
  const dream = brain.dream;
  const thoughtEnabled = brain.thoughtEnabled ?? thought?.enabled;
  const dreamEnabled = brain.dreamEnabled ?? dream?.enabled;
  const brainRow = (job, kind, enabled) => {
    if (enabled === undefined && !job) return null;
    const isThought = kind === 'thought';
    const running = job?.running === true;
    const rawJob = job || {};
    return {
      id: isThought ? 'brain-thought' : 'brain-dream',
      kind: 'brain',
      brainType: kind,
      name: isThought ? 'Brain Thought' : 'Brain Dream',
      emoji: isThought ? '🧠' : '💤',
      status: running ? 'running' : (enabled !== false ? 'active' : 'disabled'),
      builtin: true,
      enabled: enabled !== false,
      description: isThought
        ? 'Observes the last 6h of activity and writes a reflection.'
        : 'Nightly synthesis plus a second-pass memory cleanup 30m later.',
      pattern: String(rawJob.schedule || (isThought ? 'Every 6 hours' : 'Nightly')),
      next: rawJob.nextRun || '—',
      last: rawJob.lastRun || 'Never',
      footLeft: isThought ? 'Every 6 hours' : 'Nightly at 23:30 local, cleanup about 30m later',
      footRight: isThought
        ? (rawJob.todayCount !== undefined ? `Thoughts today: ${rawJob.todayCount}` : '')
        : (rawJob.ranToday !== undefined ? `Dream ran tonight: ${rawJob.ranToday ? 'yes' : 'not yet'}` : ''),
      sessionId: String(rawJob.lastOutputSessionId || rawJob.last_output_session_id || '').trim() || null,
      raw: rawJob,
    };
  };
  return [brainRow(thought, 'thought', thoughtEnabled), brainRow(dream, 'dream', dreamEnabled), ...rows].filter(Boolean);
}
export class FeatureClient {
  constructor(gatewayManager) {
    this.gateways = gatewayManager;
    this.taskCache = new Map();
    this.taskRequests = new Map();
  }
  get api() { return this.gateways.active; }
  tasks({ force = false } = {}) {
    const api = this.api;
    const key = String(api?.id || this.gateways.activeId || 'active');
    const cached = this.taskCache.get(key);
    if (!force && cached && Date.now() - cached.at < TASK_LIST_CACHE_MS) return Promise.resolve(cached.tasks);
    const pending = this.taskRequests.get(key);
    if (pending) return pending;

    const request = api.request('/api/bg-tasks?mobile=1', { timeoutMs: TASK_LIST_TIMEOUT_MS })
      .then((body) => {
        if (!body?.success || !Array.isArray(body.tasks)) throw new Error(body?.error || 'Invalid tasks response');
        const tasks = body.tasks;
        this.taskCache.set(key, { at: Date.now(), tasks });
        return tasks;
      })
      .finally(() => this.taskRequests.delete(key));
    this.taskRequests.set(key, request);
    return request;
  }
  task(id){return this.api.request(`/api/bg-tasks/${encodeURIComponent(id)}`);} taskEvidence(id){return this.api.request(`/api/bg-tasks/${encodeURIComponent(id)}/evidence`).then(r=>listFrom(r,'entries')).catch(()=>[]);} taskMessage(id,message){return this.api.request(`/api/bg-tasks/${encodeURIComponent(id)}/message`,{method:'POST',body:JSON.stringify({message})});} taskAction(id,action){if(action==='delete')return this.api.request(`/api/bg-tasks/${encodeURIComponent(id)}`,{method:'DELETE'});const endpoint=action==='retry'?'restart':action;return this.api.request(`/api/bg-tasks/${encodeURIComponent(id)}/${encodeURIComponent(endpoint)}`,{method:'POST',body:'{}'});}
  async schedules(){const[schedules,brain]=await Promise.all([this.api.request('/api/schedules').catch(()=>null),this.api.request('/api/brain/status').catch(()=>null)]);return scheduleRows(schedules,brain);} createSchedule(fields){return this.api.request('/api/schedules',{method:'POST',body:JSON.stringify({...fields,confirm:true})});} runSchedule(item){if(item.kind==='brain')return this.api.request('/api/brain/run',{method:'POST',body:JSON.stringify({type:item.brainType})});return this.api.request(`/api/schedules/${encodeURIComponent(item.id)}/run`,{method:'POST',body:'{}'});} toggleSchedule(item,enabled){if(item.kind==='brain'){const key=item.brainType==='thought'?'thoughtEnabled':'dreamEnabled';return this.api.request('/api/brain/config',{method:'PATCH',body:JSON.stringify({[key]:!!enabled})});}return this.api.request(`/api/schedules/${encodeURIComponent(item.id)}`,{method:'PATCH',body:JSON.stringify({enabled:!!enabled})});} updateSchedule(item,fields){return this.api.request(`/api/schedules/${encodeURIComponent(item.id)}`,{method:'PUT',body:JSON.stringify(fields||{})});} deleteSchedule(item){return this.api.request(`/api/schedules/${encodeURIComponent(item.id)}`,{method:'DELETE',body:JSON.stringify({confirm:true})});}
  teams(){return this.api.request('/api/teams').then(r=>listFrom(r,'teams'));} teamRuns(id,limit=30){return this.api.request(`/api/teams/${encodeURIComponent(id)}/runs?limit=${limit}`).catch(()=>({runs:[]}));} teamRoom(id){return this.api.request(`/api/teams/${encodeURIComponent(id)}/room-state`).catch(()=>null);} teamWorkspace(id){return this.api.request(`/api/teams/${encodeURIComponent(id)}/workspace`).catch(()=>({files:[]}));} teamWorkspaceFile(id,relpath){const filename=encodeURIComponent(String(relpath||'').split('/').pop()||'file');return this.api.request(`/api/teams/${encodeURIComponent(id)}/workspace/${filename}?relpath=${encodeURIComponent(relpath)}`);} teamAction(id,action){if(action==='delete')return this.api.request(`/api/teams/${encodeURIComponent(id)}`,{method:'DELETE'});const suffix=action==='review'?'manager/trigger':action;return this.api.request(`/api/teams/${encodeURIComponent(id)}/${suffix}`,{method:'POST',body:'{}'});} saveTeamContext(id,title,body){return this.api.request(`/api/teams/${encodeURIComponent(id)}/context-references`,{method:'POST',body:JSON.stringify({title,content:body})});} teamChat(id,limit=80){return this.api.request(`/api/teams/${encodeURIComponent(id)}/chat?limit=${limit}`).then(r=>listFrom(r,'messages'));} streamTeamChat(id,message,options={}){return this.api.streamRequest(`/api/teams/${encodeURIComponent(id)}/chat/stream`,{method:'POST',body:{message},...options});}
  agents(){return this.api.request('/api/agents').then(r=>listFrom(r,'agents'));} async agent(id){return(await this.agents()).find(row=>String(row.id)===String(id))||null;} agentText(id,name){return this.api.request(`/api/agents/${encodeURIComponent(id)}/${name}`).catch(()=>({content:'',exists:false}));} agentHeartbeat(id){return Promise.all([this.api.request(`/api/heartbeat/agents/${encodeURIComponent(id)}`).catch(()=>null),this.agentText(id,'heartbeat-md')]).then(([status,file])=>({status,file}));} tickAgent(id){return this.api.request(`/api/heartbeat/agents/${encodeURIComponent(id)}/tick`,{method:'POST',body:'{}'});} agentRuns(id,limit=30){return this.api.request(`/api/agents/${encodeURIComponent(id)}/runs?limit=${limit}`).then(r=>listFrom(r,'runs')).catch(()=>[]);} agentContextRefs(id){return this.api.request(`/api/agents/${encodeURIComponent(id)}/context-refs`).then(r=>listFrom(r,'refs')).catch(()=>[]);} spawnAgent(id,task,timeoutMs=180000){return this.api.request(`/api/agents/${encodeURIComponent(id)}/spawn`,{method:'POST',body:JSON.stringify({task,timeoutMs}),timeoutMs:timeoutMs+10000});} agentChat(id,limit=100){return this.api.request(`/api/agents/${encodeURIComponent(id)}/chat?limit=${limit}`).then(r=>listFrom(r,'messages')).catch(()=>[]);} streamAgentChat(id,message,options={}){return this.api.streamRequest(`/api/agents/${encodeURIComponent(id)}/chat/stream`,{method:'POST',body:{message},...options});}
  proposals(status='pending'){return this.api.request(`/api/proposals?status=${encodeURIComponent(status)}`).then(r=>listFrom(r,'proposals'));} proposal(id){return this.api.request(`/api/proposals/${encodeURIComponent(id)}`);} proposalAction(id,action){return this.api.request(`/api/proposals/${encodeURIComponent(id)}/${action}`,{method:'POST',body:'{}'});}
  hubOverview(){return Promise.all([this.api.request('/api/hub/models/overview?range=all').catch(()=>null),this.api.request('/api/hub/tools/overview?range=30d').catch(()=>null),this.api.request('/api/hub/goals').catch(()=>null)]).then(([models,tools,goals])=>({models,tools,goals:listFrom(goals,'goals')}));}
  audit(limit=80,timeoutMs=7000){return this.api.request(`/api/audit-log?limit=${encodeURIComponent(limit)}&offset=0&nonMainOnly=1`,{timeoutMs});}
  memory(timeoutMs=4500){return this.api.request('/api/memory/graph',{timeoutMs});}
  voiceStatus(){return this.api.request('/api/realtime/status').then(realtime=>({voice:{configured:null},realtime}));} transcribe(payload){return this.api.request('/api/voice/transcribe',{method:'POST',body:JSON.stringify(payload),timeoutMs:120000});} voiceStt(payload){return this.transcribe(payload);}
  heartbeat(){return this.api.request('/api/settings/heartbeat').catch(()=>null);} saveHeartbeat(fields){return this.api.request('/api/settings/heartbeat',{method:'POST',body:JSON.stringify(fields||{})});} status(){return this.api.request('/api/status').catch(()=>null);}
}
