> Raul's profile — identity, communication style, and projects. Prometheus runbooks, tools, and workflows live in **MEMORY.md**, **skills**, and **workspace/self/**.

---

## identity
- Name: Raul
- Platform: Windows 11
- Stack: TypeScript / Node.js
- Version control: Git
- Creator of Prometheus; dev-server builds have broader capabilities than the public Electron app — use that for internal feasibility/UX reasoning only. [2026-04-22]

## accounts

## communication_style
- Friendly and proactive — likes Prom to notice useful next steps and offer help.
- Token/cost sensitive on pricing questions — keep those answers very brief. [2026-03-18]
- Responds well to polished interactive outputs. [2026-03-18]
- Proposals must be fully concrete and execution-ready; rejects conceptual or pseudocode-only snippets. [2026-03-22]
- On casual chat, respond directly — avoid unnecessary tool calls unless execution is clearly requested. [2026-03-27]
- Generated X/Twitter posts and replies: no em dashes (—); use periods, commas, colons, or hyphens. [2026-07-07]
- Xpose positioning: target local businesses without explicitly naming Frederick, Maryland in messaging unless asked. [2026-04-10]
- When repo or file state is unclear, verify the real state then continue — not speculative back-and-forth. [2026-04-10]
- Xpose website work: implement once aligned; brief confirmations when he requests them. [2026-04-10]
- Local lead hunting: browser-first live listings, saved evidence, qualification — see skill **local-lead-hunting** (incl. Xpose Market flow). [2026-04-11]
- Desktop: screenshot-grounded automation; **execute immediately** on simple navigation (e.g. scroll Codex) — stay brief/silent after acting unless verification matters. [2026-05-16] [2026-07-07]
- Codex desktop handoff mechanics: **dev-debugging** skill only (not this file). [2026-07-07]
- Creative/HyperFrames: avoid purple-blue-cyan gradient “AI SaaS” aesthetics unless brand-required; prefer editorial, industrial, real UI, physical materials. [2026-05-24–25]
- Creative video: slower scene holds for readable text; landscape default for Prometheus release-thread / promo clips unless he asks portrait. [2026-05-28] [2026-06-05]
- High-consideration shopping: Product Carousel Builder — consensus models first, then product search for live prices. [2026-06-05]
- Voice/browser-desktop smoke tests: send fresh screenshots to origin after visible desktop focus/actions unless he says not to. [2026-05-21]
- Agent choices: use **ask_prometheus_questions** for decisions that block work — not prose option lists (see MEMORY `operational_rules`). [2026-06-15]
- Prometheus internals fixes: default **request_dev_source_edit**; read **workspace/self/** and open live UI to verify — see **src-edit-proposal-rigor** and MEMORY. [2026-06-16–17]

## projects
- **Xpose Market** — marketing/website agency; priority is a client-converting site and lead gen; local small businesses first (Frederick area operationally). [2026-04-10]
- Grow social presence on **X/Twitter**. [2026-04-10]
- **Day trading** — wants support around emotional pressure and execution discipline (NY open pattern in MEMORY). [2026-04-10] [2026-06-15]
- Spends most time coding; built Prometheus to act as a real assistant and cut manual coding/admin. [2026-04-10]
- Intent (2026-04-11): standing teams for Xpose website rebuild, Xpose lead gen, and nightly code bug-hunt — confirm current setup in MEMORY/automation if needed.
- Voice preference: Cedar sounded most normal; prefers a deeper Prometheus/myth tone if available. [2026-05-16]
- Wants Prom to help track DoorDash income, active vs total time, gas/fuel use, mileage, and discretionary spending so earnings can compound into retained cash. User plans to share ongoing income stats for lightweight running ledger and practical optimization. [2026-07-18]
- New PS Vita project concept (2026-07-18): turn a modded Vita into a low-latency phone/PC streaming handheld. Target experiences: cast ordinary video to the Vita; mirror/control an Android phone from the Vita; play Android games such as Call of Duty Mobile on the Vita using native Vita controls. Likely architecture is an Android host/helper app plus a native Vita H.264 receiver and bidirectional control channel. DRM-protected services such as Netflix are a separate constrained track because Android secure video may mirror as a black screen. [2026-07-18]
- VitaLink iPhone architecture investigation (2026-07-18): Raul wants the Vita to receive a ReplayKit screen/audio stream over Wi-Fi while presenting itself to a stock iPhone as a Bluetooth controller, especially for COD Mobile. Streaming is feasible; the decisive research risk is Vita Bluetooth HID peripheral mode. Vita uses Bluetooth Classic 2.1+EDR and existing public Vita Bluetooth work is host-side; no public VitaSDK/homebrew implementation was found that advertises the Vita as a HID peripheral. COD Mobile officially supports Xbox One/Series, DualShock 4 (except first gen), DualSense, and Backbone One; generic controllers may pair with iOS but are not reliably recognized. Recommended gates: first prove Vita discoverability/local SDP from a kernel plugin, then one-key Classic HID keyboard, then generic gamepad recognition, and only then integrate ReplayKit H.264 streaming. [2026-07-18]