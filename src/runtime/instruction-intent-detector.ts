export type Stage4IntentId =
  | 'file_edit_intent'
  | 'command_execution_intent'
  | 'proposal_workflow_intent'
  | 'web_research_intent'
  | 'business_context_intent';
export type Stage4InstructionMode = 'legacy' | 'shadow' | 'active';
export type Stage4MenuSegmentId = 'tools.file_edit_routing' | 'tools.run_command_routing' | 'tools.proposal_lanes' | 'tools.search_strategy' | 'tools.business_context';

export const STAGE4_MENU_SEGMENT_IDS: readonly Stage4MenuSegmentId[] = [
  'tools.business_context',
  'tools.proposal_lanes',
  'tools.run_command_routing',
  'tools.file_edit_routing',
  'tools.search_strategy',
];

export function getStage4InstructionMode(): Stage4InstructionMode {
  const requested = String(process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE || 'active').trim().toLowerCase();
  if (requested === 'legacy' || requested === 'shadow' || requested === 'active') return requested;
  return 'active';
}

export function getEnabledStage4MenuSegments(): Set<Stage4MenuSegmentId> {
  const raw = String(process.env.PROMETHEUS_STAGE4_SEGMENTS || '').trim();
  if (!raw) return new Set(STAGE4_MENU_SEGMENT_IDS);
  const requested = new Set(raw.split(',').map((value) => value.trim()).filter(Boolean));
  return new Set(STAGE4_MENU_SEGMENT_IDS.filter((id) => requested.has(id)));
}

export function resolveStage4MenuSegmentDecision(id: Stage4MenuSegmentId, intents: Stage4InstructionIntents): { included: boolean; reason: string; authoritative: boolean } {
  const mode = getStage4InstructionMode();
  const enabled = getEnabledStage4MenuSegments().has(id);
  const intentBySegment: Record<Stage4MenuSegmentId, Stage4IntentId> = {
    'tools.file_edit_routing': 'file_edit_intent',
    'tools.run_command_routing': 'command_execution_intent',
    'tools.proposal_lanes': 'proposal_workflow_intent',
    'tools.search_strategy': 'web_research_intent',
    'tools.business_context': 'business_context_intent',
  };
  const intentId = intentBySegment[id];
  const recommended = intents[intentId];
  if (mode !== 'active' || !enabled) return { included: true, reason: `${mode === 'active' ? 'segment_not_enabled' : `${mode}_authority`}:${id}`, authoritative: false };
  return { included: recommended, reason: recommended ? `${intentId}=true` : `${intentId}=false`, authoritative: true };
}

const STAGE4_SEGMENT_TOKEN_ESTIMATES: Record<Stage4MenuSegmentId, number> = {
  'tools.business_context': 176,
  'tools.proposal_lanes': 189,
  'tools.run_command_routing': 78,
  'tools.file_edit_routing': 197,
  'tools.search_strategy': 390,
};

export interface Stage4InstructionRoutingReport {
  mode: Stage4InstructionMode;
  enabledSegmentIds: Stage4MenuSegmentId[];
  intentReasons: Partial<Record<Stage4IntentId, string[]>>;
  decisions: Array<{ id: Stage4MenuSegmentId; included: boolean; reason: string; authoritative: boolean; estimatedTokens: number }>;
  estimatedSavedTokens: number;
}

export function buildStage4InstructionRoutingReport(intents: Stage4InstructionIntents): Stage4InstructionRoutingReport {
  const mode = getStage4InstructionMode();
  const enabledSegmentIds = Array.from(getEnabledStage4MenuSegments());
  const decisions = STAGE4_MENU_SEGMENT_IDS.map((id) => ({
    id,
    ...resolveStage4MenuSegmentDecision(id, intents),
    estimatedTokens: STAGE4_SEGMENT_TOKEN_ESTIMATES[id],
  }));
  return {
    mode,
    enabledSegmentIds,
    intentReasons: intents.reasons,
    decisions,
    estimatedSavedTokens: decisions.filter((decision) => decision.authoritative && !decision.included).reduce((sum, decision) => sum + decision.estimatedTokens, 0),
  };
}

