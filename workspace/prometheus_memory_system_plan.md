# Prometheus Long-Term Memory System Plan

## Purpose

This document defines the plan for adding a true long-term memory system to Prometheus. The goal is to move beyond same-day context and create a searchable, structured memory layer that helps Prometheus remember past conversations, project decisions, task history, and user preferences across time.

This system is based on the same general ideas that make Obsidian-style knowledge systems and external AI memory layers useful:

- keep raw history available
- avoid injecting everything into the prompt
- retrieve only what matters when needed
- promote important information into cleaner long-term memory
- connect notes, sessions, tasks, and facts into a searchable knowledge graph

Prometheus already has part of this system today through intraday notes. This plan expands that into a full archive, indexing, retrieval, and memory-promotion pipeline.

---

## What Prometheus already has

Prometheus already includes a strong short-horizon memory pattern:

- an intraday note feature that creates a note for the current date
- automatic writing to that note by tasks, background tasks, scheduled tasks, and agents
- injection of truncated current-day notes into the model each turn
- shared use of the note system as a scratchpad and continuity layer

That means Prometheus already has:

- same-day continuity
- operational journaling
- a shared workspace scratchpad
- between-session context for the current day

What it does **not** yet have is a true long-term retrieval system for older notes, archived sessions, and historical decisions.

---

## What this new memory system is for

The new memory system exists to solve problems like:

- “What have we talked about regarding X?”
- “What decisions did we make about this feature two weeks ago?”
- “What changed over time on this project?”
- “What user preferences have shown up repeatedly?”
- “What happened in previous sessions that matters to this task?”
- “What did we say, what did we do, and what did we decide?”

In simple terms, this system is for:

- long-horizon recall
- cross-session continuity
- cross-source search
- project memory
- better reasoning over past work
- avoiding repeated re-discovery of the same ideas and fixes

---

## Design philosophy

The memory system should follow one core rule:

**Preserve broadly, promote selectively, retrieve narrowly, inject minimally.**

That means:

- store and archive a lot
- turn the most important parts into cleaner memory objects
- search only when historical context is needed
- keep always-injected memory small and focused

This is important because injecting too much memory into every prompt causes:

- bloated context
- stale ideas resurfacing as if they are current
- contradictions between old and new plans
- weaker performance for smaller local models
- higher noise and worse decision-making

So the system should not try to make the model “see everything all the time.” It should make the model able to **find the right things at the right time**.

---

## What this is based on

This system is based on proven external-memory patterns used in note-based AI systems and Obsidian-style workflows:

1. **A raw archive exists outside the active prompt**
   - conversations, notes, logs, and summaries are kept as durable source material

2. **Important knowledge is promoted into cleaner memory objects**
   - summaries, facts, decisions, preferences, open loops

3. **A retrieval layer sits on top**
   - the AI searches when it needs long-term context

4. **Always-loaded memory stays small**
   - current state, current day, stable profile, active work only

5. **Relations matter**
   - sessions, notes, tasks, projects, and entities should be linked so memory becomes navigable and visualizable

Prometheus will use this same overall model, but fitted to its own architecture, including:

- intraday notes
- background tasks
- scheduled tasks
- subagents
- task journals
- project workspaces
- small local LLM constraints

---

## The 4 memory layers

The system should be designed as four memory layers.

### 1. Live injected context

This is the small set of memory that is directly injected into the model on normal turns.

This should include things like:

- current-day intraday note or a truncated version of it
- active task state
- short stable user profile memory
- short stable project/workspace memory
- current session state

This layer should stay small.

### 2. Raw archives

This is the full stored historical record.

This should include:

- raw chat sessions
- raw intraday notes
- task journals
- scheduled task logs
- background task logs
- manual notes
- project notes
- session files

These should be preserved, but not injected every turn.

### 3. Distilled memory

This is the clean promoted memory derived from raw archives.

This should include:

- session summaries
- daily summaries
- important decisions
n- durable facts
- user preferences
- open loops / unresolved items
- project summaries
- architecture notes
- recurring workflow rules

This layer is much more useful for retrieval than raw logs.

### 4. Retrieval and relationship index

This is the searchable layer that sits on top of raw and distilled memory.

This layer should support:

- keyword search
- semantic search using embeddings
- metadata filtering
- relationship expansion
- timeline-style retrieval
- relevance ranking

This is the part Prometheus queries when it needs to remember something older.

---

## Sources Prometheus should index

The memory system should ingest both operational and conversational sources.

### Source types to include

