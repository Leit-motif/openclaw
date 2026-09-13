import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished, vi } from "vitest";
import { createManagerHarness, markCallAnswered } from "./manager.test-harness.js";

it("finalizes each fixture's calls and destroys its real duration and transcript timers", async () => {
  const ownership = new AsyncLocalStorage<"duration" | "transcript">();
  const allocated = { duration: 0, transcript: 0 };
  const pending = new Map<Parameters<typeof clearTimeout>[0], "duration" | "transcript">();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  // oxlint-disable-next-line no-warning-comments -- Keep the upstream removal condition beside the workaround.
  // TODO(oven-sh/bun#35391): Use async_hooks again after Bun emits Timeout lifecycle events.
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ) => {
    const timer = originalSetTimeout(callback, timeout, ...args);
    const owner = ownership.getStore();
    if (owner) {
      allocated[owner]++;
      pending.set(timer, owner);
    }
    return timer;
  }) as typeof setTimeout);
  const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(((timer) => {
    if (timer !== undefined) {
      pending.delete(timer);
    }
    originalClearTimeout(timer);
  }) as typeof clearTimeout);
  const fixtures: Array<Awaited<ReturnType<typeof createManagerHarness>>> = [];
  const callIds: string[] = [];
  const turns: Array<ReturnType<(typeof fixtures)[number]["manager"]["continueCall"]>> = [];
  let turnResult: Awaited<(typeof turns)[number]> | undefined;

  // Finish hooks are LIFO: register verification before allocating fixtures so
  // it observes their cleanup, after afterEach and fixture teardown have run.
  onTestFinished(async () => {
    try {
      await setImmediate();
      expect(allocated).toEqual({ duration: 2, transcript: 1 });
      expect([...pending.values()], "fixture timers surviving test cleanup").toEqual([]);
      for (const [index, { manager, provider }] of fixtures.entries()) {
        expect(manager.getActiveCalls()).toEqual([]);
        expect(provider.hangupCalls).toEqual([]);
        expect(await manager.getCallFromMemoryOrStore(callIds[index]!)).toMatchObject({
          state: "hangup-user",
          endReason: "hangup-user",
          endedAt: expect.any(Number),
        });
      }
      expect(turnResult).toEqual({ success: false, error: "Call ended: hangup-user" });
    } finally {
      try {
        // Keep failing-before proof contained; this runs only after assertions
        // and uses carrier hangup, not the fixture's synthetic terminal event.
        for (const { manager } of fixtures) {
          for (const call of manager.getActiveCalls()) {
            await manager.endCall(call.callId);
          }
        }
        await Promise.all(turns);
      } finally {
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
        ownership.disable();
      }
    }
  });

  for (let index = 0; index < 2; index++) {
    const fixture = await createManagerHarness();
    fixtures.push(fixture);
    const started = await fixture.manager.initiateCall("+15550000001");
    expect(started.success).toBe(true);
    callIds.push(started.callId);
    await ownership.run("duration", () =>
      markCallAnswered(fixture.manager, started.callId, `answered-${index}`),
    );
    if (index === 0) {
      turns.push(
        ownership.run("transcript", () =>
          fixture.manager.continueCall(started.callId, "Waiting for a reply").then((result) => {
            turnResult = result;
            return result;
          }),
        ),
      );
    }
  }
  await setImmediate();
  expect(allocated).toEqual({ duration: 2, transcript: 1 });
  expect(pending.size).toBe(3);
  expect(turnResult).toBeUndefined();
});