export interface Stage4InstructionIntents {
  file_edit_intent: boolean;
  command_execution_intent: boolean;
  proposal_workflow_intent: boolean;
  web_research_intent: boolean;
  business_context_intent: boolean;
  reasons: Partial<Record<Stage4IntentId, string[]>>;
}

export interface Stage4IntentInput {
  message: string;
  recentMessages?: string[];
  executionMode?: string;
  activeToolCategories?: Iterable<string>;
  requiredTools?: string[];
  callerRequirements?: string[];
  businessContextEnabled?: boolean;
}

const normalize = (value: unknown): string => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()
  .replace(/\bteh\b/g, 'the')
  .replace(/\bfx\b/g, 'fix')
  .replace(/\b(moble|mobil)\b/g, 'mobile')
  .replace(/\bcomposr\b/g, 'composer')
  .replace(/\btst\b/g, 'test')
  .replace(/\bupdte\b/g, 'update')
  .replace(/\bclent\b/g, 'client')
  .replace(/\brecrd\b/g, 'record')
  .replace(/\blates\b/g, 'latest');
const any = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));

export function detectStage4InstructionIntents(input: Stage4IntentInput): Stage4InstructionIntents {
  const message = normalize(input.message);
  const history = (input.recentMessages || []).slice(-4).map(normalize).filter(Boolean).join(' ');
  const combined = `${history} ${message}`.trim();
  const active = new Set(Array.from(input.activeToolCategories || [], normalize).filter(Boolean));
  const requiredTools = (input.requiredTools || []).map(normalize);
  const caller = (input.callerRequirements || []).map(normalize).join(' ');
  const explicitlyDisallowsTools = /\b(?:do not|don't|without)\s+(?:call|use|run|invoke|execute)(?:ing)?\b[\s\S]{0,35}\btools?\b/.test(message);
  const reasons: Partial<Record<Stage4IntentId, string[]>> = {};
  const mark = (id: Stage4IntentId, reason: string): void => {
    (reasons[id] ||= []).push(reason);
  };

  const deliberativeFileQuestion = /\b(should|could|would)\s+we\b[\s\S]{0,50}\b(build|edit|change|create|update|fix)\b/.test(message)
    || /\b(what if|do you think|how should we)\b[\s\S]{0,60}\b(build|edit|change|create|update|fix)\b/.test(message);
  const proposalOnlyMutation = /\b(create|update|edit|review)\b[\s\S]{0,60}\b(code[- ]change|runtime|prometheus)?\s*proposal\b/.test(message)
    && !/\bproposal\b[\s\S]{0,100}\b(patch|implement|fix|refactor|edit|update|change)\b[\s\S]{0,70}\b(implementation|code|file|source|component|handler|ui)\b/.test(message)
    && !/\b(patch|implement|fix|refactor|edit|update|change)\b[\s\S]{0,80}(?:\b(implementation|file|source|component|handler|ui)\b|\bcode\b(?![- ]change\s+proposal))/.test(message);
  const explicitFileAction = !deliberativeFileQuestion && !proposalOnlyMutation && any(message, [
    /\b(edit|modify|patch|rewrite|rename|move|delete|create|implement|refactor)\b[\s\S]{0,90}\b(file|code|function|class|component|composers?|handler|page|website|site|repo|repository|readme|config|script|source|css|html|typescript|javascript|python|api|ui|frontend|backend|implementation)\b/,
    /\b(fix|update|change|build|complete)\b[\s\S]{0,90}\b(file|code|function|class|component|composers?|page|website|site|repo|repository|readme|config|source|frontend|backend|ui|implementation)\b/,
    /\b(write|add|remove)\b[\s\S]{0,70}\b(to|from|in|into)\b[\s\S]{0,50}\b(file|code|readme|config|source|component|page)\b/,
    /\bapply\b[\s\S]{0,40}\b(patch|changes?|fix)\b/,
    /\bpatch\b[\s\S]{0,50}\b(handler|endpoint|implementation|api)\b/,
    /\b(make|perform|apply|do)\b[\s\S]{0,45}\b(source|code|file)\s+edits?\b/,
  ]);
  const contextualFileFollowup = /\b(fix|edit|change|update|implement|apply|do)\s+(it|that|those|them|the fix|the changes?)\b/.test(message)
    && any(history, [/\b(file|code|function|component|page|website|repo|readme|source|implementation|bug)\b/]);
  if (explicitFileAction) mark('file_edit_intent', 'explicit_file_mutation');
  if (contextualFileFollowup) mark('file_edit_intent', 'contextual_file_mutation_followup');
  if (!explicitlyDisallowsTools && (active.has('workspace_write') || active.has('prometheus_source_write'))) mark('file_edit_intent', 'active_write_category');
  if (requiredTools.some((tool) => /^(write_|create_file|apply_|find_replace|replace_lines|insert_after|delete_lines)/.test(tool))) mark('file_edit_intent', 'required_file_tool');
  if (/\b(file edit|source edit|code change|modify files?)\b/.test(caller)) mark('file_edit_intent', 'caller_file_requirement');

  const explanatoryCommandQuestion = /\b(explain|what is|what are|how (does|do)|did)\b[\s\S]{0,80}\b(npm|tests?|build|lint|terminal|command|process)\b/.test(message);
  const uiNavigationCommand = /\b(start|open|launch)\b[\s\S]{0,35}\b(new\s+)?(chat|conversation|thread|tab|window)\b/.test(message);
  const explicitCommand = !explanatoryCommandQuestion && !uiNavigationCommand && any(message, [
    /\b(run|execute|start|restart|stop|kill|launch)\b[\s\S]{0,70}\b(command|terminal|shell|powershell|cmd|bash|npm|pnpm|yarn|git|python|pytest|script|build|tests?|lint|linter|formatter|typecheck|server|process|smoke test|diagnostics?)\b/,
    /\b(npm|pnpm|yarn|git|python|pytest|powershell|bash|cmd)\s+(run\s+)?[a-z0-9:_-]+\b/,
    /\b(check|show|tail|read)\b[\s\S]{0,50}\b(process status|process logs?|server logs?|terminal output)\b/,
    /\b(ai\s+)?smoke test\b/,
    /\b(build|test|verify)\b[\s\S]{0,60}\b(implementation|changes?|code|feature|project)\b/,
    /\b(update|pull|sync)\b[\s\S]{0,60}\b(repos?|repositories)\b[\s\S]{0,40}\b(latest|version|upstream)\b/,
    /\b(retest|re-test)\b/,
    /\b(keep|continue)\b[\s\S]{0,40}\b(benchmark testing|testing|benchmarking)\b/,
  ]) && !/\b(run|do)\b[\s\S]{0,30}\b(web search|online search|browser search)\b/.test(message);
  const contextualCommandFollowup = any(message, [/^(okay|alright|cool|yes|yeah|yep|please|now|then|go ahead|beautiful|perfect)*\s*(run|test|build|restart|start|stop)\s+(it|that|those|them|again)\b/])
    && any(history, [/\b(code|change|implementation|build|tests?|server|process|smoke test|command)\b/]);
  const contextualVerification = /\b(run through|test)\s+(it|that)\b[\s\S]{0,50}\b(again|works?|working|verify|make sure)\b/.test(message)
    && any(history, [/\b(code|change|implementation|runtime|test|feature)\b/]);
  const contextualTestOut = /\btest\s+(it|that)\s+out\b/.test(message)
    && any(history, [/\b(code|change|implementation|runtime|test|feature|tool)\b/]);
  const contextualTestNow = !/\b(did|have|has|was|were)\b[\s\S]{0,20}\b(test|retest)\b/.test(message)
    && /\b(test|retest)\s+(it|that)\b[\s\S]{0,30}\b(now|again|please|actually|works?|working)?\b/.test(message)
    && any(history, [/\b(code|change|implementation|runtime|test|feature|tool|desktop|browser)\b/]);
  if (explicitCommand) mark('command_execution_intent', 'explicit_command_or_process_action');
  if (contextualCommandFollowup) mark('command_execution_intent', 'contextual_command_followup');
  if (contextualVerification) mark('command_execution_intent', 'contextual_verification_followup');
  if (contextualTestOut) mark('command_execution_intent', 'contextual_test_followup');
  if (contextualTestNow) mark('command_execution_intent', 'contextual_test_now');
  if (requiredTools.some((tool) => /^(terminal|run_command|start_process|process_|run_tests|run_linter|run_typecheck)/.test(tool))) mark('command_execution_intent', 'required_command_tool');
  if (/\b(command|shell|terminal|build|test|process)\b/.test(caller)) mark('command_execution_intent', 'caller_command_requirement');

  const runtimeProposal = any(message, [
    /\b(create|write|open|edit|review|approve|reject|execute|run|update)\b[\s\S]{0,60}\b(prometheus|runtime|code[- ]change|action|review)?\s*proposal\b/,
    /\b(write_proposal|edit_proposal|proposal_execution|proposal admin|pending proposal)\b/,
    /\bproposal\b[\s\S]{0,50}\b(approval|execution mode|affected files|code change|runtime change)\b/,
  ]);
  const contentProposal = /\b(sales|business|marketing|client|customer|grant|project|service|landscaping|sponsorship|wedding)\s+proposal\b/.test(message)
    || /\bproposal\b[\s\S]{0,40}\b(document|copy|email|deck|pdf)\b/.test(message);
  if (runtimeProposal && !contentProposal) mark('proposal_workflow_intent', 'runtime_proposal_workflow');
  if (normalize(input.executionMode) === 'proposal_execution') mark('proposal_workflow_intent', 'proposal_execution_mode');
  if (active.has('proposal_admin')) mark('proposal_workflow_intent', 'active_proposal_category');
  if (requiredTools.some((tool) => /^(write_proposal|edit_proposal)$/.test(tool))) mark('proposal_workflow_intent', 'required_proposal_tool');

  const localSearch = /\b(search|grep|look through|look into|find|inspect)\b[\s\S]{0,50}\b(repo|repository|workspace|files?|folder|directory|codebase|source|self directory)\b/.test(message);
  const localOperationalState = /\b(current|latest|recent|right now)\b[\s\S]{0,60}\b(process|server|gateway|session|workspace|file|code|terminal|local logs?|task status)\b/.test(message)
    && !/\b(web|online|internet|research|look up)\b/.test(message);
  const retrospectiveWebQuestion = /\b(did you|have you|was that|were you)\b[\s\S]{0,50}\b(use|using|search|look up|research)\b/.test(message);
  const definitionalHighStakesQuestion = /\b(what is|what are|define|explain)\b[\s\S]{0,50}\b(legal advice|medical advice|financial guidance|investment advice)\b/.test(message);
  const explicitWeb = !retrospectiveWebQuestion && !definitionalHighStakesQuestion && any(message, [
    /\b(web|online|internet|google|browser)\s+(search|lookup|research)\b/,
    /\b(search the web|search online|look up online|browse the web)\b/,
    /\b(research|look up|search for|find out about)\b[\s\S]{0,100}\b(company|shop|store|product|person|agent|model|provider|voices?|restaurant|hotels?|flights?|destination|market|stock|crypto|news|announcement)\b/,
    /\b(do|conduct|perform)\s+(some\s+)?research\b/,
    /\bresearch\b[\s\S]{0,50}\b(latest|current|today|recent|newest|up[- ]to[- ]date)\b/,
    /\b(latest|current|today|tonight|this week|recent|right now|live|breaking|newest|up[- ]to[- ]date)\b[\s\S]{0,100}\b(news|price|weather|schedule|scheduled jobs?|score|version|release|availability|offerings?|options?|models?|voices?|announcement|information|state|changes?|api)\b/,
    /\b(news|price|weather|schedule|score|availability)\b[\s\S]{0,70}\b(today|current|latest|right now|live|this week)\b/,
    /https?:\/\//,
    /\b(who is|what is happening with|verify who|verify whether|fact[- ]check)\b[\s\S]{0,100}\b(ceo|president|governor|senator|company|organization|public figure|claim)\b/,
    /\b(medical|medication|dosage|symptoms?|diagnosis|legal|law|regulation|tax|investment|financial)\b[\s\S]{0,80}\b(safe|urgent|current|guidance|advice|claim|accurate|require|rules?)\b/,
    /\b(current|latest|recent|new|changed)\b[\s\S]{0,60}\b(medical|legal|law|regulation|tax|investment|financial)\b/,
    /\b(reaearch|reasearch|serach the web|lok up|look nto)\b/,
  ]);
  const recommendation = /\b(recommend|compare|best|top)\b[\s\S]{0,80}\b(products?|restaurants?|hotels?|flights?|trips?|travel|software|services?|providers?|models?)\b/.test(message);
  const contextualCurrentLookup = /\b(right now|currently|today|latest|offer)\b/.test(message)
    && any(history, [/\b(provider|voice|model|company|product|service|market|news)\b/]);
  if ((explicitWeb || recommendation) && !localSearch && !localOperationalState) mark('web_research_intent', explicitWeb ? 'external_or_current_information' : 'recommendation_research');
  if (contextualCurrentLookup && !localSearch && !localOperationalState) mark('web_research_intent', 'contextual_current_lookup');
  if (requiredTools.some((tool) => /^(web_search|web_fetch|shopping_search_products|browser_open)$/.test(tool))) mark('web_research_intent', 'required_web_tool');
  if (/\b(web research|online research|external research|current information)\b/.test(caller)) mark('web_research_intent', 'caller_web_requirement');

  const uiContactSurface = /\bcontact\b[\s\S]{0,30}\b(form|component|page|field|button|section)\b/.test(message);
  const businessEntityAction = !uiContactSurface && any(message, [
    /\b(read|show|list|create|add|update|edit|change|delete|record|append|manage|open)\b[\s\S]{0,80}\b(clients?|customers?|contacts?|vendors?|business entit(?:y|ies)|company record|project entity|social accounts?|crm record)\b/,
    /\b(client|customer|contact|vendor|project|company|social account)\b[\s\S]{0,70}\b(record|profile|entity|event|crm)\b/,
    /\b(enable|disable|use|load|update|read)\b[\s\S]{0,50}\bbusiness\.md\b/,
  ]);
  if (businessEntityAction) mark('business_context_intent', 'structured_business_context');
  if (input.businessContextEnabled) mark('business_context_intent', 'business_context_mode_enabled');
  if (active.has('business')) mark('business_context_intent', 'active_business_category');
  if (requiredTools.some((tool) => /^(list_entities|read_entity|write_entity|append_entity_event|business_context_mode)$/.test(tool))) mark('business_context_intent', 'required_business_tool');
  if (/\b(client|vendor|business entity|business context|business\.md|crm)\b/.test(caller)) mark('business_context_intent', 'caller_business_requirement');

  return {
    file_edit_intent: !!reasons.file_edit_intent?.length,
    command_execution_intent: !!reasons.command_execution_intent?.length,
    proposal_workflow_intent: !!reasons.proposal_workflow_intent?.length,
    web_research_intent: !!reasons.web_research_intent?.length,
    business_context_intent: !!reasons.business_context_intent?.length,
    reasons,
  };
}
