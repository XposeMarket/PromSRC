import assert from 'node:assert/strict';
import { PrometheusExtensionRuntimeRegistry, buildConnectorWrapperDefinition } from './runtime-registry';
import github from './bundled/connectors/github/runtime';
import gmail from './bundled/connectors/gmail/runtime';
import googleDrive from './bundled/connectors/google_drive/runtime';

// Regression: generated connector wrappers merged every action's arguments and
// the first declaration of a name won. connector_github and connector_gmail
// advertised `body` as an object (from api_request) although comment, create_pr,
// create_issue and send_email need a string; Google Drive advertised `query` as an
// object for search and list_files; GitHub `per_page` said "Number of check runs"
// for every list action.

const registry = new PrometheusExtensionRuntimeRegistry();
for (const ext of [github, gmail, googleDrive]) {
  const api = new Proxy({} as any, {
    get: (_target, prop) => {
      if (prop === 'registerTool') return (tool: any) => registry.registerTool(ext.id, tool);
      if (prop === 'registerConnector') return (connector: any) => registry.registerConnector(ext.id, connector);
      return () => undefined;
    },
  });
  ext.register(api);
}
const specs = registry.listConnectorWrapperSpecs({ connectedOnly: false });
const wrapper = (id: string) => {
  const spec = specs.find((item) => item.connectorId === id);
  assert.ok(spec, `${id} wrapper spec is built`);
  return buildConnectorWrapperDefinition(spec!).function.parameters.properties as Record<string, any>;
};

/** A string value is valid unless the schema pins a type that excludes string. */
const acceptsString = (schema: any) => {
  if (!schema) return false;
  if (schema.type === undefined) return true;
  return Array.isArray(schema.type) ? schema.type.includes('string') : schema.type === 'string';
};
const noTypeArrays = (props: Record<string, any>) => {
  for (const [key, schema] of Object.entries(props)) assert.ok(!Array.isArray(schema?.type), `${key} must not use a type array`);
};

const gh = wrapper('github');
assert.ok(acceptsString(gh.body), 'connector_github body accepts a string');
assert.match(gh.body.description, /string for [^;]*comment/);
assert.match(gh.body.description, /object for [^;]*api_request/);
assert.ok(!/check runs/i.test(String(gh.per_page?.description || '')), 'per_page no longer says check runs');
assert.equal(gh.per_page.type, 'number');
noTypeArrays(gh);

const mail = wrapper('gmail');
assert.ok(acceptsString(mail.body), 'connector_gmail body accepts a string');
assert.match(mail.body.description, /send_email/);
noTypeArrays(mail);

const drive = wrapper('google_drive');
assert.ok(acceptsString(drive.query), 'connector_gdrive query accepts a string');
assert.match(drive.query.description, /string for [^;]*search/);
noTypeArrays(drive);

// Every generated property stays a valid provider schema: arrays keep items,
// objects without a type are only produced for conflicting declarations.
for (const props of [gh, mail, drive]) {
  for (const [key, schema] of Object.entries(props)) {
    if (schema?.type === 'array') assert.ok(schema.items, `${key} array keeps items`);
  }
}
console.log('connector wrapper shared-argument regression passed');
