---
name: error-budget-tracker
description: Log failures consistently. Surface patterns. Know when things are getting worse before the user does.
emoji: "🧩"
version: 1.0.0
---

# Error Budget Tracker

Log failures consistently. Surface patterns. Know when things are getting worse before the user does.

---

## Log Location

Always write to: `D:\Prometheus\workspace\memory\error_log.jsonl`
Summary file: `D:\Prometheus\workspace\memory\error_summary.json`

Create these files if they don't exist.

---

## 1. Logging a Failure

Append one JSON line per failure to `error_log.jsonl`:

```python
import json
from datetime import datetime, timezone
from pathlib import Path

LOG_PATH = Path(r"D:\Prometheus\workspace\memory\error_log.jsonl")

def log_error(agent, tool, error_type, message, context=None, retries=0, resolved=False):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": agent,           # which agent or workflow
        "tool": tool,             # which tool or API failed
        "error_type": error_type, # "timeout" | "rate_limit" | "auth" | "not_found" | "parse" | "unknown"
        "message": message,       # short description
        "context": context or {}, # any extra data (url, input snippet, etc.)
        "retries": retries,       # how many retries were attempted
        "resolved": resolved      # did it eventually succeed?
    }
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
```

### Error Type Reference
| Type | When to Use |
|---|---|
| `timeout` | Request or operation exceeded time limit |
| `rate_limit` | HTTP 429 or API quota exceeded |
| `auth` | 401 / 403 / invalid credentials |
| `not_found` | 404 / file missing / key not found |
| `parse` | JSON decode error / unexpected response shape |
| `validation` | Data failed a validation check |
| `network` | Connection refused / DNS failure |
| `unknown` | Catch-all for unexpected errors |

---

## 2. Reading the Error Log

```python
import json
from pathlib import Path
from collections import Counter, defaultdict

LOG_PATH = Path(r"D:\Prometheus\workspace\memory\error_log.jsonl")

def load_errors():
    if not LOG_PATH.exists():
        return []
    with open(LOG_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def summarize_errors(errors):
    by_type = Counter(e["error_type"] for e in errors)
    by_agent = Counter(e["agent"] for e in errors)
    by_tool = Counter(e["tool"] for e in errors)
    unresolved = [e for e in errors if not e["resolved"]]
    high_retry = [e for e in errors if e["retries"] >= 3]

    return {
        "total": len(errors),
        "unresolved": len(unresolved),
        "high_retry_count": len(high_retry),
        "by_type": dict(by_type.most_common()),
        "by_agent": dict(by_agent.most_common()),
        "by_tool": dict(by_tool.most_common()),
        "recent_5": errors[-5:]
    }
```

---

## 3. Saving a Summary

After any multi-step task or on demand, write a summary snapshot:

```python
import json
from pathlib import Path
from datetime import datetime, timezone

SUMMARY_PATH = Path(r"D:\Prometheus\workspace\memory\error_summary.json")

def save_summary():
    errors = load_errors()
    summary = summarize_errors(errors)
    summary["generated_at"] = datetime.now(timezone.utc).isoformat()

    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    return summary
```

---

## 4. Surfacing Patterns

Run this to spot emerging problems:

```python
def find_patterns(errors, window=20):
    """Look at recent errors and flag concerning patterns."""
    recent = errors[-window:]
    flags = []

    type_counts = Counter(e["error_type"] for e in recent)

    if type_counts.get("rate_limit", 0) >= 3:
        flags.append("⚠️ Rate limit hit 3+ times recently — consider slowing down requests")

    if type_counts.get("auth", 0) >= 2:
        flags.append("🔴 Auth failures — check API keys or token expiry")

    if type_counts.get("timeout", 0) >= 3:
        flags.append("⚠️ Repeated timeouts — endpoint may be degraded")

    unresolved_rate = sum(1 for e in recent if not e["resolved"]) / len(recent) if recent else 0
    if unresolved_rate > 0.3:
        flags.append(f"🔴 {unresolved_rate:.0%} of recent errors unresolved — investigate")

    high_retry_agents = [e["agent"] for e in recent if e["retries"] >= 3]
    if high_retry_agents:
        flags.append(f"⚠️ High retries from: {', '.join(set(high_retry_agents))}")

    return flags
```

---

## 5. Workflow Integration

### Wrap any risky operation:
```python
def safe_call(agent, tool, fn, *args, max_retries=3, **kwargs):
    retries = 0
    while retries <= max_retries:
        try:
            result = fn(*args, **kwargs)
            if retries > 0:
                log_error(agent, tool, "retry_success", f"Succeeded after {retries} retries",
                          retries=retries, resolved=True)
            return result
        except Exception as e:
            retries += 1
            error_type = classify_error(e)
            log_error(agent, tool, error_type, str(e), retries=retries, resolved=False)
            if retries > max_retries:
                raise
            time.sleep(2 ** retries)

def classify_error(e):
    msg = str(e).lower()
    if "429" in msg or "rate limit" in msg: return "rate_limit"
    if "401" in msg or "403" in msg or "auth" in msg: return "auth"
    if "404" in msg or "not found" in msg: return "not_found"
    if "timeout" in msg: return "timeout"
    if "json" in msg or "parse" in msg: return "parse"
    return "unknown"
```

---

## 6. Reporting to User

When asked for an error report or after a complex task, produce this format:

```
## Error Report — [timestamp]

**Total logged:** 14  |  **Unresolved:** 3  |  **High-retry:** 2

### By Type
- rate_limit: 6
- timeout: 4
- parse: 3
- auth: 1

### Patterns Detected
⚠️ Rate limit hit 3+ times — slow down requests
⚠️ High retries from: enrichment-agent

### Recent Unresolved
- [2025-03-14T10:22Z] enrichment-agent / clearbit_api — rate_limit (3 retries)
- [2025-03-14T10:31Z] writer-agent / output_file — parse (1 retry)
```