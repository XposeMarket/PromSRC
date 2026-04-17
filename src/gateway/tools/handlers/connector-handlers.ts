// src/gateway/tools/handlers/connector-handlers.ts
// Execution handlers for all connector_* tools.
// Dispatches to the correct connector class method based on tool name.

import { getConnector, isConnectorConnected } from '../../../integrations/connector-registry.js';
import type { GmailConnector } from '../../../integrations/connectors/gmail.js';
import type { GitHubConnector } from '../../../integrations/connectors/github.js';
import type { SlackConnector } from '../../../integrations/connectors/slack.js';
import type { NotionConnector } from '../../../integrations/connectors/notion.js';
import type { GoogleDriveConnector } from '../../../integrations/connectors/google-drive.js';
import type { RedditConnector } from '../../../integrations/connectors/reddit.js';
import type { HubSpotConnector } from '../../../integrations/connectors/hubspot.js';
import type { SalesforceConnector } from '../../../integrations/connectors/salesforce.js';
import type { StripeConnector } from '../../../integrations/connectors/stripe.js';
import type { GoogleAnalyticsConnector } from '../../../integrations/connectors/google-analytics.js';

export interface ConnectorToolResult {
  result: string;
  error: boolean;
}

function notConnected(name: string): ConnectorToolResult {
  return { result: `${name} is not connected. Connect it in the Connections panel, then try again.`, error: true };
}

function ok(data: any): ConnectorToolResult {
  if (typeof data === 'string') return { result: data, error: false };
  return { result: JSON.stringify(data, null, 2), error: false };
}

function summarizeEmails(messages: any[]): string {
  if (!messages.length) return 'No emails found.';
  return messages.map((m: any) => `• [${m.id}] ${m.subject} | from: ${m.from} | ${m.date}\n  ${m.snippet}`).join('\n');
}

