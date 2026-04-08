---
name: Report Generator
description: Turn structured data, research results, or task outputs into clean formatted reports. Use whenever the user wants a summary, writeup, briefing, or formatted document from raw data or completed work. Also triggers automatically after any research task, data pipeline, or multi-agent workflow to produce a readable deliverable. Triggers on: generate report, write report, summarize results, create summary, format output, write up findings, produce briefing, make a document, turn this into a report, output report, markdown report, HTML report.
emoji: 📄
version: 1.0.0
triggers: generate report, write report, summarize results, create summary, format output, write up findings, briefing, make a document, turn into report, markdown report, HTML report, weekly report, status report, findings, output document
---

# Report Generator

Turn any structured data or completed task output into a clean, readable report. Choose format based on destination.

---

## Format Decision

| Destination | Format |
|---|---|
| Shared in chat / pasted anywhere | Markdown (`.md`) |
| Opened in browser / styled | HTML (`.html`) |
| Sent as document | Markdown saved to file |
| Data table heavy | Markdown with tables |
| Executive summary | Short markdown, no code blocks |

---

## 1. Markdown Report Template

```markdown
# [Report Title]
**Generated:** [timestamp]  |  **By:** Prometheus  |  **For:** [user/team]

---

## Summary
[2-4 sentence plain-English summary of the most important finding or outcome.]

---

## Results

| Field | Value |
|---|---|
| Total processed | 342 |
| Successful | 338 |
| Failed | 4 |
| Duration | 2m 14s |

---

## Key Findings

1. **Finding one** — brief explanation of what it means
2. **Finding two** — brief explanation
3. **Finding three** — brief explanation

---

## Details
[Expanded section with more data, tables, or breakdowns as needed]

---

## Issues / Errors
[Any failures, warnings, or things that need attention. Omit section if none.]

---

## Next Steps
- [ ] Action item one
- [ ] Action item two
```

---

## 2. Generating a Markdown Report in Python

```python
from datetime import datetime
from pathlib import Path

def generate_markdown_report(title, summary, results: dict, findings: list,
                              errors: list = None, next_steps: list = None,
                              output_path: str = None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# {title}",
        f"**Generated:** {timestamp}  |  **By:** Prometheus",
        "",
        "---",
        "",
        "## Summary",
        summary,
        "",
        "---",
        "",
        "## Results",
        "",
        "| Metric | Value |",
        "|---|---|",
    ]
    for k, v in results.items():
        lines.append(f"| {k} | {v} |")

    if findings:
        lines += ["", "---", "", "## Key Findings", ""]
        for i, f in enumerate(findings, 1):
            lines.append(f"{i}. {f}")

    if errors:
        lines += ["", "---", "", "## Issues / Errors", ""]
        for e in errors:
            lines.append(f"- ⚠️ {e}")

    if next_steps:
        lines += ["", "---", "", "## Next Steps", ""]
        for s in next_steps:
            lines.append(f"- [ ] {s}")

    report = "\n".join(lines)

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(report, encoding="utf-8")
        print(f"Report saved: {output_path}")

    return report
```

---

## 3. HTML Report (browser-ready, styled)

```python
def generate_html_report(title, summary, results: dict, findings: list,
                          output_path: str = None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    rows_html = "\n".join(f"<tr><td>{k}</td><td><strong>{v}</strong></td></tr>"
                          for k, v in results.items())
    findings_html = "\n".join(f"<li>{f}</li>" for f in findings)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }}
  h1 {{ border-bottom: 2px solid #333; padding-bottom: 8px; }}
  .meta {{ color: #666; font-size: 0.9em; margin-bottom: 24px; }}
  .summary {{ background: #f5f5f5; border-left: 4px solid #0066cc; padding: 12px 16px; border-radius: 4px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
  th, td {{ border: 1px solid #ddd; padding: 10px 14px; text-align: left; }}
  th {{ background: #f0f0f0; font-weight: 600; }}
  ol li, ul li {{ margin: 6px 0; }}
</style>
</head>
<body>
<h1>{title}</h1>
<p class="meta">Generated: {timestamp} &nbsp;|&nbsp; By: Prometheus</p>
<div class="summary"><p>{summary}</p></div>
<h2>Results</h2>
<table><tr><th>Metric</th><th>Value</th></tr>{rows_html}</table>
<h2>Key Findings</h2>
<ol>{findings_html}</ol>
</body>
</html>"""

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(html, encoding="utf-8")
        print(f"HTML report saved: {output_path}")

    return html
```

---

## 4. Report Types & When to Use Each

### Status Report
After a workflow or task completes. Focus: what ran, what worked, what failed.

### Research Report
After web research or data gathering. Focus: findings, sources, confidence level.

### Data Report
After a data pipeline. Focus: record counts, quality stats, output location.

### Error Report
After failures. Focus: what broke, pattern analysis, recommended fixes. (See also: `error-budget-tracker` skill)

### Weekly Summary
Summarize `memory/` logs over past 7 days. Focus: activity, wins, issues, next steps.

---

## 5. Report Output Locations

| Type | Path |
|---|---|
| Task output | `D:\Prometheus\workspace\teams\<team>\output\report.md` |
| General | `D:\Prometheus\workspace\memory\reports\<date>_<name>.md` |
| User-facing | Paste directly in chat response |

---

## 6. Writing Rules

- **Lead with the summary** — most important thing first
- **Numbers beat words** — "342 processed, 4 failed" beats "mostly successful"
- **Flag issues clearly** — don't bury errors at the bottom
- **Keep next steps actionable** — specific tasks, not vague intentions
- **No filler** — every sentence must carry information
