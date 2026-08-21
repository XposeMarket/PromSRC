/**
 * Fast, side-effect-free category activation for the main chat turn.
 *
 * This is intentionally a conservative router. It decides which category is
 * worth making available, not which tool the model must call. The model keeps
 * request_tool_category as a fallback when the wording is ambiguous.
 */

export type KeywordRoutingCategory =
  | 'browser_automation'
  | 'desktop_automation'
  | 'workspace_write'
  | 'advanced_memory'
  | 'media_assets'
  | 'media_generation'
  | 'automation_scheduling'
  | 'automation_tasks'
  | 'automation_recovery'
  | 'automation_sessions'
  | 'runtime_admin'
  | 'external_apps'
  | 'integration_admin'
  | 'agents_and_teams'
  | 'proposal_admin'
  | 'mcp_server_tools'
  | 'composite_tools'
  | 'creative_basic'
  | 'creative_image'
  | 'creative_video'
  | 'creative_hyperframes'
  | 'creative_quality'
  | 'skills'
  | 'model_management'
  | 'business'
  | 'social_intelligence'
  | 'prometheus_source_read'
  | 'prometheus_source_write';

type RoutingSet = Set<string>;

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function hasWord(text: string, words: readonly string[]): boolean {
  const tokens = new Set(text.split(/[^a-z0-9_]+/i).filter(Boolean));
  return words.some((word) => tokens.has(word.toLowerCase()));
}

function hasAction(text: string): boolean {
  return hasWord(text, [
    'open', 'read', 'inspect', 'check', 'search', 'find', 'look', 'review', 'show', 'list',
    'use', 'run', 'start', 'stop', 'create', 'make', 'build', 'edit', 'change', 'modify',
    'update', 'delete', 'remove', 'rename', 'copy', 'move', 'save', 'download', 'upload',
    'click', 'fill', 'type', 'drag', 'send', 'post', 'publish', 'connect', 'configure',
    'authorize', 'approve', 'recover', 'resume', 'rerun', 'retry', 'debug', 'fix', 'set',
    'apply', 'manage', 'activate', 'delegate', 'spawn', 'dispatch', 'steer', 'schedule', 'restart', 'diagnose',
    'automate', 'generate', 'render', 'compose', 'export', 'import', 'analyze', 'audit',
  ]);
}

function isQuestionAboutMeaning(text: string): boolean {
  const operationalStatusQuestion = /^(?:what|which)\s+(?:tasks?|jobs?|runs?|executions?)\b[\s\S]*(?:running|status|output|outputs|in progress)/.test(text)
    || /^what\s+is\s+(?:the\s+)?(?:status|state)\s+of\s+(?:a\s+)?(?:task|job|run|execution)/.test(text);
  return /^(?:what|who|why|how)\b/.test(text) && !operationalStatusQuestion && !hasAny(text, [
    'how do i', 'how can i', 'how should i', 'what should i do', 'what can you do with',
  ]);
}

function isExplicitToolName(text: string): boolean {
  return /(?:^|\s)\w+_(?:ops|open|observe|act|extract|screen|apps|window|input|macro|run|control|search|read|write|edit|generate|compose|manage|restart)(?:$|\s|[(),.:])/i.test(text)
    || /(?:^|\s)mcp__[\w-]+__[\w-]+/i.test(text);
}

function add(set: RoutingSet, category: KeywordRoutingCategory): void {
  set.add(category);
}

function addAutomationAliases(set: RoutingSet, pack: KeywordRoutingCategory): void {
  add(set, pack);
  // These aliases keep older prompt-context regressions and callers readable;
  // auto-activation consumes the canonical pack IDs only.
  set.add('automations');
  if (pack === 'automation_scheduling') set.add('schedule');
  if (pack === 'automation_tasks') set.add('task');
}

function normalize(input: unknown): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Detect actionable tool-category intent in under a millisecond on normal
 * chat messages. No filesystem, network, model, or memory lookup occurs.
 */
