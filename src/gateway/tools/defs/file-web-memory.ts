// src/gateway/tools/defs/file-web-memory.ts
// Tool definitions for file operations, web tools, and memory tools.

import { filterPublicBuildToolDefs } from '../../../runtime/distribution.js';

export function getFileWebMemoryTools(): any[] {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'workspace_read',
        description: 'Unified workspace read/inspection wrapper. Use grep/search to locate targets, stats for unfamiliar or large files, and capped reads only when exact context is needed. Tree/list/batch reads are budgeted by default; pass explicit max_* only when needed.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['tree', 'list', 'list_files', 'exists', 'stats', 'read', 'validate', 'batch_read', 'grep', 'search'], description: 'Read action to perform.' },
            path: { type: 'string', description: 'File or directory path relative to the workspace, or an allowed absolute path.' },
            file: { type: 'string', description: 'Alias for path when targeting one file.' },
            filename: { type: 'string', description: 'Alias for path when targeting one file.' },
            directory: { type: 'string', description: 'Alias for path when targeting a directory.' },
            paths: { type: 'array', items: { type: 'string' }, description: 'Paths for batch_read when files is not provided.' },
            files: {
              type: 'array',
              description: 'Entries for batch_read. Defaults are budgeted; each item can include filename/path plus optional start_line/num_lines/full.',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  path: { type: 'string' },
                  start_line: { type: 'number' },
                  num_lines: { type: 'number' },
                  full: { type: 'boolean' },
                },
              },
            },
            pattern: { type: 'string', description: 'Pattern for grep/search.' },
            glob: { type: 'string', description: 'Optional glob filter for tree/search.' },
            file_glob: { type: 'string', description: 'Optional file glob filter for search.' },
            start_line: { type: 'number' },
            around_line: { type: 'number', description: 'Read around this 1-based line. Uses before/after and avoids manual start_line math.' },
            line: { type: 'number', description: 'Return one exact physical line without normal truncation; use with column/char_window/full_line for minified or long-line debugging.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            char_before: { type: 'number', description: 'For grep/search: characters before each match in the returned match-local window.' },
            char_after: { type: 'number', description: 'For grep/search: characters after each match in the returned match-local window.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            before: { type: 'number', description: 'Lines before around_line or grep suggested reads. Default 40.' },
            after: { type: 'number', description: 'Lines after around_line or grep suggested reads. Default 80.' },
            num_lines: { type: 'number' },
            max_lines: { type: 'number' },
            full: { type: 'boolean' },
            max_files: { type: 'number', description: 'For batch_read. Default 2, hard cap 8.' },
            max_lines_per_file: { type: 'number', description: 'For batch_read. Default 80, hard cap 240 unless full:true is used intentionally.' },
            content: { type: 'boolean', description: 'For batch_read. false/omitted returns summaries unless exact line windows are provided; true returns capped content.' },
            mode: { type: 'string', enum: ['summary', 'content'], description: 'For batch_read. summary returns metadata/read hints; content returns capped content.' },
            inline: { type: 'boolean', description: 'Allow large results to remain inline instead of being saved to a temp artifact. Use sparingly.' },
            max_depth: { type: 'number', description: 'For tree/list. Default tree depth 2; list depth 1.' },
            max_entries: { type: 'number', description: 'For tree/list. Default tree entries 180; list entries 250.' },
            max_results: { type: 'number' },
            context_lines: { type: 'number' },
            context: { type: 'number' },
            regex: { type: 'boolean', description: 'Opt into regex search. Grep/search default to literal matching.' },
            literal: { type: 'boolean', description: 'Force literal search even if regex-looking characters are present.' },
            case_insensitive: { type: 'boolean' },
            query: { type: 'string', description: 'For stats/batch summaries, include likely relevant matches and suggested read windows.' },
            exclude: { type: 'string' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles in search. Default false.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget. Default depends on action; overflow is saved as an artifact.' },
            hard_max_result_tokens: { type: 'number', description: 'Hard result budget cap for max_result_tokens. Default 4000.' },
            map: { type: 'boolean', description: 'For tree/list. Include compact repo-map header. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_edit',
        description: 'Unified workspace mutation wrapper. Use this for create/write/surgical edits, deletes, mkdir, copy/move, patchsets, or unified patches. For large apps/games/pages, create a small runnable scaffold first, verify it exists, then add features incrementally with patchset/insert_after/replace_lines instead of trying one huge write. If exact file+old text/line range is already known, edit directly; tools verify targets and return post-edit context. Native file tools remain the expected route for workspace edits.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['create', 'write', 'find_replace', 'replace_lines', 'insert_after', 'delete_lines', 'delete_file', 'mkdir', 'move', 'copy', 'move_directory', 'copy_directory', 'patchset', 'preview_patch', 'apply_patch'], description: 'Mutation action to perform.' },
            path: { type: 'string', description: 'Target file or directory path.' },
            file: { type: 'string', description: 'Alias for path when targeting one file.' },
            filename: { type: 'string', description: 'Alias for path when targeting one file.' },
            source: { type: 'string', description: 'Source path for copy/move actions.' },
            destination: { type: 'string', description: 'Destination path for copy/move actions.' },
            content: { type: 'string', description: 'Content for create/write/insert_after. For large generated files, prefer an initial scaffold plus follow-up patchset edits.' },
            find: { type: 'string', description: 'Exact text to find for find_replace.' },
            replace: { type: 'string', description: 'Replacement text for find_replace.' },
            replace_all: { type: 'boolean' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            new_content: { type: 'string', description: 'Replacement content for replace_lines.' },
            after_line: { type: 'number' },
            edits: { type: 'array', items: { type: 'object' }, description: 'Patchset edit list.' },
            patch: { type: 'string', description: 'Unified diff text for preview_patch/apply_patch.' },
            check: { type: 'boolean', description: 'Validate only for apply_patch.' },
            overwrite: { type: 'boolean' },
            create_dirs: { type: 'boolean' },
            dry_run: { type: 'boolean' },
            max_entries: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_run',
        description: 'Unified terminal command/process/check wrapper. Use run for bounded commands, start for supervised processes, status/log/wait/kill/submit for runIds, and test/lint/format/typecheck for project checks. Default permissions ask before outside-workspace paths; Lite permissions allow full-computer terminal access except hard-blocked dangerous commands.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['run', 'start', 'status', 'log', 'wait', 'kill', 'submit', 'test', 'lint', 'format', 'typecheck', 'telemetry', 'benchmark_summary'], description: 'Command/process/check/telemetry action.' },
            command: { type: 'string', description: 'Command to run, or explicit check command.' },
            cwd: { type: 'string', description: 'Working directory relative to the workspace, or an absolute computer path. Outside-workspace paths require approval in default permissions and run directly in Lite permissions.' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] },
            elevated: { type: 'boolean', description: 'Windows only. Run this bounded command through the administrator broker. Always requires a fresh one-shot user approval; Lite mode, goals, and saved permissions cannot bypass it. Broker installation may require UAC once; later commands do not. Not supported with action=start.' },
            pty: { type: 'boolean' },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds for run/check actions.' },
            timeoutMs: { type: 'number', description: 'Legacy camelCase timeout alias.' },
            noOutputTimeoutMs: { type: 'number' },
            title: { type: 'string' },
            stdin: { type: 'boolean' },
            runId: { type: 'string', description: 'Process run id for status/log/wait/kill/submit.' },
            process_id: { type: 'string', description: 'Alias for runId.' },
            limit: { type: 'number' },
            max_chars: { type: 'number', description: 'Alias for maxChars.' },
            maxChars: { type: 'number' },
            data: { type: 'string', description: 'Text to submit to stdin.' },
            health_url: { type: 'string', description: 'Optional HTTP URL to probe during status.' },
            health_timeout_ms: { type: 'number' },
            port: { type: 'number', description: 'Optional local service port; status probes localhost and reports the listening PID.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_git',
        description: 'Unified git wrapper for status, diff, log, branch, commit, push, and PR creation. Mutating/networked actions remain policy-gated by the existing git/command handlers.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['status', 'diff', 'log', 'branch', 'commit', 'push', 'open_pr'], description: 'Git action.' },
            cwd: { type: 'string' },
            path: { type: 'string' },
            paths: { type: 'array', items: { type: 'string' } },
            staged: { type: 'boolean' },
            stat: { type: 'boolean' },
            max_chars: { type: 'number' },
            limit: { type: 'number' },
            branch: { type: 'string' },
            start_point: { type: 'string' },
            message: { type: 'string' },
            all: { type: 'boolean' },
            remote: { type: 'string' },
            set_upstream: { type: 'boolean' },
            title: { type: 'string' },
            body: { type: 'string' },
            base: { type: 'string' },
            draft: { type: 'boolean' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_safety',
        description: 'Unified recovery and risk-check wrapper for snapshots/restores/reverts, secret and large-file scans, operation plans, and patch previews.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['snapshot', 'restore', 'revert_last', 'scan_secrets', 'scan_large_files', 'operation_plan', 'preview_patch'], description: 'Safety action.' },
            path: { type: 'string' },
            snapshot_id: { type: 'string' },
            confirm: { type: 'boolean' },
            dry_run: { type: 'boolean' },
            label: { type: 'string' },
            max_files: { type: 'number' },
            max_bytes: { type: 'number' },
            min_bytes: { type: 'number' },
            max_results: { type: 'number' },
            operations: { type: 'array', items: { type: 'object' } },
            patch: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'workspace_code_nav',
        description: 'Unified code navigation wrapper for JS/TS outlines, symbol search, definition lookup, and reference search.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['outline', 'symbols', 'definition', 'references'], description: 'Code navigation action.' },
            file: { type: 'string' },
            path: { type: 'string' },
            query: { type: 'string' },
            symbol: { type: 'string' },
            max_symbols: { type: 'number' },
            max_results: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files in a directory (flat). Defaults to the workspace root, and also accepts absolute paths that are in Settings > Security > allowed paths. Use list_directory for folders plus recursion.',
	        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root, or an absolute path inside the configured allowed paths. Default: workspace root.' },
            directory: { type: 'string', description: 'Alias for path.' },
          },
          required: [],
        },
	      },
	    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a capped, line-numbered window from a file. Defaults to the first 240 lines to control context usage. Use start_line + num_lines for specific ranges. Use full:true only when the whole file is truly needed. Use file_stats first for unfamiliar/large files; skip reads when exact old text or line range is already known.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to read' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1)' },
            around_line: { type: 'number', description: 'Read around this 1-based line instead of calculating start_line manually.' },
            line: { type: 'number', description: 'Return one exact physical line without normal truncation; use with column/char_window/full_line for minified or long-line debugging.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            before: { type: 'number', description: 'Lines before around_line. Default 40.' },
            after: { type: 'number', description: 'Lines after around_line. Default 80.' },
            num_lines: { type: 'number', description: 'Number of lines to return. Default cap is 240 unless max_lines is lower/higher.' },
            max_lines: { type: 'number', description: 'Maximum lines to return unless full:true is set. Default 240, max 480.' },
            full: { type: 'boolean', description: 'Explicitly allow a full/large read. Use only when necessary.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_stats',
        description: 'Get metadata for a workspace file: line count, byte size, last modified, long/minified physical-line hints, and recommended reads. Use this before read_file on unknown files to decide whether to read chunks or exact character windows.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to stat' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_file',
        description: 'Search a single workspace file for a regex or literal pattern. Returns every match with line/column, match-local character windows for long/minified lines, and suggested exact read_file calls. Use this instead of read_file when locating specific content.',
        parameters: {
          type: 'object', required: ['filename', 'pattern'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to search' },
            pattern: { type: 'string', description: 'Literal pattern by default. Set regex:true for regex syntax.' },
            regex: { type: 'boolean', description: 'Opt into regex search. Default false/literal.' },
            literal: { type: 'boolean', description: 'Force literal search. Default true unless regex:true.' },
            context: { type: 'number', description: 'Lines of context around each match (default 0, max 10)' },
            context_lines: { type: 'number', description: 'Alias for context.' },
            before: { type: 'number', description: 'Suggested read window lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested read window lines after a match. Default 80.' },
            char_window: { type: 'number', description: 'Character window around each match for long/minified physical lines.' },
            char_before: { type: 'number', description: 'Characters before each match in the returned match-local window.' },
            char_after: { type: 'number', description: 'Characters after each match in the returned match-local window.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
            max_results: { type: 'number', description: 'Max matches to return (default 50, hard cap 80)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Multi-file grep across a workspace directory. Returns line/column matches with match-local character windows for long/minified lines. Use this to find all callers of a function before changing it, or locate where a config key is used across the workspace.',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            directory: { type: 'string', description: 'Directory to search (default: workspace root)' },
            pattern: { type: 'string', description: 'Literal pattern by default. Set regex:true for regex syntax.' },
            file_glob: { type: 'string', description: 'Comma-separated file globs to limit search, e.g. "*.md,*.ts" (default: all files)' },
            context_lines: { type: 'number', description: 'Lines of context around each match (default 0, hard cap 3)' },
            regex: { type: 'boolean', description: 'Opt into regex search. Default false/literal.' },
            literal: { type: 'boolean', description: 'Force literal search. Default true unless regex:true.' },
            before: { type: 'number', description: 'Suggested read window lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested read window lines after a match. Default 80.' },
            char_window: { type: 'number', description: 'Character window around each match for long/minified physical lines.' },
            char_before: { type: 'number', description: 'Characters before each match in the returned match-local window.' },
            char_after: { type: 'number', description: 'Characters after each match in the returned match-local window.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles. Default false.' },
            exclude: { type: 'string', description: 'Comma-separated names to exclude in addition to defaults.' },
            max_file_bytes: { type: 'number', description: 'Maximum size of each file searched. Default 5 MiB, hard cap 25 MiB. Larger files are reported as skipped; narrow to a file and use file_stats/read_file instead of broadly scanning giant indexes/logs.' },
            max_results: { type: 'number', description: 'Max total matches to return (default 50, hard cap 80). Narrow directory/glob/pattern instead of requesting huge result sets.' },
            max_files: { type: 'number', description: 'Maximum files visited. Default 5000, hard cap 25000.' },
            timeout_ms: { type: 'number', description: 'Wall-clock search budget. Default 10000ms, hard cap 30000ms. Partial observed results are returned when reached.' },
            max_depth: { type: 'number', description: 'Maximum directory depth. Default 24, hard cap 64.' },
            path_only: { type: 'boolean', description: 'Match the pattern against file paths without reading file contents. Use for locating a filename such as chat.router.ts.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a NEW file with content. Only use for files that do NOT exist yet. This can create a minimal runnable scaffold; for large apps/games/pages, verify the scaffold with file_stats/read_file, then add systems incrementally with insert_after/replace_lines/patchset instead of one oversized tool call.',
        parameters: {
          type: 'object', required: ['filename', 'content'],
          properties: {
            filename: { type: 'string', description: 'Name of the new file' },
            content: { type: 'string', description: 'Initial file content. For large builds, start with a small working scaffold and patch in features step by step.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'replace_lines',
        description: 'Replace specific lines in an existing file. Use read_file first only when line numbers are not already known; result includes post-edit context.',
        parameters: {
          type: 'object', required: ['filename', 'start_line', 'end_line', 'new_content'],
          properties: {
            filename: { type: 'string' },
            start_line: { type: 'number', description: 'First line to replace (1-based)' },
            end_line: { type: 'number', description: 'Last line to replace (1-based, inclusive)' },
            new_content: { type: 'string', description: 'New content to insert' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'insert_after',
        description: 'Insert new lines after a specific line number. Use 0 to insert at beginning.',
        parameters: {
          type: 'object', required: ['filename', 'after_line', 'content'],
          properties: {
            filename: { type: 'string' },
            after_line: { type: 'number', description: 'Line number to insert after (0 = beginning)' },
            content: { type: 'string', description: 'Content to insert' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_lines',
        description: 'Delete specific lines from a file.',
        parameters: {
          type: 'object', required: ['filename', 'start_line', 'end_line'],
          properties: {
            filename: { type: 'string' },
            start_line: { type: 'number', description: 'First line to delete (1-based)' },
            end_line: { type: 'number', description: 'Last line to delete (1-based, inclusive)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_replace',
        description: 'Find exact text in a file and replace it. Good for surgical text changes.',
        parameters: {
          type: 'object', required: ['filename', 'find', 'replace'],
          properties: {
            filename: { type: 'string' },
            find: { type: 'string', description: 'Exact text to find' },
            replace: { type: 'string', description: 'Text to replace with' },
            replace_all: { type: 'boolean', description: 'If true, replace all occurrences. Default: false (first occurrence only).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the workspace.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: { filename: { type: 'string' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write full content to a workspace file, creating it if it does not exist or overwriting it if it does. Use this for full-file rewrites or an initial scaffold. For large apps/games/pages, prefer scaffold first, verify, then incremental patchset/insert_after/replace_lines edits. For surgical edits to existing files use find_replace or replace_lines instead.',
        parameters: {
          type: 'object', required: ['filename', 'content'],
          properties: {
            filename: { type: 'string', description: 'Path relative to workspace root' },
            content: { type: 'string', description: 'Full file content to write' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rename_file',
        description: 'Rename or move a workspace file. Both old and new paths are relative to the workspace root. Creates any missing parent directories for the new path.',
        parameters: {
          type: 'object', required: ['old_path', 'new_path'],
          properties: {
            old_path: { type: 'string', description: 'Current file path relative to workspace root' },
            new_path: { type: 'string', description: 'New file path relative to workspace root' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'mkdir',
        description: 'Create a directory (and any missing parent directories) in the workspace. Use this before creating files in nested paths like src/app/ or src/lib/supabase/.',
        parameters: {
          type: 'object', required: ['path'],
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root, e.g. "src/app" or "src/lib/supabase"' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_files_batch',
        description: 'Read multiple files cheaply. Summary-first by default: entries without start_line/num_lines return metadata/read hints, not content. For content, pass exact line windows or content:true. Defaults to first 80 lines per content file and first 2 files. Large combined output is saved to a temp artifact unless inline:true is set. Use full:true only when truly needed. Also accepts src/... and web-ui/... paths.',

        parameters: {
          type: 'object', required: ['files'],
          properties: {
            files: {
              type: 'array',
              description: 'Files to read. Each item needs filename; add start_line/num_lines for a windowed read.',
              items: {
                type: 'object',
                required: ['filename'],
                properties: {
                  filename: { type: 'string', description: 'Workspace-relative file path.' },
                  start_line: { type: 'number', description: '1-based start line for windowed read.' },
                  num_lines: { type: 'number', description: 'Number of lines to return from start_line.' },
                  full: { type: 'boolean', description: 'Explicitly allow full read for this file. Use only when necessary.' },
                },
              },
            },
            max_files: { type: 'number', description: 'Maximum files to read in this call. Default 2, max 8.' },
            max_lines_per_file: { type: 'number', description: 'Default per-file content line cap. Default 80, max 240.' },
            query: { type: 'string', description: 'Optional query used in summary mode to include likely matching lines and suggested read windows.' },
            content: { type: 'boolean', description: 'Return capped content for entries without explicit line windows. Default false/summary-only.' },
            mode: { type: 'string', enum: ['summary', 'content'], description: 'summary returns metadata/read hints; content returns capped content.' },
            inline: { type: 'boolean', description: 'Keep large combined output inline instead of saving it to a temp artifact. Use sparingly.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_workspace_patchset',
        description: 'Apply multiple file edits to workspace files in one atomic call. Supports find_replace, replace_lines, insert_after, delete_lines, write_file, and create_file ops. Returns per-edit results with success/error per entry. Use instead of repeated find_replace/replace_lines calls when editing multiple files or applying multiple hunks.',
        parameters: {
          type: 'object', required: ['edits'],
          properties: {
            edits: {
              type: 'array',
              description: 'List of edits to apply in order.',
              items: {
                type: 'object',
                required: ['filename', 'op'],
                properties: {
                  filename: { type: 'string', description: 'Workspace-relative file path.' },
                  op: { type: 'string', enum: ['find_replace', 'replace_lines', 'insert_after', 'delete_lines', 'write_file', 'create_file', 'rename_file'], description: 'Edit operation.' },
                  find: { type: 'string', description: 'For find_replace: exact text to find.' },
                  replace: { type: 'string', description: 'For find_replace: replacement text.' },
                  replace_all: { type: 'boolean', description: 'For find_replace: replace all occurrences. Default false.' },
                  start_line: { type: 'number', description: 'For replace_lines/delete_lines: first line (1-based).' },
                  end_line: { type: 'number', description: 'For replace_lines/delete_lines: last line (1-based, inclusive).' },
                  new_content: { type: 'string', description: 'For replace_lines: replacement content.' },
                  after_line: { type: 'number', description: 'For insert_after: insert after this line (0 = beginning).' },
                  content: { type: 'string', description: 'For insert_after/write_file/create_file: content to insert or write.' },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_tree',
        description: 'Return a compact, budgeted indented tree of files and folders under a path. Cleaner and cheaper than list_directory for orientation. Defaults to depth 2 and 180 entries, supports depth/entry control and glob filtering. Also accepts src/... and web-ui/... paths to tree Prometheus source directories.',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Root path relative to workspace root. Default: workspace root.' },
            max_depth: { type: 'number', description: 'Max recursion depth. Default 2, max 8.' },
            max_entries: { type: 'number', description: 'Max entries returned. Default 180, max 1000.' },
            glob: { type: 'string', description: 'Optional comma-separated file globs to filter output, e.g. "*.ts,*.js". Folders always shown if they contain matches.' },
            exclude: { type: 'string', description: 'Comma-separated folder/file names to exclude. Defaults include node_modules, .git, dist, build, generated, temp, logs.' },
            map: { type: 'boolean', description: 'Include compact repo-map header with top dirs and entrypoints. Default true.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and folders under a path in the workspace. Use "." or "" for the workspace root. More detailed than list_files and usually more verbose than file_tree; defaults are capped for context cost.',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Default: workspace root.' },
            max_depth: { type: 'number', description: 'Optional recursion depth. Default: 1.' },
            max_entries: { type: 'number', description: 'Optional maximum entries. Default: 250, max: 1000.' },
            map: { type: 'boolean', description: 'Include compact repo-map header with top dirs and entrypoints. Default true.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
          },
        },
      },
    },
    // ── Source code reading (read-only, src/ only) ───────────────────────────
    {
      type: 'function',
      function: {
        name: 'dev_source_read',
        description: 'Unified Prometheus dev source read wrapper. Use under prometheus_source_read to inspect src/, web-ui/, and allowlisted prom-root files with list/stats/read/batch_read/grep/search actions. Prefer stats/grep/search before reading; batch_read is budgeted by default. Read-only.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['list', 'stats', 'stats_batch', 'read', 'validate', 'batch_read', 'grep', 'search'], description: 'Read action to perform.' },
            surface: { type: 'string', enum: ['src', 'web-ui', 'prom-root'], description: 'Target source surface. Defaults to src unless path starts with web-ui/ or prom-root/.' },
            root: { type: 'string', enum: ['src', 'web-ui', 'both', 'prom-root'], description: 'Search/list surface alias. For src grep, root can be both.' },
            file: { type: 'string', description: 'File path. Use src/... or web-ui/... prefixes when convenient.' },
            path: { type: 'string', description: 'File or directory path.' },
            directory: { type: 'string', description: 'Directory alias for list/grep.' },
            files: {
              type: 'array',
              description: 'Files for batch_read or stats_batch. Each item can include file/path plus read window fields.',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  path: { type: 'string' },
                  start_line: { type: 'number' },
                  num_lines: { type: 'number' },
                  head: { type: 'number' },
                  tail: { type: 'number' },
                  full: { type: 'boolean' },
                  around: { type: 'string' },
                  anchor: { type: 'string' },
                  regex: { type: 'boolean' },
                  context: { type: 'number' },
                },
              },
            },
            paths: { type: 'array', items: { type: 'string' }, description: 'String path list for batch_read.' },
            pattern: { type: 'string', description: 'Pattern for grep/search.' },
            glob: { type: 'string', description: 'Optional comma-separated file glob filter.' },
            case_insensitive: { type: 'boolean' },
            context: { type: 'number' },
            regex: { type: 'boolean', description: 'Opt into regex search. Grep/search default to literal matching.' },
            literal: { type: 'boolean', description: 'Force literal search.' },
            before: { type: 'number', description: 'Suggested/read-around lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested/read-around lines after a match. Default 80.' },
            around_line: { type: 'number', description: 'For read action, read around this line.' },
            line: { type: 'number', description: 'For read action, return one exact physical line without normal truncation.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            query: { type: 'string', description: 'For stats/batch summaries, include likely matching lines and suggested read windows.' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles in search. Default false.' },
            exclude: { type: 'string', description: 'Additional comma-separated search/tree excludes.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
            max_results: { type: 'number' },
            start_line: { type: 'number' },
            num_lines: { type: 'number' },
            max_lines: { type: 'number' },
            max_files: { type: 'number', description: 'For batch_read. Default 2, hard cap 8.' },
            max_lines_per_file: { type: 'number', description: 'For batch_read content mode. Default 80, hard cap 240.' },
            content: { type: 'boolean', description: 'For batch_read. false/omitted returns summaries unless exact line windows are provided; true returns capped content.' },
            mode: { type: 'string', enum: ['summary', 'content'], description: 'For batch_read. summary returns metadata/read hints; content returns capped content.' },
            inline: { type: 'boolean', description: 'Allow large results to remain inline instead of being saved to a temp artifact. Use sparingly.' },
            full: { type: 'boolean' },
            head: { type: 'number' },
            tail: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_file',
        description: 'Validate a workspace HTML/JS/TS file. For HTML, extracts inline <script> blocks and reports parse errors at original file line/column coordinates. Also emits warning-level risk checks for long-line JS smells such as optional params passed to setters, repeated src assignment in loops, flipY changes, and camera/yaw assignments.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: {
            filename: { type: 'string', description: 'Workspace file to validate.' },
            path: { type: 'string', description: 'Alias for filename.' },
            file: { type: 'string', description: 'Alias for filename.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_source_edit',
        description: 'Unified approved Prometheus dev source edit wrapper. Only available after request_dev_source_edit approval or an approved code_change proposal. Delegates to existing guarded src/web-ui handlers and prom_apply_dev_changes.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['patchset', 'find_replace', 'replace_lines', 'insert_after', 'delete_lines', 'write', 'create', 'delete_file', 'await_files', 'await_handoff', 'verify', 'verify_only', 'apply_live', 'apply'], description: 'Approved edit, overlapping-file handoff wait, verification, or apply-live readiness action.' },
            surface: { type: 'string', enum: ['src', 'web-ui'], description: 'Target source surface. Defaults to src unless path starts with web-ui/.' },
            file: { type: 'string', description: 'File path. Use src/... or web-ui/... prefixes when convenient.' },
            path: { type: 'string', description: 'Alias for file.' },
            edits: { type: 'array', items: { type: 'object' }, description: 'Patchset edits for action=patchset. Canonical fields are file, op, find, replace, content, and line coordinates. Common aliases are accepted: operation/action/type for op, old/before for find, and new/after/replacement for replace.' },
            find: { type: 'string' },
            replace: { type: 'string' },
            replace_all: { type: 'boolean' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            after_line: { type: 'number' },
            anchor: { type: 'string' },
            regex: { type: 'boolean' },
            occurrence: { type: 'number' },
            content: { type: 'string' },
            new_content: { type: 'string' },
            overwrite: { type: 'boolean' },
            expected_hash: { type: 'string' },
            expected_before: { type: 'string' },
            changed_surfaces: { type: 'array', items: { type: 'string', enum: ['backend', 'src', 'gateway', 'web-ui', 'mobile', 'config', 'static'] } },
            affected_files: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string', description: 'Required by apply_live/verify actions.' },
            dev_edit_id: { type: 'string' },
            completion_note_tag: { type: 'string' },
            verification_profile: { type: 'string', enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'] },
            verification_profiles: { type: 'array', items: { type: 'string', enum: ['backend_build', 'webui_sync_check', 'full_build', 'route_smoke', 'desktop_ui_smoke', 'mobile_ui_smoke', 'none'] } },
            refresh_desktop: { type: 'boolean' },
            test_instructions: { type: 'string' },
            timeout_seconds: { type: 'number', description: 'For await_files/await_handoff, maximum time to wait before returning the current queue state. Defaults to 900 seconds.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_source',
        description:
          'Read a file from the Prometheus src/ directory (TypeScript source code). READ-ONLY — never modifies files. ' +
          'Use this to understand the codebase before writing a proposal or making edits. ' +
          'Pass the path relative to src/, e.g. "gateway/server-v2.ts" or "gateway/tool-builder.ts". ' +
          'Defaults to a capped first window to control context usage. Use start_line+num_lines for arbitrary ranges, head/tail for first/last N lines, and full:true only when the whole file is truly needed.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts". Or a root file: package.json, tsconfig.json.' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            around_line: { type: 'number', description: 'Read around this 1-based line instead of calculating start_line manually.' },
            line: { type: 'number', description: 'Return one exact physical line without normal truncation; use with column/char_window/full_line for minified or long-line debugging.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            before: { type: 'number', description: 'Lines before around_line. Default 40.' },
            after: { type: 'number', description: 'Lines after around_line. Default 80.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Defaults to the cap when omitted.' },
            max_lines: { type: 'number', description: 'Maximum lines to return unless full:true is set. Default 180, max 480.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
            full: { type: 'boolean', description: 'Explicitly allow a full/large read. Use only when necessary.' },
            head: { type: 'number', description: 'Return only first N lines (shorthand for start_line:1, num_lines:N)' },
            tail: { type: 'number', description: 'Return only last N lines' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_dev_sources',
        description:
          'Read multiple Prometheus dev source files cheaply. Summary-first by default: entries without start_line/num_lines/head/tail return metadata/read hints, not content. ' +
          'For content, pass exact line windows or content:true. Defaults to first 80 lines per content file and first 2 files. Large combined output is saved to a temp artifact unless inline:true is set. Accepts src/..., web-ui/..., or src-relative paths, and supports line windows plus around/anchor matching. Use full:true per file only when truly needed.',
        parameters: {
          type: 'object', required: ['files'],
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string', description: 'src/..., web-ui/..., or path relative to src/.' },
                  path: { type: 'string' },
                  start_line: { type: 'number' },
                  num_lines: { type: 'number' },
                  head: { type: 'number' },
                  tail: { type: 'number' },
                  full: { type: 'boolean', description: 'Explicitly allow full read for this file. Use only when necessary.' },
                  around: { type: 'string' },
                  anchor: { type: 'string' },
                  regex: { type: 'boolean' },
                  context: { type: 'number' },
                },
              },
            },
            max_files: { type: 'number', description: 'Maximum files to read in this call. Default 2, max 8.' },
            max_lines_per_file: { type: 'number', description: 'Default per-file content line cap. Default 80, max 240.' },
            query: { type: 'string', description: 'Optional query used in summary mode to include likely matching lines and suggested read windows.' },
            content: { type: 'boolean', description: 'Return capped content for entries without explicit line windows. Default false/summary-only.' },
            mode: { type: 'string', enum: ['summary', 'content'], description: 'summary returns metadata/read hints; content returns capped content.' },
            inline: { type: 'boolean', description: 'Keep large combined output inline instead of saving it to a temp artifact. Use sparingly.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_source',
        description:
          'List files and directories inside the Prometheus src/ directory. ' +
          'Use with no arguments to see top-level src/ layout. ' +
          'Pass a subdirectory path to drill down, e.g. "gateway" or "gateway/proposals".',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Subdirectory path relative to src/. Leave empty for src/ root.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'source_stats',
        description:
          'Get metadata for a file in src/: line count, byte size, last modified, and whether chunked reads are recommended. ' +
          'Use this before read_source on unknown src/ files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts".' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_source',
        description:
          'Validate a Prometheus src/ HTML/JS/TS file. For HTML, extracts inline <script> blocks and reports parse errors at original file line/column coordinates. Also emits warning-level risk checks for optional params passed to setters, repeated src assignment in loops, flipY changes, and camera/yaw assignments.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts".' },
            path: { type: 'string', description: 'Alias for file.' },
            filename: { type: 'string', description: 'Alias for file.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'source_stats_batch',
        description:
          'Get metadata for multiple src/ or web-ui/ files in one call. Accepts an array of paths (src/... or web-ui/...) and returns line_count, last_modified, and is_large for each. Use before read_dev_sources when planning windowed reads across several files.',
        parameters: {
          type: 'object', required: ['files'],
          properties: {
            files: {
              type: 'array',
              description: 'Array of file paths. Each accepts src/... or web-ui/... prefix, or a bare src-relative path.',
              items: { type: 'string' },
            },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
            max_files: { type: 'number', description: 'Maximum files to inspect. Default 8.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'src_stats',
        description:
          'Alias for source_stats. Get metadata for a file in src/ before reading large files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts".' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_webui_source',
        description:
          'List files and directories inside the Prometheus web-ui/ directory (frontend source). ' +
          'Use with no arguments to see top-level web-ui/ layout. ' +
          'Pass a subdirectory path to drill down, e.g. "src" or "src/pages".',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Subdirectory path relative to web-ui/. Leave empty for web-ui/ root.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'webui_source_stats',
        description:
          'Get metadata for a file in web-ui/: line count, byte size, last modified, and whether chunked reads are recommended. ' +
          'Use this before read_webui_source on unknown web-ui files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/ChatPage.js".' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_webui_source',
        description:
          'Validate a Prometheus web-ui/ HTML/JS/TS file. For HTML, extracts inline <script> blocks and reports parse errors at original file line/column coordinates. Also emits warning-level risk checks for optional params passed to setters, repeated src assignment in loops, flipY changes, and camera/yaw assignments.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/ChatPage.js".' },
            path: { type: 'string', description: 'Alias for file.' },
            filename: { type: 'string', description: 'Alias for file.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'webui_stats',
        description:
          'Alias for webui_source_stats. Get metadata for a file in web-ui/ before reading large files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/ChatPage.js".' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_webui_source',
        description:
          'Read a file from the Prometheus web-ui/ directory (frontend source code). READ-ONLY — never modifies files. ' +
          'Use this for deterministic frontend inspection before proposing edits. ' +
          'Pass the path relative to web-ui/, e.g. "src/pages/TeamsPage.js" or "package.json". ' +
          'Defaults to a capped first window to control context usage. Use start_line+num_lines for arbitrary ranges, head/tail for first/last N lines, and full:true only when the whole file is truly needed.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js".' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            around_line: { type: 'number', description: 'Read around this 1-based line instead of calculating start_line manually.' },
            line: { type: 'number', description: 'Return one exact physical line without normal truncation; use with column/char_window/full_line for minified or long-line debugging.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            before: { type: 'number', description: 'Lines before around_line. Default 40.' },
            after: { type: 'number', description: 'Lines after around_line. Default 80.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Defaults to the cap when omitted.' },
            max_lines: { type: 'number', description: 'Maximum lines to return unless full:true is set. Default 180, max 480.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
            full: { type: 'boolean', description: 'Explicitly allow a full/large read. Use only when necessary.' },
            head: { type: 'number', description: 'Return only first N lines' },
            tail: { type: 'number', description: 'Return only last N lines' },
          },
        },
      },
    },
    // ── Source code search ────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'grep_source',
        description:
          'Search file contents across Prometheus source code using a regex or literal pattern. ' +
          'Returns matching lines with file paths and line numbers (like rg -n). ' +
          'Searches src/ by default; set root:"web-ui" to search frontend, or root:"both" to search everywhere. ' +
          'Use this to find function definitions, variable usages, imports, or any text across the codebase. ' +
          'Example: grep_source({pattern:"previousSessionId"}) or grep_source({pattern:"handleChat", root:"both"}).',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Literal string by default. Set regex:true for regex syntax.' },
            root: { type: 'string', description: 'Which source tree to search: "src" (default), "web-ui", or "both".' },
            path: { type: 'string', description: 'Subdirectory to limit search within the chosen root, e.g. "gateway/routes". Ignored when root is "both".' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.ts" or "*.js,*.jsx". Default: all files.' },
            regex: { type: 'boolean', description: 'Opt into regex search. Default false/literal.' },
            literal: { type: 'boolean', description: 'Force literal search. Default true unless regex:true.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0, hard cap 3.' },
            before: { type: 'number', description: 'Suggested read window lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested read window lines after a match. Default 80.' },
            exclude: { type: 'string', description: 'Additional comma-separated names to exclude.' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles. Default false.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 50, hard cap 80. Narrow root/path/glob/pattern instead of requesting huge result sets.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_webui_source',
        description:
          'Alias for grep_source with root:"web-ui". Search file contents inside the Prometheus web-ui/ directory. ' +
          'Returns matching lines with file paths and line numbers. ' +
          'Prefer grep_source({..., root:"web-ui"}) or grep_source({..., root:"both"}) to search across both src and web-ui in one call.',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Literal string by default. Set regex:true for regex syntax.' },
            path: { type: 'string', description: 'Subdirectory of web-ui/ to limit search, e.g. "src" or "src/pages". Default: all of web-ui/.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.js,*.jsx,*.css". Default: all files.' },
            regex: { type: 'boolean', description: 'Opt into regex search. Default false/literal.' },
            literal: { type: 'boolean', description: 'Force literal search. Default true unless regex:true.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0, hard cap 3.' },
            before: { type: 'number', description: 'Suggested read window lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested read window lines after a match. Default 80.' },
            exclude: { type: 'string', description: 'Additional comma-separated names to exclude.' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles. Default false.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 50, hard cap 80.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_prom',
        description:
          'List allowlisted files and directories inside the real Prometheus project root. READ-ONLY — internal/dev inspection only. ' +
          'Use this to inspect launcher/bootstrap surfaces such as scripts/, electron/, build/, dist/, .prometheus/, src/, web-ui/, and selected root markdown/json files. ' +
          'This tool is intended for dev sessions and is hidden in public/Electron builds.',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Allowlisted prom-root path to list. Leave empty for the allowlisted project root view.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prom_file_stats',
        description:
          'Get metadata for an allowlisted file in the real Prometheus project root. READ-ONLY — internal/dev inspection only. ' +
          'Returns line count, byte size, last modified, and a read hint for read_prom_file. Hidden in public/Electron builds.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Allowlisted prom-root file path, e.g. "scripts/dev-server.ts". SELF.md is a workspace-root file; use read_file("SELF.md").' },
            query: { type: 'string', description: 'Optional query to include likely matching lines and recommended reads.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_prom_file',
        description:
          'Validate an allowlisted Prometheus project-root HTML/JS/TS file. READ-ONLY and hidden in public/Electron builds. For HTML, extracts inline <script> blocks and reports parse errors at original file line/column coordinates. Also emits warning-level risk checks for optional params passed to setters, repeated src assignment in loops, flipY changes, and camera/yaw assignments.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Allowlisted prom-root file path, e.g. "scripts/dev-server.ts".' },
            path: { type: 'string', description: 'Alias for file.' },
            filename: { type: 'string', description: 'Alias for file.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_prom_file',
        description:
          'Read an allowlisted file from the real Prometheus project root. READ-ONLY — internal/dev inspection only. ' +
          'Use this for launcher/bootstrap/debug surfaces outside src/ and web-ui/, such as scripts/, electron/, build/, dist/, or .prometheus/. SELF.md and AGENTS.md are workspace-root files; use read_file for them. ' +
          'Defaults to a capped first window to control context usage. Supports start_line+num_lines plus head/tail, full:true for intentional full reads, and returns a directory listing when the target is a directory. Hidden in public/Electron builds.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Allowlisted prom-root path, e.g. "scripts". SELF.md is a workspace-root file; use read_file("SELF.md").' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            around_line: { type: 'number', description: 'Read around this 1-based line instead of calculating start_line manually.' },
            line: { type: 'number', description: 'Return one exact physical line without normal truncation; use with column/char_window/full_line for minified or long-line debugging.' },
            line_number: { type: 'number', description: 'Alias for line.' },
            column: { type: 'number', description: 'Optional 1-based column marker for exact physical-line reads.' },
            char_window: { type: 'number', description: 'Character window around column for exact physical-line reads. Default 240.' },
            full_line: { type: 'boolean', description: 'Return the full physical line for exact line reads. Use sparingly on very long lines.' },
            show_full_line: { type: 'boolean', description: 'Alias for full_line.' },
            before: { type: 'number', description: 'Lines before around_line. Default 40.' },
            after: { type: 'number', description: 'Lines after around_line. Default 80.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Defaults to the cap when omitted.' },
            max_lines: { type: 'number', description: 'Maximum lines to return unless full:true is set. Default 180, max 480.' },
            max_result_tokens: { type: 'number', description: 'Soft inline result budget; overflow is saved as an artifact.' },
            full: { type: 'boolean', description: 'Explicitly allow a full/large read. Use only when necessary.' },
            head: { type: 'number', description: 'Return only first N lines.' },
            tail: { type: 'number', description: 'Return only last N lines.' },
          },
        },
      },
    },
	    {
	      type: 'function',
	      function: {
	        name: 'grep_prom',
        description:
          'Search file contents across allowlisted Prometheus project-root surfaces using a regex or literal pattern. READ-ONLY — internal/dev inspection only. ' +
          'Returns matching lines with file paths and line numbers, constrained to the prom-root allowlist. Hidden in public/Electron builds.',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Literal string by default. Set regex:true for regex syntax.' },
            path: { type: 'string', description: 'Allowlisted prom-root directory to search within. Leave empty to search the allowlisted prom-root surface.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.ts,*.md". Default: all files.' },
            regex: { type: 'boolean', description: 'Opt into regex search. Default false/literal.' },
            literal: { type: 'boolean', description: 'Force literal search. Default true unless regex:true.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0, hard cap 3.' },
            before: { type: 'number', description: 'Suggested read window lines before a match. Default 40.' },
            after: { type: 'number', description: 'Suggested read window lines after a match. Default 80.' },
            exclude: { type: 'string', description: 'Additional comma-separated names to exclude.' },
            include_lockfiles: { type: 'boolean', description: 'Include lockfiles. Default false.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 50, hard cap 80.' },
          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'find_replace_prom',
	        description:
	          'Find exact text in an allowlisted Prometheus project-root file and replace it. ' +
	          'Only available in proposal execution sessions. Use read_prom_file first to confirm exact text. ' +
	          'Use this for dev-only root surfaces outside plain src/ and web-ui/ when a proposal must edit scripts/, electron/, build/, dist/, .prometheus/, or selected root files.',
	        parameters: {
	          type: 'object', required: ['file', 'find', 'replace'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path, e.g. "scripts/dev-server.ts" or "AGENTS.md".' },
	            find: { type: 'string', description: 'Exact text to find, including whitespace and newlines.' },
	            replace: { type: 'string', description: 'Replacement text.' },
	            replace_all: { type: 'boolean', description: 'If true, replace all occurrences. Default: false.' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'replace_lines_prom',
	        description:
	          'Replace specific line numbers in an allowlisted Prometheus project-root file. ' +
	          'Only available in proposal execution sessions. Use read_prom_file first to see line numbers.',
	        parameters: {
	          type: 'object', required: ['file', 'start_line', 'end_line', 'new_content'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path.' },
	            start_line: { type: 'number', description: 'First line to replace (1-based).' },
	            end_line: { type: 'number', description: 'Last line to replace (1-based, inclusive).' },
	            new_content: { type: 'string', description: 'New content to insert in place of those lines.' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'insert_after_prom',
	        description:
	          'Insert new lines after a specific line number in an allowlisted Prometheus project-root file. Use 0 to insert at beginning. ' +
	          'Only available in proposal execution sessions.',
	        parameters: {
	          type: 'object', required: ['file', 'after_line', 'content'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path.' },
	            after_line: { type: 'number', description: 'Line number to insert after (0 = beginning).' },
	            content: { type: 'string', description: 'Content to insert.' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'delete_lines_prom',
	        description:
	          'Delete specific lines from an allowlisted Prometheus project-root file. ' +
	          'Only available in proposal execution sessions. Use read_prom_file first to see line numbers.',
	        parameters: {
	          type: 'object', required: ['file', 'start_line', 'end_line'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path.' },
	            start_line: { type: 'number', description: 'First line to delete (1-based).' },
	            end_line: { type: 'number', description: 'Last line to delete (1-based, inclusive).' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'write_prom_file',
	        description:
	          'Create or overwrite an allowlisted Prometheus project-root file. ' +
	          'Only available in proposal execution sessions. Prefer surgical tools for existing files unless a full rewrite or new file is intentional.',
	        parameters: {
	          type: 'object', required: ['file', 'content'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path.' },
	            content: { type: 'string', description: 'Full file content to write.' },
	            overwrite: { type: 'boolean', description: 'If true, overwrite existing file content. Default: true.' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'delete_prom_file',
	        description:
	          'Delete an allowlisted Prometheus project-root file. Only available in proposal execution sessions. ' +
	          'Use list_prom/read_prom_file first to verify the exact file.',
	        parameters: {
	          type: 'object', required: ['file'],
	          properties: {
	            file: { type: 'string', description: 'Allowlisted prom-root file path.' },
	          },
	        },
	      },
	    },

	    {
	      type: 'function',
	      function: {
        name: 'grep_files',
        description:
          'DEPRECATED — use search_files instead (same capability, cleaner interface). ' +
          'Multi-file search across the workspace directory using a regex or literal pattern. ' +
          'Returns matching lines with file paths and line numbers.',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Regex or literal string to search for.' },
            path: { type: 'string', description: 'Subdirectory of workspace to limit search. Default: workspace root.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.md" or "*.json". Default: all files.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match. Default: 0, hard cap 3.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 50, hard cap 80.' },
            max_files: { type: 'number', description: 'Maximum files visited. Default 5000, hard cap 25000.' },
            timeout_ms: { type: 'number', description: 'Wall-clock search budget. Default 10000ms, hard cap 30000ms.' },
            max_depth: { type: 'number', description: 'Maximum directory depth. Default 24, hard cap 64.' },
            path_only: { type: 'boolean', description: 'Match file paths only without reading contents.' },
          },
        },
      },
    },
    // ── Source code editing (write access to src/, proposal sessions only) ────
    {
      type: 'function',
      function: {
        name: 'find_replace_source',
        description:
          'Find exact text in a src/ file and replace it. The surgical edit tool for source code changes. ' +
          'Prefer this over line-number edits when possible. If the exact text came from grep/search/user input, edit directly; otherwise read a narrow window first. ' +
          'Edits that would make TypeScript/JavaScript syntax invalid are rejected before writing. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to src/, e.g. "gateway/terminal-ui.ts".',
        parameters: {
          type: 'object', required: ['file', 'find', 'replace'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/terminal-ui.ts"' },
            find: { type: 'string', description: 'Exact text to find (must match the file exactly, including whitespace and newlines)' },
            replace: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'If true, replace all occurrences. Default: false (first occurrence only).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_dev_source_patchset',
        description:
          'Apply multiple approved Prometheus dev-source edits in one guarded patchset. Prefer this after request_dev_source_edit approval. ' +
          'It validates every edit before writing, syntax-parses changed JS/TS, returns slim telemetry and touched files, and does not repeat the full post-edit workflow after each tiny edit.',
        parameters: {
          type: 'object', required: ['edits'],
          properties: {
            edits: {
              type: 'array',
              items: {
                type: 'object',
                required: ['file', 'op'],
                properties: {
                  file: { type: 'string', description: 'src/..., web-ui/..., or path relative to src/.' },
                  path: { type: 'string' },
                  op: { type: 'string', enum: ['exact_replace', 'find_replace', 'delete_exact', 'line_replace', 'replace_lines', 'insert_after_line', 'insert_after', 'insert_after_anchor', 'delete_lines', 'write_file', 'full_file_write', 'create_file'] },
                  find: { type: 'string' },
                  replace: { type: 'string' },
                  replace_all: { type: 'boolean' },
                  start_line: { type: 'number' },
                  end_line: { type: 'number' },
                  after_line: { type: 'number' },
                  anchor: { type: 'string' },
                  regex: { type: 'boolean' },
                  occurrence: { type: 'number' },
                  content: { type: 'string' },
                  new_content: { type: 'string' },
                  expected_hash: { type: 'string', description: 'Optional sha256 prefix guard for the pre-edit file content.' },
                  expected_before: { type: 'string', description: 'Optional text guard that must be present before editing.' },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'replace_lines_source',
        description:
          'Replace specific line numbers in a src/ file. Fragile after insertions/deletions; prefer find_replace_source or write_source when possible. Use read_source first only when current line numbers are not already known. ' +
          'Edits that would make TypeScript/JavaScript syntax invalid are rejected before writing. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to src/, e.g. "gateway/terminal-ui.ts".',
        parameters: {
          type: 'object', required: ['file', 'start_line', 'end_line', 'new_content'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/terminal-ui.ts"' },
            start_line: { type: 'number', description: 'First line to replace (1-based)' },
            end_line: { type: 'number', description: 'Last line to replace (1-based, inclusive)' },
            new_content: { type: 'string', description: 'New content to insert in place of those lines' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'insert_after_source',
        description:
          'Insert new lines after a specific line number in a src/ file. Fragile after insertions/deletions; prefer find_replace_source with an exact anchor when possible. Use read_source first only when current line numbers are not already known. Use 0 to insert at beginning. ' +
          'Edits that would make TypeScript/JavaScript syntax invalid are rejected before writing. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to src/, e.g. "gateway/terminal-ui.ts".',
        parameters: {
          type: 'object', required: ['file', 'after_line', 'content'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/terminal-ui.ts"' },
            after_line: { type: 'number', description: 'Line number to insert after (0 = beginning)' },
            content: { type: 'string', description: 'Content to insert' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_lines_source',
        description:
          'Delete specific lines from a src/ file. Fragile after insertions/deletions; prefer find_replace_source with an exact removable block when possible. Use read_source first only when current line numbers are not already known. ' +
          'Edits that would make TypeScript/JavaScript syntax invalid are rejected before writing. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to src/, e.g. "gateway/terminal-ui.ts".',
        parameters: {
          type: 'object', required: ['file', 'start_line', 'end_line'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/terminal-ui.ts"' },
            start_line: { type: 'number', description: 'First line to delete (1-based)' },
            end_line: { type: 'number', description: 'Last line to delete (1-based, inclusive)' },
          },
        },
      },
    },
	    {
	      type: 'function',
	      function: {
	        name: 'write_source',
        description:
          'Create or overwrite a file in src/ directly. Use for deterministic full-file writes, including creating new src files. ' +
          'For complex TypeScript edits, this can be safer than repeated line surgery after you have read the full file. Syntax-invalid TypeScript/JavaScript is rejected before writing. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to src/, e.g. "gateway/new-file.ts".',
        parameters: {
          type: 'object', required: ['file', 'content'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/new-file.ts"' },
            content: { type: 'string', description: 'Full file content to write' },
            overwrite: { type: 'boolean', description: 'If true, overwrite existing file content. Default: true.' },
          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'delete_source',
	        description:
	          'Delete a file from src/ directly. Only available in proposal execution sessions. ' +
	          'Use list_source/read_source first when the exact file is uncertain.',
	        parameters: {
	          type: 'object', required: ['file'],
	          properties: {
	            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/old-file.ts"' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'find_replace_webui_source',
        description:
          'Find exact text in a web-ui/ file and replace it. The surgical edit tool for frontend source changes. ' +
          'If exact text came from grep/search/user input, edit directly; otherwise call read_webui_source first to confirm exact text. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to web-ui/, e.g. "src/pages/TeamsPage.js".',
        parameters: {
          type: 'object', required: ['file', 'find', 'replace'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js"' },
            find: { type: 'string', description: 'Exact text to find (must match the file exactly, including whitespace and newlines)' },
            replace: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'If true, replace all occurrences. Default: false (first occurrence only).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'replace_lines_webui_source',
        description:
          'Replace specific line numbers in a web-ui/ file. Use read_webui_source first only when line numbers are not already known. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to web-ui/, e.g. "src/pages/TeamsPage.js".',
        parameters: {
          type: 'object', required: ['file', 'start_line', 'end_line', 'new_content'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js"' },
            start_line: { type: 'number', description: 'First line to replace (1-based)' },
            end_line: { type: 'number', description: 'Last line to replace (1-based, inclusive)' },
            new_content: { type: 'string', description: 'New content to insert in place of those lines' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'insert_after_webui_source',
        description:
          'Insert new lines after a specific line number in a web-ui/ file. Use 0 to insert at beginning. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to web-ui/, e.g. "src/pages/TeamsPage.js".',
        parameters: {
          type: 'object', required: ['file', 'after_line', 'content'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js"' },
            after_line: { type: 'number', description: 'Line number to insert after (0 = beginning)' },
            content: { type: 'string', description: 'Content to insert' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_lines_webui_source',
        description:
          'Delete specific lines from a web-ui/ file. Use read_webui_source first only when line numbers are not already known. ' +
          'Only available in proposal execution sessions. ' +
          'Pass the path relative to web-ui/, e.g. "src/pages/TeamsPage.js".',
        parameters: {
          type: 'object', required: ['file', 'start_line', 'end_line'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js"' },
            start_line: { type: 'number', description: 'First line to delete (1-based)' },
            end_line: { type: 'number', description: 'Last line to delete (1-based, inclusive)' },
          },
        },
      },
    },
	    {
	      type: 'function',
	      function: {
	        name: 'write_webui_source',
	        description:
	          'Create or overwrite a file in web-ui/ directly. Use for deterministic full-file writes, including creating new frontend files. ' +
	          'Only available in proposal execution sessions. ' +
	          'Pass the path relative to web-ui/, e.g. "src/pages/NewPage.js".',
	        parameters: {
	          type: 'object', required: ['file', 'content'],
	          properties: {
	            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/NewPage.js"' },
	            content: { type: 'string', description: 'Full file content to write' },
	            overwrite: { type: 'boolean', description: 'If true, overwrite existing file content. Default: true.' },
	          },
	        },
	      },
	    },
	    {
	      type: 'function',
	      function: {
	        name: 'delete_webui_source',
	        description:
	          'Delete a file from web-ui/ directly. Only available in proposal execution sessions. ' +
	          'Use list_webui_source/read_webui_source first to verify the exact file.',
	        parameters: {
	          type: 'object', required: ['file'],
	          properties: {
	            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/OldPage.js"' },
	          },
	        },
	      },
	    },
    {
      type: 'function',
      function: {
        name: 'shopping_search_products',
        description: 'Fast product search for shopping/product carousel requests using existing web_search providers plus short metadata/image fetches. No shopping API keys required. Use this FIRST when the user asks for products, shopping comparisons, prices, ratings, or a product carousel; use browser tools only if this result is missing details or needs visual verification.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Product search query, e.g. "cordless stick vacuum under $300".' },
            merchant: { type: 'string', description: 'Optional store/domain such as Amazon, Walmart, Target, Best Buy, ebay.com.' },
            max_results: { type: 'number', description: 'Number of product cards to return. Default 8, max 12.' },
            provider: { type: 'string', enum: ['multi', 'tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'], description: 'Optional provider selector. Default multi.' },
            include_metadata: { type: 'boolean', description: 'Default true. Briefly fetch top result pages for Open Graph images/titles/prices without browser automation.' },
            include_images: { type: 'boolean', description: 'Default true. Briefly downloads discovered product images to downloads/product-carousel and sets imagePath for stable carousel rendering.' },
            metadata_timeout_ms: { type: 'number', description: 'Per-page metadata timeout in ms. Default 1800, max 5000.' },
            image_timeout_ms: { type: 'number', description: 'Per-image download timeout in ms. Default 1600, max 4000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current information. Provider thumbnails/publisher/date fields are preserved when available. Defaults to multi-engine search across all configured providers, including xAI X Search when xAI credentials are present. Use provider to force one engine, provider:"multi" to force all configured engines, or multi_engine:false for preferred-provider-only search. fetch_top_k also fetches pages and merges preview metadata/images back into results.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'Maximum results to return per provider. Default 5, max 10.' },
            multi_engine: { type: 'boolean', description: 'Default true. When true, queries every configured credentialed provider. Set false to use only the preferred search provider from Settings.' },
            provider: { type: 'string', enum: ['multi', 'tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'], description: 'Optional engine selector. Use multi for every configured engine, or a provider name for a true single-provider search.' },
            fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
            fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
            provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search_single',
        description: 'Search using one provider only. Defaults to the preferred provider from Settings. Use provider to override for testing or provider-specific checks.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'Maximum results to return. Default 5, max 10.' },
            provider: { type: 'string', enum: ['tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'], description: 'Optional provider override. Omit to use Settings preferred provider.' },
            fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
            fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
            provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search_multi',
        description: 'Search using every configured credentialed provider in parallel, then merge deduplicated results.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'Maximum results to return per provider. Default 5, max 10.' },
            fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
            fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
            provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch the full text content and structured page preview metadata (title, description, publisher, date, hero image, icon) for one webpage URL, or multiple URLs in parallel when urls is provided. Use this AFTER web_search to read actual page content instead of snippets. Exact X/Twitter statuses use official X oEmbed; thread expansion is opt-in with include_thread=true and attached-media analysis is opt-in with include_media=true.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Single full URL to fetch (from web_search results or any URL)' },
            urls: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 20,
              description: 'Optional multiple full URLs to fetch in parallel. Use instead of url for batch evidence gathering.',
            },
            max_chars: { type: 'number', description: 'Single fetch max characters, or max characters per URL for urls. Default 10000 single / 6000 batch.' },
            concurrency: { type: 'number', description: 'Batch-only parallel fetch count. Default 4, max 8.' },
            include_media: { type: 'boolean', description: 'X status URLs only. Default false. Download and analyze attached media only when explicitly requested.' },
            include_thread: { type: 'boolean', description: 'X status URLs only. Default false. Use browser extraction to expand the surrounding thread.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch_batch',
        description: 'Fetch full text content from multiple webpage URLs in parallel. Use after web_search when several result URLs need full-page evidence. Returns one result per URL and preserves partial failures.',
        parameters: {
          type: 'object',
          required: ['urls'],
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Full URLs to fetch. Duplicate and blank URLs are ignored. Max 20.',
            },
            max_chars: { type: 'number', description: 'Max characters per URL. Default 6000, max 25000.' },
            concurrency: { type: 'number', description: 'Parallel fetches. Default 4, max 8.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_diff',
        description: 'Show git diff for the workspace or a specific file/path. Use before summarizing edits.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional file or directory path to diff.' },
            staged: { type: 'boolean', description: 'If true, show staged diff. Default false.' },
            stat: { type: 'boolean', description: 'If true, show diffstat instead of full patch.' },
            max_chars: { type: 'number', description: 'Maximum characters to return. Default 12000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'preview_patch',
        description: 'Validate a unified diff patch against workspace files without applying it.',
        parameters: { type: 'object', required: ['patch'], properties: { patch: { type: 'string', description: 'Unified diff patch text.' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'apply_patch',
        description: 'Apply a unified diff patch to workspace files after validating target paths.',
        parameters: {
          type: 'object', required: ['patch'],
          properties: {
            patch: { type: 'string', description: 'Unified diff patch text.' },
            check: { type: 'boolean', description: 'If true, validate only and do not apply.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'format_changed_files',
        description: 'Run the project formatter for changed files when a formatter script or prettier is available.',
        parameters: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'Optional package.json script name to run. Defaults to format if present.' },
            check_only: { type: 'boolean', description: 'Run a formatter check when supported instead of writing changes.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'revert_last_tool_change',
        description: 'Restore files from the most recent snapshot_workspace snapshot. Requires confirm=true.',
        parameters: {
          type: 'object',
          properties: {
            snapshot_id: { type: 'string', description: 'Optional snapshot id. Defaults to latest.' },
            confirm: { type: 'boolean', description: 'Must be true to restore files.' },
            dry_run: { type: 'boolean', description: 'Preview files that would be restored.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'revert_own_patch',
        description: 'Alias for revert_last_tool_change. Restore files from a snapshot_workspace snapshot. Requires confirm=true.',
        parameters: {
          type: 'object',
          properties: {
            snapshot_id: { type: 'string', description: 'Optional snapshot id. Defaults to latest.' },
            confirm: { type: 'boolean', description: 'Must be true to restore files.' },
            dry_run: { type: 'boolean', description: 'Preview files that would be restored.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Return concise local git status for the workspace or a subdirectory.',
        parameters: { type: 'object', properties: { cwd: { type: 'string', description: 'Optional working directory inside the workspace.' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Return local git diff. Supports staged/full/stat options.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional pathspec to diff.' },
            staged: { type: 'boolean', description: 'Show staged diff.' },
            stat: { type: 'boolean', description: 'Show diffstat.' },
            max_chars: { type: 'number', description: 'Maximum characters to return. Default 12000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_log',
        description: 'Return recent local git commits.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of commits. Default 10, max 50.' },
            path: { type: 'string', description: 'Optional pathspec.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_branch',
        description: 'List, create, or switch local git branches. Mutating actions are policy-gated.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'list, create, or switch. Default list.' },
            branch: { type: 'string', description: 'Branch name for create/switch.' },
            start_point: { type: 'string', description: 'Optional start point for create.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_commit',
        description: 'Create a local git commit. Requires message. Use all=true to stage all changed files first.',
        parameters: {
          type: 'object', required: ['message'],
          properties: {
            message: { type: 'string', description: 'Commit message.' },
            all: { type: 'boolean', description: 'Stage all modified/deleted files before committing.' },
            paths: { type: 'array', items: { type: 'string' }, description: 'Optional paths to stage before committing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_push',
        description: 'Push the current or specified branch to a remote. Mutating and networked.',
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Remote name. Default origin.' },
            branch: { type: 'string', description: 'Branch name. Defaults to current branch.' },
            set_upstream: { type: 'boolean', description: 'Add --set-upstream.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_pr',
        description: 'Open a pull request using GitHub CLI if available. Requires a pushed branch.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'PR title.' },
            body: { type: 'string', description: 'PR body.' },
            base: { type: 'string', description: 'Base branch.' },
            draft: { type: 'boolean', description: 'Create as draft PR.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_tests',
        description: 'Run the project test script or a provided test command.',
        parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_linter',
        description: 'Run the project lint script or an explicit lint command.',
        parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_formatter',
        description: 'Run the project formatter script or an explicit format command.',
        parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_typecheck',
        description: 'Run the project typecheck script, build:backend, or tsc --noEmit fallback.',
        parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_dev_server',
        description: 'Start a long-running dev server process and return a process id for read_process_output/stop_process.',
        parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, name: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stop_process',
        description: 'Stop a process started by start_dev_server.',
        parameters: { type: 'object', required: ['process_id'], properties: { process_id: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_process_output',
        description: 'Read buffered stdout/stderr from a process started by start_dev_server.',
        parameters: { type: 'object', required: ['process_id'], properties: { process_id: { type: 'string' }, max_chars: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'snapshot_workspace',
        description: 'Create a bounded file snapshot of the current workspace for later restore_snapshot/revert_last_tool_change.',
        parameters: { type: 'object', properties: { label: { type: 'string' }, max_files: { type: 'number' }, max_bytes: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'restore_snapshot',
        description: 'Restore files from a snapshot_workspace snapshot. Requires confirm=true.',
        parameters: { type: 'object', properties: { snapshot_id: { type: 'string' }, confirm: { type: 'boolean' }, dry_run: { type: 'boolean' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scan_secrets',
        description: 'Scan workspace files for likely secrets/tokens using conservative regexes.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, max_results: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scan_large_files',
        description: 'Find large files in the workspace that may be unsafe to commit or process.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, min_bytes: { type: 'number' }, max_results: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'operation_plan',
        description: 'Create a structured dry-run plan for file/git operations. Does not mutate anything.',
        parameters: { type: 'object', properties: { operations: { type: 'array', items: { type: 'object' } } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'code_outline',
        description: 'Return a TypeScript/JavaScript AST outline for a file: imports, exports, classes, functions, methods, and constants with line numbers.',
        parameters: { type: 'object', required: ['file'], properties: { file: { type: 'string' }, max_symbols: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_symbols',
        description: 'Search TypeScript/JavaScript symbols by name across the workspace.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'go_to_definition',
        description: 'Find likely definition locations for a TypeScript/JavaScript symbol.',
        parameters: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_references',
        description: 'Find references to a symbol across workspace code with file and line numbers.',
        parameters: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'copy_file',
        description: 'Copy one workspace file to another path. Refuses to overwrite unless overwrite=true.',
        parameters: {
          type: 'object', required: ['source', 'destination'],
          properties: {
            source: { type: 'string', description: 'Source file path relative to workspace root, or absolute path inside allowed paths.' },
            destination: { type: 'string', description: 'Destination file path relative to workspace root, or absolute path inside allowed paths.' },
            overwrite: { type: 'boolean', description: 'Allow replacing an existing destination file. Default false.' },
            create_dirs: { type: 'boolean', description: 'Create missing parent directories. Default true.' },
            dry_run: { type: 'boolean', description: 'Preview the operation without copying.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_file',
        description: 'Move or rename one workspace file. Refuses to overwrite unless overwrite=true.',
        parameters: {
          type: 'object', required: ['source', 'destination'],
          properties: {
            source: { type: 'string', description: 'Source file path relative to workspace root, or absolute path inside allowed paths.' },
            destination: { type: 'string', description: 'Destination file path relative to workspace root, or absolute path inside allowed paths.' },
            overwrite: { type: 'boolean', description: 'Allow replacing an existing destination file. Default false.' },
            create_dirs: { type: 'boolean', description: 'Create missing parent directories. Default true.' },
            dry_run: { type: 'boolean', description: 'Preview the operation without moving.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'copy_directory',
        description: 'Recursively copy a workspace directory. Refuses to overwrite existing destination contents unless overwrite=true.',
        parameters: {
          type: 'object', required: ['source', 'destination'],
          properties: {
            source: { type: 'string', description: 'Source directory path relative to workspace root, or absolute path inside allowed paths.' },
            destination: { type: 'string', description: 'Destination directory path relative to workspace root, or absolute path inside allowed paths.' },
            overwrite: { type: 'boolean', description: 'Allow replacing existing destination files. Default false.' },
            dry_run: { type: 'boolean', description: 'Preview affected file counts without copying.' },
            max_entries: { type: 'number', description: 'Safety cap for recursive copy. Default 2000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_directory',
        description: 'Move or rename a workspace directory. Refuses to overwrite unless overwrite=true.',
        parameters: {
          type: 'object', required: ['source', 'destination'],
          properties: {
            source: { type: 'string', description: 'Source directory path relative to workspace root, or absolute path inside allowed paths.' },
            destination: { type: 'string', description: 'Destination directory path relative to workspace root, or absolute path inside allowed paths.' },
            overwrite: { type: 'boolean', description: 'Allow replacing an existing destination directory. Default false.' },
            dry_run: { type: 'boolean', description: 'Preview affected file counts without moving.' },
            max_entries: { type: 'number', description: 'Safety cap for recursive move. Default 2000.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'path_exists',
        description: 'Check whether a workspace path exists and return basic type/stat metadata when it does.',
        parameters: {
          type: 'object', required: ['path'],
          properties: {
            path: { type: 'string', description: 'Path relative to workspace root, or absolute path inside allowed paths.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'download_url',
        description: 'Download a single URL directly into the workspace. Use this for direct image URLs, article assets, PDFs, and normal file links. GitHub blob URLs (github.com/owner/repo/blob/ref/path) are auto-rewritten to the raw file. For a whole git repo or multiple files from a repo, use clone_repo instead. Saves to downloads/ by default.',
        parameters: {
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', description: 'Direct URL to download' },
            filename: { type: 'string', description: 'Optional output filename override' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: downloads' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'clone_repo',
        description: 'Clone a git repository into the workspace, or pull only specific files/dirs from it. Use this FIRST whenever the user gives you a git/GitHub repo (URL or owner/repo) and wants you to download, inspect, or analyze it — do NOT fall back to fetching individual web URLs and re-typing file contents. Defaults to a shallow clone (depth 1) into repos/<name> inside the workspace. Pass paths:[...] to sparse-checkout just those files/dirs (e.g. ["src/index.ts","README.md"]). After cloning, use list_directory/read_file/search_files on the cloned path to analyze it.',
        parameters: {
          type: 'object', required: ['repo'],
          properties: {
            repo: { type: 'string', description: 'Repo URL (https or ssh) or owner/repo shorthand, e.g. "vercel/next.js" or "https://github.com/vercel/next.js".' },
            dest: { type: 'string', description: 'Optional workspace-relative destination directory. Default: repos/<repo-name>.' },
            ref: { type: 'string', description: 'Optional branch, tag, or commit to check out. A ref embedded in a github tree/blob URL is auto-detected.' },
            depth: { type: 'number', description: 'Clone depth. Default 1 (shallow). Use 0 for full history.' },
            paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of files/dirs to fetch via sparse checkout instead of the whole repo, e.g. ["src/app","package.json"].' },
            overwrite: { type: 'boolean', description: 'Replace an existing non-empty destination. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'download_media',
        description: 'Download media from a supported page URL using yt-dlp. Use for X videos, YouTube videos, Instagram posts/reels, TikTok videos, and similar media pages. Saves to downloads/media by default.',
        parameters: {
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', description: 'Page URL containing the media item' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: downloads/media' },
            audio_only: { type: 'boolean', description: 'If true, extract audio only' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'media_generate',
        description: 'Unified AI media generation wrapper. Use action="image" for one-shot raster images and action="video" for one-shot MP4 generation. Existing generate_image/generate_video remain executable compatibility aliases.',
        parameters: {
          type: 'object',
          required: ['action', 'prompt'],
          properties: {
            action: { type: 'string', enum: ['image', 'video'], description: 'Media kind to generate.' },
            prompt: { type: 'string', description: 'Text prompt describing the image or video to generate.' },
            reference_images: { type: 'array', items: { type: 'string' }, maxItems: 16, description: 'Optional reference images as local/workspace file paths, HTTPS URLs, or data URLs.' },
            image: { type: 'string', description: 'Optional source image path, URL, or data URL for image-to-video.' },
            video: { type: 'string', description: 'Optional source video path, URL, or data URL for video edit/extend modes.' },
            mode: { type: 'string', enum: ['generate', 'edit', 'extend'], description: 'Video request mode. Defaults to generate, or edit when video is provided.' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired media aspect ratio.' },
            count: { type: 'integer', minimum: 1, maximum: 4, description: 'Image only: how many separate image outputs to generate.' },
            duration: { type: 'integer', minimum: 1, maximum: 15, description: 'Video only: duration in seconds.' },
            resolution: { type: 'string', enum: ['480p', '720p'], description: 'Video only: output resolution.' },
            provider: { type: 'string', enum: ['auto', 'openai', 'openai_codex', 'xai'], description: 'Optional provider override. Image supports OpenAI/OpenAI Codex/xAI; video currently supports xAI.' },
            model: { type: 'string', description: 'Optional image or video model override.' },
            background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Image only: background mode. Use transparent for real alpha.' },
            output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image only: output format.' },
            quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Image only: generation quality.' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory.' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep generated media only in Prometheus cache.' },
            poll_interval_ms: { type: 'integer', minimum: 1000, maximum: 30000, description: 'Video only: polling interval in milliseconds.' },
            timeout_ms: { type: 'integer', minimum: 30000, maximum: 1800000, description: 'Video only: generation timeout in milliseconds.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate one or more raster images from a text prompt using the configured AI image provider such as OpenAI GPT image models or xAI Grok Imagine. Use background="transparent" and output_format="png" for true alpha transparency; do not rely only on prompt wording. For separate options/variations, set count > 1 and ask for separate standalone images, not a collage. Use count=1 only when the user wants one image or explicitly wants a single collage/grid/contact sheet. Saves to generated/images by default.',
        parameters: {
          type: 'object', required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Text prompt describing the image(s) to generate. For count > 1, say each output must be a separate standalone image and must not be a collage, grid, contact sheet, split-screen, or multi-panel image.' },
            reference_images: { type: 'array', items: { type: 'string' }, maxItems: 16, description: 'Optional reference images as local/workspace file paths, HTTPS URLs, or data URLs. These are sent as actual image inputs for supported reference/edit generation.' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired image aspect ratio' },
            count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many separate image outputs to generate at once. Use values greater than 1 for options, variations, sets, or several standalone images; do not use count > 1 for a single collage/grid image.' },
            provider: { type: 'string', enum: ['auto', 'openai', 'openai_codex', 'xai'], description: 'Optional image provider override. openai may use either direct OpenAI API credentials or saved OpenAI OAuth/Codex auth; use xai for Grok Imagine.' },
            model: { type: 'string', description: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality' },
            background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background mode. Use transparent for real alpha; Prometheus also infers this when the prompt asks for a transparent/no background sprite or cutout.' },
            output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Output file format. Use png or webp for transparency; png is forced if background is transparent and jpeg was requested.' },
            quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Image generation quality.' },
            output_dir: { type: 'string', description: 'Optional workspace-relative parent output directory. Each generation run is saved in a new child folder. Default: generated/images' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_video',
        description: 'Generate a short raster video using a configured AI video provider such as xAI Grok Imagine Video. Use this for one-shot text-to-video, image-to-video, reference-to-video, video editing, or video extension when the user wants an AI-generated MP4 rather than an editable timeline project. Saves to generated/videos by default.',
        parameters: {
          type: 'object', required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Text prompt describing the video to generate, edit, or extend' },
            image: { type: 'string', description: 'Optional source image path, URL, or data URL for image-to-video' },
            reference_images: { type: 'array', items: { type: 'string' }, maxItems: 7, description: 'Optional reference images as local/workspace paths, HTTPS URLs, or data URLs for reference-to-video' },
            video: { type: 'string', description: 'Optional source video path, URL, or data URL for edit/extend modes' },
            mode: { type: 'string', enum: ['generate', 'edit', 'extend'], description: 'Video request mode. Defaults to generate, or edit when video is provided.' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired video aspect ratio' },
            duration: { type: 'integer', minimum: 1, maximum: 15, description: 'Video duration in seconds. xAI supports 1-15 for generation, max 10 for reference/extension.' },
            resolution: { type: 'string', enum: ['480p', '720p'], description: 'Video resolution' },
            provider: { type: 'string', enum: ['auto', 'xai'], description: 'Optional video provider override. Use xai for Grok Imagine Video.' },
            model: { type: 'string', description: 'Optional video model override, e.g. grok-imagine-video' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: generated/videos' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep the video only in Prometheus cache' },
            poll_interval_ms: { type: 'integer', minimum: 1000, maximum: 30000, description: 'Optional polling interval in milliseconds' },
            timeout_ms: { type: 'integer', minimum: 30000, maximum: 1800000, description: 'Optional generation timeout in milliseconds' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_image',
        description: 'Analyze a local image file and describe what is visible using the active vision-capable model. Use this after downloading or generating an image when you want Prometheus to actually inspect it.',
        parameters: {
          type: 'object', required: ['file_path'],
          properties: {
            file_path: { type: 'string', description: 'Workspace-relative or absolute path to the image file' },
            prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_video',
        description: 'Analyze a local video with Python/FFmpeg. Use analysis_mode="quick" for a contact-sheet overview, "detail" for budgeted chronological frame batches, or "both" when the user needs both broad and detailed review.',
        parameters: {
          type: 'object', required: ['file_path'],
          properties: {
            file_path: { type: 'string', description: 'Workspace-relative or absolute path to the video file' },
            prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
            analysis_mode: { type: 'string', enum: ['quick', 'detail', 'both'], description: 'quick creates one overview contact sheet; detail creates duration-aware chronological batches; both does both. Default quick.' },
            sample_count: { type: 'number', description: 'Backward-compatible quick sample count (default 6, max 24)' },
            quick_sample_count: { type: 'number', description: 'Frames for the quick contact sheet (default 16, max 24)' },
            detail_frame_budget: { type: 'number', description: 'Optional detail frame budget across the full duration. Choose a sane value based on video length; do not request every frame for long clips.' },
            max_detail_frames: { type: 'number', description: 'Hard cap for automatic detail extraction when detail_frame_budget is omitted (default 42, max 72)' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory for extracted artifacts' },
            extract_audio: { type: 'boolean', description: 'If true, extract audio when ffmpeg is available (default true)' },
            transcribe: { type: 'boolean', description: 'If true, use the configured speech-to-text provider when audio is available (default true)' },
            include_raw_probe: { type: 'boolean', description: 'If true, include full ffprobe JSON. Default false keeps model-facing output compact.' },
          },
        },
      },
    },
    // ── Memory Tools ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'memory_write',
        description: 'Write a durable fact under a category. In main Prometheus this can target USER.md, SOUL.md, or MEMORY.md. In a distinct manager/agent runtime only file="memory" is allowed and resolves to that actor’s private MEMORY.md; it never falls back to main memory.',
        parameters: {
          type: 'object',
          required: ['file', 'category', 'content'],
          properties: {
            file: { type: 'string', description: '"user" for USER.md, "soul" for SOUL.md, or "memory" for MEMORY.md' },
            category: { type: 'string', description: 'Category section name (e.g. "coding", "communication_style", "projects"). Use existing categories when possible.' },
            content: { type: 'string', description: 'The fact or update to write. Be specific and concise. Example: "Prefers vanilla JS over frameworks"' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_read',
        description: 'Read a markdown memory file. In a distinct manager/agent runtime only file="memory" is allowed and resolves to that actor’s private MEMORY.md.',
        parameters: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', description: '"user" for USER.md, "soul" for SOUL.md, or "memory" for MEMORY.md' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_browse',
        description: 'List the category sections currently in USER.md, SOUL.md, or MEMORY.md. Call this before memory_write to find the right category or decide to create a new one.',
        parameters: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', description: '"user" for USER.md, "soul" for SOUL.md, or "memory" for MEMORY.md' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_search',
          description: 'Search long-term memory with SQLite/FTS/vector hybrid retrieval when available, falling back to the JSON index. Results blend exact/FTS recall, operational records (canonical decisions, preferences, proposals, task_outcomes, project_facts), semantic vectors, recency, durability, authority, status/supersession, and evidence chunks. Hits include layer ("operational"|"evidence"), recordType, canonicalKey, whyMatched, and citation/source span fields. Use record_id from hits with memory_read_record to fetch full record.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Natural language query or exact ID (proposal ID, task UUID, canonical key like "proposal:prop_xxx" or "preference:root:memory:key_decisions").' },
            mode: { type: 'string', description: 'Search mode: quick (default), deep (broader, all candidates), project (project-scoped), or timeline (chronological evidence).' },
            limit: { type: 'number', description: 'Maximum hits to return (default 8, max 50).' },
            project_id: { type: 'string', description: 'Filter results to a specific project ID.' },
            date_from: { type: 'string', description: 'Lower date bound YYYY-MM-DD or ISO timestamp (evidence layer only).' },
            date_to: { type: 'string', description: 'Upper date bound YYYY-MM-DD or ISO timestamp (evidence layer only).' },
            source_types: { type: 'array', items: { type: 'string' }, description: 'Source type filter (skips operational layer when set). Types: chat_session, chat_transcript, chat_compaction, task_state, proposal_state, memory_root, memory_note, obsidian_note, project_state, etc.' },
            min_durability: { type: 'number', description: 'Minimum durability 0..1 (evidence layer only).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_read_record',
        description: 'Read a full memory record by record_id from memory_search. Resolves both operational records (opr_* IDs — canonical decisions/preferences/proposals/tasks/projects) and raw evidence records. Use this to get full body, sourceRefs, entities, and outcome fields.',
        parameters: {
          type: 'object',
          required: ['record_id'],
          properties: {
            record_id: { type: 'string', description: 'Record id from memory_search hit.recordId.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_search_project',
        description: 'Search long-term memory constrained to a project id.',
        parameters: {
          type: 'object',
          required: ['project_id', 'query'],
          properties: {
            project_id: { type: 'string', description: 'Project id to search within.' },
            query: { type: 'string', description: 'Project memory query.' },
            limit: { type: 'number', description: 'Maximum hits to return (default 10, max 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_search_timeline',
        description: 'Search long-term memory and return results in chronological order.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Timeline query.' },
            date_from: { type: 'string', description: 'Optional lower date bound, YYYY-MM-DD or ISO timestamp.' },
            date_to: { type: 'string', description: 'Optional upper date bound, YYYY-MM-DD or ISO timestamp.' },
            limit: { type: 'number', description: 'Maximum hits to return (default 20, max 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_get_related',
        description: 'Expand from one memory record to related records by project/day/source and lexical similarity.',
        parameters: {
          type: 'object',
          required: ['record_id'],
          properties: {
            record_id: { type: 'string', description: 'Record id from memory_search hit.recordId.' },
            limit: { type: 'number', description: 'Maximum related hits (default 8, max 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_graph_snapshot',
        description: 'Return graph-ready memory nodes/edges projected from the indexed memory relation layer.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_index_refresh',
        description: 'Force-refresh the memory index from workspace/audit immediately. Use for diagnostics or after major archive changes.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_provider_status',
        description: 'Show configured memory backends and their capabilities/status: sqlite-local, Obsidian adapter slot, external-vector adapter slot, and cloud-memory adapter slot.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_embedding_status',
        description: 'Show memory embedding provider preference, active provider, and availability for OpenAI, Ollama, LM Studio, Voyage, Jina, and hash fallback.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_embedding_backfill',
        description: 'Backfill stored memory embeddings with a real provider when available. Keeps hash vectors as fallback. Use after configuring OpenAI/Ollama/LM Studio/Voyage/Jina embedding credentials.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            provider: { type: 'string', description: 'Optional provider override: openai, ollama, lmstudio, voyage, jina, hash.' },
            limit: { type: 'number', description: 'Maximum records to backfill this run. Default 500.' },
            force: { type: 'boolean', description: 'Recompute even if a non-hash embedding already exists.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_debug_search',
        description: 'Run memory search with first-class diagnostics explaining why each hit appeared: FTS score, vector score, authority, recency, temporal decay, durability, status, source, and MMR score.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Memory search query.' },
            mode: { type: 'string', description: 'quick, deep, project, or timeline.' },
            limit: { type: 'number', description: 'Maximum hits. Default 12.' },
            project_id: { type: 'string', description: 'Optional project filter.' },
            rerank: { type: 'boolean', description: 'Set false to disable MMR reranking.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_consolidate',
        description: 'Extract durable memory claims from recent audit/session/task/project evidence. Produces reviewable claims; auto_accept only accepts high-confidence explicit user/correction claims.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            max_sources: { type: 'number', description: 'Maximum source files to scan. Default 120.' },
            max_claims: { type: 'number', description: 'Maximum proposed claims. Default 80.' },
            auto_accept: { type: 'boolean', description: 'Automatically accept only high-confidence explicit user facts/corrections.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_review_claims',
        description: 'List proposed/accepted/rejected/superseded curated memory claims for human or agent review.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            status: { type: 'string', description: 'Claim status to list. Default proposed.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_accept_claim',
        description: 'Accept a proposed memory claim and write it as durable indexed memory evidence.',
        parameters: {
          type: 'object',
          required: ['claim_id'],
          properties: {
            claim_id: { type: 'string', description: 'Claim id from memory_review_claims or memory_consolidate.' },
            note: { type: 'string', description: 'Optional review note.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_reject_claim',
        description: 'Reject a proposed memory claim so it is not promoted into durable memory.',
        parameters: {
          type: 'object',
          required: ['claim_id'],
          properties: {
            claim_id: { type: 'string', description: 'Claim id from memory_review_claims or memory_consolidate.' },
            note: { type: 'string', description: 'Optional review note.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_supersede_record',
        description: 'Mark a proposed/accepted curated memory claim as superseded. Use when newer evidence replaces an older claim.',
        parameters: {
          type: 'object',
          required: ['claim_id'],
          properties: {
            claim_id: { type: 'string', description: 'Claim id to supersede.' },
            note: { type: 'string', description: 'Optional supersession note.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_note',
        description:
          'Write a timestamped note to today\'s intraday notes file. ' +
          'Use this to preserve context between sessions: things discussed, decisions made, data gathered, tasks completed, or anything the agent should remember later. ' +
          'Call during main chat, background tasks, plans, or any session — this is a general-purpose session memory tool. ' +
          'Good triggers: file edited, task completed, significant decision, data gathered from browser/desktop, user shared project context, plan step completed. ' +
          'Skip for casual chat, greetings, simple questions, or turns where nothing actionable occurred. ' +
          'When write_note is the only action in a turn, call switch_model("low") first to keep it fast.',
        parameters: {
          type: 'object', required: ['content'],
          properties: {
            content: { type: 'string', description: 'Note content — what was done, decided, or discovered' },
            tag: { type: 'string', description: 'Optional tag: task, debug, discovery, or general' },
            task_id: { type: 'string', description: 'Optional task ID if related to a specific background task' },
            dev_edit_id: { type: 'string', description: 'Optional dev edit id. Use with tag "dev_edit_complete" after prom_apply_dev_changes restarts/reloads Prometheus.' },
            step: { type: 'string', description: 'Optional step label' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_site_shortcut',
        description: 'Save a keyboard shortcut for a website so Prometheus remembers it for all future sessions. Call this when you discover that a keyboard shortcut works on a site. Example: after pressing "n" successfully opens the X.com composer, save it.',
        parameters: {
          type: 'object', required: ['hostname', 'key', 'action'],
          properties: {
            hostname: { type: 'string', description: 'Domain name only, e.g. "x.com", "github.com"' },
            key: { type: 'string', description: 'The key or combination, e.g. "n", "Control+p", "g i"' },
            action: { type: 'string', description: 'What the shortcut does, e.g. "Open tweet composer modal"' },
            context: { type: 'string', description: 'Optional: which page this applies on, e.g. "any page", "feed only"' },
            preferred_for_compose: { type: 'boolean', description: 'True if this shortcut is the best way to start composing/creating content' },
            notes: { type: 'string', description: 'Optional notes about how to use this shortcut' },
          },
        },
      },
    },
  ];
  return filterPublicBuildToolDefs(tools);
}
