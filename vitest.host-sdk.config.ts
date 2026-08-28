import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const hostSdkRoot = process.env.OPENCLAW_TEST_SDK_ROOT?.trim();
if (!hostSdkRoot) {
  throw new Error(
    "OPENCLAW_TEST_SDK_ROOT must name the host dist directory for host-SDK integration tests.",
  );
}

const hostSdkDir = isAbsolute(hostSdkRoot) ? hostSdkRoot : resolve(hostSdkRoot);
const transcriptRuntime = join(hostSdkDir, "plugin-sdk", "session-transcript-runtime.js");
if (!existsSync(transcriptRuntime)) {
  throw new Error(
    `OPENCLAW_TEST_SDK_ROOT does not expose plugin-sdk/session-transcript-runtime.js: ${hostSdkDir}`,
  );
}

const testHome = mkdtempSync(join(tmpdir(), "lossless-claw-vitest-host-sdk-home-"));
const testOpenClawDir = join(testHome, ".openclaw");
mkdirSync(testOpenClawDir, { recursive: true });

/**
 * A test-only binding for the host's public SDK export. Production keeps its
 * normal package import, while this lane proves the plugin against the exact
 * host artifact selected by OPENCLAW_TEST_SDK_ROOT.
 */
export default defineConfig({
  resolve: {
    alias: {
      "openclaw/plugin-sdk/session-transcript-runtime": transcriptRuntime,
    },
  },
  test: {
    dir: "test",
    include: ["**/*.test.ts"],
    exclude: ["**/.worktrees/**"],
    env: {
      HOME: testHome,
    },
  },
});
