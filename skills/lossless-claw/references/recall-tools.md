# Recall Tools

Use recall tools when the question depends on exact historical evidence from compacted context.

For room history, use the channel archive or omniscience surface first. For same-day state, use the current journal. For older workspace context, use memory search. Lossless recall is for compacted conversation evidence after those cheaper sources cannot settle the question.

## Tool selection

### `lcm_grep`

Use for:

- finding whether a term, file name, error string, or identifier appears in compacted history
- narrowing the search space before deeper inspection

Do not use it for:

- answering detail-heavy questions by itself

### `lcm_describe`

Use for:

- inspecting a specific summary or stored-file record by ID
- reading lineage and content for a known summary node

Do not use it for:

- broad discovery when you do not know the target ID yet

### `lcm_expand_query`

Use for:

- focused questions that need richer detail recovered from summaries after grep and describe
- evidence-oriented follow-up after `lcm_grep` or `lcm_describe`

Cross-conversation expansion requires explicit `mode: "forensic"` and runs its selected conversation buckets under one shared deadline and one shared token budget. Completed buckets still return evidence when a sibling bucket times out. Failure results identify the affected conversation, summary IDs, phase, and error code; they never invent answer text for interrupted work.

This is the best recall tool when the user asks for:

- exact commands
- exact file paths
- precise timestamps
- root-cause chains

Default `mode: "normal"` is a 30-second end-to-end work pass with 5 seconds of cleanup/RPC headroom. Its deadline includes LCM initialization, scope resolution, and candidate discovery, and it can create at most one child. It asks that child to inspect no more than two seed summaries and expand no more than two high-signal paths, returning `truncated: true` when the bounded pass is insufficient. Use explicit `mode: "forensic"` for a longer investigation or cross-conversation synthesis. On OpenClaw 2026.7.1 these child-tool limits are prompt restrictions, not a host-enforced tool allowlist.

### `lcm_expand`

Treat as a specialized sub-agent flow, not the default first step.

## Recommended workflow

1. Start with `lcm_grep` to find likely evidence.
2. Use `lcm_describe` when you have a summary or file ID.
3. Use `lcm_expand_query` when the answer requires precise recovery rather than a high-level summary.

## Conversation scope

When `conversationId` is omitted, recall tools use the current session family: the active conversation plus archived segments that share the same stable session identity. This preserves recall across session rotation and `/reset` replacement rows.

Use `conversationId` only when you need one specific physical conversation. Use `allConversations: true` for broad discovery across unrelated sessions. Cross-conversation `lcm_expand_query` requires explicit `mode: "forensic"`.

## Important guardrail

Do not infer exact details from summaries alone when the user needs evidence. Expand first or state that the answer still needs expansion.
