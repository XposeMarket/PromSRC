import assert from 'assert';
import { detectVisualOutputIntent, selectPresentationInstruction } from './visual-intent';
import { PROM_VIZ_REFERENCE } from '../gateway/prom-viz-reference';

assert.equal(detectVisualOutputIntent('fix the bug in foo.ts').visual, false, 'coding fix has no visual intent');
assert.equal(detectVisualOutputIntent('chart my weekly spend').visual, true, 'chart request is visual');
assert.equal(detectVisualOutputIntent('compare these 3 laptops').visual, true, 'comparison is visual');
assert.equal(detectVisualOutputIntent('yo').visual, false, 'greeting has no visual intent');
assert.equal(detectVisualOutputIntent('make it bigger', { recentAssistantText: 'Here it is:\n```html\n<div></div>\n```' }).visual, true, 'continuation of a visual is visual');

const core = selectPresentationInstruction({ executionMode: 'interactive', routingText: 'fix the bug in foo.ts' });
assert.ok(!core.includes(PROM_VIZ_REFERENCE), 'core presentation must not include the Viz Kit reference');
assert.ok(core.length <= 1100, `core presentation must be compact (got ${core.length})`);

const full = selectPresentationInstruction({ executionMode: 'interactive', routingText: 'chart my weekly spend' });
assert.ok(full.includes(PROM_VIZ_REFERENCE), 'visual intent must include the Viz Kit reference');

assert.equal(selectPresentationInstruction({ executionMode: 'heartbeat', routingText: 'chart my weekly spend' }), '', 'heartbeat gets no presentation block');

const small = selectPresentationInstruction({ executionMode: 'interactive', routingText: 'chart my weekly spend', smallContext: true });
assert.equal(small, 'Answer in plain text or markdown. Use tools to act; keep replies short.', 'small-context returns the compact string');

console.log('visual-intent: all assertions passed');
