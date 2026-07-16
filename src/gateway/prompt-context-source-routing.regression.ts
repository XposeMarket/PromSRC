import assert from 'node:assert/strict';
import { detectToolCategories } from './prompt-context';
import { isWorkspacePrometheusSourceCopyPath } from './agents-runtime/subagent-executor';

function has(message: string, category: string): boolean {
  return detectToolCategories(message).has(category);
}

assert.equal(
  has('Inspect src/gateway/routes/chat.router.ts and explain the admission flow.', 'prometheus_source_read'),
  true,
);
assert.equal(
  has('Read src/runtime/tool-category-manifest.ts.', 'prometheus_source_read'),
  true,
);
assert.equal(
  has('Check web-ui/src/pages/ChatPage.js for the mobile rendering issue.', 'prometheus_source_read'),
  true,
);
assert.equal(
  has('Fix src/gateway/routes/chat.router.ts after you identify the bug.', 'prometheus_source_write'),
  true,
);
assert.equal(
  has('In Prometheus, inspect src/config/config.ts for the gateway setting.', 'prometheus_source_read'),
  true,
);

assert.equal(
  has('Build my new React project in src/components and add a button.', 'prometheus_source_read'),
  false,
  'an ordinary user-project src path must remain a workspace file task',
);
assert.equal(
  has('Open src/index.ts from the cloned customer project.', 'prometheus_source_read'),
  false,
);
assert.equal(
  has('Inspect gateway behavior but do not read any source files.', 'prometheus_source_read'),
  false,
  'a generic gateway mention without a source path must not force dev-source tools',
);
assert.equal(isWorkspacePrometheusSourceCopyPath('repos/PromSRC-compare/src/gateway/routes/chat.router.ts'), true);
assert.equal(isWorkspacePrometheusSourceCopyPath('workspace/repos/PromSRC-rescue/src/gateway/routes/chat.router.ts'), true);
assert.equal(isWorkspacePrometheusSourceCopyPath('repos/customer-app/src/index.ts'), false);

console.log('prompt-context source-routing regression passed');
