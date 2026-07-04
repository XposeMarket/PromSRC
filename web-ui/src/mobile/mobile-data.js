// Mock data for the first mobile UI pass. Replace with real APIs later.

export const chatMessages = [
  {
    role: 'ai',
    time: '9:30 AM',
    body: {
      sender: 'Prometheus',
      text: 'Good morning.\nHere’s your operator snapshot for today.',
      summary: [
        { icon: 'calendar', title: '3 schedules today', subtitle: 'Brain Dream, Weekly Radar, Team Standup' },
        { icon: 'users',    title: '2 team updates',  subtitle: 'Daily Signal Radar, Growth Team' },
        { icon: 'clipboard', title: '7 tasks need attention', subtitle: 'Across 3 teams and 2 subagents' },
      ],
    },
  },
  { role: 'user', time: '9:31 AM', body: { text: 'What are my top priorities today?' } },
  {
    role: 'ai',
    time: '9:32 AM',
    body: {
      sender: 'Prometheus',
      text: 'Based on your schedule and task queue, here are your top priorities:',
      numbered: [
        { title: 'Run Brain Dream', subtitle: 'Nightly synthesis + memory cleanup' },
        { title: 'Review Weekly Opportunity Radar', subtitle: 'Synthesis brief due today' },
        { title: 'Finalize manager inbox outcomes', subtitle: '7d lane validation and escalation' },
      ],
    },
  },
  { role: 'user', time: '9:32 AM', body: { text: 'Summarize team updates.' } },
  {
    role: 'ai',
    time: '9:33 AM',
    body: {
      sender: 'Prometheus',
      text: 'Here’s a quick team update summary:',
      teamRows: [
        { icon: '🏠', name: 'Daily X Bookmark',  detail: 'All runs healthy. 4 subagents active.' },
        { icon: '🏠', name: 'Growth Team', detail: '2 proposals in review. 1 awaiting approval.' },
      ],
    },
  },
];

export const recentCommands = [
  { title: 'Analyze market trends',     when: 'Today, 9:30 AM' },
  { title: 'Summarize meeting notes',   when: 'Today, 8:15 AM' },
  { title: 'Create a content brief',    when: 'Yesterday, 4:42 PM' },
];

export const mobileSchedules = [
  {
    id: 'brain-thought',
    emoji: '🧠',
    name: 'Brain Thought',
    color: 'purple',
    status: 'active',
    builtin: true,
    enabled: true,
    description: 'Observes the last 6h of activity and writes a reflection.',
    next: '5/14/2026, 1:25:56 PM',
    last: '5/14/2026, 6:37:15 AM',
    footLeft: 'Every 6 hours',
    footRight: 'Thoughts today: 2',
  },
  {
    id: 'brain-dream',
    emoji: '💤',
    name: 'Brain Dream',
    color: 'purple',
    status: 'running',
    builtin: true,
    enabled: true,
    description: 'Nightly synthesis plus a second-pass memory cleanup 30m later.',
    next: '5/14/2026, 1:25:56 PM',
    last: '5/13/2026, 5:27:03 AM',
    footLeft: 'Nightly at 23:30 local, cleanup about 30m later',
    footRight: 'Dream ran tonight: not yet',
  },
  {
    id: 'weekly-radar-synth',
    emoji: '🎯',
    name: 'Weekly Opportunity Radar — Synthesis Brief',
    color: 'orange',
    status: 'active',
    enabled: true,
    description: 'You are Prometheus running the Weekly Opportunity Radar synthesis brief.',
    next: '5/17/2026, 8:00:00 PM',
    last: '5/11/2026, 2:10:54 AM',
    assignedTo: 'schedule_weekly-opportunity-radar-synthesis-brief_gyze1',
  },
  {
    id: 'weekly-radar-monday',
    emoji: '🎯',
    name: 'Weekly Opportunity Radar — Monday Morning Briefing',
    color: 'orange',
    status: 'active',
    enabled: true,
    description: 'You are Prometheus running the Monday Morning Opportunity Radar briefing.',
    next: '5/18/2026, 8:30:00 AM',
    last: '5/11/2026, 8:30:51 AM',
    assignedTo: 'schedule_weekly-opportunity-radar-monday-morning-brief_u4s0m',
  },
  {
    id: 'daily-x-radar',
    emoji: '📡',
    name: 'Daily Signal Radar — Collector',
    color: 'green',
    status: 'active',
    enabled: true,
    description: 'You are running the Daily Signal Radar collector for the user.',
    next: '5/14/2026, 9:30:00 PM',
    last: '5/13/2026, 10:16:09 PM',
    assignedTo: 'schedule_daily-x-signal-radar-collector_di871',
  },
];