export async function handleConnectorTool(toolName: string, args: any): Promise<ConnectorToolResult> {
  try {
    // ── Gmail ───────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_gmail_')) {
      if (!isConnectorConnected('gmail')) return notConnected('Gmail');
      const gmail = getConnector('gmail') as unknown as GmailConnector;

      if (toolName === 'connector_gmail_list_emails') {
        const maxResults = Math.min(100, args.max_results || 20);
        const ids = await gmail.listMessages(maxResults, args.query || '');
        if (!ids.length) return ok('No emails found.');
        const emails = await Promise.all(ids.slice(0, Math.min(20, ids.length)).map((m: any) => gmail.getMessageParsed(m.id)));
        return ok(summarizeEmails(emails));
      }

      if (toolName === 'connector_gmail_get_email') {
        const msg = await gmail.getMessageParsed(args.message_id);
        return ok(`Subject: ${msg.subject}\nFrom: ${msg.from}\nDate: ${msg.date}\n\n${msg.body || msg.snippet}`);
      }

      if (toolName === 'connector_gmail_send_email') {
        const sent = await gmail.sendEmail(args.to, args.subject, args.body, args.cc, args.bcc);
        return ok(`Email sent successfully. Message ID: ${sent.id}, Thread ID: ${sent.threadId}`);
      }

      if (toolName === 'connector_gmail_get_profile') {
        const profile = await gmail.getProfile();
        return ok(profile);
      }

      if (toolName === 'connector_gmail_list_labels') {
        const labels = await gmail.listLabels();
        return ok(labels.map((l: any) => `${l.id}: ${l.name} (${l.type})`).join('\n'));
      }
    }

    // ── GitHub ──────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_github_')) {
      if (!isConnectorConnected('github')) return notConnected('GitHub');
      const gh = getConnector('github') as unknown as GitHubConnector;

      if (toolName === 'connector_github_list_repos') {
        const repos = await gh.listRepos(args.per_page || 50);
        if (!Array.isArray(repos)) return ok(repos);
        return ok(repos.map((r: any) => `${r.full_name} — ${r.description || 'no description'} (⭐${r.stargazers_count}, updated: ${r.updated_at?.slice(0,10)})`).join('\n'));
      }

      if (toolName === 'connector_github_list_issues') {
        const issues = await gh.listIssues(args.owner, args.repo, args.state || 'open', args.per_page || 30);
        if (!issues.length) return ok('No issues found.');
        return ok(issues.map((i: any) => `#${i.number} [${i.state}] ${i.title}\n  by ${i.user?.login} | ${i.created_at?.slice(0,10)} | labels: ${i.labels?.map((l: any) => l.name).join(', ') || 'none'}`).join('\n'));
      }

      if (toolName === 'connector_github_create_issue') {
        const issue = await gh.createIssue(args.owner, args.repo, args.title, args.body || '', args.labels || []);
        return ok(`Issue created: #${issue.number} — ${issue.html_url}`);
      }

      if (toolName === 'connector_github_list_prs') {
        const prs = await gh.listPRs(args.owner, args.repo, args.state || 'open', args.per_page || 30);
        if (!prs.length) return ok('No pull requests found.');
        return ok(prs.map((p: any) => `#${p.number} [${p.state}] ${p.title}\n  by ${p.user?.login} | ${p.created_at?.slice(0,10)} | ${p.draft ? 'DRAFT' : 'ready'}`).join('\n'));
      }

      if (toolName === 'connector_github_search') {
        const type = args.type || 'repos';
        if (type === 'code') {
          const results = await gh.searchCode(args.query, args.per_page || 20);
          return ok(results.map((r: any) => `${r.repository?.full_name}/${r.path} (${r.html_url})`).join('\n'));
        }
        if (type === 'issues') {
          // Search repos for now as issues search
          const results = await gh.searchRepos(args.query + ' type:issue', args.per_page || 20);
          return ok(results);
        }
        const results = await gh.searchRepos(args.query, args.per_page || 20);
        return ok(results.map((r: any) => `${r.full_name} — ${r.description || 'no description'} (⭐${r.stargazers_count})`).join('\n'));
      }
    }

    // ── Slack ───────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_slack_')) {
      if (!isConnectorConnected('slack')) return notConnected('Slack');
      const slack = getConnector('slack') as unknown as SlackConnector;

      if (toolName === 'connector_slack_list_channels') {
        const channels = await slack.listChannels(args.limit || 100);
        return ok(channels.map((c: any) => `${c.id}: #${c.name} (${c.num_members || 0} members${c.is_private ? ', private' : ''})`).join('\n'));
      }

      if (toolName === 'connector_slack_send_message') {
        const result = await slack.postMessage(args.channel, args.text);
        return ok(`Message sent to ${args.channel}. Timestamp: ${result.ts}`);
      }

      if (toolName === 'connector_slack_get_history') {
        const messages = await slack.getChannelHistory(args.channel_id, args.limit || 20);
        if (!messages.length) return ok('No messages found.');
        return ok(messages.map((m: any) => `[${new Date(parseFloat(m.ts) * 1000).toLocaleString()}] ${m.username || m.user}: ${m.text}`).join('\n'));
      }

      if (toolName === 'connector_slack_search') {
        const results = await slack.searchMessages(args.query, args.count || 20);
        if (!results.length) return ok('No messages found matching that query.');
        return ok(results.map((m: any) => `[#${m.channel?.name} | ${m.ts}] ${m.username}: ${m.text}\n  ${m.permalink}`).join('\n'));
      }
    }

    // ── Notion ──────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_notion_')) {
      if (!isConnectorConnected('notion')) return notConnected('Notion');
      const notion = getConnector('notion') as unknown as NotionConnector;

      if (toolName === 'connector_notion_search') {
        const pages = await notion.searchPages(args.query || '', args.page_size || 20);
        if (!pages.length) return ok('No pages found.');
        return ok(pages.map((p: any) => {
          const title = p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || '(untitled)';
          return `${p.id}: ${title} (${p.object}, last edited: ${p.last_edited_time?.slice(0,10)})`;
        }).join('\n'));
      }

      if (toolName === 'connector_notion_get_page') {
        const page = await notion.getPage(args.page_id);
        const blocks = await notion.getPageBlocks(args.page_id);
        const title = (page as any).properties?.title?.title?.[0]?.plain_text || '(untitled)';
        const content = blocks.map((b: any) => {
          const texts = b[b.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          return texts;
        }).filter(Boolean).join('\n');
        return ok(`# ${title}\n\n${content || '(no text content)'}`);
      }

      if (toolName === 'connector_notion_create_page') {
        const page = await notion.createPage(args.parent_page_id, args.title, args.content);
        return ok(`Page created: "${args.title}" — ID: ${(page as any).id}`);
      }

      if (toolName === 'connector_notion_query_database') {
        const rows = await notion.queryDatabase(args.database_id, args.filter, undefined, args.page_size || 20);
        if (!rows.length) return ok('No rows found.');
        return ok(rows.map((r: any) => {
          const props = Object.entries(r.properties || {}).map(([k, v]: [string, any]) => {
            const text = v.title?.[0]?.plain_text || v.rich_text?.[0]?.plain_text || v.select?.name || v.number || v.checkbox || '';
            return `${k}: ${text}`;
          }).join(' | ');
          return `${r.id}: ${props}`;
        }).join('\n'));
      }
    }

    // ── Google Drive ─────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_gdrive_')) {
      if (!isConnectorConnected('google_drive')) return notConnected('Google Drive');
      const drive = getConnector('google_drive') as unknown as GoogleDriveConnector;

      if (toolName === 'connector_gdrive_list_files') {
        const files = await drive.listFiles(args.query || '', args.page_size || 20);
        if (!files.length) return ok('No files found.');
        return ok(files.map((f: any) => `${f.id}: ${f.name} (${f.mimeType?.split('.').pop()}, modified: ${f.modifiedTime?.slice(0,10)})`).join('\n'));
      }

      if (toolName === 'connector_gdrive_get_file') {
        return ok(await drive.getFile(args.file_id));
      }

      if (toolName === 'connector_gdrive_read_file') {
        const content = await drive.readFileContent(args.file_id);
        return ok(content.slice(0, 10000) + (content.length > 10000 ? '\n\n[...truncated at 10,000 chars]' : ''));
      }

      if (toolName === 'connector_gdrive_search') {
        const files = await drive.searchFiles(args.query, args.page_size || 20);
        if (!files.length) return ok('No files found matching that query.');
        return ok(files.map((f: any) => `${f.id}: ${f.name} (${f.mimeType?.split('.').pop()}, ${f.webViewLink})`).join('\n'));
      }
    }

    // ── Reddit ───────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_reddit_')) {
      if (!isConnectorConnected('reddit')) return notConnected('Reddit');
      const reddit = getConnector('reddit') as unknown as RedditConnector;

      if (toolName === 'connector_reddit_get_posts') {
        const posts = await reddit.getSubredditPosts(args.subreddit, args.sort || 'hot', args.limit || 25);
        if (!posts.length) return ok('No posts found.');
        return ok(posts.map((p: any) => `[${p.score}↑] ${p.title}\n  ${p.url} | ${p.num_comments} comments | by u/${p.author}`).join('\n'));
      }

      if (toolName === 'connector_reddit_search') {
        const posts = await reddit.searchPosts(args.query, args.subreddit, args.sort || 'relevance', args.limit || 25);
        if (!posts.length) return ok('No posts found.');
        return ok(posts.map((p: any) => `[${p.score}↑] r/${p.subreddit}: ${p.title}\n  ${p.url}`).join('\n'));
      }

      if (toolName === 'connector_reddit_submit_post') {
        const result = await reddit.submitPost(args.subreddit, args.title, args.text);
        return ok(`Post submitted to r/${args.subreddit}. URL: ${(result as any)?.json?.data?.url || 'submitted'}`);
      }

      if (toolName === 'connector_reddit_get_comments') {
        const comments = await reddit.getPostComments(args.subreddit, args.post_id, args.limit || 20);
        if (!comments.length) return ok('No comments found.');
        return ok(comments.map((c: any) => `u/${c.author} [${c.score}↑]: ${c.body}`).join('\n---\n'));
      }
    }

    // ── HubSpot ──────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_hubspot_')) {
      if (!isConnectorConnected('hubspot')) return notConnected('HubSpot');
      const hs = getConnector('hubspot') as unknown as HubSpotConnector;

      if (toolName === 'connector_hubspot_list_contacts') {
        const { results, next } = await hs.listContacts(args.limit || 20, args.after);
        if (!results.length) return ok('No contacts found.');
        const lines = results.map((c: any) => {
          const p = c.properties;
          return `${c.id}: ${p.firstname || ''} ${p.lastname || ''} <${p.email || 'no email'}> — ${p.company || ''} (${p.jobtitle || ''})`;
        });
        if (next) lines.push(`\nNext page cursor: ${next}`);
        return ok(lines.join('\n'));
      }

      if (toolName === 'connector_hubspot_get_contact') {
        return ok(await hs.getContact(args.contact_id));
      }

      if (toolName === 'connector_hubspot_create_contact') {
        const properties: Record<string, string> = { email: args.email };
        if (args.firstname) properties.firstname = args.firstname;
        if (args.lastname) properties.lastname = args.lastname;
        if (args.phone) properties.phone = args.phone;
        if (args.company) properties.company = args.company;
        if (args.jobtitle) properties.jobtitle = args.jobtitle;
        const contact = await hs.createContact(properties);
        return ok(`Contact created: ID ${contact.id} — ${args.firstname || ''} ${args.lastname || ''} <${args.email}>`);
      }

      if (toolName === 'connector_hubspot_search') {
        const results = await hs.searchContacts(args.query, args.limit || 20);
        if (!results.length) return ok('No contacts found matching that query.');
        return ok(results.map((c: any) => {
          const p = c.properties;
          return `${c.id}: ${p.firstname || ''} ${p.lastname || ''} <${p.email || ''}> — ${p.company || ''}`;
        }).join('\n'));
      }

      if (toolName === 'connector_hubspot_list_deals') {
        const deals = await hs.listDeals(args.limit || 20);
        if (!deals.length) return ok('No deals found.');
        return ok(deals.map((d: any) => {
          const p = d.properties;
          return `${d.id}: ${p.dealname} — $${p.amount || '0'} | stage: ${p.dealstage} | close: ${p.closedate?.slice(0,10) || 'n/a'}`;
        }).join('\n'));
      }
    }

    // ── Salesforce ───────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_salesforce_')) {
      if (!isConnectorConnected('salesforce')) return notConnected('Salesforce');
      const sf = getConnector('salesforce') as unknown as SalesforceConnector;

      if (toolName === 'connector_salesforce_query') {
        const result = await sf.query(args.soql);
        if (!result.records?.length) return ok(`Query returned 0 records (totalSize: ${result.totalSize})`);
        return ok({ totalSize: result.totalSize, records: result.records });
      }

      if (toolName === 'connector_salesforce_search') {
        const sosl = `FIND {${args.query}} IN ALL FIELDS RETURNING Contact(Id,Name,Email), Lead(Id,Name,Email,Company), Account(Id,Name), Opportunity(Id,Name,StageName)`;
        const records = await sf.search(sosl);
        if (!records.length) return ok('No records found matching that search.');
        return ok(records);
      }

      if (toolName === 'connector_salesforce_create_record') {
        const result = await sf.createRecord(args.object_type, args.fields);
        return ok(`${args.object_type} record created. ID: ${result.id}`);
      }

      if (toolName === 'connector_salesforce_get_record') {
        return ok(await sf.getRecord(args.object_type, args.record_id));
      }
    }

    // ── Stripe ───────────────────────────────────────────────────────────────
    if (toolName.startsWith('connector_stripe_')) {
      if (!isConnectorConnected('stripe')) return notConnected('Stripe');
      const stripe = getConnector('stripe') as unknown as StripeConnector;

      if (toolName === 'connector_stripe_get_balance') {
        const balance = await stripe.getBalance();
        const lines: string[] = ['Stripe Account Balance:'];
        for (const entry of (balance.available || [])) {
          lines.push(`  Available: ${(entry.amount / 100).toFixed(2)} ${entry.currency.toUpperCase()}`);
        }
        for (const entry of (balance.pending || [])) {
          lines.push(`  Pending: ${(entry.amount / 100).toFixed(2)} ${entry.currency.toUpperCase()}`);
        }
        return ok(lines.join('\n'));
      }

      if (toolName === 'connector_stripe_list_customers') {
        const customers = await stripe.listCustomers(args.limit || 20);
        if (!customers.length) return ok('No customers found.');
        return ok(customers.map((c: any) => `${c.id}: ${c.email || '(no email)'} — ${c.name || ''} (created: ${new Date(c.created * 1000).toLocaleDateString()})`).join('\n'));
      }

      if (toolName === 'connector_stripe_list_charges') {
        const charges = await stripe.listCharges(args.limit || 20);
        if (!charges.length) return ok('No charges found.');
        return ok(charges.map((c: any) => {
          const amt = ((c.amount || 0) / 100).toFixed(2);
          return `${c.id}: ${amt} ${(c.currency || 'usd').toUpperCase()} | ${c.status} | ${c.description || 'no desc'} | ${new Date(c.created * 1000).toLocaleDateString()}`;
        }).join('\n'));
      }

      if (toolName === 'connector_stripe_list_products') {
        const products = await stripe.listProducts(args.limit || 20);
        if (!products.length) return ok('No products found.');
        return ok(products.map((p: any) => `${p.id}: ${p.name} — ${p.description || 'no description'}`).join('\n'));
      }
    }

    // ── Google Analytics (GA4) ───────────────────────────────────────────────
    if (toolName.startsWith('connector_ga4_')) {
      if (!isConnectorConnected('ga4')) return notConnected('Google Analytics');
      const ga4 = getConnector('ga4') as unknown as GoogleAnalyticsConnector;

      if (toolName === 'connector_ga4_run_report') {
        const data = await ga4.runReport({
          metrics: args.metrics || ['sessions'],
          dimensions: args.dimensions,
          startDate: args.start_date,
          endDate: args.end_date,
          propertyId: args.property_id,
          limit: args.limit,
        });
        // Format the response
        const metricHeaders = (data.metricHeaders || []).map((h: any) => h.name);
        const dimensionHeaders = (data.dimensionHeaders || []).map((h: any) => h.name);
        const header = [...dimensionHeaders, ...metricHeaders].join(' | ');
        const rows = (data.rows || []).map((row: any) => {
          const dims = (row.dimensionValues || []).map((v: any) => v.value);
          const mets = (row.metricValues || []).map((v: any) => v.value);
          return [...dims, ...mets].join(' | ');
        });
        return ok([header, ...rows.slice(0, 50)].join('\n'));
      }

      if (toolName === 'connector_ga4_realtime_users') {
        const result = await ga4.getRealtimeUsers(args.property_id);
        return ok(`Active users right now: ${result.activeUsers}`);
      }

      if (toolName === 'connector_ga4_list_properties') {
        const properties = await ga4.listProperties();
        if (!properties.length) return ok('No GA4 properties found for this account.');
        return ok(properties.map((p: any) => `${p.name}: ${p.displayName} (industry: ${p.industryCategory || 'n/a'})`).join('\n'));
      }
    }

    return { result: `Unknown connector tool: ${toolName}`, error: true };
  } catch (err: any) {
    return { result: `Connector tool error (${toolName}): ${err.message}`, error: true };
  }
}
