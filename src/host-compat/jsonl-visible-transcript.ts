import type { AgentMessage } from "../openclaw-bridge.js";
import type {
  SessionTranscriptReadTarget,
  VisibleSessionTranscriptMessageEntry,
} from "../types.js";
import {
  scanSessionTranscriptTree,
  selectSessionTranscriptTreePathNodes,
} from "./openclaw-transcript-tree.js";

/**
 * JSONL host compatibility for OpenClaw hosts older than 2026.7.2-beta.2.
 *
 * Those hosts keep session transcripts as append-only JSONL files and expose
 * `readSessionTranscriptEvents` through `openclaw/plugin-sdk/session-transcript-runtime`,
 * but not `readVisibleSessionTranscriptMessageEntries`. This module rebuilds the
 * same branch-safe visible projection from the raw events: the host's own
 * transcript tree selects the active branch, original file positions become
 * `seq`, and only canonical `message` records with an id become entries.
 */

export type HostSessionTranscriptEventsReader = (
  params: SessionTranscriptReadTarget & { sessionFile?: string },
) => Promise<unknown[]>;

export type VisibleTranscriptEventEntry<T> = {
  event: T;
  /** Parent id after active-branch normalization; null when no visible parent exists. */
  parentId: string | null;
  seq: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isAgentMessageRecord(value: unknown): value is AgentMessage & Record<string, unknown> {
  return isRecord(value) && readNonEmptyString(value.role) !== undefined;
}

/** Select the active visible branch while preserving original transcript sequence numbers. */
export function selectVisibleTranscriptEventEntries<T>(
  events: readonly T[],
): VisibleTranscriptEventEntry<T>[] {
  const tree = scanSessionTranscriptTree(events);
  const visiblePath = selectSessionTranscriptTreePathNodes(tree, tree.leafId);
  if (visiblePath.length > 0) {
    return visiblePath.map((node) => ({
      event: node.entry,
      parentId: node.parentId,
      seq: node.index + 1,
    }));
  }
  return tree.hasLeafControl
    ? []
    : events.map((event, index) => ({ event, parentId: null, seq: index + 1 }));
}

/** Project one visible transcript event into the message-entry contract. */
export function projectVisibleMessageEntry(
  entry: VisibleTranscriptEventEntry<unknown>,
): VisibleSessionTranscriptMessageEntry[] {
  const event = entry.event;
  if (!isRecord(event) || event.type !== "message") {
    return [];
  }
  const entryId = readNonEmptyString(event.id);
  const message = event.message;
  if (!entryId || !isAgentMessageRecord(message)) {
    return [];
  }
  const createdAt = readNonEmptyString(event.timestamp);
  const idempotencyKey = readNonEmptyString(message.idempotencyKey);
  return [
    {
      entryId,
      parentId: entry.parentId,
      seq: entry.seq,
      message,
      role: message.role,
      ...(createdAt ? { createdAt } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  ];
}

/** Build the visible message projection from already-loaded transcript events. */
export function projectVisibleSessionTranscriptMessageEntries(
  events: readonly unknown[],
): VisibleSessionTranscriptMessageEntry[] {
  return selectVisibleTranscriptEventEntries(events).flatMap(projectVisibleMessageEntry);
}

export type TranscriptProjectionSource = "host-native" | "jsonl-compat";

export type ResolvedVisibleTranscriptProjection = {
  read: (target: SessionTranscriptReadTarget) => Promise<VisibleSessionTranscriptMessageEntry[]>;
  source: TranscriptProjectionSource;
};

/**
 * Pick the projection reader a host module can support: the native export on
 * OpenClaw >=2026.7.2-beta.2, the local JSONL rebuild when only the raw event
 * reader exists, or nothing when the module offers neither.
 */
export function resolveVisibleTranscriptProjection(mod: {
  readVisibleSessionTranscriptMessageEntries?: unknown;
  readSessionTranscriptEvents?: unknown;
}): ResolvedVisibleTranscriptProjection | undefined {
  if (typeof mod.readVisibleSessionTranscriptMessageEntries === "function") {
    return {
      read: mod.readVisibleSessionTranscriptMessageEntries as ResolvedVisibleTranscriptProjection["read"],
      source: "host-native",
    };
  }
  if (typeof mod.readSessionTranscriptEvents === "function") {
    return {
      read: createJsonlVisibleSessionTranscriptReader(
        mod.readSessionTranscriptEvents as HostSessionTranscriptEventsReader,
      ),
      source: "jsonl-compat",
    };
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInjectedAgentRuntimeStorePath(storePath: string | undefined, agentId: string | undefined): boolean {
  const normalizedAgentId = readNonEmptyString(agentId)?.toLowerCase();
  const normalizedStorePath = typeof storePath === "string" ? storePath.trim().replaceAll("\\", "/") : "";
  return (
    normalizedAgentId !== undefined &&
    new RegExp(`(?:^|/)agents/${escapeRegex(normalizedAgentId)}/agent/openclaw-agent\\.sqlite$`).test(
      normalizedStorePath,
    )
  );
}

/** Wrap the host's raw JSONL event reader as a visible-projection reader. */
export function createJsonlVisibleSessionTranscriptReader(
  readSessionTranscriptEvents: HostSessionTranscriptEventsReader,
): (target: SessionTranscriptReadTarget) => Promise<VisibleSessionTranscriptMessageEntry[]> {
  return async (target) => {
    const sessionFile =
      typeof target.sessionFile === "string" && target.sessionFile.trim().length > 0
        ? target.sessionFile.trim()
        : undefined;
    // OpenClaw 2026.7.1 can inject exactly this agent SQLite store into a
    // JSONL context-engine callback without an active session file. Its raw
    // event SDK mistakes that database for the sessions directory and returns
    // an empty projection. Keep every other caller-owned store path intact.
    const storePath =
      sessionFile === undefined && isInjectedAgentRuntimeStorePath(target.storePath, target.agentId)
        ? undefined
        : target.storePath;
    const events = await readSessionTranscriptEvents({
      sessionId: target.sessionId,
      sessionKey: target.sessionKey,
      ...(target.agentId !== undefined ? { agentId: target.agentId } : {}),
      ...(storePath !== undefined ? { storePath } : {}),
      ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
      ...(sessionFile !== undefined ? { sessionFile } : {}),
    });
    return projectVisibleSessionTranscriptMessageEntries(events);
  };
}
