---
name: "api-integration"
description: "Build, call, connect, or debug REST/HTTP APIs with secret-safe authentication, response validation, pagination, rate-limit handling, bounded retries, and clear failure reporting."
---

# API Integration

Use this skill for HTTP API clients and integration scripts. Use a purpose-built connector when one exists, and use `connector-builder` when the result should become a reusable Prometheus connector.

## Workflow

1. Read the current provider documentation or supplied contract. Confirm base URL, method, authentication, scopes, request schema, response shape, pagination, rate limits, and sandbox availability.
2. Keep credentials in the configured secret store or environment. Never hardcode, echo, log, or persist raw values.
3. Set explicit connect/read timeouts, a descriptive user agent when appropriate, and bounded response-size expectations.
4. Validate status, content type, and response schema before consuming data. Preserve the provider’s useful error code/request ID while redacting secrets and sensitive payloads.
5. Retry only transient failures such as selected 429/5xx/network errors. Honor `Retry-After`, use exponential backoff with jitter, cap attempts, and keep non-idempotent writes out of automatic retries unless an idempotency key makes them safe.
6. Implement the provider’s actual pagination contract and stop on explicit termination signals; protect against repeated cursors and unbounded collection.
7. Test success, auth failure, malformed response, rate limit, pagination termination, timeout, and empty result with a disposable fixture or sandbox.
8. Report verified behavior, remaining credential/setup gates, and sanitized evidence.

Read [the detailed guide](references/detailed-guide.md) for Python authentication, request, retry, pagination, async, and error-handling examples. Adapt example domains and dependency choices to the current project.
