import { Cron } from 'croner';

export type NormalizedSchedule =
  | {
      kind: 'recurring';
      cron: string;
      preview: string;
      timezone?: string;
    }
  | {
      kind: 'one-shot';
      runAt: string;
      preview: string;
      timezone?: string;
    };

const DAY_NUMBERS: Record<string, string> = {
  sunday: '0',
  sun: '0',
  monday: '1',
  mon: '1',
  tuesday: '2',
  tue: '2',
  tues: '2',
  wednesday: '3',
  wed: '3',
  thursday: '4',
  thu: '4',
  thurs: '4',
  friday: '5',
  fri: '5',
  saturday: '6',
  sat: '6',
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseTime(raw: any): { hour: number; minute: number } | null {
  const text = String(raw || '').trim().toLowerCase();
  const match = text.match(/\b(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const period = match[3];
  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeDays(raw: any, options: { includeNumeric?: boolean } = {}): { cron: string; label: string } | null {
  const source = Array.isArray(raw) ? raw.join(',') : String(raw || '');
  const text = source.toLowerCase();
  if (/\bweekdays?\b|\bmon\s*(?:-|to)\s*fri\b/.test(text)) return { cron: '1-5', label: 'weekdays' };
  if (/\bweekends?\b/.test(text)) return { cron: '0,6', label: 'weekends' };
  const found = new Set<string>();
  for (const [name, value] of Object.entries(DAY_NUMBERS)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.add(value);
  }
  if (options.includeNumeric || Array.isArray(raw)) {
    const numeric = text.match(/\b[0-6]\b/g) || [];
    for (const n of numeric) found.add(n);
  }
  if (!found.size) return null;
  const values = Array.from(found).sort((a, b) => Number(a) - Number(b));
  return { cron: values.join(','), label: values.map((n) => DAY_LABELS[Number(n)]).join(', ') };
}

export function validateCronExpression(cron: string, timezone?: string): void {
  const expr = String(cron || '').trim();
  if (!expr) throw new Error('Cron expression is required.');
  const job = new Cron(expr, { paused: true, timezone: timezone || 'UTC', catch: false });
  const next = job.nextRun(new Date());
  if (!next || !Number.isFinite(next.getTime())) throw new Error(`Cron expression has no next run: ${expr}`);
}

export function normalizeScheduleSpec(input: any, timezone?: string): NormalizedSchedule {
  const schedule = input && typeof input === 'object' ? input : {};
  const tz = String(timezone || schedule.timezone || schedule.tz || '').trim() || undefined;
  const rawKind = String(schedule.kind || schedule.type || '').trim().toLowerCase();

  const runAtRaw = schedule.run_at ?? schedule.runAt ?? schedule.at;
  if (rawKind === 'one_shot' || rawKind === 'one-shot' || runAtRaw) {
    const parsed = new Date(String(runAtRaw || '').trim());
    if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid run_at value: "${runAtRaw || ''}"`);
    return { kind: 'one-shot', runAt: parsed.toISOString(), preview: `One-shot at ${parsed.toISOString()}`, timezone: tz };
  }

  const cron = String(schedule.cron || schedule.pattern || '').trim();
  if (cron) {
    validateCronExpression(cron, tz);
    return { kind: 'recurring', cron, preview: `Cron: ${cron}`, timezone: tz };
  }

  const text = String(schedule.text || schedule.natural_language || schedule.naturalLanguage || '').trim();
  if (text) return parseSchedulePattern(text, tz);

  const time = parseTime(schedule.time || schedule.at_time || schedule.atTime || '09:00') || { hour: 9, minute: 0 };
  const minute = time.minute;
  const hour = time.hour;
  const everyHours = Number(schedule.every_hours ?? schedule.everyHours ?? schedule.interval_hours);
  if (Number.isFinite(everyHours) && everyHours > 0 && everyHours <= 23) {
    const cronExpr = `${minute} */${Math.floor(everyHours)} * * *`;
    validateCronExpression(cronExpr, tz);
    return { kind: 'recurring', cron: cronExpr, preview: `Every ${Math.floor(everyHours)} hours`, timezone: tz };
  }
  const everyDays = Number(schedule.every_days ?? schedule.everyDays ?? schedule.interval_days);
  if (Number.isFinite(everyDays) && everyDays > 0 && everyDays <= 31) {
    const cronExpr = `${minute} ${hour} */${Math.floor(everyDays)} * *`;
    validateCronExpression(cronExpr, tz);
    return { kind: 'recurring', cron: cronExpr, preview: `Every ${Math.floor(everyDays)} days at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timezone: tz };
  }
  const structuredDays = schedule.days_of_week ?? schedule.daysOfWeek ?? schedule.weekdays;
  const days = normalizeDays(structuredDays, { includeNumeric: Array.isArray(structuredDays) });
  const preset = String(schedule.repeat || schedule.recurrence || schedule.preset || '').toLowerCase();
  const dayInfo = days || (preset.includes('weekday') ? { cron: '1-5', label: 'weekdays' } : preset.includes('weekend') ? { cron: '0,6', label: 'weekends' } : null);
  const cronExpr = `${minute} ${hour} * * ${dayInfo ? dayInfo.cron : '*'}`;
  validateCronExpression(cronExpr, tz);
  return {
    kind: 'recurring',
    cron: cronExpr,
    preview: `${dayInfo ? dayInfo.label : 'Daily'} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    timezone: tz,
  };
}

export function parseSchedulePattern(text: string, timezone?: string): NormalizedSchedule {
  const t = String(text || '').trim().toLowerCase();
  if (!t) throw new Error('text is required');
  if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+\S+)?$/.test(t) && /^[\d*/,\-?a-z]+ /i.test(t)) {
    validateCronExpression(t, timezone);
    return { kind: 'recurring', cron: t, preview: `Cron: ${t}`, timezone };
  }
  const dayInfo = normalizeDays(t);
  const timeInfo = parseTime(t) || { hour: 9, minute: 0 };
  if (dayInfo || /\bdaily\b|\bevery day\b|\bweekly\b|\bweekdays?\b|\bweekends?\b/.test(t)) {
    const dow = dayInfo ? dayInfo.cron : (/\bweekly\b/.test(t) ? '1' : '*');
    const cron = `${timeInfo.minute} ${timeInfo.hour} * * ${dow}`;
    validateCronExpression(cron, timezone);
    const label = dayInfo ? dayInfo.label : (dow === '1' ? 'Weekly on Monday' : 'Daily');
    return { kind: 'recurring', cron, preview: `${label} at ${String(timeInfo.hour).padStart(2, '0')}:${String(timeInfo.minute).padStart(2, '0')}`, timezone };
  }
  throw new Error('Could not parse pattern. Try "daily at 3:13pm", "weekdays at 9am", "Mon/Wed/Fri at 14:00", or cron like "0 9 * * *".');
}
