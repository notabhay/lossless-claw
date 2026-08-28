declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  type SessionTranscriptReadTarget =
    import("./types.js").SessionTranscriptReadTarget;
  type VisibleSessionTranscriptMessageEntry =
    import("./types.js").VisibleSessionTranscriptMessageEntry;

  /** Present on OpenClaw >=2026.7.2-beta.2. */
  export function readVisibleSessionTranscriptMessageEntries(
    target: SessionTranscriptReadTarget,
  ): Promise<VisibleSessionTranscriptMessageEntry[]>;

  /** Raw JSONL transcript events; the only projection source on older hosts. */
  export function readSessionTranscriptEvents(
    target: SessionTranscriptReadTarget,
  ): Promise<unknown[]>;
}
