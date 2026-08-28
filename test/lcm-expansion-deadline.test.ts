import { describe, expect, it } from "vitest";
import {
  allocateExpansionTokenCaps,
  createExpansionDeadline,
  remainingDeadlineMs,
} from "../src/tools/lcm-expansion-deadline.js";

describe("createExpansionDeadline", () => {
  it("gives normal recall 30 seconds of work and five seconds of cleanup headroom", () => {
    expect(
      createExpansionDeadline({
        nowMs: 1_000,
        dynamicToolTimeoutMs: 35_000,
        delegationTimeoutMs: 30_000,
        headroomMs: 5_000,
        mode: "normal",
      }),
    ).toEqual({
      startedAtMs: 1_000,
      totalDeadlineMs: 36_000,
      workDeadlineMs: 31_000,
    });
    const deadline = createExpansionDeadline({
      nowMs: 1_000,
      dynamicToolTimeoutMs: 35_000,
      delegationTimeoutMs: 30_000,
      headroomMs: 5_000,
      mode: "normal",
    });
    expect(deadline.totalDeadlineMs - deadline.startedAtMs).toBe(35_000);
  });

  it("never lets normal recall exceed its 35-second total budget", () => {
    expect(
      createExpansionDeadline({
        nowMs: 1_000,
        dynamicToolTimeoutMs: 120_000,
        delegationTimeoutMs: 120_000,
        headroomMs: 5_000,
        mode: "normal",
      }),
    ).toEqual({
      startedAtMs: 1_000,
      totalDeadlineMs: 36_000,
      workDeadlineMs: 31_000,
    });
  });

  it("keeps the default delegated work window and cleanup reserve", () => {
    expect(
      createExpansionDeadline({
        nowMs: 1_000,
        dynamicToolTimeoutMs: 150_000,
        delegationTimeoutMs: 120_000,
        headroomMs: 30_000,
        mode: "forensic",
      }),
    ).toEqual({
      startedAtMs: 1_000,
      totalDeadlineMs: 151_000,
      workDeadlineMs: 121_000,
    });
  });

  it("uses the configured delegation timeout when the caller provides more time", () => {
    expect(
      createExpansionDeadline({
        nowMs: 500,
        dynamicToolTimeoutMs: 600_000,
        delegationTimeoutMs: 180_000,
        headroomMs: 30_000,
        mode: "forensic",
      }).workDeadlineMs,
    ).toBe(180_500);
  });

  it("does not expand short caller timeouts to the configured delegation timeout", () => {
    expect(
      createExpansionDeadline({
        nowMs: 2_000,
        dynamicToolTimeoutMs: 20_000,
        delegationTimeoutMs: 120_000,
        headroomMs: 30_000,
        mode: "forensic",
      }),
    ).toEqual({
      startedAtMs: 2_000,
      totalDeadlineMs: 22_000,
      workDeadlineMs: 2_000,
    });
  });
});

describe("remainingDeadlineMs", () => {
  it("returns the remaining whole milliseconds without extending the deadline", () => {
    expect(remainingDeadlineMs(5_000, 1_250.4)).toBe(3_749);
    expect(remainingDeadlineMs(5_000, 5_000)).toBe(0);
    expect(remainingDeadlineMs(5_000, 6_000)).toBe(0);
  });
});

describe("allocateExpansionTokenCaps", () => {
  it("splits the cap evenly and assigns remainder in rank order", () => {
    expect(allocateExpansionTokenCaps({ bucketCount: 3, tokenCap: 10 })).toEqual([4, 3, 3]);
  });

  it("skips lower-ranked buckets when the cap is smaller than the bucket count", () => {
    expect(allocateExpansionTokenCaps({ bucketCount: 3, tokenCap: 2 })).toEqual([1, 1]);
  });

  it("never allocates more than the normalized positive token cap", () => {
    expect(allocateExpansionTokenCaps({ bucketCount: 3, tokenCap: 1.9 })).toEqual([1]);
    expect(allocateExpansionTokenCaps({ bucketCount: 0, tokenCap: 100 })).toEqual([]);
  });
});