export function detectKeywordToolCategories(input: string): RoutingSet {
  const text = normalize(input);
  const categories: RoutingSet = new Set();
  if (!text) return categories;

  const explicitNoTool = /\b(?:do not|don't|dont|never|without)\s+(?:call|use|run|activate|load)\s+(?:any|the|a)?\s*tools?\b/i.test(text);
  if (explicitNoTool) return categories;

  const meaningQuestion = isQuestionAboutMeaning(text);
  const action = hasAction(text) || isExplicitToolName(text);
  const planningOnly = /\b(?:plan|planning|discuss|discussion|talk about|think through|should we|idea|ideas|strategy|recommendation|recommendations)\b/.test(text)
    && /\b(?:not|without|before|yet|just)\b/.test(text);

  const normalizedPath = text.replace(/\\/g, '/');
  const sourcePath = /(?:^|[\s("'`])(?:\.\/)?(?:src|web-ui)\/[a-z0-9_.@/-]+/i.test(normalizedPath);
  const promContext = /\b(?:prometheus|promsrc|prometheus repo|prometheus source|dev source)\b/.test(text);
  const explicitPromSource = /\b(?:prometheus source|prom source|read source|inspect source|grep source|read webui source|source_read|prometheus_source_read)\b/.test(text);
  const knownPrometheusSurfacePath = /(?:^|[\s("'`])(?:\.\/)?(?:src\/(?:gateway|runtime|config|agents|providers|extensions|integrations|security|types\.ts)|web-ui\/src)(?:\/|\b)/i.test(normalizedPath);
  const sourceMutation = /\b(?:edit|change|patch|modify|fix|update|refactor|remove|add|implement|write|delete)\b/.test(text);
  const isPromSource = explicitPromSource || knownPrometheusSurfacePath || (promContext && sourcePath);
  const mediaTransferIntent = /\b(?:download|upload|analyze|extract|convert|transcode|fetch|retrieve)\b/.test(text)
    && (/(?:https?:\/\/|\b(?:image|photo|video|audio|media|asset|pdf)\b)/.test(text));

  if (sourcePath || /\b(?:workspace|repo|repository|file|files|folder|directory|path|readme)\b/.test(text)) {
    const fileAction = action || sourcePath || /\b(?:package\.json|tsconfig|\.env|dockerfile|makefile|\.gitignore|\.html?|\.css|\.jsx?|\.tsx?|\.json|\.md)\b/.test(text);
    if (fileAction && !meaningQuestion && !mediaTransferIntent) add(categories, 'workspace_write');
  }

  const commandIntent = isExplicitToolName(text)
    || /\b(?:run|execute|start|stop|kill|install|test|build|compile|lint|format|deploy|serve|watch)\b\s+(?:the\s+)?(?:command|script|tests?|build|server|dev|app|project|package|suite)/.test(text)
    || /\b(?:npm|npx|pnpm|yarn|bun|node|python|pip|cargo|docker|kubectl|powershell|terminal|cmd|bash|git)\b(?:\s|$)/.test(text);
  if (commandIntent && !meaningQuestion) add(categories, 'workspace_write');

  if (isPromSource) {
    add(categories, 'prometheus_source_read');
    add(categories, 'workspace_write');
    if (sourceMutation || explicitPromSource && /\b(?:edit|change|patch|modify|fix|update|refactor|remove|add|implement|write|delete)\b/.test(text)) {
      add(categories, 'prometheus_source_write');
    }
  }

  const browserTool = /\b(?:browser_session|browser_observe|browser_act|browser_extract|browser_open|browser_click|browser_fill|browser_press|browser_snapshot)\b/.test(text);
  const browserUiTarget = /\b(?:browser|web page|webpage|website|site|tab|form|login|log in|sign in|x\.com|twitter|tweet)\b/.test(text);
  const browserNavigationUrl = /https?:\/\//.test(text) && /\b(?:open|navigate|go to|visit|browse)\b/.test(text);
  const browserTarget = browserUiTarget || browserNavigationUrl;
  const browserAction = /\b(?:open|navigate|go to|click|fill|type|press|scroll|browse|login|log in|sign in|submit|post|publish|inspect|extract|scrape|download)\b/.test(text);
  if ((browserTool || browserTarget && browserAction) && !meaningQuestion) add(categories, 'browser_automation');

  const desktopTool = /\b(?:desktop_screen|desktop_apps|desktop_window|desktop_input|desktop_macro|desktop_background)\b/.test(text);
  const desktopTarget = /\b(?:desktop|native app|installed app|active window|screen|clipboard|monitor)\b/.test(text)
    || /\b(?:window)\b/.test(text) && /\b(?:app|focus|click|type|close|launch|screenshot|control|inspect)\b/.test(text);
  const desktopAction = /\b(?:screenshot|capture|focus|click|type|press|drag|launch|open|close|control|inspect|list|clipboard|wait)\b/.test(text);
  if ((desktopTool || desktopTarget && desktopAction) && !/\bwindow of time\b/.test(text)) add(categories, 'desktop_automation');

  const directAssetTool = /\b(?:download_url|download_media|analyze_image|analyze_video)\b/.test(text);
  const assetTarget = /\b(?:image|images|photo|photos|video|videos|audio|sound|media|asset|assets|pdf|screenshot|file)\b/.test(text)
    || /https?:\/\//.test(text);
  const assetAction = /\b(?:download|upload|analyze|inspect|extract|convert|transcode|pull|fetch|retrieve)\b/.test(text);
  if ((directAssetTool || assetTarget && assetAction && (!browserUiTarget && !browserNavigationUrl || directAssetTool)) && !meaningQuestion) add(categories, 'media_assets');

  const editableVideo = /\b(?:editable|timeline|storyboard|shot|shots|sequence|rough cut|trim|splice|stitch|caption|captions|voiceover|voice-over|composition|compose|video editor|video edit|render the video|export the video)\b/.test(text);
  const imageEditing = /\b(?:image layers?|masks?|cutouts?|background removal|brand kit|icon set|remove the background)\b/.test(text);
  const generatedMedia = /\b(?:image|images|photo|video|videos|clip|animation)\b/.test(text)
    && /\b(?:generate|create|make|produce|render|imagine|text to|image to video|extend|edit|variation)\b/.test(text);
  const directMediaGenerateTool = /\b(?:media_generate|generate_image|generate_video)\b/.test(text);
  if ((directMediaGenerateTool || generatedMedia) && !editableVideo && !imageEditing && !planningOnly && !meaningQuestion) add(categories, 'media_generation');

  if (/\b(?:creative_hyperframes|hyperframes|html motion|motion clip|hyperframe)\b/.test(text)) add(categories, 'creative_hyperframes');
  const qualityIntent = /\b(?:creative_quality|quality check|qa|preflight|text overflow|contrast|empty region|bounds|overlap|contact sheet|audio sync|caption timing|frame diff|lint the render)\b/.test(text);
  if (qualityIntent
    && action) add(categories, 'creative_quality');
  if (/\b(?:creative_video_ops|creative video|video editor|editable video|timeline|storyboard|shot list|sequence|rough cut|trim|splice|stitch|voiceover|captions?)\b/.test(text)
    && (action || editableVideo) && !qualityIntent && !meaningQuestion) add(categories, 'creative_video');
  if (/\b(?:creative_image_ops|creative image|image layers?|masks?|cutouts?|background removal|brand kit|image asset|icon set)\b/.test(text)
    && (action || /\b(?:layer|mask|cutout|brand kit)\b/.test(text)) && !meaningQuestion) add(categories, 'creative_image');
  if (/\b(?:creative_project|creative_scene|creative canvas|creative editor|scene state|canvas state)\b/.test(text)
    && !meaningQuestion) add(categories, 'creative_basic');

  const schedulingAction = /\b(?:schedule|scheduled|recurring|cron|remind|reminder|every day|every week|daily|weekly|monthly|run at|run on|automate)\b/.test(text)
    && /\b(?:create|make|set|schedule|run|start|stop|pause|resume|update|delete|change|remind|automate|list|show|inspect|check|when|what)\b/.test(text);
  const timedAction = /\b(?:start|run|send|execute|launch|begin|fire|remind)\b[^.!?]{0,80}\bat\s+(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}\s*o['’]?clock|noon|midnight)\b/i.test(text);
  if ((schedulingAction || timedAction) && !meaningQuestion) addAutomationAliases(categories, 'automation_scheduling');

  const taskAction = /\b(?:task|tasks|background run|job|jobs|execution|executions|run id|runid|queue|queued|dashboard)\b/.test(text)
    && /\b(?:run|start|stop|pause|resume|cancel|retry|watch|monitor|inspect|check|show|list|get|control|status|output|outputs|now|running|in progress|what)\b/.test(text);
  if (taskAction && !meaningQuestion) addAutomationAliases(categories, 'automation_tasks');

  const recoveryIntent = /\b(?:recover|recovery|resume|rerun|retry|retry the original|interrupted|stalled|cut off|cutoff|failed run|failed request|pending approval|crashed|crash recovery)\b/.test(text)
    && (action || /\b(?:request|run|task|job|work|thread|proposal|approval)\b/.test(text));
  if (recoveryIntent && !meaningQuestion) addAutomationAliases(categories, 'automation_recovery');

  const conversationReference = /\b(?:other|another|previous|prior|old|that|this|our|my|full)\s+(?:prometheus\s+)?(?:chat|chats|conversation|conversations|thread|threads|session|sessions)\b/.test(text)
    || /\b(?:chat|conversation|thread|session)\s+where\b/.test(text)
    || /\b(?:our|the)\s+(?:discussion|conversation)\s+about\b/.test(text);
  const sessionLookupAction = /\b(?:create|start|send|message|steer|interrupt|rename|pin|follow|find|read|inspect|continue|ask|look|check|show|go|pick up)\b/.test(text);
  const sessionLookupIntent = conversationReference
    && (action || sessionLookupAction || /\b(?:what did we talk|what happened|where did we leave off|find our|look through|go into|pick up|continue where we left off)\b/.test(text));
  const sessionIntent = /\b(?:prometheus|main chat|chat)\b/.test(text)
    && /\b(?:thread|session|conversation)\b/.test(text)
    && /\b(?:create|start|send|message|steer|interrupt|rename|pin|follow|find|read|inspect|continue|ask)\b/.test(text);
  const directSessionTool = /\b(?:prometheus_thread_ops|prometheus_request_ops|prometheus_audit_ops)\b/.test(text);
  if ((sessionIntent || sessionLookupIntent || directSessionTool)
    && (!meaningQuestion || sessionLookupIntent)) addAutomationAliases(categories, 'automation_sessions');

  if (/\b(?:diagnostic packet|system diagnostics|runtime diagnostics|gateway restart|restart prometheus|restart the gateway|runtime admin|diagnostic_packet|system_diagnostics|gateway_restart)\b/.test(text)
    && !meaningQuestion) add(categories, 'runtime_admin');

  const serviceName = /\b(?:gmail|google drive|github|slack|notion|hubspot|salesforce|stripe|vercel|airtable|outlook|calendar|supabase|reddit|x\.com|twitter|apple messages|messages app|mac messages|imessage)\b/.test(text);
  const connectorReference = /\b(?:connected app|connected apps|connected account|connected service|external app|external apps|connector|plugin|connector_list|list connectors)\b/.test(text);
  const connectionAction = /\b(?:connect|configure|authorize|authenticate|oauth|webhook|integration|integrate|setup|set up|add service|install (?:the )?(?:connector|plugin))\b/.test(text);
  if ((connectionAction && (serviceName || /\b(?:mcp|connector|plugin|service|api|webhook)\b/.test(text))) && !meaningQuestion) add(categories, 'integration_admin');
  const externalAction = /\b(?:search|read|list|send|post|publish|update|create|delete|inspect|use|check|find|show|open|review|query|comment|merge|archive)\b/.test(text);
  const externalResourceReference = /\b(?:my|the|this|that)\s+(?:inbox|email|emails|calendar|calendar event|deployment|deployments|issue|issues|commit|commits|pr|pull request)\b/.test(text);
  const sessionTopicLookup = /\b(?:chat|conversation|thread|session|discussion)\s+(?:where|about|regarding|on)\b/.test(text)
    || /\b(?:our|the)\s+discussion\s+about\b/.test(text);
  const bareExternalReference = /^(?:my|our|the|this|that)\s+(?:github|gmail|google drive|slack|notion|hubspot|salesforce|stripe|vercel|airtable|outlook|calendar|supabase|reddit|x\.com|twitter|apple messages|messages app|mac messages|imessage|inbox|pr|pull request)\s*[?!.]?$/.test(text);
  const sessionLookupWithoutExternalTarget = sessionLookupIntent && sessionTopicLookup && !externalResourceReference;
  if ((serviceName || connectorReference || externalResourceReference)
    && (externalAction || bareExternalReference)
    && !connectionAction && !meaningQuestion && !sessionLookupWithoutExternalTarget) add(categories, 'external_apps');

  const mcpDynamic = /(?:\bmcp__|\b(?:mcp tool|connected mcp tool|call an mcp|list mcp tools|mcp server tool|mcp_server_tools|mcp_server_manage)\b)/.test(text);
  if (mcpDynamic && !/\b(?:connect|configure|authorize|setup|set up)\b/.test(text)) add(categories, 'mcp_server_tools');

  const agentTarget = /\b(?:agent|subagent|sub-agent|worker|team|teammate|coordinator)\b/.test(text);
  const agentAction = /\b(?:ask|tell|message|chat|talk|spawn|start|create|delegate|dispatch|send|steer|assign|run|manage|list|check|query|coordinate|hand off|handoff)\b/.test(text);
  if (agentTarget && agentAction && !meaningQuestion) add(categories, 'agents_and_teams');

  if (/\b(?:write|create|file|edit|update|revise|submit|approve|pending)\b/.test(text)
    && /\bproposal\b/.test(text) && !/\b(?:sales|marketing|business) proposal\b/.test(text)) add(categories, 'proposal_admin');
  if (/\b(?:composite tool|saved tool|multi-step tool|composites)\b/.test(text)
    && (action || /\b(?:create|edit|delete|list|inspect|run)\b/.test(text))) add(categories, 'composite_tools');
  if (/\b(?:skill|skills)\b/.test(text)
    && /\b(?:create|write|update|edit|audit|check|test|match|trigger|metadata|manifest|resource|bundle|maintenance|repair)\b/.test(text)
    && !meaningQuestion) add(categories, 'skills');
  if (/\b(?:agent model|agent models|model template|model templates|agent routing|executor route)\b/.test(text)
    && action && !meaningQuestion) add(categories, 'model_management');
  if (/\b(?:business entity|client record|contact record|vendor record|project record|crm record|entity file|business context)\b/.test(text)
    && action && !meaningQuestion) add(categories, 'business');
  if (/\b(?:social profile|social intelligence|engagement analysis|growth trajectory|social account)\b/.test(text)
    && action && !meaningQuestion) add(categories, 'social_intelligence');

  // Web search is core, but retaining this label lets prompt context and
  // telemetry distinguish research from browser UI work without activating a
  // large category.
  if (hasAny(text, ['search', 'look up', 'latest', 'news', 'research', 'web search', 'what is', 'who is'])) categories.add('web');

  return categories;
}
