import { z } from 'zod';
import type { ExtensionDescriptor } from './types.js';

const ExtensionKindSchema = z.enum(['provider', 'connector', 'mcp_preset']);
const ExtensionSetupFieldInputSchema = z.enum([
  'text',
  'password',
  'select',
  'textarea',
  'checkbox',
]);
const ExtensionSetupAuthTypeSchema = z.enum([
  'oauth',
  'api_key',
  'oauth_setup_token',
  'browser_session',
  'none',
]);

const ExtensionSetupFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  input: ExtensionSetupFieldInputSchema,
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  secret: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const ExtensionPermissionSchema = z.object({
  icon: z.string().min(1),
  label: z.string().min(1),
});

const ExtensionRuntimeOptionsSchema = z.object({
  endpoint: z.string().optional(),
  chatCompletionsPath: z.string().optional(),
  modelsPath: z.string().optional(),
  messagesPath: z.string().optional(),
  staticModels: z.array(z.string()).optional(),
  defaultHeaders: z.record(z.string()).optional(),
  authHeader: z.enum(['bearer', 'x-api-key']).optional(),
  supportsLiveModelDiscovery: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
});

export const ExtensionDescriptorSchema = z.object({
  id: z.string().min(1),
  kind: ExtensionKindSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  enabledByDefault: z.boolean().optional(),
  docsUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
  runtime: z.object({
    binding: z.string().min(1),
    options: ExtensionRuntimeOptionsSchema.optional(),
  }),
  ui: z
    .object({
      color: z.string().optional(),
      permissions: z.array(ExtensionPermissionSchema).optional(),
    })
    .optional(),
  ownership: z
    .object({
      providerIds: z.array(z.string()).optional(),
      modelPrefixes: z.array(z.string()).optional(),
      toolNamespaces: z.array(z.string()).optional(),
      capabilities: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
    })
    .optional(),
  setup: z
    .object({
      authType: ExtensionSetupAuthTypeSchema.optional(),
      fields: z.array(ExtensionSetupFieldSchema).optional(),
      envVars: z.array(z.string()).optional(),
      scopes: z.array(z.string()).optional(),
      callback: z
        .object({
          port: z.number().int().positive().optional(),
          path: z.string().optional(),
        })
        .optional(),
      browserLogin: z
        .object({
          url: z.string().min(1),
          checkUrl: z.string().min(1),
        })
        .optional(),
      docsUrl: z.string().optional(),
      docsHint: z.string().optional(),
      statusMode: z.enum(['generic', 'oauth_connector', 'codex_oauth', 'anthropic_setup_token']).optional(),
    })
    .optional(),
  config: z
    .object({
      schema: z.record(z.unknown()).optional(),
      uiHints: z.record(z.object({ label: z.string().optional(), help: z.string().optional() })).optional(),
      defaults: z.record(z.unknown()).optional(),
    })
    .optional(),
  mcpPreset: z
    .object({
      transport: z.enum(['stdio', 'sse', 'http']).optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      envTemplate: z.record(z.string()).optional(),
      urlTemplate: z.string().optional(),
      headersTemplate: z.record(z.string()).optional(),
    })
    .optional(),
});

export function parseExtensionDescriptor(raw: unknown, sourcePath: string): ExtensionDescriptor {
  const result = ExtensionDescriptorSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid extension descriptor at ${sourcePath}: ${message}`);
  }
  return result.data as ExtensionDescriptor;
}
