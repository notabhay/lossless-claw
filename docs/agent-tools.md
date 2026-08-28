# Agent tools

LCM provides four tools for agents to search, inspect, and recall information from compacted conversation history.

## Usage patterns

### Escalation pattern: archive/journal/memory → grep → describe → expand_query

For room history, same-day state, or workspace context, first use the authoritative channel archive or omniscience surface, current journal, or memory search. For compacted conversation history, use this escalation:

1. **`lcm_grep`** — Find relevant summaries, messages, or externalized file prefixes by keyword/regex
2. **`lcm_describe`** — Inspect a specific summary's full content (cheap, no sub-agent)
3. **`lcm_expand_query`** — Last-resort deep recall: spawn a sub-agent to expand the DAG and answer a focused question

Start with grep. If the snippet is enough, stop. If you need full summary content, use describe. If you need details that were compressed away, use expand_query.

### When to expand

Summaries are lossy by design. The "Expand for details about:" footer at the end of each summary lists what was dropped. Use `lcm_expand_query` when you need:

- Exact commands, error messages, or config values
- File paths and specific code changes
- Decision rationale beyond what the summary captured
- Tool call sequences and their outputs
- Verbatim quotes or specific data points

`lcm_expand_query` defaults to `mode: "normal"`, a 30-second work pass with 5 seconds of cleanup/RPC headroom. It is for a small, live-chat-safe recovery after grep and describe cannot settle the question. Use `mode: "forensic"` only for an explicit long investigation. It keeps the configured 120-second work budget plus 30 seconds of cleanup/RPC headroom. On OpenClaw 2026.7.1, normal mode's limited child-tool workflow is prompt-restricted rather than host-enforced.

## Tool reference

### lcm_grep

Search across messages, summaries, and/or the bounded prefix of externalized large files using regex or full-text search.

Use `mode: "full_text"` for keyword or topical recall. Full-text queries are not regexes: alternation (`A|B`), regex wildcards (`.*`), character classes (`[abc]`), and anchors (`^foo`, `foo$`) require `mode: "regex"`. Wrap exact multi-word phrases in quotes to preserve phrase matching. Keep the default `sort: "recency"` for recent events, switch to `sort: "relevance"` when looking for the best older match on a topic, and use `sort: "hybrid"` when you want relevance without giving up recency entirely.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `pattern` | string | ✅ | — | Search pattern |
| `mode` | string | | `"regex"` | `"regex"` or `"full_text"` |
| `scope` | string | | `"both"` | `"messages"`, `"summaries"`, `"both"`, or `"files"` |
| `fileIds` | string[] | | — | Optional `file_xxx` IDs to restrict `scope: "files"` searches |
| `conversationId` | number | | current session family | Specific physical conversation to search |
| `allConversations` | boolean | | `false` | Search all conversations |
| `since` | string | | — | ISO timestamp lower bound |
| `before` | string | | — | ISO timestamp upper bound |
| `limit` | number | | 50 | Max results (1–200) |
| `sort` | string | | `"recency"` | `"recency"`, `"relevance"`, or `"hybrid"` for full-text ranking |

**Returns:** Array of matches with:
- `id` — Message, summary, or file ID
- `type` — `"message"`, `"summary"`, or `"file"`
- `snippet` — Truncated content around the match
- `conversationId` — Which conversation
- `createdAt` — Timestamp
- For summaries: `depth`, `kind`, `summaryId`
- For files: line number, byte offset, matched text, and a snippet from the first 512,000 bytes scanned per file

**Examples:**

```
# Full-text search across all conversations
lcm_grep(pattern: "database migration", mode: "full_text", allConversations: true)

# Older-topic recall ranked by FTS relevance
lcm_grep(pattern: "\"error handling\" retries", mode: "full_text", sort: "relevance")

# Regex search in summaries only
lcm_grep(pattern: "config\\.threshold.*0\\.[0-9]+", scope: "summaries")

# Recent messages containing a specific term
lcm_grep(pattern: "deployment", since: "2026-02-19T00:00:00Z", scope: "messages")

# Search the bounded scanned prefix of an externalized file
lcm_grep(pattern: "CRITICAL_MARKER", scope: "files", fileIds: ["file_789abc012345"])
```

### lcm_describe

Look up metadata and content for a specific summary or stored file.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | ✅ | — | `sum_xxx` for summaries, `file_xxx` for files |
| `conversationId` | number | | current session family | Scope to a specific physical conversation |
| `allConversations` | boolean | | `false` | Allow cross-conversation lookups |

**Returns for summaries:**
- Full summary content
- Metadata: depth, kind, token count, created timestamp
- Time range (earliestAt, latestAt)
- Descendant count
- Parent summary IDs (for condensed summaries)
- Child summary IDs
- Source message IDs (for leaf summaries)
- File IDs referenced in the summary

**Returns for files:**
- File content, capped by `expandFileMaxBytes`
- Metadata: fileName, mimeType, byteSize
- Exploration summary
- Storage path

**Examples:**

```
# Inspect a summary from context
lcm_describe(id: "sum_abc123def456")

# Retrieve a stored large file
lcm_describe(id: "file_789abc012345")
```

### lcm_expand_query

