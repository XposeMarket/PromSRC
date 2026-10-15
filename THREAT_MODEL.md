# Prometheus threat model

Companion to [SECURITY.md](SECURITY.md). SECURITY.md lists the controls; this
document says who we defend against, what they want, how they would get in,
and which control stops them, including where nothing does yet.

Scope: the gateway (`src/gateway`), its HTTP/WebSocket API, the desktop
(Electron) and mobile (PWA) clients, channels (Telegram/Discord/etc.), tool
execution, subagents and teams, extensions/MCP, and stored credentials.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Host authority (shell, files, desktop, browser) | Gateway process, host user | Full compromise of the user's machine and accounts |
| Connected-account credentials (OAuth tokens, API keys) | Vault / config under the Prometheus data dir | Impersonation, data exfiltration, spend |
| Conversation history, memory, notes | Workspace + data dir | Personal data, business data |
| Outbound authority (email, posts, merges, purchases) | Connector tools, browser/desktop automation | Irreversible actions in the user's name |
| Pairing tokens | Mobile device storage, pairing store | Remote control of the gateway |

## Trust boundaries

1. **Network edge**: anything not a direct local socket. Includes LAN clients,
   tailnet clients, and the public Tailscale Funnel URL. A local reverse proxy
   connects from 127.0.0.1, so forwarding headers mark a request as remote.
2. **Model boundary**: every model (any provider, including local) proposes
   tool calls. It is never trusted to grant authority.
3. **Content boundary**: tool results, web pages, emails, files, memory recall
   and channel messages from non-owners are data, never instructions.
4. **Worker boundary**: subagents, background workers and team members act
   with at most their spawner's authority.
5. **Extension boundary**: extensions and MCP servers are code the owner chose
   to install. They are trusted code, not sandboxed (see gaps).

## Attackers and mitigations

| # | Attacker | Goal / path | Mitigation (code) | Residual risk |
|---|---|---|---|---|
| A1 | Anonymous internet client | Reach the API through an enabled Funnel URL | `gateway-auth.ts` `isProxiedRequest`: proxied requests need a paired-device token or gateway token on HTTP, WS, voice and pairing admin; `/api/status` fast path returns a stub (`core/server.ts`) | Liveness of the gateway is observable |
| A2 | LAN / tailnet peer | Call the API directly | Non-loopback sockets require a token; default bind is loopback | Owner-enabled LAN mode relies on token secrecy |
| A3 | Prompt-injected model (malicious page, email, file, memory) | Make the agent send, post, buy, delete or leak | Offered-surface dispatch policy, approval queue for writes, connector write approvals, mandatory final-action gate on UI targets (`final-action-gate.ts`), elevated commands always need a fresh approval | Pixel/selector-only clicks are unclassifiable; reads of allowed data can still be summarized back into the chat |
| A4 | Narrowed agent escalating through workers | Spawn a worker with tools it lacks | `tool-ceiling.ts`: worker allowlist is capped at the spawner's, empty intersection is deny-all | Named subagents with their own configured allowlist are governed by that config, not intersected |
| A5 | Replay / confused deputy on approvals | Reuse a grant for a different action | Grants bind session, tool, arguments, expiry, single use (`final-action-approvals.ts`) | — |
| A6 | Malicious extension or MCP server | Read secrets, run code | Install is an explicit owner action; MCP stdio uses `shell:false` | Runs with gateway/host privileges and inherits environment. Out-of-process permission broker is roadmap |
| A7 | Stolen phone / pairing token | Remote control | Tokens are per device and revocable from the desktop pairing panel | No device-bound signing yet; revoke on loss |
| A8 | Local malware as the same user | Read data dir / vault | Out of scope: same-user malware owns the account | OS account security |
| A9 | Crash between side effect and persistence | Duplicate send/post on recovery | Recovery asks for reconciliation instead of blind retry; operation ledger (durability wave) | Until the ledger lands, an uncertain outcome needs human verification |

## Non-goals

- Multi-tenant isolation between hostile users of one gateway.
- Sandboxing the host from the owner's own commands. Shell confinement is a
  path/command policy, not an OS boundary; optional OS-contained execution is
  roadmap.

## Testing

Each mitigation above has a regression wired into `.github/workflows/pr-regression.yml`:
`test:gateway-auth-proxy` (A1/A2), `test:final-action-gate` (A3/A4/A5),
`src/security/security-controls.regression.ts` (grant validation) and the
adversarial replay scenarios in `src/testing/replay/scenarios.ts` (unknown or
un-offered tool calls).
