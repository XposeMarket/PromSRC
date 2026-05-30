# Product Preview Architecture Analysis

## Executive Summary

Prometheus currently renders assistant messages as pure markdown text. ChatGPT renders rich product previews using a structured block system that separates:
1. **Tool layer** - tools return structured JSON (product objects)
2. **Model layer** - model decides when to include blocks
3. **UI layer** - frontend renders block types as components

This document cross-examines the current Prometheus architecture against ChatGPT's approach to plan the implementation.

---

## Current Prometheus Architecture

### Message Structure
```typescript
type ChatMessage = {
  role: 'user' | 'assistant' | 'ai';
  content: string;  // Plain markdown text only
  artifacts?: Artifact[];
  canvasFiles?: string[];
  steps?: Step[];
  approvalRequest?: ApprovalRequest;
  // ... other metadata
}
```

**Location:** `generated/public-web-ui/static/pages/ChatPage.js:createEmptyChatSession()`

**Key facts:**
- Messages stored in `session.history[]` as plain objects
- Content is always a string (markdown)
- No provision for structured block data
- Persisted to localStorage/server via `saveChatSessions()`

### Message Rendering Pipeline

1. **Load phase** - `renderChatMessages()` in ChatPage.js:7905
   - Maps over `window.chatHistory`
   - Filters internal messages
   - Collapses duplicate assistant entries

2. **Render phase** - per-message HTML generation
   - User messages → `renderUserMessageContent(msg)` → emoji/links only
   - Assistant messages → `renderAssistantContent(msg.content)` → markdown only
   - Special rendering for artifacts, images, videos, file pills

3. **Markdown rendering** - `renderMd()` utility from `utils.js`
   - Handles markdown → HTML via marked.js
   - Links, bold, code, lists, etc.
   - No structured component support

**No block renderer exists yet.** All content flows through markdown.

### SSE Streaming Architecture

**Location:** `src/gateway/routes/chat.router.ts:handleChat()`

Current SSE event types:
- `ui_preflight` - status messages
- `token` - streamed text tokens
- `tool_call` - tool invocation
- `tool_result` - tool completion
- `progress_state` - execution progress
- `info` - informational log lines
- `vision_injected` - image context
- Other specialized events (voice, orchestration, etc.)

**Key observation:** SSE stream is token-based and tool-based, NOT block-based. 
- No `ui_block` event type exists
- Assistant text accumulates as tokens until message finishes
- Blocks would need a new streaming concept

### Message Persistence & Serialization

**Location:** `generated/public-web-ui/static/pages/ChatPage.js:saveChatSessions()`

- Chat sessions stored in `localStorage[CHAT_SESSIONS_KEY]`
- Also synced to server via API
- `JSON.stringify()` of entire session object
- **Adding blocks would need to be serializable** (cannot contain React components)

---

## ChatGPT Architecture (from provided spec)

### Three-Layer Model

#### Layer 1: Tool Layer
```typescript
type ProductSearchResult = {
  type: "product_carousel";
  title: "Electric toothbrushes";
  items: [
    {
      id: "sonicare-4100";
      title: "Philips Sonicare 4100 Electric Toothbrush";
      price: "$38.49";
      rating: 4.2;
      reviews: 6755;
      merchant: "Amazon";
      imageUrl: "https://...";
      productUrl: "https://amazon.com/...";
      tag: "Best overall";
      description: "Top-rated for overall cleaning and durability.";
    }
  ]
}
```

- Tool returns **pure data**
- Structured JSON (serializable)
- No rendering logic embedded

#### Layer 2: Model/Action Layer
```typescript
type AssistantResponse = {
  message: string;  // Text preamble ("I'll search...")
  blocks: ChatBlock[];  // Structured components
  closing?: string;  // Follow-up text
}
```

Model decides: "Include a product_carousel block here instead of inline text."

#### Layer 3: UI Renderer Layer
```typescript
function renderMessageBlocks(container, blocks) {
  for (const block of blocks) {
    if (block.type === "markdown") renderMarkdownBlock(container, block);
    else if (block.type === "product_carousel") renderProductCarousel(container, block);
    else if (block.type === "image_carousel") renderImageCarousel(container, block);
    // ...
  }
}

function renderProductCarousel(block) {
  // CSS-based horizontal scrolling cards
  // Each card is a clickable link with image, title, price, rating
}
```

