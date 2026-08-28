# Brodie absorption record for upstream main above v1.0.0

The v0.15.6 `brodie/master` commit (`f9313b96683fcaf2755b59670a2d1818deb35979`) is donor evidence only. This rebuild starts from upstream `main` at `c6d06e528867004c85ae84897019d94f0cdbea50`, one commit above the `v1.0.0` release (the retired-transcript-config acceptance fix), and keeps only brodie behavior still missing there plus the host-compatibility layer brodie's OpenClaw `2026.7.1` fork needs. Abhay ruled on September 6, 2026 that the host stays on `2026.7.1` and that features needing a newer host are shimmed or disabled inside the plugin instead.

| Donor boundary | Classification on upstream main | Resolution |
| --- | --- | --- |
| Inline authored and tool-result payload modes | still missing | retain config, schema, documentation, exact ingestion, and overflow-only externalization |
| Managed OpenClaw external-file materialization | still missing | retain typed file references, idempotent materialization, and realpath confinement |
| Honest forced-compaction results | still missing | retain real mutation reporting and preserve host-owned live prompt overhead across sweeps |
| Bounded normal recall (`lcm_expand_query` normal and forensic modes) | still missing | retain the mode parameter, the 30-second normal deadline, and the telemetry mode tag; `resolveRequesterConversationScopeId` no longer takes `deps` upstream, so the deadline wrapper calls it without one |
| Fresh-tail newest-user boundary | absorbed (code) | upstream code is byte-identical; upstream only lost the documentation, which is restored here |
| Transcript GC, session rollover, and session-file rotation | removed upstream | not replayed; brodie's host owns JSONL rotation, and the retired config keys are accepted and ignored by `c6d06e5` |
| Pending-summary compaction, anchor trust, transcript epochs, and `commitTurn` ledger | absorbed | upstream v1.0.0 behavior unchanged; `commitTurn` is never invoked by the `2026.7.1` host, so the `turn_advancements` ledger stays empty and `afterTurn` remains the sole ingestion path |
| Donor timing, cache, and file-log instrumentation | obsolete | not replayed |

## Host compatibility layer for OpenClaw 2026.7.1

Upstream v1.0.0 reads session history only through `readVisibleSessionTranscriptMessageEntries` from `openclaw/plugin-sdk/session-transcript-runtime`, which first shipped in OpenClaw `2026.7.2-beta.2`. On a `2026.7.1` host every bootstrap and after-turn reconcile would report zero imported messages, the engine would refuse to advance, and `assemble()` would keep serving frozen history while still owning compaction. That is silent transcript loss, not a degraded mode, so the plugin now feature-detects the host:

- `src/host-compat/openclaw-transcript-tree.ts` is a verbatim copy of the fork's `src/config/sessions/transcript-tree.ts` (brodie/master `32daff1cf1cf7e396a385328e2241cc8c7bd77f7`), because the host does not export its tree through the plugin SDK and the projection must select the same active branch the host's own readers select.
- `src/host-compat/jsonl-visible-transcript.ts` rebuilds the upstream `2026.7.2-beta.2` projection contract (`selectVisibleTranscriptEventEntries` plus `projectVisibleMessageEntry`) on top of the host's exported `readSessionTranscriptEvents`: original file positions become `seq`, active-branch normalization supplies `parentId`, and only canonical `message` records with an id become entries.
- `src/plugin/index.ts` prefers the native export, falls back to the JSONL reader when only `readSessionTranscriptEvents` exists, and logs `transcript projection source=host-native|jsonl-compat` once.
- `package.json` relaxes `peerDependencies.openclaw`, `openclaw.compat.pluginApi`, and `minGatewayVersion` to `>=2026.7.1`; the fork's plugin discovery refuses any plugin whose `pluginApi` range excludes the host version.

- the engine keeps the host-provided `sessionFile` on its transcript read target and the compat reader forwards it, so the fork reads the exact active transcript for the run instead of re-deriving it from store identity (a mid-reset or cron alias mismatch would otherwise resolve to a missing file and silently project nothing).
- inline tool-result recovery (brodie's `toolResultPayloadMode: inline`) now runs through one shared `resolveStoredMessageForIngest` helper used by ingestion, image rewrites, upstream's transcript anchor audit, and the projection reconcile comparison. without that, a tool result persisted as a `tool_result` wrapper block would be stored with recovered text but audited as empty content, and upstream's audit would clear its transcript anchor and pin a `legacy_prefix` epoch on the next bootstrap. `test/inline-tool-result-anchor-audit.test.ts` is the regression.
- the vendored tree is the fork's, which lacks upstream beta.2's `canonicalParentIsStale` reparenting: an entry whose parent is missing from the file keeps the dangling parent and the visible path truncates to the reachable suffix, which is exactly what the fork's own readers show the model. when the host later adopts the beta.2 tree the same JSONL projects a longer prefix, so the host upgrade cycle must re-verify reconcile against that change.

Verified against 428 live brodie transcripts, including all 33 that carry leaf controls: the compat projection returned the same message count as the retained legacy leaf-path reader for every file, with zero empty projections. A migration and bootstrap rehearsal on an online copy of the 8.45 GB live database ran upstream's forward-only migrations in 18 seconds, re-bootstrapped three live conversations as already bootstrapped with zero warnings, and assembled each within budget.

Behaviors not available on the `2026.7.1` host: atomic turn-commit idempotency (retried turns fall back to the heuristic after-turn dedup, as on v0.15.6), and sub-agent fork projection, which was already blocked on this host before the upgrade.

No donor commit or whole-file patch is replayed. The resulting branch is one brodie-owned commit above upstream `main` at `c6d06e5`.
