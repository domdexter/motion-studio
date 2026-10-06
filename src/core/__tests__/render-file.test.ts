import { describe, expect, it } from "vitest";
import { renderFileStem } from "../spec/format";

describe("render file names", () => {
  const projectName = "Incep Platform — Launch Film";

  it("names renders after the project, version and kind", () => {
    expect(renderFileStem({ projectName, version: 7, kind: "final" })).toBe("incep-platform-launch-film-v7-final");
    expect(renderFileStem({ projectName, version: 8, kind: "preview" })).toBe("incep-platform-launch-film-v8-preview");
    expect(renderFileStem({ projectName, version: 9, kind: "scene", sceneKey: "scene_03" })).toBe("incep-platform-launch-film-v9-scene-03");
    expect(renderFileStem({ projectName, version: 10, kind: "range", startSec: 15.4, endSec: 30.44 })).toBe("incep-platform-launch-film-v10-range-15.4s-30.4s");
  });

  it("adds the size for non-project formats and stays path-safe", () => {
    expect(renderFileStem({ projectName, version: 3, kind: "final", size: { width: 1080, height: 1920 } })).toBe("incep-platform-launch-film-v3-final-1080x1920");
    const hostile = renderFileStem({ projectName: "../../etc/passwd <script>", version: 1, kind: "final" });
    expect(hostile).toMatch(/^[a-z0-9.-]+$/);
    expect(renderFileStem({ projectName: "日本語", version: 2, kind: "final" })).toBe("project-v2-final");
  });
});
