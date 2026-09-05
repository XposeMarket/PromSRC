import assert from 'node:assert/strict';
import { INSTRUCTION_SEGMENT_REGISTRY, validateInstructionSegmentRegistry } from './instruction-segment-registry';

assert.deepEqual(validateInstructionSegmentRegistry(), []);
const duplicate = [...INSTRUCTION_SEGMENT_REGISTRY.slice(0, 2), { ...INSTRUCTION_SEGMENT_REGISTRY[0], order: INSTRUCTION_SEGMENT_REGISTRY[1].order }];
const issues = validateInstructionSegmentRegistry(duplicate);
assert.deepEqual(issues.map((issue) => issue.code), ['duplicate_id', 'duplicate_order']);
assert.equal(issues.every((issue) => issue.segmentId), true);
console.log('instruction registry provenance regression checks passed');