---

## Cross-Examination: Gaps in Prometheus

### 1. Message Schema Gap
**Issue:** Current `ChatMessage.content` is a string. Need `ChatMessage.blocks[]`.

```diff
type ChatMessage = {
  role: 'user' | 'assistant';
+ content?: string;  // Still present for backwards compat
+ blocks?: Array<
+   | { type: 'markdown'; text: string }
+   | { type: 'product_carousel'; title: string; items: ProductItem[] }
+   | { type: 'image_carousel'; ... }
+   | { type: 'file_preview'; ... }
+ >;
}
```

**Impact on persistence:** New field is JSON-serializable ✓

### 2. Tool Layer Gap
**Issue:** No product search tool exists.

**Current tools:** browser tools (click, fill), code tools, file ops, etc.
**Missing:** product_search, web_shopping, etc.

Options:
- Simple MVP: Use existing `web_search` + scrape results
- Long-term: Integrate SerpAPI, Rainforest API, Amazon PA API
- Current blocker: No product search capability at all

### 3. Model/Runtime Gap
**Issue:** Model doesn't know how to emit blocks; just outputs text.

**Current behavior:**
```
User: "Show me toothbrushes on Amazon"
Model output: "Here are some options: ..."
Runtime: Wraps in message.content string
```

**Needed behavior:**
```
User: "Show me toothbrushes on Amazon"
Tool result: { type: 'product_carousel', items: [...] }
Model output: "I found these options" + structured data
Runtime: Emits as blocks in message.blocks[]
```

**Complexity:** Model behavior change OR explicit tool-to-block mapping logic.

### 4. SSE Streaming Gap
**Issue:** No block-aware event type.

**Current:**
```
event: token
data: "I"

event: token
data: " found"

...

event: message_complete
data: { ... full message object with content string ... }
```

**Needed:**
```
event: text_block
data: { type: "markdown", text: "I found..." }

event: tool_call
data: { name: "product_search", args: {...} }

event: ui_block
data: { type: "product_carousel", items: [...] }

event: text_block
data: { type: "markdown", text: "My pick..." }

event: message_complete
data: { blocks: [...] }
```

### 5. Frontend Rendering Gap
**Issue:** `renderAssistantContent()` only handles markdown and staged text.

**Current code paths:**
- Background agent response (staged layout)
- Markdown text

**Needed:**
- `renderBlock(container, block)` dispatcher
- `renderProductCarousel(container, block)` component
- `renderImageCarousel(...)`, `renderFilePreview(...)`, etc.

**Good news:** ChatPage.js already handles complex renders:
- `renderAssistantGeneratedImages()` - image gallery
- `renderArtifacts()` - artifact display  
- `renderFilePills()` - file list with icons
- Process log rendering
- React steps rendering

**Pattern exists.** Just need to generalize it.

### 6. CSS Gap
**Issue:** No carousel styling.

**Current CSS exists for:**
- Messages, markdown, code blocks
- Grid layouts for images
- Table layouts

**Needed:**
```css
.product-carousel {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}

.product-card {
  width: 245px;
  flex: 0 0 auto;
  /* ... styling for image, title, price, rating ... */
}
```

---

## Implementation Priority

### Phase 1: Foundation (Lowest Risk)
1. **Message schema** - Add `blocks?: ChatBlock[]` field
   - Backwards compatible (optional, existing code ignores it)
   - Serializable
   - No runtime impact
   
2. **Block type definitions** - TypeScript types for block union
   - Clarifies what can be rendered
   - No API changes yet

3. **Frontend block renderer** - `renderBlock()` dispatcher
   - Pure UI code
   - No backend integration
   - Can test with mock data

### Phase 2: Product Search Integration
1. **Product search tool** - MVP using web_search + scraping
   - Or integrate SerpAPI
   - Returns structured product data
   
2. **Tool-to-block mapping** - Logic to convert tool results
   - Hook between tool execution and message building
   - Decide: explicit mapping or implicit model behavior?

### Phase 3: SSE & Streaming
1. **New SSE event type** - `ui_block` event
   - Sent when block-producing tool completes
   - Contains structured block data
   
