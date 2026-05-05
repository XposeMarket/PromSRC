// src/gateway/tools/defs/file-web-memory.ts
// Tool definitions for file operations, web tools, and memory tools.

import { filterPublicBuildToolDefs } from '../../../runtime/distribution.js';

export function getFileWebMemoryTools(): any[] {
  const tools = [
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
        description: 'Read a file and return its content WITH line numbers. Supports windowed reading for large files — use start_line + num_lines to read a specific range (e.g. start_line:200, num_lines:100 reads lines 200–300). Always use file_stats first on unknown files to check line count before reading. Always use this before editing a file.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to read' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1)' },
            num_lines: { type: 'number', description: 'Number of lines to return. Omit to read up to the retrieval mode cap. Example: start_line:200, num_lines:100 returns lines 200–300.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_stats',
        description: 'Get metadata for a workspace file: line count, byte size, last modified, and whether it exceeds the read cap. Use this before read_file on unknown files to decide whether to read all at once or in chunks with start_line/num_lines.',
        parameters: {
          type: 'object', required: ['filename'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to stat' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_file',
        description: 'Search a single workspace file for a regex or literal pattern. Returns matching lines with line numbers and optional surrounding context. Use this instead of read_file when you need to find specific content in a file.',
        parameters: {
          type: 'object', required: ['filename', 'pattern'],
          properties: {
            filename: { type: 'string', description: 'Name of the file to search' },
            pattern: { type: 'string', description: 'Regex or literal pattern to search for' },
            context: { type: 'number', description: 'Lines of context around each match (default 0, max 10)' },
            context_lines: { type: 'number', description: 'Alias for context.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
            max_results: { type: 'number', description: 'Max matches to return (default 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Multi-file grep across a workspace directory. Finds all files containing a pattern. Use this to find all callers of a function before changing it, or locate where a config key is used across the workspace.',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            directory: { type: 'string', description: 'Directory to search (default: workspace root)' },
            pattern: { type: 'string', description: 'Regex or literal pattern to search for' },
            file_glob: { type: 'string', description: 'Comma-separated file globs to limit search, e.g. "*.md,*.ts" (default: all files)' },
            context_lines: { type: 'number', description: 'Lines of context around each match (default 0, max 5)' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
            max_results: { type: 'number', description: 'Max total matches to return (default 100, max 500)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a NEW file with content. Only use for files that do NOT exist yet.',
        parameters: {
          type: 'object', required: ['filename', 'content'],
          properties: {
            filename: { type: 'string', description: 'Name of the new file' },
            content: { type: 'string', description: 'Content for the new file' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'replace_lines',
        description: 'Replace specific lines in an existing file. Use read_file first to see line numbers.',
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
        description: 'Write full content to a workspace file, creating it if it does not exist or overwriting it if it does. Use this for full-file rewrites. For surgical edits to existing files use find_replace or replace_lines instead.',
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
        name: 'list_directory',
        description: 'List files and folders under a path in the workspace. Use "." or "" for the workspace root. More detailed than list_files, which only returns root files.',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Default: workspace root.' },
            max_depth: { type: 'number', description: 'Optional recursion depth. Default: 2.' },
            max_entries: { type: 'number', description: 'Optional maximum entries. Default: 500, max: 1000.' },
          },
        },
      },
    },
    // ── Source code reading (read-only, src/ only) ───────────────────────────
    {
      type: 'function',
      function: {
        name: 'read_source',
        description:
          'Read a file from the Prometheus src/ directory (TypeScript source code). READ-ONLY — never modifies files. ' +
          'Use this to understand the codebase before writing a proposal or making edits. ' +
          'Pass the path relative to src/, e.g. "gateway/server-v2.ts" or "gateway/tool-builder.ts". ' +
          'Supports windowed reads for large files: use start_line+num_lines for arbitrary ranges, or head/tail for first/last N lines.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts". Or a root file: package.json, tsconfig.json.' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Omit to read to end of file (up to cap).' },
            head: { type: 'number', description: 'Return only first N lines (shorthand for start_line:1, num_lines:N)' },
            tail: { type: 'number', description: 'Return only last N lines' },
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
          'Supports windowed reads: use start_line+num_lines for arbitrary ranges, or head/tail for first/last N lines.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js".' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Omit to read to end of file (up to cap).' },
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
            pattern: { type: 'string', description: 'Regex or literal string to search for.' },
            root: { type: 'string', description: 'Which source tree to search: "src" (default), "web-ui", or "both".' },
            path: { type: 'string', description: 'Subdirectory to limit search within the chosen root, e.g. "gateway/routes". Ignored when root is "both".' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.ts" or "*.js,*.jsx". Default: all files.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 100.' },
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
            pattern: { type: 'string', description: 'Regex or literal string to search for.' },
            path: { type: 'string', description: 'Subdirectory of web-ui/ to limit search, e.g. "src" or "src/pages". Default: all of web-ui/.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.js,*.jsx,*.css". Default: all files.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 100.' },
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
            file: { type: 'string', description: 'Allowlisted prom-root file path, e.g. "SELF.md" or "scripts/dev-server.ts".' },
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
          'Use this for launcher/bootstrap/debug surfaces outside src/ and web-ui/, such as SELF.md, AGENTS.md, scripts/, electron/, build/, dist/, or .prometheus/. ' +
          'Supports start_line+num_lines plus head/tail, and returns a directory listing when the target is a directory. Hidden in public/Electron builds.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Allowlisted prom-root path, e.g. "SELF.md" or "scripts".' },
            start_line: { type: 'number', description: '1-based line to start reading from (default: 1). Use with num_lines for a specific range.' },
            num_lines: { type: 'number', description: 'Number of lines to return from start_line. Omit to read to end of file (up to cap).' },
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
            pattern: { type: 'string', description: 'Regex or literal string to search for.' },
            path: { type: 'string', description: 'Allowlisted prom-root directory to search within. Leave empty to search the allowlisted prom-root surface.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.ts,*.md". Default: all files.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            context: { type: 'number', description: 'Lines of context around each match (like -C N). Default: 0.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 100.' },
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
            context: { type: 'number', description: 'Lines of context around each match. Default: 0.' },
            max_results: { type: 'number', description: 'Max matching lines to return. Default: 100.' },
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
          'ALWAYS call read_source first to confirm the exact text to find. ' +
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
        name: 'replace_lines_source',
        description:
          'Replace specific line numbers in a src/ file. Use read_source first to see line numbers. ' +
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
          'Insert new lines after a specific line number in a src/ file. Use 0 to insert at beginning. ' +
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
          'Delete specific lines from a src/ file. Use read_source first to see line numbers. ' +
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
	          'Use list_source/read_source first to verify the exact file.',
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
          'ALWAYS call read_webui_source first to confirm exact text. ' +
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
          'Replace specific line numbers in a web-ui/ file. Use read_webui_source first to see line numbers. ' +
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
          'Delete specific lines from a web-ui/ file. Use read_webui_source first to see line numbers. ' +
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
	        name: 'web_search',
        description: 'Search the web for current information. Use web_fetch on result URLs to read full page content.',
        parameters: {
          type: 'object', required: ['query'],
          properties: { query: { type: 'string', description: 'Search query' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch the full text content of a webpage URL. Use this AFTER web_search to read the actual page content instead of just snippets. For X/Twitter status URLs, it returns structured post data and will attempt attached-media download plus analysis automatically.',
        parameters: {
          type: 'object', required: ['url'],
          properties: { url: { type: 'string', description: 'Full URL to fetch (from web_search results or any URL)' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'download_url',
        description: 'Download a URL directly into the workspace. Use this for direct image URLs, article assets, PDFs, and normal file links. Saves to downloads/ by default.',
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
        name: 'generate_image',
        description: 'Generate a new raster image from a text prompt using the configured AI image provider/GPT image model such as gpt-image-2. Use this for one-shot image generation, including brand kits, posters, thumbnails, concept art, and requests that reference uploaded files. Saves to generated/images by default.',
        parameters: {
          type: 'object', required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
            reference_images: { type: 'array', items: { type: 'string' }, maxItems: 16, description: 'Optional reference images as local/workspace file paths, HTTPS URLs, or data URLs. These are sent as actual image inputs for gpt-image-2 reference/edit generation.' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired image aspect ratio' },
            count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many images to generate at once' },
            provider: { type: 'string', enum: ['auto', 'openai', 'openai_codex'], description: 'Optional image provider override' },
            model: { type: 'string', description: 'Optional image model tier override, e.g. gpt-image-2-medium' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: generated/images' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache' },
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
        description: 'Analyze a local video by extracting sampled frames and optional audio transcript, then using the active vision-capable model to summarize what happens in the clip.',
        parameters: {
          type: 'object', required: ['file_path'],
          properties: {
            file_path: { type: 'string', description: 'Workspace-relative or absolute path to the video file' },
            prompt: { type: 'string', description: 'Optional analysis prompt or focus instruction' },
            sample_count: { type: 'number', description: 'How many visual samples to extract (default 6, max 8)' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory for extracted artifacts' },
            extract_audio: { type: 'boolean', description: 'If true, extract audio when ffmpeg is available (default true)' },
            transcribe: { type: 'boolean', description: 'If true, attempt local whisper transcription when available (default true)' },
          },
        },
      },
    },
    // ── Memory Tools ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'memory_write',
        description: 'Write a fact or update to USER.md, SOUL.md, or MEMORY.md under a specific category section. Creates the category if it does not exist. Use memory_browse first to pick the right category.',
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
        description: 'Read the full contents of USER.md, SOUL.md, or MEMORY.md. Use when you need complete context before making changes.',
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
        description: 'Search long-term memory with layered retrieval: (1) exact ID/key lookup, (2) operational layer — canonical decisions, preferences, proposals, task_outcomes, project_facts extracted from audit history, (3) evidence fallback — raw indexed session/transcript chunks. Operational records lead results; evidence fills remaining slots. Hits include layer ("operational"|"evidence"), recordType, canonicalKey, and whyMatched fields. Use record_id from hits with memory_read_record to fetch full record.',
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
            source_types: { type: 'array', items: { type: 'string' }, description: 'Source type filter (skips operational layer when set). Types: chat_session, chat_transcript, chat_compaction, task_state, proposal_state, memory_root, project_state, etc.' },
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
