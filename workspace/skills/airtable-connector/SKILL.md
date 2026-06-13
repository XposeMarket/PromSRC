---
name: airtable-connector
description: Use this skill when Prometheus needs to add, operate, or harden an Airtable connector for reading, searching, creating, updating, exporting, or schema-inspecting Airtable bases, tables, fields, and records. Triggers on phrases like Airtable connector, connect Airtable, Airtable records, Airtable base, Airtable table schema, export Airtable, create Airtable record, update Airtable record, and Airtable integration. Use it to design schema-aware, credential-safe Airtable tools with clear read/write boundaries.
emoji: "🧩"
version: 1.1.0
triggers: Airtable connector, connect Airtable, Airtable records, Airtable base, Airtable table schema, export Airtable, create Airtable record, update Airtable record, Airtable integration, Airtable API, Airtable fields, search Airtable
---


# Airtable Connector

Use this skill when Prometheus needs to read, search, create, update, or export Airtable records.

## Prometheus Fit

Airtable should be a REST connector with schema-aware tools. Prometheus needs field metadata before it can safely generate writes.

## Tool Scope

Start with:

- `airtable_list_bases`
- `airtable_list_tables`
- `airtable_get_schema`
- `airtable_search_records`
- `airtable_get_record`
- `airtable_create_record`
- `airtable_update_record`
- `airtable_export_table`

## Rules

- Fetch table schema before writing records.
- Validate field names and field types before create/update.
- Use Airtable pagination and return offsets/cursors.
- Store API credentials only through Connections/vault.
- Creating, updating, deleting, or bulk-changing records requires explicit confirmation.
- Treat formulas, linked records, attachments, and collaborators as typed fields, not strings.
- Return record IDs and Airtable URLs when possible.

## Implementation Route

1. Use `connector-builder` to scaffold a REST connector.
2. Add schema and read/search tools before writes.
3. Implement field validation in the connector layer.
4. Add CSV/JSON export to workspace artifacts for analysis flows.
5. Add mocked tests for pagination and field validation.

## Acceptance Check

Prometheus can inspect Airtable structure, query records, and propose writes without guessing field shapes.
