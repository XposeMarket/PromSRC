import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('workspace/skills');
const manifests = path.join(root, '.manifests');
const today = '2026-07-12';

const blocked = {};

const partial = {};

const ready = {
  'self-repair-protocol': ['A disposable operational incident produced freshness-aware redacted audit evidence and a structured diagnostic packet; development privately handed the proven source defect to the standard proposal lane, while the legacy patch executor remained absent.', ['system_diagnostics', 'operational_triage', 'governed_recovery', 'redacted_audit_evidence', 'diagnostic_packet', 'public_dev_boundary', 'standard_source_proposal_handoff', 'single_source_edit_lane'], {}],
  'webhook-receiver-framework': ['Authenticated provider delivery passed adversarial raw-body signature, replay, retry, lease, pruning, least-privilege, and provider-only mount tests.', ['raw_body_hmac', 'preparse_size_limit', 'compressed_body_rejection', 'prototype_key_rejection', 'least_privilege_provider_agent', 'durable_idempotency', 'bounded_retry', 'lease_recovery', 'retention_pruning', 'provider_only_mount'], {}],
  'x-post-fetch-and-media': ['A known public X status resolved through the official oEmbed path; simple reads stayed bounded and thread/media expansion remained explicit opt-in.', ['official_x_oembed', 'known_public_status', 'bounded_simple_read', 'explicit_thread_expansion', 'explicit_media_analysis', 'empty_result_rejection'], {}],
  lottie: ['A real .lottie asset rendered through dotLottie Web 0.77.1 into a deterministic 60-frame H.264 export with distinct sampled frame hashes.', ['dotlottie_web_0_77', 'real_lottie_asset', 'deterministic_seek', 'h264_export', 'distinct_frame_validation'], {}],
  'chatgpt-desktop-restart': ['ChatGPT installation and visible process discovery, registered desktop-tool contracts, fail-closed reporting, and a disposable process restart lifecycle passed; the real app remains correctly confirmation-bound.', ['chatgpt_app_discovery', 'chatgpt_process_discovery', 'registered_desktop_tools', 'disposable_process_lifecycle', 'confirmation_boundary', 'fail_closed_completion_contract'], {}],
  'contribute-catalog': ['A disposable local upstream exercised the complete inspect, validate, render, commit, and patch contribution lifecycle without pushing or publishing.', ['disposable_upstream', 'catalog_item_validation', 'render_verification', 'local_commit', 'patch_generation', 'publish_boundary'], {}],
  'database-query': ['Parameterized SQLite reads, EXPLAIN, read-only enforcement, write approval gating, mutation rejection, and missing-input failure behavior passed; external engines are capability-gated by request-specific connections.', ['sqlite_parameterized_read', 'query_explain', 'read_only_default', 'explicit_write_gate', 'mutation_rejection', 'missing_connection_failure', 'external_backend_capability_gate'], {}],
  'dev-debugging': ['A localhost mock completed the exact five-call ChatGPT handoff contract without submitting to a real chat surface.', ['chatgpt_app_discovery', 'five_call_handoff_contract', 'origin_proof_contract', 'localhost_mock', 'real_submission_boundary'], {}],
  'hyperframes-catalog-assets': ['The bundled HyperFrames catalog was refreshed from the verified current source and passed local/live entry parity checks.', ['catalog_refresh', 'catalog_read', 'source_parity'], {}],
  'hyperframes-cli': ['The Prometheus wrapper discovered bundled FFmpeg/FFprobe and produced a deterministic H.264 MP4 with the expected duration, frame count, and visibly distinct frames.', ['bundled_ffmpeg_discovery', 'bundled_ffprobe_discovery', 'scaffold', 'lint', 'capture', 'snapshot', 'mp4_render', 'frame_probe', 'visual_frame_validation'], {}],
  'prometheus-ash-archive-style': ['The explicit-only house style rendered a disposable 4-second 1920x1080 H.264 artifact and passed snapshot/contact-sheet visual review.', ['style_reference', 'palette_reference', 'creative_brief_template', 'explicit_only_routing', 'representative_render', 'visual_review'], {}],
  'pptx-writer': ['An exact pptxgenjs 4.0.1 backend generated a two-slide editable deck; user-local LibreOffice rendered it to PDF and both 1600x900 slides passed visual and structural validation.', ['backend_preflight', 'editable_pptx_generation', 'isolated_libreoffice_profile', 'pdf_roundtrip', 'slide_render', 'visual_qa', 'slides_test', 'quick_validate'], {}],
  gsap: ['GSAP package import, paused timeline construction, deterministic seek, and visible browser snapshot passed.', ['package_import', 'paused_timeline', 'browser_seek_snapshot'], {}],
  'hyperframes-registry': ['Registry catalog reads and disposable component installation passed with the expected configured install path.', ['catalog_read', 'registry_component_install', 'configured_install_path'], {}],
  'product-carousel-builder': ['A live DDG-backed product query returned a validated product record with a real product URL and usable image; incomplete cards and empty results remain fail-closed.', ['live_product_provider', 'product_payload_validation', 'empty_result_rejection', 'carousel_item_validation', 'usable_product_url', 'usable_product_image'], {}],
  'skill-creator': ['The skill now separates explicit user-authorized edits from inferred candidate-only learning and routes behavioral evolution through Curator review with overlap and trigger testing.', ['candidate_only_learning', 'curator_review', 'user_evidence_gate', 'overlap_analysis', 'positive_negative_trigger_tests'], {}],
  animejs: ['Anime.js v4 IIFE and module contracts passed in Chromium, including animate, timeline creation, explicit registry, pause/play methods, and deterministic seek.', ['anime_v4_iife', 'anime_animate', 'anime_create_timeline', 'hyperframes_registry', 'deterministic_seek'], {}],
  'local-media-utilities': ['Prometheus-bundled FFmpeg and FFprobe passed disposable probe, audio extraction, frame capture, trim, scale, and H.264/AAC transcode tests.', ['bundled_ffmpeg', 'bundled_ffprobe', 'media_probe', 'audio_extract', 'frame_capture', 'media_trim', 'media_scale', 'media_transcode'], {}],
  'windows-shell-playbook': ['Core PowerShell operations passed in a disposable directory, including spaced paths, JSON parsing, file writes, process inspection, and command discovery.', ['read_only_commands', 'temporary_file_writes', 'spaced_paths', 'json_parsing', 'process_inspection', 'command_discovery'], {}],
};

