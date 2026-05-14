# Prometheus Bridge for Obsidian

This is the Obsidian-side companion for the Prometheus Obsidian Bridge.

## Install for local testing

1. Copy this folder to:

   ```text
   <your-vault>/.obsidian/plugins/prometheus-bridge
   ```

2. In Obsidian, open Settings -> Community plugins.
3. Turn off Restricted mode if needed.
4. Enable "Prometheus Bridge".
5. Open the plugin settings and confirm the Prometheus gateway URL.
6. Click "Connect and sync".

## Memory promotion

Prometheus indexes all included markdown notes as `obsidian_note` evidence. A note becomes operational memory when it has one of these markers:

```yaml
---
prometheus-memory: true
prometheus-memory-type: decision
tags:
  - prometheus/memory
---
```

Supported `prometheus-memory-type` values map to Prometheus operational memory:

- `decision`
- `preference`
- `workflow_rule`
- `project_fact`
- `entity_fact`

Tags such as `#prometheus/decision`, `#prometheus/preference`, and `#prometheus/rule` also work.
