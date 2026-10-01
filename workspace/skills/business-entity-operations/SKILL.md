---
name: "business-entity-operations"
description: "Maintain structured business entity records and business context with provenance. Use for clients, projects, contacts, and dated entity events; not for personal memory governance (memory-governance-playbook)."
---

# Business Entity Operations

Use this for structured business records and BUSINESS.md context. Keep business facts separate from personal memory, temporary notes, and procedural skills.

## Route the information

Company-wide facts and operating rules belong in BUSINESS context. Clients, projects, vendors, contacts, or social accounts belong in the matching entity file. Dated activity belongs as an entity event. Personal preferences belong in user memory. Reusable procedure belongs in a skill candidate.

## Read before writing

List entities first, then read the exact canonical entity before replacing or appending. Use stable slugs and preserve existing fields, owner, status, last-updated, source, and confidence. Create an entity only when the record does not exist and identity is clear.

## Write conservatively

Write only high-confidence facts. Prefer append_entity_event for dated history instead of replacing a whole record. Include source and confidence. Do not store secrets, speculative claims, or sensitive personal data. Do not silently merge similarly named entities.

## Conflicts and verification

If evidence conflicts, preserve the conflict or correct the canonical field with dated provenance rather than appending a contradictory duplicate. Re-read after writing and verify the expected section, event, or field. Report created, updated, appended, skipped as uncertain, or blocked by ambiguity.
