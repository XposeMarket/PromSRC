import assert from 'assert';
import {
  boundToolMessageContentForModelContext,
  boundToolTextForModelContext,
  buildToolOutputArtifactPreview,
} from '../tool-result-model-context';

function main(): void {
  const rawRef = `tool-result-raw:session-${'a'.repeat(16)}/${'b'.repeat(64)}.txt`;
  const source = `${'head'.repeat(3_000)}MIDDLE_SENTINEL${'tail'.repeat(3_000)}`;

  const bounded = boundToolTextForModelContext(source, 'workspace_read', 12_000, rawRef);
  assert.ok(bounded.length < source.length, 'large source output should still be bounded');
  assert.ok(bounded.includes('[TOOL_RESULT_BOUNDED]'));
  assert.ok(bounded.includes(rawRef), 'bounded output must carry the exact retrievable raw reference');
  assert.ok(bounded.includes('tool_result_read'), 'bounded output must explain the recovery tool');
  assert.ok(!bounded.includes('MIDDLE_SENTINEL'), 'fixture must prove that the omitted range is real');

  const withoutRef = boundToolTextForModelContext(source, 'workspace_read', 12_000);
  assert.ok(withoutRef.includes('No raw retrieval reference is available'));
  assert.ok(!withoutRef.includes('full output remains in tool logs/raw storage'));

  const small = 'small result';
  assert.equal(boundToolTextForModelContext(small, 'workspace_read', 12_000, rawRef), small);

  const multipart = boundToolMessageContentForModelContext([
    { type: 'text', text: source },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } },
  ], 'desktop_screenshot', rawRef);
  assert.ok(Array.isArray(multipart));
  assert.ok(String(multipart[0].text).includes(rawRef));
  assert.equal(multipart[1].type, 'image_url');

  const skill = 'skill'.repeat(5_000);
  assert.strictEqual(boundToolMessageContentForModelContext(skill, 'skill_read', rawRef), skill);

  const artifactSource = `${'first-line\n'.repeat(900)}ARTIFACT_MIDDLE${'last-line\n'.repeat(900)}`;
  const artifactPreview = buildToolOutputArtifactPreview({
    toolName: 'read_file',
    text: artifactSource,
    inlineLimit: 12_000,
    artifactPath: 'temp/tool-results/read-file-fixture.txt',
    summary: 'requested read exceeded its inline budget',
  });
  assert.ok(artifactPreview.includes('requested read exceeded its inline budget'));
  assert.ok(artifactPreview.includes('temp/tool-results/read-file-fixture.txt'));
  assert.ok(artifactPreview.includes('first-line'));
  assert.ok(artifactPreview.includes('last-line'));
  assert.ok(!artifactPreview.includes('ARTIFACT_MIDDLE'));
  assert.ok(artifactPreview.includes('chars omitted from inline preview'));

  console.log('tool-result model-context regression: ok');
}

main();
