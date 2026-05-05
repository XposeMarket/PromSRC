---
name: doc-ingestion
description: This is the skill that feeds the business brain from real documents instead of manual data entry.
emoji: "🧩"
version: 1.0.0
---

# Doc Ingestion

Orchestrator skill. Reads any uploaded document, extracts structured business facts, and writes them into the correct places in the Prometheus workspace — `BUSINESS.md` and entity files under `entities/`.

This is the skill that feeds the business brain from real documents instead of manual data entry.

---

## DEPENDENCIES

This skill calls other skills. Verify these are working before running ingestion:
- `docx-reader` skill → requires `mammoth` npm package
- `pdf-reader` skill → requires `pdf-parse` npm package
- `xlsx-reader` skill → requires `xlsx` npm package

If any are missing: `node workspace\doc-skills-setup.js` from `D:\Prometheus`

---

## Step 1 — Detect File Type and Route

Determine the file extension and route to the correct reader:

| Extension | Reader Skill |
|---|---|
| `.docx` | `docx-reader` |
| `.doc` | Ask user to save as .docx first |
| `.pdf` | `pdf-reader` |
| `.xlsx`, `.xls` | `xlsx-reader` |
| `.csv` | `xlsx-reader` (SheetJS handles CSV) |
| `.txt`, `.md` | Read directly with `read_file()` tool |

---

## Step 2 — Extract Raw Text

Run the appropriate reader to get the document's text. Use the core extraction scripts from each reader skill. Goal: get a clean string of the document's full text (up to ~12,000 chars).

For long documents (>12k chars), extract:
- All headings/sections
- First 500 chars of each section
- Any tables in full
- Last 500 chars (often contains signature blocks, dates, totals)

---

## Step 3 — Classify the Document

Once you have the extracted text, classify what kind of document it is before deciding where to write:

```
Document types and their ingestion targets:

CONTRACT / AGREEMENT / SOW
  → entities/clients/[client-name].md  (contract terms, payment, SLA)
  → entities/contacts/  (any named people)
  → BUSINESS.md approval thresholds (if payment terms found)

PROPOSAL / QUOTE / ESTIMATE
  → entities/clients/[client-name].md  (deal value, scope)
  → entities/projects/[project-name].md  (scope, timeline)

INVOICE / RECEIPT
  → entities/vendors/[vendor-name].md  (cost, billing date)
  → BUSINESS.md key vendors section  (if new vendor)

SOP / HANDBOOK / POLICY
  → BUSINESS.md company policies section
  → BUSINESS.md team section  (if roles/people mentioned)

MEETING NOTES / BRIEF
  → entities/clients/[client].md  communication history
  → entities/projects/[project].md  current state / decisions

SPREADSHEET (financial, team, CRM data)
  → BUSINESS.md  (if company-level metrics found)
  → Appropriate entity files for each named entity

COMPANY PROFILE / ABOUT DOC
  → BUSINESS.md  company, team, products/services sections
```

---

## Step 4 — LLM Extraction Pass

After getting the raw text, run a structured extraction prompt **as a tool call to yourself** (inner reasoning step, not a separate agent). Think through the document and extract:

```
From this document text, extract the following as JSON:

{
  "documentType": "contract|proposal|invoice|sop|meeting_notes|spreadsheet|company_profile|other",
  "entities": {
    "clients": [{ "name": "", "industry": "", "status": "", "contractValue": "", "renewalDate": "", "paymentTerms": "", "contacts": [] }],
    "contacts": [{ "name": "", "role": "", "email": "", "phone": "", "company": "" }],
    "vendors": [{ "name": "", "category": "", "purpose": "", "monthlyCost": "", "billingDate": "" }],
    "projects": [{ "name": "", "client": "", "status": "", "deadline": "", "objective": "" }]
  },
  "businessFacts": {
    "companyName": "",
    "industry": "",
    "website": "",
    "policies": [],
    "approvalThresholds": {},
    "importantDates": [],
    "teamMembers": []
  },
  "confidence": "high|medium|low",
  "notes": "anything ambiguous or worth flagging"
}

Only populate fields you found explicitly in the document. Leave empty strings for anything not found.
```

Use this extracted JSON to drive all write operations in Step 5.

---

## Step 5 — Write to BUSINESS.md

Read the current BUSINESS.md first. Then apply updates using the `edit_file()` tool or by appending to sections:

**Rules for BUSINESS.md updates:**
- Never overwrite existing data — only add or extend
- Add to existing sections, don't create duplicate sections
- Use the existing format (markdown with comment headers)
- If a field already has a value, only update it if the document provides something more specific or recent
- Always append a `# Ingested from: [filename] on [date]` comment after any block you add

**Example — adding a new client to BUSINESS.md:**
```markdown
## Active Clients
- Acme Corp | Manufacturing | Active | John Doe (john@acme.com) | $48k/yr contract, renewal 2026-01-15
  # Ingested from: acme-master-services-agreement.docx on 2025-03-17
```

