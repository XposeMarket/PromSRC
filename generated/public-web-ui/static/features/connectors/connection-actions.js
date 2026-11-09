import { postJson } from '../secure-access/secure-access-core.js';
export function approveConnection(fetchJson, attemptId) {
  return postJson(fetchJson, `/api/connection-attempts/${encodeURIComponent(attemptId)}/connect`, {}, 'Approve connection');
}
