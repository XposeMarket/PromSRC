---
name: twitter-thread
description: Turn any input — an idea, article, research, or insight — into a punchy, structured, high-engagement X/Twitter thread.
emoji: "🧩"
version: 1.0.0
---

# Twitter Thread

Turn any input — an idea, article, research, or insight — into a punchy, structured, high-engagement X/Twitter thread.

---

## 1. Thread Anatomy

A high-performing thread has:

| Part | Tweets | Purpose |
|---|---|---|
| **Hook** | 1 | Stop the scroll — the single most important tweet |
| **Setup** | 1-2 | Context, why this matters, who it's for |
| **Body** | 5-12 | The substance — one point per tweet |
| **Recap / TL;DR** | 1 | Summary of key takeaways |
| **CTA** | 1 | One ask: follow, retweet, link, or reply |

Total length: 8-15 tweets is the sweet spot for engagement. Under 5 is a regular tweet, over 20 loses people.

---

## 2. Hook Rules (Tweet #1)

The hook is everything. It determines whether anyone reads the rest.

**Hook formulas (pick one):**

1. **The Counterintuitive:** "Most people think [X]. They're wrong. Here's why:"
2. **The Number:** "I [studied / analyzed / built] [N] [things]. Here's what I learned:"
3. **The Promise:** "How to [achieve big outcome] in [timeframe/way]:"
4. **The Story Open:** "In [year/situation], I [did something]. It changed everything."
5. **The Bold Claim:** "[Strong, specific, polarizing statement]."
6. **The Question:** "[Question that makes the reader feel curious or called out]"

**Hook rules:**
- Under 200 characters (ideally under 140 so it previews fully in feed)
- No "A thread 🧵" — the first tweet IS the thread, make it earn the read
- Must create enough curiosity to click "show more"
- Never start with "In this thread I will..."
- Use numbers when you have them ("7 things" outperforms "things I learned")

---

## 3. Body Tweet Rules

Each body tweet should:
- Contain **one idea only** — don't pack two points into one tweet
- Stand alone as useful even without the rest of the thread
- Start with a hook word: number, bold verb, or the point stated first
- Use white space — hard line breaks make tweets readable on mobile
- Stay under 280 characters (or break into a long tweet format when warranted)

**Body tweet templates:**

```
[Number]. [Bold one-line point]

[2-3 sentence explanation]

[Optional: example or data point]
```

```
The rule most people miss:

[Rule stated clearly]

Here's why it matters:
[Brief explanation]
```

**Formatting tips:**
- Use hard line breaks between ideas within a tweet
- Avoid excessive emojis — 0-1 per tweet is enough
- Bold (if platform supports) key terms
- Short paragraphs (1-2 sentences per line)

---

## 4. Recap Tweet

The second-to-last tweet. Summarizes the whole thread in 3-7 bullets:

```
TL;DR:

→ [Point 1]
→ [Point 2]
→ [Point 3]
→ [Point 4]

Save this for later 🔖
```

---

## 5. CTA Tweet (Final Tweet)

One clear ask only. Options:

- **Follow ask:** "If you found this useful, follow me @[handle] — I post [topic] every [day/week]."
- **Retweet ask:** "RT the first tweet to share this with someone who needs it."
- **Link/product:** "I built [tool] that does this for you: [link]"
- **Reply ask:** "What's your experience with [topic]? Reply below 👇"
- **Like + bookmark:** "Like if this was useful. Bookmark to revisit."

---

## 6. Topic-Specific Thread Patterns

### "Lessons I learned" thread
```
Hook: I [did X] for [N years]. Here are [N] lessons nobody tells you:

Body: 1. [Lesson] — [explanation]
     2. [Lesson] — [explanation]
     ...

End: The biggest one nobody talks about: [most counterintuitive lesson]

Recap + CTA
```

### "How to" tutorial thread
```
Hook: How to [achieve outcome] in [N steps]:

Body: Step 1: [Action]
     [Why + how]
     Step 2: [Action]
     ...

End: Most people skip step [N]. Don't.

Recap + CTA
```

### "Research / Analysis" thread
```
Hook: I analyzed [N] [things]. Here's what I found:

Body: Finding 1: [Stat/observation] — [what it means]
     Finding 2: ...

End: The surprising takeaway: [most counterintuitive result]

Recap + CTA
```

---

## 7. Output Format

Deliver the thread as numbered tweets:

```
--- THREAD ---

[1/N]
[Hook tweet text]

[2/N]
[Setup tweet text]

[3/N]
[Body tweet 1]

...

[N-1/N]
[Recap tweet]

[N/N]
[CTA tweet]
--- END ---
```

Character count for each tweet: note if any exceed 280 chars.

---

## 8. Posting via Browser (Optional)

If user wants to post immediately, use the x-browser-automation-playbook skill:
1. `skill_read("x-browser-automation-playbook")` for the exact posting flow
2. Post tweet #1 first
3. Reply to tweet #1 with tweet #2, then reply to #2 with #3, etc. (this creates the thread chain)
4. Confirm each tweet posts before continuing

**Note:** Threads require replying to the previous tweet — you can't post all at once via browser. Post one tweet at a time, each as a reply to the previous.