import assert from 'assert';
import { getBrowserToolDefinitions } from '../browser-tools.js';
import { dispatchIsolatedModelCall, shutdownModelTurnWorkerPool } from './model-call-dispatcher.js';
import { MODEL_CALL_REQUEST_VERSION } from './model-call-contract.js';

async function main(): Promise<void> {
  try {
    const tools = getBrowserToolDefinitions();
    const output = await dispatchIsolatedModelCall<any>({
      version: MODEL_CALL_REQUEST_VERSION,
      operation: 'echo',
      value: { tools } as any,
    });
    assert.equal(JSON.stringify(output).includes('cycle_omitted'), false);
    const echoedTools = output?.value?.tools as any[];
    const observe = echoedTools.find((tool) => tool?.function?.name === 'browser_observe');
    assert(Array.isArray(observe?.function?.parameters?.properties?.observe?.enum));
    console.log('model schema worker roundtrip regression passed');
  } finally {
    await shutdownModelTurnWorkerPool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
