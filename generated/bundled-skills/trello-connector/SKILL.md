---
name: "trello-connector"
description: "Build or operate a Trello connector for boards, lists, cards, labels, comments, checklists, movement, and explicit Prometheus task links. Use when a request specifically concerns Trello integration or Trello card operations; do not invoke for generic task planning."
---

# Trello Connector

Use this skill when Prometheus needs Trello boards, lists, cards, labels, comments, or checklist workflows.

## Prometheus Fit

Trello should be a REST connector with board-aware typed tools. It is useful for lightweight task boards and should map cleanly to Prometheus task summaries without replacing Prometheus's own task state.

## Tool Scope

Start with:

- `trello_list_boards`
- `trello_list_lists`
- `trello_search_cards`
- `trello_get_card`
- `trello_create_card`
- `trello_update_card`
- `trello_move_card`
- `trello_add_comment`
- `trello_add_checklist_item`

## Rules

- Store keys/tokens only through Connections/vault.
- Creating, moving, archiving, deleting, commenting, or bulk-changing cards requires explicit confirmation.
- Return board/list/card IDs and URLs.
- Preserve card member, label, checklist, due date, and attachment metadata.
- Paginate and filter board/card searches.
- Do not silently mirror Prometheus tasks to Trello; cross-link only when requested.

## Implementation Route

1. Use `connector-builder` for a REST connector.
2. Add read/list/search tools first.
3. Add mutation tools with dry-run payload previews.
4. Add a small sync helper for linking Prometheus tasks to Trello cards.
5. Add mocked tests for create/move/comment behavior.

## Acceptance Check

Prometheus can use Trello as an external project surface while keeping local planning state explicit.
