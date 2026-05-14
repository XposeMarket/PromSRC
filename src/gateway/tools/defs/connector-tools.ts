// src/gateway/tools/defs/connector-tools.ts
// Tool definitions for all connected OAuth/API connectors.
// These tools are gated behind the 'connectors' category.
// connector_list is a core tool (always available) for discovery.

import { isConnectorConnected, listConnectors, getConnector } from '../../../integrations/connector-registry.js';
import { loadObsidianBridgeState } from '../../obsidian/bridge.js';

// Map from connector ID to available tool names (for discovery)
export const CONNECTOR_TOOL_MAP: Record<string, string[]> = {
  gmail: ['connector_gmail_list_emails', 'connector_gmail_get_email', 'connector_gmail_send_email', 'connector_gmail_get_profile', 'connector_gmail_list_labels'],
  github: ['connector_github_list_repos', 'connector_github_list_issues', 'connector_github_create_issue', 'connector_github_create_repo', 'connector_github_list_prs', 'connector_github_search'],
  slack: ['connector_slack_list_channels', 'connector_slack_send_message', 'connector_slack_get_history', 'connector_slack_search'],
  notion: ['connector_notion_search', 'connector_notion_get_page', 'connector_notion_create_page', 'connector_notion_query_database'],
  google_drive: ['connector_gdrive_list_files', 'connector_gdrive_get_file', 'connector_gdrive_read_file', 'connector_gdrive_search'],
  reddit: ['connector_reddit_get_posts', 'connector_reddit_search', 'connector_reddit_submit_post', 'connector_reddit_get_comments'],
  hubspot: ['connector_hubspot_list_contacts', 'connector_hubspot_get_contact', 'connector_hubspot_create_contact', 'connector_hubspot_search', 'connector_hubspot_list_deals'],
  salesforce: ['connector_salesforce_query', 'connector_salesforce_search', 'connector_salesforce_create_record', 'connector_salesforce_get_record'],
  stripe: ['connector_stripe_get_balance', 'connector_stripe_list_customers', 'connector_stripe_list_charges', 'connector_stripe_list_products'],
  ga4: ['connector_ga4_run_report', 'connector_ga4_realtime_users', 'connector_ga4_list_properties'],
  obsidian: ['connector_obsidian_status', 'connector_obsidian_connect_vault', 'connector_obsidian_sync', 'connector_obsidian_writeback'],
};

export function buildConnectorStatus(): string {
  const all = Array.from(new Set([...listConnectors(), 'obsidian']));
  const connected: string[] = [];
  const disconnected: string[] = [];
  for (const id of all) {
    if (id === 'obsidian' ? loadObsidianBridgeState().vaults.some((vault) => vault.enabled !== false) : isConnectorConnected(id)) {
      connected.push(id);
    } else {
      disconnected.push(id);
    }
  }

  if (connected.length === 0) {
    return `No connectors connected yet (${disconnected.length} available: ${disconnected.join(', ')}).\nConnect them in the Connections panel, then activate the external_apps category to use their tools.`;
  }

  const lines: string[] = [`Connected connectors (${connected.length} of ${all.length}):`];
  for (const id of connected) {
    if (id === 'obsidian') {
      const vaultCount = loadObsidianBridgeState().vaults.length;
      const tools = CONNECTOR_TOOL_MAP[id] || [];
      lines.push(`  ${id} - ${vaultCount} vault(s)`);
      lines.push(`    Tools: ${tools.join(', ')}`);
      continue;
    }
    const c = getConnector(id);
    const tokens = (c as any).loadTokens?.() as any;
    const account = tokens?.account_email ? ` — ${tokens.account_email}` : '';
    const tools = CONNECTOR_TOOL_MAP[id] || [];
    lines.push(`  ${id}${account}`);
    lines.push(`    Tools: ${tools.join(', ')}`);
  }
  if (disconnected.length > 0) {
    lines.push(`\nNot connected (${disconnected.length}): ${disconnected.join(', ')}`);
  }
  lines.push('\nUse request_tool_category({"category":"external_apps"}) to unlock all connector tools for this session.');
  return lines.join('\n');
}

