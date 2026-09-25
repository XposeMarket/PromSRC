import type { MCPTransport } from './mcp-manager.js';

export interface HostedMcpEntry {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  transport: Extract<MCPTransport, 'sse' | 'http'>;
  logoId?: string;
  dcr: boolean;
  /**
   * false when the provider's DCR rejects the gateway's public https callback
   * (probed 2026-09-25: "invalid_redirect_uri"). Those finish consent on the
   * PC through the loopback listener instead of on the phone.
   */
  publicCallback?: boolean;
  notes?: string;
}

const BUILT_IN: HostedMcpEntry[] = [
  { id: 'vercel', name: 'Vercel', url: 'https://mcp.vercel.com', description: 'Deployments and projects', category: 'Development', transport: 'http', dcr: true, publicCallback: false, notes: 'Authorize page rejects non-loopback redirect URIs ("App configuration error") even though DCR accepts them.' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', description: 'Pages and workspace content', category: 'Productivity', transport: 'http', dcr: true },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', description: 'Issues and projects', category: 'Productivity', transport: 'http', dcr: true },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', description: 'Payments and billing', category: 'Business', transport: 'http', dcr: true },
  { id: 'atlassian', name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/sse', description: 'Jira and Confluence', category: 'Productivity', transport: 'sse', dcr: true },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', description: 'Errors and performance', category: 'Development', transport: 'http', dcr: true },
  { id: 'canva', name: 'Canva', url: 'https://mcp.canva.com/mcp', description: 'Designs and assets', category: 'Design', transport: 'http', dcr: true, publicCallback: false, notes: 'Authorize endpoint returns 400 for non-loopback redirect URIs.' },
  { id: 'asana', name: 'Asana', url: 'https://mcp.asana.com/sse', description: 'Tasks and projects', category: 'Productivity', transport: 'sse', dcr: true, publicCallback: false, notes: 'DCR rejects non-loopback redirect URIs.' },
  { id: 'supabase', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', description: 'Databases, tables and edge functions', category: 'Development', transport: 'http', dcr: true },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://bindings.mcp.cloudflare.com/mcp', description: 'Workers, KV, R2 and D1', category: 'Development', transport: 'http', dcr: true },
  { id: 'paypal', name: 'PayPal', url: 'https://mcp.paypal.com/mcp', description: 'Invoices, orders and transactions', category: 'Business', transport: 'http', dcr: true },
  { id: 'webflow', name: 'Webflow', url: 'https://mcp.webflow.com/sse', description: 'Sites, CMS collections and pages', category: 'Design', transport: 'sse', dcr: true },
  { id: 'neon', name: 'Neon', url: 'https://mcp.neon.tech/mcp', description: 'Serverless Postgres projects and branches', category: 'Development', transport: 'http', dcr: true },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', description: 'Models, datasets and Spaces', category: 'AI', transport: 'http', dcr: true },
  { id: 'square', name: 'Square', url: 'https://mcp.squareup.com/sse', description: 'Payments, catalog and customers', category: 'Business', transport: 'sse', dcr: true, publicCallback: false, notes: 'DCR rejects non-loopback redirect URIs.' },
  { id: 'intercom', name: 'Intercom', url: 'https://mcp.intercom.com/mcp', description: 'Conversations and contacts', category: 'Support', transport: 'http', dcr: true, publicCallback: false, notes: 'DCR rejects non-loopback redirect URIs.' },
];

export function listHostedMcpCatalog(): HostedMcpEntry[] {
  return BUILT_IN.map(entry => ({ ...entry }));
}
