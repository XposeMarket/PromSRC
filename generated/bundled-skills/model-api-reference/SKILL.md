---
name: "model-api-reference"
description: "Build or troubleshoot software against a model provider API using current first-party documentation and the project's SDK. Use for provider API work, not general API integration or ordinary model-selection advice; not for unrelated general-purpose workflows."
---

# Model API Reference

Use when code or a design depends on a hosted model API, SDK, tool protocol, streaming behavior, structured output, files, batches, caching, or model version changes. Keep the workflow provider-neutral and verify current first-party documentation before writing code.

## 1. Identify the exact contract

Inspect the target project and determine language, package manager, installed SDK, API surface, model or capability, authentication method, request shape, response shape, streaming behavior, limits, and compatibility constraints. If the user requests provider-neutral code, preserve that boundary.

## 2. Read current first-party documentation

Use the provider's official documentation or SDK repository for the exact feature and version. Prefer current reference pages, migration notes, and typed examples over memory or search snippets. Record the URL, retrieval date, SDK version, model identifier, and any feature limitations. Do not invent method names, parameters, model availability, or pricing.

## 3. Implement safely

Keep credentials in the configured secret store or environment. Do not log prompts containing secrets, raw tokens, private user data, or full responses unnecessarily. Match the project's language-specific SDK when supported; use raw HTTP only when requested or when no suitable SDK exists. Add explicit timeouts, bounded retries for safe transient failures, request IDs where available, cancellation, response validation, and clear error handling.

## 4. Verify behavior

Test success, authentication failure, malformed output, rate limit, timeout, empty result, cancellation, and the relevant streaming or tool-use path with disposable fixtures or a safe sandbox. Re-run typecheck, tests, and build scripts that apply. Report documentation URLs, versions, verified behavior, unverified provider gates, and upgrade risks.