**Example — adding a policy:**
```markdown
## Company Policies
- All invoices over $5,000 require written approval before payment
  # Ingested from: finance-policy-2025.pdf on 2025-03-17
```

---

## Step 6 — Write Entity Files

For each entity found in the extraction:

### Creating a new entity file

Use the template from the relevant subfolder. File naming: lowercase, hyphens, no spaces.
- `entities/clients/acme-corp.md`
- `entities/contacts/john-smith.md`
- `entities/vendors/aws.md`
- `entities/projects/website-redesign.md`

**Check if the entity file already exists first.** If it does, append to the relevant sections rather than overwriting.

**Client entity example (from a contract):**
```markdown
# Acme Corp — Client Entity
# File: entities/clients/acme-corp.md
# Last Updated: 2025-03-17
# Ingested from: acme-master-services-agreement.docx

## Overview
- **Company:** Acme Corp
- **Industry:** Manufacturing
- **Status:** Active
- **Since:** 2024-06-01
- **Website:** acme.com
- **Contract Value:** $48,000/year
- **Renewal Date:** 2026-01-15

## Key Contacts
- John Doe | VP Operations | john@acme.com | — | Primary signatory

## Active Items
- Master Services Agreement active through 2026-01-15

## Contract & Terms
- **Contract type:** Master Services Agreement
- **Payment terms:** Net-30
- **SLA:** 99.5% uptime, 4hr response
- **Special terms:** Auto-renews unless 60-day notice given

## Notes
- Signed 2024-06-01, covers all professional services
```

---

## Step 7 — Confirm to User

After all writes are complete, give the user a clear summary:

```
✓ Ingested: acme-master-services-agreement.docx

Written to:
  BUSINESS.md          → Added Acme Corp to Active Clients
  entities/clients/    → Created acme-corp.md (contract terms, renewal date)
  entities/contacts/   → Created john-smith.md (VP Operations, Acme)

Key facts extracted:
  • Contract value: $48,000/year
  • Renewal date: 2026-01-15
  • Payment terms: Net-30
  • SLA: 99.5% uptime, 4hr response time

Nothing was overwritten. Flagged for review:
  • Auto-renewal clause — added to acme-corp.md notes
```

---

## Step 8 — Handle Ambiguity

Not every document maps cleanly. Use these rules:

**Can't determine client/entity name:**
Ask the user: "I extracted contract terms but couldn't determine the client name clearly — is this for [best guess] or a different client?"

**Multiple entities in one document:**
Create all of them. A contract might have a client, 3 contacts, and reference 2 vendors — write all 4 entity files.

**Conflicting data (document says X, BUSINESS.md says Y):**
Don't overwrite. Add a comment: `# CONFLICT: document says $52k, BUSINESS.md has $48k — verify which is current`

**Very low confidence extraction:**
Tell the user: "I extracted this but confidence is low — please review `entities/clients/acme-corp.md` before relying on it."

**Large spreadsheets (100+ rows):**
Don't try to create entity files for every row. Summarize: "This spreadsheet has 142 customer rows. Would you like me to create entity files for the top 10 by revenue, or write a summary to BUSINESS.md?"

---

## File Paths Reference

All paths relative to `D:\Prometheus\workspace\`:

| Target | Path |
|---|---|
| Business facts | `BUSINESS.md` |
| Client entity | `entities/clients/[name].md` |
| Contact entity | `entities/contacts/[name].md` |
| Vendor entity | `entities/vendors/[name].md` |
| Project entity | `entities/projects/[name].md` |
| Client template | `entities/clients/_template.md` |
| Contact template | `entities/contacts/_template.md` |
| Vendor template | `entities/vendors/_template.md` |
| Project template | `entities/projects/_template.md` |

---

## Quick Decision: What Gets Written Where

```
Found a person's name + email + company?
  → entities/contacts/[first-last].md

Found a company name + contract/deal terms?
  → entities/clients/[company-name].md
  → BUSINESS.md active clients line

Found a vendor + cost + what it's for?
  → entities/vendors/[vendor-name].md
  → BUSINESS.md key vendors line

Found a project name + deadline + scope?
  → entities/projects/[project-name].md
  → BUSINESS.md active projects line

Found company-level facts (name, what we do, policies)?
  → BUSINESS.md directly

Found nothing clearly business-relevant?
  → Tell the user: "This document doesn't contain obvious business facts to ingest.
    Would you like me to summarize it to a workspace file instead?"
```

---

## Safety Rules

- **Never delete existing entity files** — only append or create
- **Never overwrite non-empty BUSINESS.md sections** — only extend them
- **Never store credentials or passwords** found in documents — flag them: "Found what appears to be credentials in this document — not storing. Please add to vault manually."
- **Never ingest personal/private data about third parties** beyond what's needed for business context
- **Always tell the user exactly what was written** — no silent writes