export function getConnectorToolDefs(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'connector_obsidian_status',
        description: '[Obsidian] Show configured local vaults, bridge modes, and last sync stats.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_obsidian_connect_vault',
        description: '[Obsidian] Connect a local Obsidian vault folder to Prometheus. Defaults to read-only indexing.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Absolute path to the local Obsidian vault folder.' },
            name: { type: 'string', description: 'Optional display name for the vault.' },
            mode: { type: 'string', enum: ['read_only', 'assisted', 'full'], description: 'Bridge mode. read_only indexes only; assisted/full allow writeback.' },
            include: { type: 'array', items: { type: 'string' }, description: 'Optional glob list. Default: **/*.md' },
            exclude: { type: 'array', items: { type: 'string' }, description: 'Optional glob list. Default excludes .obsidian, trash, and node_modules.' },
            writeback_folder: { type: 'string', description: 'Folder inside the vault where Prometheus writes notes in assisted/full mode.' },
            sync_now: { type: 'boolean', description: 'If true, sync immediately after connecting. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_obsidian_sync',
        description: '[Obsidian] Sync configured Obsidian vault notes into Prometheus memory and refresh the memory index.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            vault_id: { type: 'string', description: 'Optional vault id to sync. Omit to sync every enabled vault.' },
            force: { type: 'boolean', description: 'Force reindex unchanged notes. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_obsidian_writeback',
        description: '[Obsidian] Write a Prometheus-generated Markdown note into an Obsidian vault in assisted/full mode.',
        parameters: {
          type: 'object',
          required: ['vault_id', 'title', 'content'],
          properties: {
            vault_id: { type: 'string', description: 'Vault id from connector_obsidian_status.' },
            title: { type: 'string', description: 'Note title.' },
            content: { type: 'string', description: 'Markdown note content to write.' },
            folder: { type: 'string', description: 'Optional folder inside the vault. Defaults to the vault writeback folder.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional extra tags.' },
            source_record_id: { type: 'string', description: 'Optional Prometheus memory record id for traceability.' },
          },
        },
      },
    },

    // ── Gmail ─────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_gmail_list_emails',
        description: '[Gmail] List emails from inbox. Supports Gmail search query syntax (e.g., "from:boss@acme.com", "is:unread", "subject:invoice", "after:2024/01/01").',
        parameters: {
          type: 'object', required: [],
          properties: {
            query: { type: 'string', description: 'Gmail search query (default: inbox). Examples: "is:unread", "from:example@gmail.com", "has:attachment", "label:work"' },
            max_results: { type: 'number', description: 'Max emails to return (default: 20, max: 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gmail_get_email',
        description: '[Gmail] Fetch full content of a specific email including subject, from, date, and body text.',
        parameters: {
          type: 'object', required: ['message_id'],
          properties: {
            message_id: { type: 'string', description: 'Gmail message ID (from connector_gmail_list_emails)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gmail_send_email',
        description: '[Gmail] Send an email from the connected Gmail account.',
        parameters: {
          type: 'object', required: ['to', 'subject', 'body'],
          properties: {
            to: { type: 'string', description: 'Recipient email address (or comma-separated for multiple)' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Plain text email body' },
            cc: { type: 'string', description: 'CC recipients (comma-separated)' },
            bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gmail_get_profile',
        description: '[Gmail] Get the connected Gmail account profile (email address, total message count).',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gmail_list_labels',
        description: '[Gmail] List all Gmail labels/folders on the connected account.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },

    // ── GitHub ────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_github_list_repos',
        description: '[GitHub] List repositories for the connected GitHub account, sorted by last updated.',
        parameters: {
          type: 'object', required: [],
          properties: {
            per_page: { type: 'number', description: 'Number of repos to return (default: 50)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_github_list_issues',
        description: '[GitHub] List issues for a repository.',
        parameters: {
          type: 'object', required: ['owner', 'repo'],
          properties: {
            owner: { type: 'string', description: 'Repository owner (username or org)' },
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' },
            per_page: { type: 'number', description: 'Number of issues (default: 30)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_github_create_issue',
        description: '[GitHub] Create a new issue in a repository.',
        parameters: {
          type: 'object', required: ['owner', 'repo', 'title'],
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue description (markdown supported)' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Label names to apply' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_github_create_repo',
        description: '[GitHub] Create a new repository for the connected GitHub account. Requires approval before execution.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Repository name' },
            description: { type: 'string', description: 'Repository description' },
            private: { type: 'boolean', description: 'Whether the repository should be private. Defaults to true.' },
            auto_init: { type: 'boolean', description: 'Create the repository with an initial README commit.' },
            homepage: { type: 'string', description: 'Optional homepage URL' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_github_list_prs',
        description: '[GitHub] List pull requests for a repository.',
        parameters: {
          type: 'object', required: ['owner', 'repo'],
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' },
            per_page: { type: 'number', description: 'Number of PRs (default: 30)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_github_search',
        description: '[GitHub] Search GitHub. Use type="repos" to find repos, type="code" to search code, type="issues" for issues.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query (supports GitHub search syntax, e.g., "language:typescript stars:>100")' },
            type: { type: 'string', enum: ['repos', 'code', 'issues'], description: 'What to search (default: repos)' },
            per_page: { type: 'number', description: 'Results per page (default: 20)' },
          },
        },
      },
    },

    // ── Slack ─────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_slack_list_channels',
        description: '[Slack] List public and private channels in the connected Slack workspace.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of channels to return (default: 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_slack_send_message',
        description: '[Slack] Send a message to a Slack channel or DM. Use the channel ID or name (e.g., "#general" or "C01234ABCD").',
        parameters: {
          type: 'object', required: ['channel', 'text'],
          properties: {
            channel: { type: 'string', description: 'Channel ID or name (e.g., "#general", "C01234ABCD", "@username")' },
            text: { type: 'string', description: 'Message text (markdown supported)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_slack_get_history',
        description: '[Slack] Get recent message history from a Slack channel.',
        parameters: {
          type: 'object', required: ['channel_id'],
          properties: {
            channel_id: { type: 'string', description: 'Channel ID (from connector_slack_list_channels)' },
            limit: { type: 'number', description: 'Number of messages to return (default: 20)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_slack_search',
        description: '[Slack] Search messages across the Slack workspace.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query (supports Slack search modifiers: from:, in:, before:, after:)' },
            count: { type: 'number', description: 'Number of results (default: 20)' },
          },
        },
      },
    },

    // ── Notion ────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_notion_search',
        description: '[Notion] Search pages and databases in the connected Notion workspace.',
        parameters: {
          type: 'object', required: [],
          properties: {
            query: { type: 'string', description: 'Search query (leave empty to list all)' },
            page_size: { type: 'number', description: 'Number of results (default: 20)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_notion_get_page',
        description: '[Notion] Get a Notion page with its properties and block content.',
        parameters: {
          type: 'object', required: ['page_id'],
          properties: {
            page_id: { type: 'string', description: 'Notion page ID (UUID from search results)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_notion_create_page',
        description: '[Notion] Create a new page inside an existing Notion page.',
        parameters: {
          type: 'object', required: ['parent_page_id', 'title'],
          properties: {
            parent_page_id: { type: 'string', description: 'Parent page ID to create the new page inside' },
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'Initial text content for the page body' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_notion_query_database',
        description: '[Notion] Query a Notion database with optional filters and sorting.',
        parameters: {
          type: 'object', required: ['database_id'],
          properties: {
            database_id: { type: 'string', description: 'Notion database ID' },
            filter: { type: 'object', description: 'Notion filter object (see Notion API docs for filter syntax)' },
            page_size: { type: 'number', description: 'Number of results (default: 20)' },
          },
        },
      },
    },

    // ── Google Drive ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_gdrive_list_files',
        description: '[Google Drive] List files in the connected Google Drive.',
        parameters: {
          type: 'object', required: [],
          properties: {
            query: { type: 'string', description: 'Drive search query (e.g., "mimeType=\'application/pdf\'", "name contains \'report\'", "modifiedTime > \'2024-01-01\'")' },
            page_size: { type: 'number', description: 'Number of files (default: 20)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gdrive_get_file',
        description: '[Google Drive] Get metadata for a specific file (name, type, size, link, owner).',
        parameters: {
          type: 'object', required: ['file_id'],
          properties: {
            file_id: { type: 'string', description: 'Google Drive file ID' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gdrive_read_file',
        description: '[Google Drive] Read the text content of a file (Google Docs exported as plain text, or raw text files). Not for binary files.',
        parameters: {
          type: 'object', required: ['file_id'],
          properties: {
            file_id: { type: 'string', description: 'Google Drive file ID' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_gdrive_search',
        description: '[Google Drive] Search for files by name or content in Google Drive.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query — searches file names and content' },
            page_size: { type: 'number', description: 'Number of results (default: 20)' },
          },
        },
      },
    },

    // ── Reddit ────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_reddit_get_posts',
        description: '[Reddit] Get posts from a subreddit.',
        parameters: {
          type: 'object', required: ['subreddit'],
          properties: {
            subreddit: { type: 'string', description: 'Subreddit name (without r/, e.g., "programming")' },
            sort: { type: 'string', enum: ['hot', 'new', 'top', 'rising'], description: 'Sort order (default: hot)' },
            limit: { type: 'number', description: 'Number of posts (default: 25)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_reddit_search',
        description: '[Reddit] Search Reddit posts across all subreddits or within a specific one.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query' },
            subreddit: { type: 'string', description: 'Limit search to this subreddit (optional)' },
            sort: { type: 'string', enum: ['relevance', 'new', 'top'], description: 'Sort order (default: relevance)' },
            limit: { type: 'number', description: 'Number of results (default: 25)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_reddit_submit_post',
        description: '[Reddit] Submit a text post to a subreddit.',
        parameters: {
          type: 'object', required: ['subreddit', 'title', 'text'],
          properties: {
            subreddit: { type: 'string', description: 'Subreddit to post to (without r/)' },
            title: { type: 'string', description: 'Post title' },
            text: { type: 'string', description: 'Post body text' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_reddit_get_comments',
        description: '[Reddit] Get comments for a specific Reddit post.',
        parameters: {
          type: 'object', required: ['subreddit', 'post_id'],
          properties: {
            subreddit: { type: 'string', description: 'Subreddit name (without r/)' },
            post_id: { type: 'string', description: 'Post ID (the alphanumeric ID from the post URL)' },
            limit: { type: 'number', description: 'Number of comments (default: 20)' },
          },
        },
      },
    },

    // ── HubSpot ───────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_hubspot_list_contacts',
        description: '[HubSpot] List contacts in the HubSpot CRM.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of contacts to return (default: 20)' },
            after: { type: 'string', description: 'Pagination cursor for next page' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_hubspot_get_contact',
        description: '[HubSpot] Get detailed information about a specific HubSpot contact.',
        parameters: {
          type: 'object', required: ['contact_id'],
          properties: {
            contact_id: { type: 'string', description: 'HubSpot contact ID' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_hubspot_create_contact',
        description: '[HubSpot] Create a new contact in HubSpot CRM.',
        parameters: {
          type: 'object', required: ['email'],
          properties: {
            email: { type: 'string', description: 'Contact email address' },
            firstname: { type: 'string', description: 'First name' },
            lastname: { type: 'string', description: 'Last name' },
            phone: { type: 'string', description: 'Phone number' },
            company: { type: 'string', description: 'Company name' },
            jobtitle: { type: 'string', description: 'Job title' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_hubspot_search',
        description: '[HubSpot] Search contacts, companies, or deals in HubSpot.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query (searches across name, email, company)' },
            limit: { type: 'number', description: 'Number of results (default: 20)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_hubspot_list_deals',
        description: '[HubSpot] List deals in the HubSpot CRM pipeline.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of deals (default: 20)' },
          },
        },
      },
    },

    // ── Salesforce ────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_salesforce_query',
        description: '[Salesforce] Run a SOQL query against Salesforce data (SELECT ... FROM ... WHERE ...).',
        parameters: {
          type: 'object', required: ['soql'],
          properties: {
            soql: { type: 'string', description: 'SOQL query string, e.g., "SELECT Id, Name, Email FROM Contact WHERE Account.Name = \'Acme\' LIMIT 20"' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_salesforce_search',
        description: '[Salesforce] Full-text search across Salesforce objects using SOSL.',
        parameters: {
          type: 'object', required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search term — will be wrapped in SOSL: FIND {query} IN ALL FIELDS RETURNING Contact, Lead, Account, Opportunity' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_salesforce_create_record',
        description: '[Salesforce] Create a new record in a Salesforce object (e.g., Lead, Contact, Opportunity).',
        parameters: {
          type: 'object', required: ['object_type', 'fields'],
          properties: {
            object_type: { type: 'string', description: 'Salesforce object type, e.g., "Lead", "Contact", "Opportunity", "Account"' },
            fields: { type: 'object', description: 'Field values for the new record, e.g., {"LastName":"Smith","Email":"smith@acme.com","Company":"Acme"}' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_salesforce_get_record',
        description: '[Salesforce] Get a specific Salesforce record by ID.',
        parameters: {
          type: 'object', required: ['object_type', 'record_id'],
          properties: {
            object_type: { type: 'string', description: 'Salesforce object type (e.g., Contact, Lead, Account)' },
            record_id: { type: 'string', description: 'Salesforce record ID' },
          },
        },
      },
    },

    // ── Stripe ────────────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_stripe_get_balance',
        description: '[Stripe] Get the current Stripe account balance (available, pending amounts by currency).',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_stripe_list_customers',
        description: '[Stripe] List recent customers in the Stripe account.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of customers to return (default: 20, max: 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_stripe_list_charges',
        description: '[Stripe] List recent charges/payments in the Stripe account.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of charges to return (default: 20, max: 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_stripe_list_products',
        description: '[Stripe] List active products and their prices in the Stripe account.',
        parameters: {
          type: 'object', required: [],
          properties: {
            limit: { type: 'number', description: 'Number of products to return (default: 20)' },
          },
        },
      },
    },

    // ── Google Analytics (GA4) ────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'connector_ga4_run_report',
        description: '[Google Analytics] Run a GA4 analytics report. Fetch metrics like sessions, users, pageviews, bounce rate, etc.',
        parameters: {
          type: 'object', required: ['metrics'],
          properties: {
            metrics: {
              type: 'array', items: { type: 'string' },
              description: 'Metric names, e.g., ["sessions", "activeUsers", "newUsers", "bounceRate", "averageSessionDuration", "screenPageViews"]',
            },
            dimensions: {
              type: 'array', items: { type: 'string' },
              description: 'Dimension names to break down by, e.g., ["date", "country", "deviceCategory", "sessionSource", "pagePath"]',
            },
            start_date: { type: 'string', description: 'Start date, e.g., "30daysAgo", "7daysAgo", "2024-01-01" (default: 30daysAgo)' },
            end_date: { type: 'string', description: 'End date, e.g., "today", "yesterday", "2024-01-31" (default: today)' },
            property_id: { type: 'string', description: 'GA4 property ID (overrides GA4_PROPERTY_ID env var)' },
            limit: { type: 'number', description: 'Max rows to return (default: 100)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_ga4_realtime_users',
        description: '[Google Analytics] Get the current number of active users on the site right now (realtime report).',
        parameters: {
          type: 'object', required: [],
          properties: {
            property_id: { type: 'string', description: 'GA4 property ID (overrides GA4_PROPERTY_ID env var)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connector_ga4_list_properties',
        description: '[Google Analytics] List all GA4 properties accessible to the connected Google account.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
  ];
}