- chat sessions
- intraday notes
- background task journals
- scheduled task logs
- task completion summaries
- project notes
- architecture/design notes
- user memory notes
- durable fact records
- decision records
- daily summaries
- session summaries

### Why both chats and notes matter

Chats capture:

- ideas
- reasoning
- explanations
- brainstorming
- user intent
- design discussions

Notes and logs capture:

- what actually happened
- progress
- execution traces
- updates across the day
- task follow-through

Together they give:

- what was said
- what was done
- what was decided

That combination is much stronger than either one alone.

---

## Do files need to be markdown?

No. Files do not need to be markdown.

The source-of-truth storage can remain in whatever native format makes sense:

- JSON
- raw transcript format
- database rows
- log files
- markdown notes

The important thing is that all memory is normalized into a shared internal format for indexing and retrieval.

That said, markdown is still very useful for:

- human-readable summaries
- decision notes
- project memory
- daily summaries
- architecture notes
- note graph visualization

Recommended split:

- keep raw source files in their original format
- create normalized summaries and notes in markdown
- store structured facts and metadata in JSON or database tables
- store embeddings and chunk references in the memory index/database

---

## How the system should work at a high level

The memory system should work in two phases:

### Phase A: write and index

Whenever new information is created, Prometheus decides how to archive it, summarize it, and index it.

This happens after:

- a chat session
- a task run
- a background task checkpoint
- a scheduled task run
- a day rollover
- a major decision
- an explicit “remember this” user instruction

### Phase B: search and retrieve

When Prometheus is answering or working on something, it decides whether long-term memory is needed.

If yes, it searches the index, reads the most relevant results, and uses them as evidence/context.

This happens when:

- the user references previous discussions
- the user asks for all information about a topic
- a task continues work from previous days/sessions
- the system needs historical project context
- a project/design/architecture question likely depends on past decisions

---

## Backend logic in plain English

### Step 1: store the raw source

When something happens in Prometheus, keep the raw source material.

Examples:

- save the chat transcript
- save the daily note
- save the task log
- save the session file

This raw source is the evidence layer.

### Step 2: normalize it

Different source types look different. A transcript is not shaped like a note, and a note is not shaped like a log.

So Prometheus should convert each item into a common internal memory record format.

Each memory record should have fields like:

- id
- source type
- title
- content
- date/time
- workspace/project
- agent/task/session reference
- tags/entities
- related ids
- priority
- durability

This makes all memory searchable in one unified way.

### Step 3: create cleaner derived memory objects

The raw source is useful, but often noisy.

So Prometheus should also generate cleaner derived memory objects, such as:

- summary of the session
- summary of the day
- key decisions made
- durable user or system facts
- open loops and unresolved tasks
- project update notes

This makes retrieval much better later.

### Step 4: split content into chunks

Large files should not be searched only as giant blobs.

Instead, Prometheus should split documents into smaller chunks that are easier to search and rank.

Examples of chunks:

- a section of a summary
- a single conversation segment
- a decision block
- a part of a long daily note

Each chunk should know what it came from.

### Step 5: index for keyword search

Prometheus should create a full-text / keyword search index so exact phrases and terms can be found quickly.

This helps with questions like:

- “find where we mentioned OAuth”
- “show me the discussion about verification loops”
- “find all notes mentioning Qwen”

### Step 6: index for semantic search using embeddings

Prometheus should also create embeddings for important chunks.

Embeddings allow semantic search, which means the system can find related meaning even if the exact wording is different.

This helps with questions like:

- “what did we decide about escalation logic?”
- “show me old discussions related to memory design”
- “find earlier conversations about this same idea”

### Step 7: create relationships between items

Prometheus should store links between related memory objects.

Examples:

- this summary came from that session
- this decision belongs to that project
- this task log is part of that task
- this note mentions the same entity as those three sessions
- this fact was extracted from that conversation

This helps with:

- graph visualization
- follow-up retrieval
- timeline building
- connected memory exploration

---

## How indexing should work

Indexing is not just “make embeddings.” It should be a hybrid process.

### What the index should contain

For each memory item and chunk, the index should store:

- the text
- the source type
- the source id
- the date
- tags/entities
- project/workspace
- related records
- keyword terms
- embedding vector if applicable
- ranking priority

### What gets indexed most strongly

Highest priority:

- durable facts
- decisions
- summaries
- project notes
- architecture notes
- user preferences

Medium priority:

- daily notes
- session summaries
- task logs

Lower priority:

- raw tool chatter
- repetitive logs
- noisy execution traces

