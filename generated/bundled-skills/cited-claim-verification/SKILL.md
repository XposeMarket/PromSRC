---
name: "cited-claim-verification"
description: "Produce or fact-check a written deliverable so every outside claim is traceable: a source ledger with stable [n] ids registered at retrieval time, inline citations, verbatim supporting quotes, [unverified] markers for unsourced claims, and a final citation audit that catches invented ids, retyped URLs, and thin coverage. Use when the user asks to fact-check a draft, verify the claims in a document, add sources to a report, or wants a high-stakes cited deliverable (medical, legal, financial, disputed). Do not use for ordinary research answers (web-researcher), competitor monitoring (competitor-signal-monitor), or reviewing code."
---

# Cited Claim Verification

Citation numbers and URLs come from retrieval, never from memory. A ledger owns the mapping from source to `[n]`; the writer only ever uses ids the ledger handed out. For fact-checking, each cited source also carries the exact sentence that supports the claim.

## 1. Start the ledger

Create `reports/<slug>-sources.json` (or reuse the existing one when continuing a draft, so numbering stays stable):

```json
{"sources": [{"id": 1, "url": "", "title": "", "retrieved": "", "type": "primary|secondary|community", "quotes": []}]}
```

One ledger per deliverable. Parallel workers writing parts of the same deliverable must all be pointed at the same ledger path, or their ids will collide.

## 2. Register sources as they are retrieved

After every `web_search` and `web_fetch` (use the batch `urls` form for several pages), add each page actually read to the ledger immediately, before writing prose. Normalize the URL (strip tracking parameters and fragments) so the same page always gets the same id. A search snippet supports only what it literally says; fetch the page before citing it for anything in the body.

For broad "what is everyone saying" questions, cover several source types (official pages, docs and changelogs, community threads, X via the connector found with `tool_search`, code via GitHub) and record per-type gaps instead of silently narrowing. Community posts are evidence that people report something, not that it is true; label them as sentiment or pair them with a primary source.

## 3. Draft with inline citations

- Put `[n]` right after the sentence it supports, no space before the bracket, at most three ids per sentence.
- Use only ids present in the ledger.
- Quote figures, dates, and names exactly as the source states them.
- Conflicting sources: present both readings with their own ids and say which you weight and why.
- Claims from your own knowledge get no citation; in fact-check mode they get `[unverified]` instead.
- Say "no source found for X" rather than smoothing over a gap.

## 4. Fact-check mode (high stakes or on request)

1. For each cited source, save the fetched text and copy the exact supporting sentence into that source's `quotes`. Copy, never retype or paraphrase. If you cannot find the literal sentence, the claim is not supported by that page.
2. Mark load-bearing claims you could not source with `[unverified]`. If most sentences need it, retrieval was insufficient: go back to step 2 rather than shipping.
3. Corroborate disputed or decision-relevant facts with a second independent source (not a syndicated copy of the first).
4. Checking someone else's draft: split it into atomic claims, give each a verdict (supported, partly supported, contradicted, unsupported) with the ledger id and quote, and propose the corrected wording.

## 5. Render the Sources block from the ledger

Generate the `## Sources` list from the ledger (only cited ids, in id order, `[n] Title. URL (retrieved date)`); never retype URLs by hand. In fact-check mode, print each source's quotes beneath it. For a chat answer, end with the same list, and optionally show `show_ui_card(type:"sources")` built from the ledger entries.

## 6. Audit before delivering

Check, and fix until all pass:

- every `[n]` in the text exists in the ledger;
- the Sources block lists exactly the cited ids with the ledger URLs;
- no ledger source is cited without having been fetched;
- in fact-check mode, every cited source has at least one quote that appears verbatim in its saved text (a quick `workspace_read` grep on the saved text confirms it);
- coverage: the share of factual sentences carrying `[n]` or `[unverified]` is at least about 60 percent for reports, higher for fact-checks. Report the figure.

Uncited ledger sources usually mean a claim lost its citation during editing; restore or drop them deliberately.

## Exit criteria

Audit passes; the deliverable states coverage, unverified count, and unresolved conflicts; the ledger file sits next to the deliverable.

Lineage: inspired by NousResearch/hermes-agent grounded-citations, rewritten for Prometheus.