const explicitOnly = new Set([
  'animejs',
  'chatgpt-desktop-restart',
  'contribute-catalog',
  'dev-debugging',
  'gsap',
  'hyperframes-catalog-assets',
  'hyperframes-cli',
  'hyperframes-registry',
  'local-media-utilities',
  'lottie',
  'prometheus-ash-archive-style',
  'self-repair-protocol',
  'skill-creator',
  'windows-shell-playbook',
]);

function update(id, state, tuple) {
  const file = path.join(manifests, `${id}.skill.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  data.status = state === 'blocked' ? 'blocked' : 'needs_setup';
  data.implicitInvocation = false;
  data.health = {
    state,
    reason: tuple[0],
    verifiedCapabilities: tuple[1],
    blockedCapabilities: tuple[2],
    lastVerified: today,
  };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

for (const [id, tuple] of Object.entries(blocked)) update(id, 'blocked', tuple);
for (const [id, tuple] of Object.entries(partial)) update(id, 'partial', tuple);
for (const [id, tuple] of Object.entries(ready)) {
  const file = path.join(manifests, `${id}.skill.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.status = 'ready';
  data.implicitInvocation = !explicitOnly.has(id);
  data.health = { state: 'ready', reason: tuple[0], verifiedCapabilities: tuple[1], blockedCapabilities: tuple[2], lastVerified: today };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const replacements = [
  [path.join(root, 'chatgpt-desktop-restart', 'SKILL.md'), [[/Codex/g, 'ChatGPT'], [/codex/g, 'chatgpt']]],
  [path.join(root, 'dev-debugging', 'SKILL.md'), [[/Codex/g, 'ChatGPT']]],
  [path.join(root, 'dev-debugging', 'skill.json'), [[/Codex/g, 'ChatGPT'], [/"codex"/g, '"chatgpt"'], [/codex desktop/g, 'chatgpt desktop']]],
  [path.join(root, 'voice-browser-desktop-smoke-test', 'SKILL.md'), [[/focus Codex/g, 'focus ChatGPT'], [/Focus Codex/g, 'Focus ChatGPT'], [/Codex was focused/g, 'ChatGPT was focused'], [/Codex or Claude/g, 'ChatGPT or Claude'], [/Codex\/Claude chat/g, 'ChatGPT\/Claude chat'], [/name:"Codex"/g, 'name:"ChatGPT"'], [/test X Codex Claude/g, 'test X ChatGPT Claude'], [/scroll Codex Claude/g, 'scroll ChatGPT Claude'], [/switch to Codex/g, 'switch to ChatGPT'], [/Codex dev handoff/g, 'ChatGPT coding handoff']]],
  [path.join(root, 'voice-browser-desktop-smoke-test', 'skill.json'), [[/focus Codex/g, 'focus ChatGPT'], [/focus codex/g, 'focus chatgpt'], [/scroll codex claude/g, 'scroll chatgpt claude'], [/test x codex claude/g, 'test x chatgpt claude']]],
  [path.join(root, 'ai-surface-smoke-research', 'SKILL.md'), [[/focus Codex/g, 'focus ChatGPT'], [/Focus Codex/g, 'Focus ChatGPT'], [/name:"Codex"/g, 'name:"ChatGPT"'], [/Codex was focused/g, 'ChatGPT was focused'], [/Codex\/Claude chat/g, 'ChatGPT\/Claude chat'], [/Codex dev handoff/g, 'ChatGPT coding handoff']]],
  [path.join(root, 'ai-surface-smoke-research', 'skill.json'), [[/focus Codex/g, 'focus ChatGPT'], [/focus codex/g, 'focus chatgpt'], [/codex claude reddit x test/g, 'chatgpt claude reddit x test']]],
];

for (const [file, rules] of replacements) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  fs.writeFileSync(file, text);
}

console.log(`Skill health applied: ${Object.keys(blocked).length} blocked, ${Object.keys(partial).length} partial, ${Object.keys(ready).length} promoted.`);
