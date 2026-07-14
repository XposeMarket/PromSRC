# Research-First Shopping Flow

Observed 2026-06-05: for broad/high-consideration shopping asks like "best gaming laptops under $1500", starting with repeated broad `shopping_search_products` calls produced noisier/slower results. the user corrected the flow: first research current best/recommended models from credible sources, then use product search for those exact models.

Use this route when the request is broad and quality-sensitive (laptops, phones, tools, appliances, car parts where fit/quality matters, or anything "best under $X"):

1. Run web research first: search current buying guides/review sources and, when useful, Reddit/community consensus.
2. Extract recurring candidate models/specs and disqualifiers before shopping.
3. Product-search exact candidates, not just the broad category query.
4. Curate final cards with live price/seller caveats, source-backed reasons, and warnings for suspiciously low listings.
5. If compatibility is ambiguous (vehicle part, device variant, fitment), ask for/mention the missing discriminator (engine/VIN/model variant) and avoid pretending one listing fits all.

Evidence: `audit/chats/transcripts/850e5468-3dc8-4a2f-afb2-680ca1e2fef1.md:33-56`; `Brain/skill-gardener/2026-06-05/workflow-episodes.jsonl:7-8`.