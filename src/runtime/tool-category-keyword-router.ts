import { detectPromptSignalToolCategories } from './tool-category-prompt-signals';

/**
 * Fast category activation for the main chat turn.
 *
 * Native workflow/admin categories use the shared declarative prompt-signal
 * matcher. The remaining categories keep their specialized structural rules.
 * The model keeps request_tool_category as a fallback when wording is ambiguous.
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

function normalize(input: unknown): string {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Shared fail-closed guard for the two message-driven activation paths:
 * native tool categories and extension-backed connectors.  Keeping this
 * predicate here prevents a connector planner from re-introducing tools after
 * the native keyword router has honored an explicit no-tool instruction.
 */
export function isExplicitToolSuppression(input: string): boolean {
  const text = normalize(input);
  return /\b(?:do not|don't|dont|never|without)\s+(?:call|use|run|activate|load|invoke|execute)(?:ing)?\s+(?:any|the|a)?\s*tools?\b/i.test(text);
}

/**
 * Detect actionable tool-category intent on normal chat messages.
 */
export function detectKeywordToolCategories(input: string): RoutingSet {
  const text = normalize(input);
  const categories: RoutingSet = new Set();
  if (!text) return categories;

  if (isExplicitToolSuppression(text)) return categories;

  const meaningQuestion = isQuestionAboutMeaning(text);
  const action = hasAction(text) || isExplicitToolName(text);
  const planningOnly = /\b(?:plan|planning|discuss|discussion|talk about|think through|should we|idea|ideas|strategy|recommendation|recommendations)\b/.test(text)
    && /\b(?:not|without|before|yet|just)\b/.test(text);

  for (const category of detectPromptSignalToolCategories(text)) add(categories, category);

  const normalizedPath = text.replace(/\\/g, '/');
  const sourcePath = /(?:^|[\s("'`])(?:\.\/)?(?:src|web-ui)\/[a-z0-9_.@/-]+/i.test(normalizedPath);
  const promContext = /\b(?:prometheus|promsrc|prometheus repo|prometheus source|dev source)\b/.test(text);
  const explicitPromSource = /\b(?:prometheus source|prom source|read source|inspect source|grep source|read webui source|source_read|prometheus_source_read)\b/.test(text);
  const knownPrometheusSurfacePath = /(?:^|[\s("'`])(?:\.\/)?(?:src\/(?:gateway|runtime|config|agents|providers|extensions|integrations|security|types\.ts)|web-ui\/src)(?:\/|\b)/i.test(normalizedPath);
  const sourceMutation = /\b(?:edit|change|patch|modify|fix|update|refactor|remove|add|implement|write|delete)\b/.test(text);
  const isPromSource = explicitPromSource || knownPrometheusSurfacePath || (promContext && sourcePath);
  const mediaTransferIntent = /\b(?:download|upload|analyze|extract|convert|transcode|fetch|retrieve)\b/.test(text)
    && (/(?:https?:\/\/|\b(?:image|photo|video|audio|media|asset|pdf)\b)/.test(text));
  const browserFileTransfer = /\b(?:browser|web page|webpage|website|site|tab)\b/.test(text)
    && /\bdownload\b/.test(text);

  if (sourcePath || /\b(?:workspace|repo|repository|file|files|folder|directory|path|readme)\b/.test(text)) {
    const fileAction = action || sourcePath || /\b(?:package\.json|tsconfig|\.env|dockerfile|makefile|\.gitignore|\.html?|\.css|\.jsx?|\.tsx?|\.json|\.md)\b/.test(text);
    if (fileAction && !meaningQuestion && !mediaTransferIntent && !browserFileTransfer) add(categories, 'workspace_write');
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
  if (qualityIntent && action) add(categories, 'creative_quality');
  if (/\b(?:creative_video_ops|creative video|video editor|editable video|timeline|storyboard|shot list|sequence|rough cut|trim|splice|stitch|voiceover|captions?)\b/.test(text)
    && (action || editableVideo) && !qualityIntent && !meaningQuestion) add(categories, 'creative_video');
  if (/\b(?:creative_image_ops|creative image|image layers?|masks?|cutouts?|background removal|brand kit|image asset|icon set)\b/.test(text)
    && (action || /\b(?:layer|mask|cutout|brand kit)\b/.test(text)) && !meaningQuestion) add(categories, 'creative_image');
  if (/\b(?:creative_project|creative_scene|creative canvas|creative editor|scene state|canvas state)\b/.test(text)
    && !meaningQuestion) add(categories, 'creative_basic');

  // Session-language context is still used to prevent a phrase such as
  // "find our discussion about the iMessage plugin" from accidentally exposing
  // connected-app tools. Actual session-category activation is declarative.
  const conversationReference = /\b(?:other|another|previous|prior|old|that|this|our|my|full)\s+(?:prometheus\s+)?(?:chat|chats|conversation|conversations|thread|threads|session|sessions)\b/.test(text)
    || /\b(?:chat|conversation|thread|session)\s+where\b/.test(text)
    || /\b(?:our|the)\s+(?:discussion|conversation)\s+about\b/.test(text);
  const sessionLookupAction = /\b(?:create|start|send|message|steer|interrupt|rename|pin|follow|find|read|inspect|continue|ask|look|check|show|go|pick up|talk|discuss|history|where)\b/.test(text);
  const sessionLookupIntent = conversationReference
    && (action || sessionLookupAction || /\b(?:what did we talk|what happened|where did we leave off|find our|look through|go into|pick up|continue where we left off)\b/.test(text));

  const connectorReference = /\b(?:connected app|connected apps|connected account|connected service|external app|external apps|connector|plugin|connector_list|list connectors)\b/.test(text);
  const connectionAction = /\b(?:connect|configure|authorize|authenticate|oauth|webhook|integration|integrate|setup|set up|add service|install (?:the )?(?:connector|plugin))\b/.test(text);
  const externalAction = /\b(?:search|read|list|send|post|publish|update|create|delete|inspect|use|check|find|show|open|review|query|comment|merge|archive|look|browse|pull|fetch|retrieve|manage|deploy|redeploy|trigger|preview|status|logs|tail|push)\b/.test(text);
  const externalResourceReference = /\b(?:my|the|this|that)\s+(?:inbox|email|emails|calendar|calendar event|deployment|deployments|issue|issues|commit|commits|pr|pull request)\b/.test(text);
  const sessionTopicLookup = /\b(?:chat|conversation|thread|session|discussion)\s+(?:where|about|regarding|on)\b/.test(text)
    || /\b(?:our|the)\s+discussion\s+about\b/.test(text);
  const bareExternalReference = /^(?:my|our|the|this|that)\s+(?:inbox|pr|pull request|deployment|project|issue|commit|calendar|email|messages?)\s*[?!.]?$/.test(text);
  const sessionLookupWithoutExternalTarget = sessionLookupIntent && sessionTopicLookup && !externalResourceReference;
  if ((connectorReference || externalResourceReference)
    && (externalAction || bareExternalReference)
    && !connectionAction && !meaningQuestion && !sessionLookupWithoutExternalTarget) add(categories, 'external_apps');

  if (/\b(?:skill|skills)\b/.test(text)
    && /\b(?:create|write|update|edit|audit|check|test|match|trigger|metadata|manifest|resource|bundle|maintenance|repair)\b/.test(text)
    && !meaningQuestion) add(categories, 'skills');
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
