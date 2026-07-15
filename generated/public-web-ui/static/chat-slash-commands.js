const ALL_CHAT_SLASH_COMMANDS = [
  { command: '/side', label: 'Open a linked side chat', placeholder: 'Optional first side-chat message...', surfaces: ['desktop', 'mobile'] },
  { command: '/skill', label: 'Insert a skill reference', placeholder: 'Search installed skills...', surfaces: ['desktop', 'mobile'] },
  { command: '/visual', label: 'Turn this request into the best-fit visual', placeholder: 'Describe what Prometheus should help you see or explore...', surfaces: ['desktop', 'mobile'], selectedSkillIds: ['interactive-visuals'] },
  { command: '/goal', label: 'Start goal mode in this chat', placeholder: 'Describe the goal Prometheus should keep working toward...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal status', label: 'Show the active goal state', placeholder: 'Optional note for the status check...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal pause', label: 'Pause the active goal runner', placeholder: 'Optional reason...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal resume', label: 'Resume a paused goal', placeholder: 'Optional note before resuming...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal done', label: 'Mark the goal completed', placeholder: 'Optional completion note...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal clear', label: 'Stop and archive the goal', placeholder: 'Optional archive note...', surfaces: ['desktop', 'mobile'] },
  { command: '/goal revise', label: 'Rewrite the active goal', placeholder: 'Write the revised goal...', surfaces: ['desktop', 'mobile'] },
  { command: '/models', label: 'Open provider and model controls', placeholder: 'Use without extra text to open model settings...', surfaces: ['mobile'] },
  { command: '/new', label: 'Start a fresh chat', placeholder: 'Use without extra text to open a new chat...', surfaces: ['desktop', 'mobile'] },
  { command: '/screenshot', label: 'Open screenshot controls', placeholder: 'Use without extra text for screenshot options...', surfaces: ['mobile'] },
  { command: '/restart', label: 'Open gateway restart controls', placeholder: 'Use without extra text for quick/full restart...', surfaces: ['mobile'] },
  { command: '/stop', label: 'Inspect and stop live AI flows', placeholder: 'Use without extra text to show live flows...', surfaces: ['mobile'] },
  { command: '/stop_now', label: 'Stop the active main chat turn', placeholder: 'Use without extra text to abort this chat...', surfaces: ['mobile'] },
  { command: '/browse', label: 'Browse workspace files', placeholder: 'Optional path to start in, e.g. src/gateway', surfaces: ['mobile'] },
];

export function getChatSlashCommands(surface) {
  const normalized = String(surface || '').trim().toLowerCase();
  return ALL_CHAT_SLASH_COMMANDS
    .filter((item) => !normalized || item.surfaces.includes(normalized))
    .map(({ surfaces, ...item }) => ({ ...item }));
}

export function mergeSlashCommandSkillIds(message, selectedSkillIds = []) {
  const text = String(message || '').trim();
  const match = ALL_CHAT_SLASH_COMMANDS.find((item) => {
    const command = item.command.toLowerCase();
    const lower = text.toLowerCase();
    return lower === command || lower.startsWith(`${command} `);
  });
  const seen = new Set();
  return [...(Array.isArray(selectedSkillIds) ? selectedSkillIds : []), ...(match?.selectedSkillIds || [])]
    .map((id) => String(id || '').trim())
    .filter((id) => {
      const key = id.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function isVisualSlashCommand(message) {
  return /^\s*\/visual(?:\s|$)/i.test(String(message || ''));
}
