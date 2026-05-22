---
name: image-analyst
description: Use this skill when images have been uploaded to the chat or when the user wants to analyze a visual file. Works best with vision-capable providers (OpenAI, OpenAI Codex).
emoji: "🧩"
version: 1.0.0
---

# Image Analyst

Use this skill when images have been uploaded to the chat or when the user wants to analyze a visual file. Works best with vision-capable providers (OpenAI, OpenAI Codex).

---

## 1. When to Use

| User input | Analysis type |
|---|---|
| Screenshot of app/website | UI element inventory, layout critique, UX issues |
| Chart or graph | Data extraction, trend reading, axis/label parsing |
| Diagram (flowchart, architecture, ER diagram) | Element identification, relationship mapping |
| Handwritten notes or whiteboard photo | OCR text extraction, idea summary |
| Design mockup | Feedback, component list, style guide extraction |
| Photo of a document | Text extraction, key information summary |
| Error screenshot | Error message extraction, diagnosis |
| Any image + a question | Answer the question using visual context |

---

## 2. Analysis Framework

For every image, deliver in this order:

### A. Describe (What am I looking at?)
- Type of image (screenshot, chart, diagram, photo, etc.)
- Overall subject/context in one sentence
- Dimensions or rough aspect ratio (if relevant)

### B. Extract (What does it contain?)
Pull out all observable data:
- **Text** — every visible string, label, heading, value, placeholder, error message
- **UI elements** — buttons, inputs, dropdowns, nav items, modals (for screenshots)
- **Data values** — chart Y-axis values, percentages, table rows, key metrics (for charts/tables)
- **Structure** — sections, panels, boxes, connections, hierarchy (for diagrams)
- **Colors/style** — primary palette, typography cues (for design mockups)

### C. Interpret (What does it mean?)
- What is the main takeaway or insight?
- For charts: what trend or comparison is being shown?
- For UI: what is the user expected to do here?
- For diagrams: what is the system/process being described?
- For error screenshots: what went wrong and likely why?

### D. Act (What should happen next?)
Provide specific, actionable output based on the user's request:
- Answer their specific question if they asked one
- List issues found (bugs, UX problems, data anomalies)
- Suggest improvements or next steps
- Extract structured data (tables, JSON, markdown) if that's the goal

---

## 3. Output Templates

### For UI/Screenshot Analysis
```
## Image Analysis: [Page/Component Name]

**Type:** App screenshot — [web/desktop/mobile]
**Summary:** [One sentence about what this shows]

### Elements Found
- Navigation: [items]
- Key content: [headings, body copy]
- Interactive: [buttons, inputs, CTAs]
- Status indicators: [errors, badges, notifications]

### Key Observations
1. [Most important thing you see]
2. [Second observation]
3. [Third observation]

### Issues / UX Notes
- [Issue or improvement opportunity]

### Recommended Action
[What to do based on this screenshot]
```

### For Charts/Data
```
## Chart Analysis

**Chart type:** [Line, bar, pie, scatter, etc.]
**X-axis:** [label and range]
**Y-axis:** [label and range]
**Data series:** [series names]

### Key Values
| [X] | [Y] |
|---|---|
| [val] | [val] |

### Trend/Insight
[Main takeaway in 1-2 sentences]
```

### For Diagrams
```
## Diagram Analysis

**Type:** [Flowchart / ER / Architecture / Mind Map / etc.]
**Subject:** [What system or process]

### Components
- [Component A] — [role]
- [Component B] — [role]

### Relationships
- [A] → [B]: [relationship description]

### Summary
[One paragraph describing what this diagram communicates]
```

---

## 4. OCR Mode (Reading Text from Images)

When the goal is just to extract text:
1. Read every visible string, left to right, top to bottom
2. Preserve formatting cues (headings look bigger → use ## in output)
3. Mark uncertain text with [?]
4. Preserve numbers exactly (don't round or infer)
5. Wrap extracted text in a code block for easy copying

---

## 5. Vision Limitations

Be honest about:
- **Low resolution:** Mark blurry/pixelated text as `[unclear]`
- **Cut-off content:** Note if image appears cropped
- **Color-blind safe:** Describe charts by shape/position, not just color
- **Dynamic content:** Screenshots are static — note if time-sensitive data shown

---

## 6. Multi-Image Workflow

If multiple images are uploaded in one message:
1. Number them: "Image 1:", "Image 2:", etc.
2. Analyze each separately under its own heading
3. Then synthesize: "Comparing all images..." section at the end
4. Note relationships or contradictions between images