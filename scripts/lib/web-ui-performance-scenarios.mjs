const SCENARIO_VERSION = 1;

export const STANDARD_WEB_UI_PERFORMANCE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'desktop-100-rich-stream',
    viewport: Object.freeze({ width: 1440, height: 900, mobile: false }),
    turns: 100,
    toolEvery: 3,
    reasoningEvery: 2,
    foregroundStreams: 2,
    backgroundStreams: 1,
    streamChunks: 72,
    typingEvents: 96,
    seed: 0x100c0de,
  }),
  Object.freeze({
    id: 'mobile-500-window-pressure',
    viewport: Object.freeze({ width: 390, height: 844, mobile: true }),
    turns: 500,
    toolEvery: 4,
    reasoningEvery: 3,
    foregroundStreams: 2,
    backgroundStreams: 2,
    streamChunks: 96,
    typingEvents: 120,
    seed: 0x500c0de,
  }),
  Object.freeze({
    id: 'desktop-1200-multipane-switch',
    viewport: Object.freeze({ width: 1440, height: 900, mobile: false }),
    turns: 1200,
    toolEvery: 3,
    reasoningEvery: 2,
    foregroundStreams: 2,
    backgroundStreams: 3,
    streamChunks: 120,
    typingEvents: 144,
    seed: 0x1200c0de,
  }),
]);

function seededRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function words(random, count, prefix) {
  const vocabulary = [
    'runtime', 'session', 'gateway', 'message', 'stream', 'render', 'history',
    'cursor', 'approval', 'question', 'attachment', 'process', 'terminal',
    'source', 'browser', 'creative', 'background', 'reconcile', 'visible',
    'anchor', 'window', 'cache', 'transport', 'update', 'response', 'tool',
  ];
  const output = [prefix];
  for (let index = 1; index < count; index += 1) {
    output.push(vocabulary[Math.floor(random() * vocabulary.length)]);
  }
  return output.join(' ');
}

function stableTurnKey(index) {
  return `turn-${String(index + 1).padStart(5, '0')}`;
}

export function createWebUiPerformanceScenario(definition) {
  const config = { ...definition, viewport: { ...definition.viewport } };
  const random = seededRandom(config.seed);
  const turns = [];
  let toolCards = 0;
  let reasoningBlocks = 0;

  for (let index = 0; index < config.turns; index += 1) {
    const key = stableTurnKey(index);
    const toolCount = index % config.toolEvery === 0 ? 1 + (index % 3) : 0;
    const hasReasoning = index % config.reasoningEvery === 0;
    toolCards += toolCount;
    reasoningBlocks += hasReasoning ? 1 : 0;
    turns.push({
      key,
      user: words(random, 7 + (index % 11), `request-${index + 1}`),
      assistant: words(random, 18 + (index % 37), `response-${index + 1}`),
      reasoning: hasReasoning
        ? words(random, 20 + (index % 53), `reasoning-${index + 1}`)
        : '',
      tools: Array.from({ length: toolCount }, (_, toolIndex) => ({
        key: `${key}-tool-${toolIndex + 1}`,
        name: ['shell_command', 'browser_snapshot', 'read_file'][toolIndex % 3],
        state: toolIndex === toolCount - 1 && index % 5 === 0 ? 'running' : 'complete',
        summary: words(random, 10 + ((index + toolIndex) % 19), `tool-${index + 1}-${toolIndex + 1}`),
      })),
    });
  }

  const streams = [];
  const streamCount = config.foregroundStreams + config.backgroundStreams;
  for (let streamIndex = 0; streamIndex < streamCount; streamIndex += 1) {
    streams.push({
      id: `stream-${streamIndex + 1}`,
      surface: streamIndex < config.foregroundStreams ? 'foreground' : 'background',
      chunks: Array.from({ length: config.streamChunks }, (_, chunkIndex) => ({
        seq: chunkIndex + 1,
        text: words(random, 3 + (chunkIndex % 6), `delta-${streamIndex + 1}-${chunkIndex + 1}`),
        structural: chunkIndex === 0
          ? 'start'
          : chunkIndex === config.streamChunks - 1
            ? 'done'
            : chunkIndex % 29 === 0
              ? 'tool-transition'
              : '',
      })),
    });
  }

  return {
    version: SCENARIO_VERSION,
    id: config.id,
    seed: config.seed,
    viewport: config.viewport,
    expected: {
      turns: config.turns,
      toolCards,
      reasoningBlocks,
      streams: streamCount,
      foregroundStreams: config.foregroundStreams,
      backgroundStreams: config.backgroundStreams,
      streamChunks: streamCount * config.streamChunks,
      typingEvents: config.typingEvents,
    },
    turns,
    streams,
    typing: Array.from({ length: config.typingEvents }, (_, index) => ({
      seq: index + 1,
      text: String.fromCharCode(97 + (index % 26)),
      dueMs: index * 8,
    })),
  };
}

export function createStandardWebUiPerformanceScenarios(ids = null) {
  const selected = ids && ids.length
    ? STANDARD_WEB_UI_PERFORMANCE_SCENARIOS.filter((scenario) => ids.includes(scenario.id))
    : STANDARD_WEB_UI_PERFORMANCE_SCENARIOS;
  return selected.map(createWebUiPerformanceScenario);
}

export function validateWebUiPerformanceScenario(scenario) {
  const failures = [];
  const keys = new Set();
  for (const turn of scenario.turns || []) {
    if (!turn?.key || keys.has(turn.key)) failures.push(`duplicate or missing turn key: ${turn?.key || '<empty>'}`);
    keys.add(turn?.key);
  }
  const toolCards = (scenario.turns || []).reduce((sum, turn) => sum + (turn.tools?.length || 0), 0);
  const reasoningBlocks = (scenario.turns || []).filter((turn) => Boolean(turn.reasoning)).length;
  const streamChunks = (scenario.streams || []).reduce((sum, stream) => sum + (stream.chunks?.length || 0), 0);
  const checks = {
    turns: scenario.turns?.length || 0,
    toolCards,
    reasoningBlocks,
    streams: scenario.streams?.length || 0,
    foregroundStreams: (scenario.streams || []).filter((stream) => stream.surface === 'foreground').length,
    backgroundStreams: (scenario.streams || []).filter((stream) => stream.surface === 'background').length,
    streamChunks,
    typingEvents: scenario.typing?.length || 0,
  };
  for (const [name, expected] of Object.entries(scenario.expected || {})) {
    if (checks[name] !== expected) failures.push(`${name}: generated ${checks[name]}, expected ${expected}`);
  }
  if (scenario.version !== SCENARIO_VERSION) failures.push(`scenario version ${scenario.version} is not ${SCENARIO_VERSION}`);
  return { ok: failures.length === 0, failures, checks };
}
