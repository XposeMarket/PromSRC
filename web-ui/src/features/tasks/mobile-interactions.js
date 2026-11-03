// Loaded only for actionable Tasks requests; the chat route keeps its own host.
export function createTaskInteractions(c) {
  return {
    question(payload) { c.upsert(payload); return c.question({ ...payload, currentIndex:c.index(payload) }); },
    approval: payload => c.approval(payload),
    wire(root, entries, refresh) {
      root.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach(c.wireApproval);
      c.wireProcess(root); c.expiry();
      for (const entry of entries) {
        const q=entry.item?.payload;
        if (!q?.id || !['question','browser_login'].includes(entry.kind)) continue;
        const host=[...root.querySelectorAll('[data-ny-entry]')].find(el=>el.dataset.nyEntry===entry.id);
        const card=host?.querySelector('[data-pm-q-card]');
        if (!card || card.dataset.tasksWired) continue;
        card.dataset.tasksWired='true';
        c.restore(host,{[q.id]:c.drafts.get(q.id)});
        card.addEventListener('input',event=>c.remember(event.target));
        const cancel=card.querySelector('[data-pm-q-cancel]');
        if(cancel) cancel.onclick=async event=>{
          event.stopPropagation(); if(cancel.disabled)return; cancel.disabled=true;
          const result=await c.controller.cancel(q.id,{sessionId:entry.sessionId});
          if(result.ok)refresh();else cancel.disabled=false;
        };
        const submit=card.querySelector('[data-pm-q-submit]');
        if(submit)submit.onclick=async event=>{
          event.stopPropagation();if(submit.disabled)return;submit.disabled=true;
          const normalized=c.normalize(q);
          const result=await c.controller.submit(q.id,{
            sessionId:entry.sessionId, readAnswers:()=>c.collect(normalized),
            readDraftAnswers:()=>c.fromDraft(normalized,c.drafts.get(q.id)),
            stepIndex:Number(card.dataset.pmQIndex||0),advanceStep:true,
            onStepAdvance:({payload,nextIndex})=>{
              c.payload(normalized,payload,nextIndex);
              card.outerHTML=c.question({...q,currentIndex:nextIndex});
              this.wire(root,entries,refresh);
            },
          });
          if(!result.ok)submit.disabled=false;else if(!result.advanced)refresh();
        };
      }
    },
  };
}
