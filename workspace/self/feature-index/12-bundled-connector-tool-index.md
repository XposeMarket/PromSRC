# Bundled Connector Tool Capability Index

Generated from bundled connector runtime definitions on 2026-07-22. These tools are dynamically added only when their connector is installed and connected; authorization scopes and tenant capabilities still apply.
**Total:** 56 bundled connector tools.

## `src/extensions/bundled/connectors/ga4/runtime.ts` — 3 tools

| Tool | Source-derived capability |
|---|---|
| `connector_ga4_list_properties` | [Google Analytics] List all GA4 properties accessible to the connected Google account. |
| `connector_ga4_realtime_users` | [Google Analytics] Get the current number of active users on the site right now (realtime report). |
| `connector_ga4_run_report` | [Google Analytics] Run a GA4 analytics report. Fetch metrics like sessions, users, pageviews, bounce rate, etc. |

## `src/extensions/bundled/connectors/github/runtime.ts` — 6 tools

| Tool | Source-derived capability |
|---|---|
| `connector_github_create_issue` | [GitHub] Create a new issue in a repository. |
| `connector_github_create_repo` | [GitHub] Create a new repository for the connected GitHub account. Requires approval before execution. |
| `connector_github_list_issues` | [GitHub] List issues for a repository. |
| `connector_github_list_prs` | [GitHub] List pull requests for a repository. |
| `connector_github_list_repos` | [GitHub] List repositories for the connected GitHub account, sorted by last updated. |
| `connector_github_search` | [GitHub] Search GitHub. Use type="repos" to find repos, type="code" to search code, type="issues" for issues. |

## `src/extensions/bundled/connectors/gmail/runtime.ts` — 6 tools

| Tool | Source-derived capability |
|---|---|
| `connector_gmail_get_email` | [Gmail] Fetch full content of a specific email including subject, from, date, and body text. |
| `connector_gmail_get_profile` | [Gmail] Get the connected Gmail account profile (email address, total message count). |
| `connector_gmail_list_emails` | [Gmail] List emails from inbox. Supports Gmail search query syntax (e.g., "from:boss@acme.com", "is:unread", "subject:invoice", "after:2024/01/01"). |
| `connector_gmail_list_labels` | [Gmail] List all Gmail labels/folders on the connected account. |
| `connector_gmail_prepare_email` | [Gmail] Prepare an editable email draft composer in chat. Use this by default when the user asks to draft, write, compose, or prepare an email, so they can review/edit and click Send. |
| `connector_gmail_send_email` | [Gmail] Send an email from the connected Gmail account. Use only when the user clearly asked to send now; otherwise use connector_gmail_prepare_email. |

## `src/extensions/bundled/connectors/google_drive/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_gdrive_get_file` | [Google Drive] Get metadata for a specific file (name, type, size, link, owner). |
| `connector_gdrive_list_files` | [Google Drive] List files in the connected Google Drive. |
| `connector_gdrive_read_file` | [Google Drive] Read the text content of a file (Google Docs exported as plain text, or raw text files). Not for binary files. |
| `connector_gdrive_search` | [Google Drive] Search for files by name or content in Google Drive. |

## `src/extensions/bundled/connectors/hubspot/runtime.ts` — 5 tools

| Tool | Source-derived capability |
|---|---|
| `connector_hubspot_create_contact` | [HubSpot] Create a new contact in HubSpot CRM. |
| `connector_hubspot_get_contact` | [HubSpot] Get detailed information about a specific HubSpot contact. |
| `connector_hubspot_list_contacts` | [HubSpot] List contacts in the HubSpot CRM. |
| `connector_hubspot_list_deals` | [HubSpot] List deals in the HubSpot CRM pipeline. |
| `connector_hubspot_search` | [HubSpot] Search contacts, companies, or deals in HubSpot. |

## `src/extensions/bundled/connectors/notion/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_notion_create_page` | [Notion] Create a new page inside an existing Notion page. |
| `connector_notion_get_page` | [Notion] Get a Notion page with its properties and block content. |
| `connector_notion_query_database` | [Notion] Query a Notion database with optional filters and sorting. |
| `connector_notion_search` | [Notion] Search pages and databases in the connected Notion workspace. |

## `src/extensions/bundled/connectors/obsidian/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_obsidian_connect_vault` | [Obsidian] Connect a local Obsidian vault folder to Prometheus. Defaults to read-only indexing. |
| `connector_obsidian_status` | [Obsidian] Show configured local vaults, bridge modes, and last sync stats. |
| `connector_obsidian_sync` | [Obsidian] Sync configured Obsidian vault notes into Prometheus memory and refresh the memory index. |
| `connector_obsidian_writeback` | [Obsidian] Write a Prometheus-generated Markdown note into an Obsidian vault in assisted/full mode. |

## `src/extensions/bundled/connectors/reddit/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_reddit_get_comments` | [Reddit] Get comments for a specific Reddit post. |
| `connector_reddit_get_posts` | [Reddit] Get posts from a subreddit. |
| `connector_reddit_search` | [Reddit] Search Reddit posts across all subreddits or within a specific one. |
| `connector_reddit_submit_post` | [Reddit] Submit a text post to a subreddit. |

## `src/extensions/bundled/connectors/salesforce/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_salesforce_create_record` | [Salesforce] Create a new record in a Salesforce object (e.g., Lead, Contact, Opportunity). |
| `connector_salesforce_get_record` | [Salesforce] Get a specific Salesforce record by ID. |
| `connector_salesforce_query` | [Salesforce] Run a SOQL query against Salesforce data (SELECT ... FROM ... WHERE ...). |
| `connector_salesforce_search` | [Salesforce] Full-text search across Salesforce objects using SOSL. |

## `src/extensions/bundled/connectors/slack/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_slack_get_history` | [Slack] Get recent message history from a Slack channel. |
| `connector_slack_list_channels` | [Slack] List public and private channels in the connected Slack workspace. |
| `connector_slack_search` | [Slack] Search messages across the Slack workspace. |
| `connector_slack_send_message` | [Slack] Send a message to a Slack channel or DM. Use the channel ID or name (e.g., "#general" or "C01234ABCD"). |

## `src/extensions/bundled/connectors/stripe/runtime.ts` — 4 tools

| Tool | Source-derived capability |
|---|---|
| `connector_stripe_get_balance` | [Stripe] Get the current Stripe account balance (available, pending amounts by currency). |
| `connector_stripe_list_charges` | [Stripe] List recent charges/payments in the Stripe account. |
| `connector_stripe_list_customers` | [Stripe] List recent customers in the Stripe account. |
| `connector_stripe_list_products` | [Stripe] List active products and their prices in the Stripe account. |

## `src/extensions/bundled/connectors/vercel/runtime.ts` — 8 tools

| Tool | Source-derived capability |
|---|---|
| `connector_vercel_domains` | [Vercel] List domains for the connected personal account/team or a specific project. |
| `connector_vercel_env` | [Vercel] List, create, update, or delete environment variables for a Vercel project. |
| `connector_vercel_get_deployment` | [Vercel] Get a deployment by ID or URL. |
| `connector_vercel_list_deployments` | [Vercel] List deployments account-wide, team-wide, or filtered to one/multiple projects. |
| `connector_vercel_list_projects` | [Vercel] List projects in the connected personal account or specified team. |
| `connector_vercel_list_teams` | [Vercel] List teams available to the connected Vercel token. |
| `connector_vercel_redeploy` | [Vercel] Redeploy the latest deployment for a project, or redeploy a specific deployment ID. |
| `connector_vercel_status` | [Vercel] Check the connected Vercel account/user and configured default project/team scope. |

