# Brodie absorption record for v0.14.0

The former `brodie/v0.13.0` branch is donor evidence only. This rebuild starts from the peeled `v0.14.0` release and keeps only behavior still missing from that release.

| Donor path | Classification on v0.14.0 | Resolution |
| --- | --- | --- |
| `docs/configuration.md` | still missing | document the two inline payload modes |
| `openclaw.plugin.json` | still missing | expose both modes in schema and UI hints |
| `skills/lossless-claw/references/config.md` | still missing | document behavior and defaults |
| `src/db/config.ts` | still missing | resolve config and environment precedence |
| `src/engine.ts` | mixed | retain inline ingestion, overflow fallback, and typed external files; use upstream continuation and assembly lifecycle |
| `src/large-file-interceptor.ts` | mixed | rebuild idempotent overflow and managed-media handling with realpath confinement |
| `src/large-files.ts` | still missing | add an explicit managed external-file reference |
| `src/openclaw-bridge.ts` | absorbed | v0.14.0 already carries assemble runtime context |
| `src/live-coverage.ts` | absorbed | v0.14.0 has occurrence-aware live coverage and continuation preservation |
| `src/assembler.ts` | absorbed | v0.14.0 owns fresh-tail protection, ordering, tool pairing, and bounded selection |
| `src/estimate-tokens.ts` | absorbed | v0.14.0 owns current serialized token estimation and memoization |
| `src/retrieval.ts` | obsolete | donor cache shape is not replayed without a v0.14.0 benchmark showing a regression |
| `src/phase-timing.ts` | obsolete | donor-only instrumentation is not required for the product contract |
| `src/lcm-file-log.ts` | obsolete | donor timing fields are not carried into current logging |
| `test/config.test.ts` | still missing | cover defaults, plugin config, and environment precedence |
| `test/engine-ingest.test.ts` | still missing | prove exact inline authored and tool payload retention |
| `test/engine-assemble.test.ts` | mixed | retain overflow and typed-media proofs; upstream continuation cases stay authoritative |
| `test/circuit-breaker.test.ts` | obsolete | donor edits only supported the removed timing layer |
| `test/expansion.test.ts` | compatibility | extend the canonical test config for the new fields |
| `test/helpers.ts` | compatibility | extend the canonical test config for the new fields |
| `test/lcm-log.test.ts` | compatibility | extend the canonical test config for the new fields |

No donor commit or whole-file patch is replayed. Performance code remains upstream-owned unless a focused v0.14.0 benchmark proves a product regression.
