import { describe, expect, it } from "vitest";
import {
  createJsonlVisibleSessionTranscriptReader,
  projectVisibleSessionTranscriptMessageEntries,
  resolveVisibleTranscriptProjection,
  selectVisibleTranscriptEventEntries,
} from "../src/host-compat/jsonl-visible-transcript.js";

const header = { type: "session", version: 3, id: "session-1", timestamp: "2026-09-06T00:00:00.000Z" };

function messageEvent(params: {
  id: string;
  parentId: string | null;
  role: string;
  text: string;
  timestamp?: string;
  idempotencyKey?: string;
}) {
  return {
    type: "message",
    id: params.id,
    parentId: params.parentId,
    timestamp: params.timestamp ?? "2026-09-06T00:00:01.000Z",
    message: {
      role: params.role,
      content: params.text,
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    },
  };
}

describe("jsonl visible transcript projection", () => {
  it("projects a linear transcript with file positions as seq and skips non-message records", () => {
    const events = [
      header,
      messageEvent({ id: "m1", parentId: null, role: "user", text: "hi", idempotencyKey: "u1" }),
      { type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "x", thinkingLevel: "high" },
      { type: "custom", id: "c1", parentId: "t1", customType: "x", data: {} },
      messageEvent({ id: "m2", parentId: "c1", role: "assistant", text: "hello" }),
    ];
    expect(projectVisibleSessionTranscriptMessageEntries(events)).toEqual([
      {
        entryId: "m1",
        parentId: null,
        seq: 2,
        message: { role: "user", content: "hi", idempotencyKey: "u1" },
        role: "user",
        createdAt: "2026-09-06T00:00:01.000Z",
        idempotencyKey: "u1",
      },
      {
        entryId: "m2",
        parentId: "c1",
        seq: 5,
        message: { role: "assistant", content: "hello" },
        role: "assistant",
        createdAt: "2026-09-06T00:00:01.000Z",
      },
    ]);
  });

  it("selects the active branch through a leaf control and drops the abandoned sibling", () => {
    const root = messageEvent({ id: "root", parentId: null, role: "user", text: "root prompt" });
    const inactive = messageEvent({
      id: "inactive",
      parentId: "root",
      role: "assistant",
      text: "inactive answer",
    });
    const active = messageEvent({
      id: "active",
      parentId: "root",
      role: "assistant",
      text: "active answer",
    });
    const events = [
      header,
      root,
      inactive,
      active,
      { type: "label", id: "label-1", parentId: "active", value: "non-message metadata" },
      { type: "leaf", id: "select-active", parentId: "inactive", targetId: "active" },
    ];
    const entries = projectVisibleSessionTranscriptMessageEntries(events);
    expect(entries.map((entry) => [entry.entryId, entry.parentId, entry.seq])).toEqual([
      ["root", null, 2],
      ["active", "root", 4],
    ]);
  });

  it("follows the parent chain of the newest entry so an older abandoned branch is not visible", () => {
    const events = [
      header,
      messageEvent({ id: "a", parentId: null, role: "user", text: "a" }),
      messageEvent({ id: "b", parentId: "a", role: "assistant", text: "b" }),
      messageEvent({ id: "c", parentId: "b", role: "user", text: "old branch" }),
      messageEvent({ id: "d", parentId: "b", role: "user", text: "new branch" }),
      messageEvent({ id: "e", parentId: "d", role: "assistant", text: "reply" }),
    ];
    expect(projectVisibleSessionTranscriptMessageEntries(events).map((entry) => entry.entryId)).toEqual([
      "a",
      "b",
      "d",
      "e",
    ]);
  });

  it("falls back to file order without parents when records carry no ids", () => {
    const events = [
      { type: "message", message: { role: "user", content: "legacy" } },
      { type: "message", id: "only", message: { role: "assistant", content: "answer" } },
    ];
    const selected = selectVisibleTranscriptEventEntries(events);
    expect(selected.map((entry) => entry.seq)).toEqual([2]);
    expect(projectVisibleSessionTranscriptMessageEntries(events)).toEqual([
      {
        entryId: "only",
        parentId: null,
        seq: 2,
        message: { role: "assistant", content: "answer" },
        role: "assistant",
      },
    ]);
  });

  it("returns nothing for a message record without an id or without a role", () => {
    const events = [
      header,
      { type: "message", id: "m1", parentId: null, message: { content: "no role" } },
      { type: "message", parentId: "m1", message: { role: "user", content: "no id" } },
    ];
    expect(projectVisibleSessionTranscriptMessageEntries(events)).toEqual([]);
  });

  it("passes the read target through to the host event reader", async () => {
    const calls: unknown[] = [];
    const reader = createJsonlVisibleSessionTranscriptReader(async (params) => {
      calls.push(params);
      return [header, messageEvent({ id: "m1", parentId: null, role: "user", text: "hi" })];
    });
    const entries = await reader({
      sessionId: "s1",
      sessionKey: "agent:main:main",
      agentId: "main",
      threadId: 7,
    });
    expect(calls).toEqual([
      { sessionId: "s1", sessionKey: "agent:main:main", agentId: "main", threadId: 7 },
    ]);
    expect(entries.map((entry) => entry.entryId)).toEqual(["m1"]);
  });

  it("keeps compaction records on the branch without projecting them", () => {
    const events = [
      header,
      messageEvent({ id: "m1", parentId: null, role: "user", text: "one" }),
      { type: "compaction", id: "c1", parentId: "m1", timestamp: "x", summary: "s" },
      messageEvent({ id: "m2", parentId: "c1", role: "assistant", text: "two" }),
    ];
    expect(selectVisibleTranscriptEventEntries(events).map((entry) => entry.seq)).toEqual([2, 3, 4]);
    expect(projectVisibleSessionTranscriptMessageEntries(events).map((entry) => entry.entryId)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("treats an invalid leaf control as transparent and keeps the append path", () => {
    const events = [
      header,
      messageEvent({ id: "m1", parentId: null, role: "user", text: "one" }),
      { type: "leaf", id: "bad-leaf", parentId: "m1", targetId: "missing" },
      messageEvent({ id: "m2", parentId: "bad-leaf", role: "assistant", text: "two" }),
    ];
    expect(projectVisibleSessionTranscriptMessageEntries(events).map((entry) => [entry.entryId, entry.parentId])).toEqual([
      ["m1", null],
      ["m2", "m1"],
    ]);
  });

  it("truncates to the reachable suffix when an ancestor is missing from the file", () => {
    const events = [
      header,
      messageEvent({ id: "m2", parentId: "gone", role: "user", text: "orphan" }),
      messageEvent({ id: "m3", parentId: "m2", role: "assistant", text: "reply" }),
    ];
    const entries = projectVisibleSessionTranscriptMessageEntries(events);
    expect(entries.map((entry) => entry.entryId)).toEqual(["m2", "m3"]);
    expect(entries[0]?.parentId).toBe("gone");
  });

  it("returns an empty projection when the host has no events", async () => {
    const reader = createJsonlVisibleSessionTranscriptReader(async () => []);
    await expect(reader({ sessionId: "s", sessionKey: "agent:main:main" })).resolves.toEqual([]);
  });

  it("forwards the host-provided session file to the event reader", async () => {
    const calls: unknown[] = [];
    const reader = createJsonlVisibleSessionTranscriptReader(async (params) => {
      calls.push(params);
      return [];
    });
    await reader({ sessionId: "s", sessionKey: "agent:main:main", sessionFile: "/tmp/s.jsonl" });
    expect(calls).toEqual([{ sessionId: "s", sessionKey: "agent:main:main", sessionFile: "/tmp/s.jsonl" }]);
  });
});

describe("visible transcript projection resolution", () => {
  it("prefers the native host projection", async () => {
    const native = async () => [];
    const resolved = resolveVisibleTranscriptProjection({
      readVisibleSessionTranscriptMessageEntries: native,
      readSessionTranscriptEvents: async () => [header],
    });
    expect(resolved?.source).toBe("host-native");
    expect(resolved?.read).toBe(native);
  });

  it("falls back to the JSONL rebuild when only raw events are exported", async () => {
    const resolved = resolveVisibleTranscriptProjection({
      readSessionTranscriptEvents: async () => [
        header,
        messageEvent({ id: "m1", parentId: null, role: "user", text: "hi" }),
      ],
    });
    expect(resolved?.source).toBe("jsonl-compat");
    const entries = await resolved!.read({ sessionId: "s", sessionKey: "agent:main:main" });
    expect(entries.map((entry) => entry.entryId)).toEqual(["m1"]);
  });

  it("resolves nothing when the host exports neither reader", () => {
    expect(resolveVisibleTranscriptProjection({})).toBeUndefined();
    expect(resolveVisibleTranscriptProjection({ readSessionTranscriptEvents: "nope" })).toBeUndefined();
  });
});

describe("JSONL compatibility target adaptation", () => {
  it("omits only the injected agent SQLite runtime store path", async () => {
    const calls: unknown[] = [];
    const reader = createJsonlVisibleSessionTranscriptReader(async (params) => {
      calls.push(params);
      return [header, messageEvent({ id: "m1", parentId: null, role: "user", text: "hi" })];
    });

    await expect(
      reader({
        agentId: "MAIN",
        sessionId: "s1",
        sessionKey: "agent:main:subagent:s1",
        storePath: "/tmp/openclaw/agents/main/agent/openclaw-agent.sqlite",
      }),
    ).resolves.toHaveLength(1);

    expect(calls).toEqual([
      { agentId: "MAIN", sessionId: "s1", sessionKey: "agent:main:subagent:s1" },
    ]);
  });

  it("preserves custom SQLite stores, mismatched agent paths, and explicit files", async () => {
    const calls: unknown[] = [];
    const reader = createJsonlVisibleSessionTranscriptReader(async (params) => {
      calls.push(params);
      return [];
    });
    const injectedPath = "/tmp/openclaw/agents/main/agent/openclaw-agent.sqlite";

    await reader({
      agentId: "main",
      sessionId: "custom",
      sessionKey: "agent:main:custom",
      storePath: "/tmp/custom-session-store.sqlite",
    });
    await reader({
      agentId: "main",
      sessionId: "other-agent",
      sessionKey: "agent:main:other-agent",
      storePath: "/tmp/openclaw/agents/other/agent/openclaw-agent.sqlite",
    });
    await reader({
      agentId: "main",
      sessionId: "active-file",
      sessionKey: "agent:main:active-file",
      storePath: injectedPath,
      sessionFile: "  /tmp/active.jsonl  ",
    });

    expect(calls).toEqual([
      {
        agentId: "main",
        sessionId: "custom",
        sessionKey: "agent:main:custom",
        storePath: "/tmp/custom-session-store.sqlite",
      },
      {
        agentId: "main",
        sessionId: "other-agent",
        sessionKey: "agent:main:other-agent",
        storePath: "/tmp/openclaw/agents/other/agent/openclaw-agent.sqlite",
      },
      {
        agentId: "main",
        sessionId: "active-file",
        sessionKey: "agent:main:active-file",
        storePath: injectedPath,
        sessionFile: "/tmp/active.jsonl",
      },
    ]);
  });

  it("treats a blank session file as absent for the injected path", async () => {
    const calls: unknown[] = [];
    const reader = createJsonlVisibleSessionTranscriptReader(async (params) => {
      calls.push(params);
      return [];
    });

    await reader({
      agentId: "main",
      sessionId: "s1",
      sessionKey: "agent:main:subagent:s1",
      storePath: "/tmp/openclaw/agents/main/agent/openclaw-agent.sqlite",
      sessionFile: "  ",
    });

    expect(calls).toEqual([
      { agentId: "main", sessionId: "s1", sessionKey: "agent:main:subagent:s1" },
    ]);
  });


});
