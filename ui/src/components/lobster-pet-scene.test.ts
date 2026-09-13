import { describe, expect, it } from "vitest";
import { resolveLobsterComposerScene } from "./lobster-pet-scene.ts";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("composer critter clearance", () => {
  const input = {
    composer: box(0, 100, 720, 112),
    footer: box(0, 168, 720, 40),
    controls: [box(8, 170, 130, 32), box(480, 170, 232, 32)],
    topObstacles: [box(8, 60, 220, 32)],
    editor: box(14, 114, 692, 28),
    placeholderRight: 300,
    twins: false,
  };

  it("uses a normal-height footer without touching controls, chips or placeholder", () => {
    const scene = resolveLobsterComposerScene(input);
    expect(scene.top?.start).toBeGreaterThan(228);
    expect(scene.floor).toEqual({ start: 176, end: 442, y: 103 });
    expect(scene.passage).toEqual([338, 442]);
  });

  it("keeps a crowded footer and a tall editor out of the travel scene", () => {
    expect(
      resolveLobsterComposerScene({ ...input, controls: [box(0, 168, 720, 40)] }).floor,
    ).toBeNull();
    expect(
      resolveLobsterComposerScene({ ...input, editor: box(14, 114, 692, 85) }).passage,
    ).toBeNull();
  });
});