The system should preserve all raw data, but ranking should prefer the cleaner, more useful memory objects.

---

## How searching should work

Prometheus should use **hybrid search**, not vector-only search.

### Search methods to combine

1. **Keyword / full-text search**
   - good for exact terms, names, phrases, ids, features

2. **Semantic search with embeddings**
   - good for related meaning and concept matching

3. **Metadata filtering**
   - by project, source type, time range, task, workspace, agent, priority

4. **Relationship expansion**
   - if one result is useful, follow connected results

5. **Recency and source weighting**
   - newer items and cleaner summaries can rank higher where appropriate

### Why hybrid search matters

Keyword search is best when exact terms matter.
Semantic search is best when wording changes but the idea is the same.
Metadata filters help narrow the result set.
Relationship expansion helps connect the bigger picture.

Using all of them together creates far better memory recall than relying on only one.

---

## When Prometheus should search memory

Prometheus should not search long-term memory on every turn.

Instead, memory search should be triggered when historical context is likely useful.

### Good triggers for memory search

- the user says “previously,” “before,” “last week,” “earlier,” or similar
- the user asks “what did we say about X?”
- the user asks “tell me everything about X”
- a task is being resumed from another day/session
- the project has old decisions that likely matter
- the current context is insufficient for continuity
- the model detects likely missing historical context

### Cases where search is probably not needed

- simple present-tense chat
- brand new brainstorming
- short questions already answerable from current context
- tasks that are fully local to the present session

A routing layer should decide between:

- no search
- light search
- deep search

---

## Search modes Prometheus should support

### 1. Quick memory search

Used for normal recall.

Looks across:

- summaries
- facts
- recent notes
- decisions

Returns a small number of strong candidates.

### 2. Archive search

Used for broad “everything about X” queries.

Looks across:

- chats
- notes
- tasks
- logs
- summaries
- decisions

### 3. Project search

Restricted to a specific project, workspace, or topic.

Used when continuity matters inside one domain.

### 4. Timeline search

Returns results in chronological order.

Used for:

- “what changed over time?”
- “how did this evolve?”
- “show the history of this topic”

### 5. Related-memory expansion

Starts from one result and pulls linked memory.

Used for:

- connected exploration
- graph browsing
- finding neighboring ideas/notes

---

## What search results should look like

Search results should not immediately dump giant full documents into the model.

Instead, the memory search should first return compact results such as:

- title
- source type
- date
- short snippet
- score
- why it matched
- related entities
- reference id/path

Then Prometheus can decide which 1–3 items to read more deeply.

This keeps context usage lower and improves reliability, especially for small models.

---

## How injection should work

Injection should stay small.

### What should usually be injected

- current-day note or compact active-day summary
- active task state
- current session state
- short stable user profile memory
- short stable project/workspace memory

### What should not usually be injected

- all old session files
- all historical notes
- raw archives
- giant logs
- broad historical memory dumps

Older memory should almost always be retrieval-first, not injection-first.

This means:

- same-day continuity is injected
- older history is searched when needed

---

## How embeddings should be used

Embeddings should be used as part of the retrieval system, not as the entire memory system.

### Embeddings are good for

- finding semantically related ideas
- retrieving conversations with different wording
- clustering notes and sessions by theme
- linking similar memory objects together
- powering graph relationships and discovery

### Embeddings are not enough on their own

If the system only uses embeddings, it may struggle with:

- exact names
- code identifiers
- specific phrases
- timestamps
- direct term matching

So embeddings should be combined with keyword and metadata search.

### What should get embeddings first

- session summaries
- daily summaries
- decision records
- durable fact records
- key sections of raw sessions
- project notes
- architecture notes

This is a good first rollout without embedding every noisy raw log line.

---

## How memory promotion should work

Not everything should become long-term memory.

Prometheus should selectively promote the most useful information.

### Good candidates for promotion

- user preferences
- stable project rules
- architecture decisions
- important conclusions
- recurring workflows
- recurring constraints
- important fixes and failure lessons
- open loops that remain unresolved
- long-running goals

### Things that should usually stay raw/archive only

- repetitive tool logs
- low-value status chatter
- temporary brainstorming fragments
- outdated dead-end ideas
- noisy background traces with no durable value

This promotion step is what keeps memory high quality over time.

---

## Recommended write moments

Prometheus should update memory at predictable points.

### After a chat session

Create or update:

- session archive
- session summary
- extracted decisions
- extracted open loops
- extracted entities/topics
- any durable facts if relevant

