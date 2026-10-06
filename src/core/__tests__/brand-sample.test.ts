import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN } from "../design/presets";
import { sampleBrandVideoProps } from "../design/sample";
import { validateSceneSpec } from "../spec/scene";

describe("sampleBrandVideoProps (brand kit preview)", () => {
  it("produces valid scene specs that cover the whole sample duration", () => {
    const props = sampleBrandVideoProps({ design: DEFAULT_DESIGN, brand: { brandName: "Acme", tagline: "Work, simplified.", logoAssetId: null } });
    expect(props.scenes).toHaveLength(3);
    for (const scene of props.scenes) expect(validateSceneSpec(scene.spec).ok).toBe(true);
    expect(props.scenes[0].start).toBe(0);
    expect(props.scenes[props.scenes.length - 1].end).toBe(props.durationSec);
    expect(props.brand.brandName).toBe("Acme");
  });

  it("uses placeholder copy for an empty brand and keeps a custom format", () => {
    const props = sampleBrandVideoProps({ design: DEFAULT_DESIGN, brand: { brandName: "", tagline: "", logoAssetId: null }, width: 1080, height: 1920, fps: 25 });
    expect(props.brand.brandName).toBe("Your brand");
    expect([props.width, props.height, props.fps]).toEqual([1080, 1920, 25]);
    for (const scene of props.scenes) expect(validateSceneSpec(scene.spec).ok).toBe(true);
  });
});
