// src/gateway/tools/defs/file-web-memory.ts
// Tool definitions for file operations, web tools, and memory tools.

export function getFileWebMemoryTools(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all files in the workspace root directory (flat). Use list_directory for a specific folder or directory tree.',
        parameters: { type: 'object', properties: {}, required: [] },
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
            context_lines: { type: 'number', description: 'Lines of context around each match (default 0, max 10)' },
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
        description: 'Multi-file grep across a workspace directory. Finds all files containing a pattern. Critical for self-repair work — use this to find all callers of a function before changing it, or locate where a config key is used across the workspace.',
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
        description: 'Find exact text in a file and replace it. Good for small text changes.',
        parameters: {
          type: 'object', required: ['filename', 'find', 'replace'],
          properties: {
            filename: { type: 'string' },
            find: { type: 'string', description: 'Exact text to find' },
            replace: { type: 'string', description: 'Text to replace with' },
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
        description: 'Recursively list all files and folders under a path in the workspace. Use "." or "" for the workspace root. More detailed than list_files.',
        parameters: {
          type: 'object', required: [],
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Default: workspace root.' },
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
          'Also supports root-level files: package.json, tsconfig.json, README.md, CHANGELOG.md. ' +
          'Supports head/tail line limiting for large files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to src/, e.g. "gateway/server-v2.ts". Or a root file: package.json, tsconfig.json.' },
            head: { type: 'number', description: 'Return only first N lines' },
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
          'Supports head/tail line limiting for large files.',
        parameters: {
          type: 'object', required: ['file'],
          properties: {
            file: { type: 'string', description: 'Path relative to web-ui/, e.g. "src/pages/TeamsPage.js".' },
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
          'Search file contents inside the Prometheus src/ directory using a regex or literal pattern. ' +
          'Returns matching lines with file paths and line numbers (like rg -n). ' +
          'Use this to find function definitions, variable usages, imports, or any text across the codebase. ' +
          'Example: grep_source({pattern:"previousSessionId"}) or grep_source({pattern:"case \'step_complete\'", path:"gateway/routes"}).',
        parameters: {
          type: 'object', required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Regex or literal string to search for.' },
            path: { type: 'string', description: 'Subdirectory of src/ to limit search, e.g. "gateway" or "gateway/routes". Default: all of src/.' },
            glob: { type: 'string', description: 'Comma-separated file name patterns to include, e.g. "*.ts" or "*.ts,*.json". Default: all files.' },
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
          'Search file contents inside the Prometheus web-ui/ directory using a regex or literal pattern. ' +
          'Returns matching lines with file paths and line numbers (like rg -n). ' +
          'Use this to find React components, styles, imports, handlers, or any text across frontend code.',
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
        description: 'Fetch the full text content of a webpage URL. Use this AFTER web_search to read the actual page content instead of just snippets. Essential for getting real data, details, and context.',
        parameters: {
          type: 'object', required: ['url'],
          properties: { url: { type: 'string', description: 'Full URL to fetch (from web_search results or any URL)' } },
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
        description: 'Search long-term memory indexed from workspace/audit using hybrid ranking (keyword + semantic-lite + recency + durability). Use this when historical context from older sessions/tasks/notes is needed.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query, e.g. "oauth decision history" or "what did we decide about indexing".' },
            mode: { type: 'string', description: 'Optional search mode: quick, deep, project, or timeline. Default: quick.' },
            limit: { type: 'number', description: 'Maximum hits to return (default 8, max 50).' },
            project_id: { type: 'string', description: 'Optional project filter.' },
            date_from: { type: 'string', description: 'Optional lower date bound, YYYY-MM-DD or ISO timestamp.' },
            date_to: { type: 'string', description: 'Optional upper date bound, YYYY-MM-DD or ISO timestamp.' },
            source_types: { type: 'array', items: { type: 'string' }, description: 'Optional source type filters.' },
            min_durability: { type: 'number', description: 'Optional durability floor from 0..1.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_read_record',
        description: 'Read a full indexed memory record and its chunks by record_id (retrieved from memory_search). Use this for evidence-grounded follow-up reads.',
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
        description: 'Save a keyboard shortcut for a website so SmallClaw remembers it for all future sessions. Call this when you discover that a keyboard shortcut works on a site. Example: after pressing "n" successfully opens the X.com composer, save it.',
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
}
