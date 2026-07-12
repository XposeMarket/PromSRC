export interface SkillRoutingBenchmarkCase {
  id: string;
  source: 'typed' | 'voice' | 'collision' | 'discovery';
  message: string;
  expectedCandidates: string[];
  discoveryRecommended?: boolean;
}

const leads = ['', 'please ', 'can you ', 'alright, ', 'go ahead and ', 'yo, ', 'okay so ', 'I need you to ', 'would you ', 'right now ', 'beautiful, ', 'when you can, '];

function expand(prefix: string, source: SkillRoutingBenchmarkCase['source'], messages: Array<{ text: string; selected?: string[]; discovery?: boolean }>): SkillRoutingBenchmarkCase[] {
  const out: SkillRoutingBenchmarkCase[] = [];
  let index = 0;
  for (const item of messages) {
    for (const lead of leads) {
      out.push({
        id: `${prefix}_${String(index++).padStart(4, '0')}`,
        source,
        message: `${lead}${item.text}`.trim(),
        expectedCandidates: item.selected || [],
        discoveryRecommended: item.discovery,
      });
    }
  }
  return out;
}

const positive = expand('positive', 'typed', [
  { text: 'debug typescript authentication failure in the backend', selected: ['coding-debugger'] },
  { text: 'create faceless explainer video about token routing', selected: ['faceless-video'] },
  { text: 'reply to gmail email from the customer', selected: ['gmail-replies'] },
  { text: 'build excel financial model for revenue', selected: ['excel-model'] },
  { text: 'fix mobile webgl sprites on iphone', selected: ['mobile-webgl'] },
  { text: 'diagnose scheduled job stuck in cron', selected: ['scheduler-operations'] },
  { text: 'run browser desktop smoke validation', selected: ['browser-smoke'] },
  { text: 'conduct current competitor market research', selected: ['market-research'] },
  { text: 'draft social post without publishing', selected: ['ghostwriter'] },
  { text: 'ingest a directory of documents into embeddings', selected: ['document-ingestion'] },
]);

const voice = expand('voice', 'voice', [
  { text: 'hey debug typescript authentication failure', selected: ['coding-debugger'] },
  { text: 'make me a create faceless explainer video workflow', selected: ['faceless-video'] },
  { text: 'could you reply to gmail email', selected: ['gmail-replies'] },
  { text: 'I want to build excel financial model', selected: ['excel-model'] },
  { text: 'please fix mobile webgl sprites on iphone', selected: ['mobile-webgl'] },
  { text: 'check why the diagnose scheduled job stuck in cron process failed', selected: ['scheduler-operations'] },
  { text: 'do the run browser desktop smoke validation process', selected: ['browser-smoke'] },
  { text: 'do current competitor market research', selected: ['market-research'] },
]);

const collisions = expand('collision', 'collision', [
  { text: 'give me three options for an email subject' },
  { text: 'what is an authentication token' },
  { text: 'tell me what a video call is' },
  { text: 'save my gmail address in the contact field' },
  { text: 'explain how Excel formulas work' },
  { text: 'what is WebGL used for' },
  { text: 'did the scheduled meeting happen' },
  { text: 'tell me about browser history' },
  { text: 'what does market research mean' },
  { text: 'write the word workflow ten times' },
  { text: 'summarize this paragraph about code' },
  { text: 'say hello' },
  { text: 'thanks for the help' },
  { text: 'is the model ready' },
  { text: 'the client likes animation' },
  { text: 'did you already test it' },
  { text: 'do not browse or publish anything' },
  { text: 'write a normal business email' },
  { text: 'show the current session status' },
  { text: 'what skills do people learn in school' },
]);

const discovery = expand('discovery', 'discovery', [
  { text: 'build a payroll reconciliation workflow for an unfamiliar vendor format', discovery: true },
  { text: 'create a specialized laboratory ingestion pipeline', discovery: true },
  { text: 'automate a migration workflow for an unknown legacy service', discovery: true },
  { text: 'design a compliance audit playbook for a new jurisdiction', discovery: true },
  { text: 'produce a specialized captioning pipeline for an unsupported format', discovery: true },
  { text: 'find a skill for reconciling proprietary telemetry', discovery: true },
  { text: 'do we have a skill for an unfamiliar procurement workflow', discovery: true },
  { text: 'search skills for a custom deployment pipeline', discovery: true },
]);

export const SKILL_ROUTING_BENCHMARK_CASES: readonly SkillRoutingBenchmarkCase[] = Object.freeze([
  ...positive,
  ...voice,
  ...collisions,
  ...discovery,
]);
