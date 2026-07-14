# Phase 4B Creative Runtime Verification

Date: 2026-07-12

Scope: `gsap`, `lottie`, `hyperframes-cli`, `hyperframes-media`, `hyperframes-registry`, `hyperframes-catalog-assets`, and `website-to-hyperframes`.

## Results

| Skill | Status | Verified | Remaining blocker |
|---|---|---|---|
| `gsap` | ready | Installed GSAP 3.15.0; a paused timeline rendered at a sought timestamp in a real HyperFrames browser snapshot. | None for the documented adapter workflow. |
| `lottie` | partial | Installed `lottie-web` loaded and visibly rendered a known package test animation from a local JSON asset in a sought HyperFrames snapshot. | `@lottiefiles/dotlottie-web` and a known-valid `.lottie` asset are absent, so the dotLottie branch remains unverified. |
| `hyperframes-cli` | partial | HyperFrames 0.6.20 completed scaffold, lint, info, inspect, snapshot, catalog, registry install, and website capture operations against disposable inputs. | MP4 render fails closed because FFmpeg and FFprobe are not available on `PATH`. The CLI also reports 0.7.54 available. |
| `hyperframes-media` | partial | Voice discovery works and a disposable SRT imported into normalized `transcript.json`. | Local TTS, Whisper transcription, and background removal cannot be claimed: `kokoro_onnx`, `soundfile`, `faster_whisper`, `onnxruntime`, and `transparent_background` are absent. No dependency was installed. |
| `hyperframes-registry` | ready | Live catalog discovery returned 134 entries; `add grain-overlay --no-clipboard --json` wrote the component into a disposable project's configured component path. | None for catalog discovery and project-local installation. Upstream contribution/publishing belongs to `contribute-catalog`. |
| `hyperframes-catalog-assets` | partial | Its local manifest parses and the live official CLI catalog is reachable. | The bundled manifest contains 47 entries while the live catalog contains 134, so it is materially stale and must not claim canonical completeness. |
| `website-to-hyperframes` | partial | A disposable branded local site was captured successfully: title, description, two screenshots, one detected section, colors, and fonts were extracted. | A complete website-to-MP4 export cannot pass in this environment until FFmpeg/FFprobe are available. |

## Fail-closed observations

- HyperFrames snapshots do not prove MP4 export. The render command was run and returned the explicit `FFmpeg not found` failure; no output file was presented as successful.
- The first hand-written Lottie fixture did not render visibly. It was replaced with a known animation shipped in `lottie-web`; only that proven JSON path is credited.
- HyperFrames 0.6.20 accepted `--output` for snapshot and `--dir` for capture without placing output at those requested paths. Tests located the CLI's actual output rather than claiming the requested destinations worked.
- No missing model, media, or encoder dependency was installed during verification.

## Recommended health tuples

- `gsap`: ready; capabilities `package_import`, `paused_timeline`, `browser_seek_snapshot`.
- `lottie`: partial; capabilities `lottie_web_load`, `lottie_web_seek`, `local_json_asset_render`; blocker `dotlottie_asset_render`.
- `hyperframes-cli`: partial; capabilities `scaffold`, `lint`, `info`, `inspect`, `snapshot`, `capture`; blocker `mp4_render` requiring FFmpeg/FFprobe.
- `hyperframes-media`: partial; capabilities `voice_discovery`, `srt_import`; blockers `local_tts`, `whisper_transcription`, `background_removal` requiring the documented Python/model stack.
- `hyperframes-registry`: ready; capabilities `catalog_read`, `registry_component_install`, `configured_install_path`.
- `hyperframes-catalog-assets`: partial; capability `catalog_read`; blocker `catalog_refresh` because 47 bundled entries do not cover 134 live entries.
- `website-to-hyperframes`: partial; capabilities `local_site_capture`, `metadata_extract`, `screenshot_capture`; blocker `complete_video_export` requiring a working renderer.