Answer a focused question by expanding summaries through the DAG. Spawns a bounded sub-agent that walks parent links down to source material and returns a compact answer.

When `allConversations: true` is set, `lcm_expand_query` requires `mode: "forensic"` and can synthesize one answer across multiple conversations. That cross-conversation mode is bounded, not exhaustive: it ranks conversation buckets, expands only the top few under one shared deadline, and marks the result truncated when lower-ranked buckets are skipped or fail. The selected buckets share the existing `tokenCap`, so concurrent recall does not multiply the retrieval budget.

**Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | ✅ | — | The question to answer |
| `query` | string | ✅* | — | Text query to find summaries (if no `summaryIds`) |
| `summaryIds` | string[] | ✅* | — | Specific summary IDs to expand (if no `query`) |
| `maxTokens` | number | | 2000 | Answer length cap |
| `mode` | `"normal" \| "forensic"` | | `"normal"` | Normal is capped at 35000ms total. Forensic opts into the configured long deep-recall budget. |
| `timeoutMs` | number | | mode-specific runtime default: `35000` normal; `delegationTimeoutMs + 30000` forensic | Total OpenClaw dynamic tool RPC timeout. The schema intentionally has no static default because it cannot express a mode-dependent value. Normal requests are clamped to 35000ms. |
| `conversationId` | number | | current session family | Scope to a specific physical conversation |
| `allConversations` | boolean | | `false` | Search across all conversations |

*One of `query` or `summaryIds` is required.

**Returns:**
- `answer` — The focused answer text
- `citedIds` — Summary IDs that contributed to the answer
- `sourceConversationIds` — Conversations that were successfully expanded
- `expandedSummaryCount` — How many summaries were expanded
- `totalSourceTokens` — Total tokens read from the DAG
- `truncated` — Whether source expansion was truncated or any selected conversation was skipped or failed
- `conversationBreakdown` — Optional per-conversation success/failure diagnostics for bounded multi-conversation runs
- `mode` — The effective normal or forensic recall policy, including validation and failure results

Successful single-conversation results keep the response shape above. When delegated recall fails, the result keeps the human-readable `error` and adds `errorCode`, empty source counters, and a `conversationBreakdown`. Failed entries identify the conversation, attempted summary IDs, failure phase, elapsed time, and error code. Timed-out child work is cancelled through the host-owned temporary-session cleanup path. Completed conversation buckets still contribute evidence when another bucket times out; timed-out buckets do not contribute guessed answer text or citations.

**Examples:**

```
# Find and expand summaries about a topic
lcm_expand_query(
  query: "OAuth authentication fix",
  prompt: "What was the root cause and what commits fixed it?"
)

# Expand specific summaries you already have
lcm_expand_query(
  summaryIds: ["sum_abc123", "sum_def456"],
  prompt: "What were the exact file changes?"
)

# Cross-conversation synthesis
lcm_expand_query(
  query: "deployment procedure",
  prompt: "What's the current deployment process?",
  allConversations: true,
  mode: "forensic",
  timeoutMs: 150000
)
```

### lcm_expand

Low-level DAG expansion tool. **Only available to sub-agents** spawned by `lcm_expand_query`. Main agents should always use `lcm_expand_query` instead.

This tool is what the expansion sub-agent uses internally to walk the summary DAG, read source messages, and build its answer.

## Tips for agent developers

### Configuring agent prompts

Add instructions to your agent's system prompt so it knows when to use LCM tools:

```markdown
## Memory & Context

Use LCM tools for recall:
1. `lcm_grep` — Search all conversations by keyword/regex. Prefer `mode: "full_text"` for short topic terms, use `mode: "regex"` for alternation or other regex syntax, quote exact phrases, use `sort: "relevance"` for older-topic lookups, and `sort: "hybrid"` when recency should still matter.
2. `lcm_describe` — Inspect a specific summary (cheap, no sub-agent)
3. `lcm_expand_query` — Last-resort deep recall with bounded sub-agent expansion

When summaries in context have an "Expand for details about:" footer
listing something you need, use `lcm_expand_query` to get the full detail.
```

### Conversation scoping

By default, tools operate on the current session family: the active conversation plus archived segments that share the same stable session identity. This keeps recall continuous across session rotation and `/reset` replacement rows without widening the search to unrelated sessions. Use `lcm_grep(..., allConversations: true)` when you need broad global discovery. Use `lcm_expand_query(..., allConversations: true, mode: "forensic")` when you want bounded synthesis across sessions. Use `conversationId` when you already know the exact physical conversation to inspect or expand.

### Performance considerations

- `lcm_grep` and `lcm_describe` are fast (direct database queries)
- Normal `lcm_expand_query` spawns a sub-agent with 30 seconds of work and 5 seconds of cleanup/RPC headroom. Its child prompt limits inspection to two seed summaries and two high-signal expansions, returning `truncated: true` rather than continuing.
- `mode: "forensic"` retains the 120-second timeout with 30 seconds of cleanup/RPC headroom for explicit deeper investigations.
- Token caps (`LCM_MAX_EXPAND_TOKENS`) prevent runaway expansion
- Cross-conversation `lcm_expand_query` expands only a bounded set of top-ranked conversations