2. **Stream aggregation** - Collect tokens, tool results, blocks
   - Build complete `message.blocks[]` array
   - Emit on message_complete

### Phase 4: Polish
1. **CSS & responsive design**
2. **Image caching/proxy** for product images
3. **Link handling** (open in same tab, new tab, etc.)
4. **Search logic** - when to trigger carousel vs. text

---

## Critical Design Decisions

### Decision 1: Block Emission Strategy
**Question:** How does the model decide to emit a block instead of text?

**Option A - Explicit:** Model outputs structured JSON in response
```
<product_carousel>
[{ id: "sonicare-4100", ... }]
</product_carousel>
```
- Pro: Clear and explicit
- Con: Model training/prompt engineering required

**Option B - Implicit:** Tool result automatically becomes a block
```
tool: product_search() → { type: "product_carousel", ... }
→ automatically wrapped as block
```
- Pro: Automatic, no model changes needed
- Con: All tool results become blocks (maybe not always desired)

**Option C - Hybrid:** Tool results + explicit model decision
```
Model can wrap tool results in narrative text + blocks
"I found these options [BLOCK: product_carousel]"
```
- Pro: Maximum flexibility
- Con: More complex implementation

**Recommendation:** Start with **Option C (Hybrid)** - gives model full control while letting tools return pure data.

### Decision 2: Product Data Source
**Question:** Where do product listings come from?

**Option A - MVP (web_search + scrape):**
- Use existing `web_search` tool
- Parse HTML → extract title, price, image, rating
- Low cost, no API keys
- Con: Brittle parsing, rate limiting risk

**Option B - SerpAPI Shopping:**
- https://serpapi.com/ (free tier: 100/month)
- Direct structured results, images already available
- Pro: Reliable, fast, images pre-hosted
- Con: API key needed, costs at scale

**Option C - Amazon Product API:**
- Official Amazon API (requires approval)
- Most accurate for Amazon-specific search
- Con: Slow approval, complex setup

**Recommendation:** Start with **Option A (MVP)**, migrate to **Option B (SerpAPI)** once MVP is proven. Option C can wait.

### Decision 3: Image Handling
**Question:** How to handle product images (CORS, caching, proxying)?

**Current approach in Prometheus:**
- Generated images stored as base64 data URIs
- Creative assets served from `/assets/`

**ChatGPT approach:**
- Images proxied through `/api/proxy-image?url=...`
- Prevents CORS issues
- Caches/validates images server-side

**Recommendation:** Implement image proxy endpoint for product images (can reuse for other external image sources too).

### Decision 4: Backwards Compatibility
**Question:** How to handle old messages (pre-blocks)?

**Option A - Dual render:**
```typescript
if (msg.blocks?.length) {
  renderBlocks(msg);
} else if (msg.content) {
  renderMarkdown(msg.content);
}
```
- Old messages still render fine
- No migration needed

**Recommendation:** **Option A** - it's the default.

---

## Files to Modify / Create

### Backend Changes
- `src/gateway/routes/chat.router.ts` - SSE event handling
- `src/types.ts` OR new `src/chat/message-types.ts` - Block type definitions
- `src/gateway/tools/` - New product search tool
- `src/gateway/session.ts` - Message storage (maybe)

### Frontend Changes
- `generated/public-web-ui/static/pages/ChatPage.js` - Message schema, rendering logic
- `generated/public-web-ui/static/utils.js` - New `renderBlock()` function
- `generated/public-web-ui/static/styles/components.css` - Product carousel styles
- New: `generated/public-web-ui/static/components/product-carousel.js` (optional)

### Configuration
- `.claude/settings.json` - Might need SerpAPI key management (later phase)

---

## Open Questions for Planning

1. **Product search MVP scope:** How many results? Which fields? Exact format?
2. **When to show carousel:** Only for "show me products" queries? All search results?
3. **Block composition:** Can a message have mixed blocks (text + carousel + text)?
4. **Streaming:** Should carousel appear inline or after text fully streams?
5. **User actions:** Copy/save/compare products - any special handling?
6. **Mobile:** How should carousel scroll on mobile? Current code has mobile view.
7. **Accessibility:** Alt text for images? ARIA labels for carousel?

