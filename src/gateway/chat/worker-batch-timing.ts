// Keep the first worker batch (TTFT evidence) and every 50th; completion and
// failure stages already carry the final batch count and byte totals.
export function shouldRecordWorkerBatchTiming(stage: string, fields?: Record<string, number | string | boolean>): boolean {
  if (stage !== 'event_batch') return true;
  const count = Number(fields?.eventBatches);
  return count === 1 || (Number.isSafeInteger(count) && count > 0 && count % 50 === 0);
}
