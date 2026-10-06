import { describe, expect, it } from "vitest";
import { validateSceneSpec } from "../spec/scene";
import { endScreenSpec, lowerThirdElements, titleCardSpec } from "../templates/builtin";

describe("built-in templates", () => {
  it("builds valid title card and end screen scenes", () => {
    const title = validateSceneSpec(titleCardSpec({ title: "Free AI dictation", kicker: "Review" }));
    expect(title.ok).toBe(true);
    const end = validateSceneSpec(endScreenSpec({ title: "Watch next", link: "clemencekotoku.com" }));
    expect(end.ok ? end.spec.elements.map((e) => e.id) : end.issues).toEqual(["es_title", "es_video_1", "es_video_1_label", "es_video_2", "es_video_2_label", "es_subscribe", "es_link"]);
  });

  it("builds a lower third that can be added to any scene", () => {
    const elements = lowerThirdElements({ name: "Clemence Kotoku", title: "Web designer", atSec: 2, durationSec: 5, side: "right", idPrefix: "lt_1" });
    const v = validateSceneSpec({ version: 1, elements });
    expect(v.ok ? v.spec.elements.length : v.issues).toBe(4);
    expect(elements.map((e) => e.id)).toEqual(["lt_1_panel", "lt_1_bar", "lt_1_name", "lt_1_title"]);
  });
});