### During task execution

Append to:

- task journal
- intraday note

Optionally checkpoint:

- current plan
- current blockers
- current progress state

### On task completion

Create:

- task outcome summary
- fixes/lessons memory
- project update memory

### On day rollover

Create:

- daily summary
- important decisions from the day
- unresolved open loops
- retained facts worth carrying forward

### On explicit remember instructions

Immediately create:

- durable memory entry
- preference record
- rule/fact record

---

## Graph and visualization plan

The graph UI should not be a separate fake layer. It should be a real view over the memory index.

### Possible node types

- session
- note
- summary
- task
- decision
- fact
- entity
- project

### Possible edge types

- derived from
- belongs to project
- same task chain
- same day
- same entity
- explicit reference
- semantic similarity
- user-linked or system-linked relation

That allows the graph view to become a genuine memory explorer, not just a visual effect.

---

## Prometheus-specific runtime behavior

At runtime, the memory system should behave like this:

### When new content is created

1. Store raw source
2. Normalize it into a shared memory record format
3. Create summaries/facts/decisions/open loops if needed
4. Chunk the useful content
5. Update keyword index
6. Update embeddings index
7. Update relationships/graph links

### When the user asks something

1. Check live context first
2. Decide if long-term memory is needed
3. Run light or deep memory search
4. Return top candidates
5. Read the most relevant full records/chunks
6. Answer grounded in those retrieved results
7. Optionally write back new memory if the turn created useful durable knowledge

---

## Suggested implementation phases

### Phase 1: raw archive and normalization

Build:

- source ingestion for sessions, notes, and task logs
- a normalized memory record schema
- chunking support

Goal:

- unify all memory sources under one model

### Phase 2: derived memory generation

Build:

- session summarizer
- daily summarizer
- decision extractor
- fact extractor
- open-loop extractor

Goal:

- reduce noise and create high-value memory objects

### Phase 3: hybrid indexing

Build:

- full-text / keyword index
- embedding index
- metadata filters
- ranking / source weighting

Goal:

- make retrieval strong and practical

### Phase 4: retrieval tools

Build tools like:

- search memory
- read memory record
- search project memory
- search timeline
- get related memory

Goal:

- make long-term memory accessible to the agent

### Phase 5: routing logic

Build:

- memory-search triggers
- light vs deep search mode
- retrieval gating

Goal:

- search only when needed

### Phase 6: graph explorer

Build:

- node/edge projection from real memory data
- filters by source type/project/date
- clickable notes and sessions
- cluster exploration
- drag/zoom/relationship visualization

Goal:

- make memory visually explorable and useful

---

## Recommended plain-English technical split

### Raw layer

Stores the original source data.

Examples:

- transcripts
- logs
- notes
- task files

### Memory-object layer

Stores cleaner derived memory.

Examples:

- summaries
- decisions
- facts
- open loops
- project notes

### Index layer

Stores search-ready chunk and retrieval data.

Examples:

- keywords
- embeddings
- metadata
- links/relations

### Runtime memory layer

Used by the agent during actual work.

Examples:

- injected active context
- retrieved historical results
- follow-up reads of top memory hits

---

## Recommended guiding rules

1. Do not inject all memory.
2. Search older memory only when needed.
3. Keep raw sources as evidence.
4. Generate cleaner derived memory for better recall.
5. Use hybrid search, not vector-only search.
6. Rank distilled memory above noisy logs.
7. Let the graph be powered by real relations.
8. Keep the system friendly to small local models.
9. Make memory explainable and inspectable.
10. Treat memory as a pipeline, not a dump.

---

## Final summary

Prometheus’s new memory system should extend the current intraday note system into a full long-term memory pipeline. Raw sessions, notes, and logs should be preserved as source truth. Cleaner derived memory objects such as summaries, decisions, durable facts, and open loops should be generated from that source material. All of this should be normalized, chunked, indexed with both keyword and embedding search, and linked together through relationships. At runtime, Prometheus should keep active injected memory small, search long-term memory only when historical context is needed, read the most relevant results, and ground its answers or task work in those retrieved records. This gives Prometheus a real searchable memory system instead of an oversized prompt dump.

---

## Immediate next build targets

1. Define the normalized memory schema.
2. Connect chat sessions, daily notes, and task logs to a shared archive pipeline.
3. Add session and daily summarization.
4. Add decision, fact, and open-loop extraction.
5. Build hybrid search over those records.
6. Add retrieval routing into Prometheus runtime.
7. Use the relationship layer to power the graph explorer.

