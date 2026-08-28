import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLcmDatabaseConnection } from "../src/db/connection.js";
import { LcmContextEngine } from "../src/engine.js";
import type { AgentMessage } from "../src/openclaw-bridge.js";
import type { VisibleSessionTranscriptMessageEntry } from "../src/types.js";
import { cleanupEngineTestState, createTestConfig, createTestDeps, tempDirs } from "./helpers.js";

afterEach(cleanupEngineTestState);

describe("inline tool-result recovery and the transcript anchor audit", () => {
  it("keeps the transcript anchor of a recovered tool result across a second bootstrap", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-claw-inline-audit-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "lcm.db");
    const sessionId = "inline-audit-session";
    const sessionKey = "agent:main:inline-audit-session";
    const toolMessage = {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "exec",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          name: "exec",
          content: [{ type: "text", text: "exec output line" }],
        },
      ],
    } as unknown as AgentMessage;
    const visibleEntries: VisibleSessionTranscriptMessageEntry[] = [
      {
        entryId: "entry-user",
        parentId: null,
        seq: 2,
        role: "user",
        message: { role: "user", content: "run it" },
        createdAt: "2026-09-06T00:00:00.000Z",
      },
      {
        entryId: "entry-tool",
        parentId: "entry-user",
        seq: 3,
        role: "toolResult",
        message: toolMessage,
        createdAt: "2026-09-06T00:00:01.000Z",
      },
      {
        entryId: "entry-assistant",
        parentId: "entry-tool",
        seq: 4,
        role: "assistant",
        message: { role: "assistant", content: "done" },
        createdAt: "2026-09-06T00:00:02.000Z",
      },
    ];
    const readVisibleSessionTranscriptMessageEntries = vi.fn(async () => visibleEntries);
    const openEngine = () => {
      const config = createTestConfig(databasePath, { toolResultPayloadMode: "inline" });
      return new LcmContextEngine(
        createTestDeps(config, { readVisibleSessionTranscriptMessageEntries }),
        createLcmDatabaseConnection(databasePath),
      );
    };

    const first = openEngine();
    await expect(first.bootstrap({ sessionId, sessionKey })).resolves.toMatchObject({
      bootstrapped: true,
      importedMessages: 3,
    });
    const conversation = await first.getConversationStore().getConversationBySessionId(sessionId);
    expect(conversation).not.toBeNull();
    const storedFirst = await first.getConversationStore().getMessages(conversation!.conversationId);
    expect(storedFirst.map((message) => message.role)).toEqual(["user", "tool", "assistant"]);
    expect(storedFirst[1]?.content).toContain("exec output line");
    await first.dispose();

    const second = openEngine();
    await second.bootstrap({ sessionId, sessionKey });
    const audit = await second
      .getConversationStore()
      .listTranscriptAnchorAuditMessages(conversation!.conversationId);
    expect(audit.map((row) => row.transcriptEntryId)).toEqual([
      "entry-user",
      "entry-tool",
      "entry-assistant",
    ]);
    const epoch = await second
      .getConversationStore()
      .getConversationTranscriptEpoch(conversation!.conversationId);
    expect(epoch?.migrationMode ?? null).not.toBe("legacy_prefix");
    await second.dispose();
  });
});