export const mobileTeams = [
  { id: 'oss-competitive-analysis', name: 'OSS Competitive Analysis', agents: 5, house: 'brown', featured: false },
  { id: 'daily-x-bookmark',          name: 'Daily X Bookmark → Prometheus Feature Pipeline', agents: 4, house: 'blue',  featured: true },
  { id: 'growth-team',              name: 'Growth Team', agents: 6, house: 'brown', featured: false },
  { id: 'committee',                 name: 'Committee', agents: 3, house: 'brown', featured: false },
];

export const mobileTeamDetail = {
  'daily-x-bookmark': {
    id: 'daily-x-bookmark',
    name: 'Daily X Bookmark → Prometheus Feature Pipeline',
    subagents: 4,
    totalRuns: 23,
    runsDone: 3,
    runsTotal: 7,
    members: [
      { id: 'manager',       name: 'Manager',        color: '#7d6bd6', avatar: '🧠' },
      { id: 'operator_x',    name: 'operator_x…',     color: '#2fae66', avatar: '🤖' },
      { id: 'planner_xb',    name: 'planner_xb…',     color: '#c8851f', avatar: '👹' },
      { id: 'researcher',    name: 'researcher…',     color: '#d8473a', avatar: '🍄' },
      { id: 'analyst_xb',    name: 'analyst_xb…',     color: '#a06bd6', avatar: '✨' },
    ],
    purpose:
      'Run a daily saved-signal → Prometheus Feature Pipeline for the user. Use user-approved sources to collect up to 50 recent saved items/day, triage up to 15 viable Prometheus-relevant ideas/day, deep research 3–8 of the triaged candidates/day depending on signal quality, map the strongest researched ideas into clear product notes, and prepare 3–5 manager-selected proposal candidates/day when quality is high enough.',
    currentTask:
      'Finalize queued manager inbox outcomes for 2026-05-08 lane; validate corrected Ari artifacts; preserve root-source visibility blocker and pending owner go/no-go on artifact-to-proposal escalation.',
    lastRun: '7d ago',
    memberStates: 'No member state updates yet.',
    dispatches: 'No active dispatches.',
    workspace: 'No workspace files yet.',
  },
};

export const mobileNavTabs = [
  { id: 'chat',     label: 'Chat',     icon: 'chat',     route: '#mobile/chat' },
  { id: 'voice',    label: 'Voice',    icon: 'mic',      route: '#mobile/voice' },
  { id: 'tasks',    label: 'Tasks',    icon: 'clipboard',route: '#mobile/tasks' },
  { id: 'hub',      label: 'Hub',      icon: 'target',   route: '#mobile/hub' },
];

export const mobileDrawerItems = [
  { id: 'schedule',  label: 'Schedule',  icon: 'calendar', route: '#mobile/schedule' },
  { id: 'teams',     label: 'Teams',     icon: 'users',    route: '#mobile/teams' },
  { id: 'subagents', label: 'Subagents', icon: 'robot',    route: '#mobile/subagents' },
  { id: 'proposals', label: 'Proposals', icon: 'doc',      route: '#mobile/proposals' },
  { id: 'more',      label: 'More',      icon: 'dots',     route: '#mobile/more' },
];
