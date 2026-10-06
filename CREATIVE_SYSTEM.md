# Creative system — direction, shots, motion grammar and Creative QA

The creative system is the layer between the audio timeline and the Remotion scene specs. It
stores creative decisions as validated, versioned documents — a project **creative plan**,
per-scene **creative intent** and written **creative reviews** — so every scene is designed from
one direction, its implementation can be measured, and quality is judged and refined through
explicit, reviewable steps. It never changes timing and never scores creative quality on its own:
metrics measure, reviewers judge.

> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [AI_WORKFLOW.md](AI_WORKFLOW.md) ·
> [REMOTION.md](REMOTION.md) · [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md). The analysis that preceded
> the system is in [CREATIVE_ASSESSMENT.md](CREATIVE_ASSESSMENT.md).

| Concern | Code |
| --- | --- |
| Schemas and vocabularies (plan, scene intent, reviews) | `src/core/creative/schema.ts` |
| Treatments, motion grammar, density and role scales, asset hierarchy, principles | `src/core/creative/grammar.ts` |
| Measured metrics and findings | `src/core/creative/metrics.ts` |
| Generation briefs | `src/core/creative/briefs.ts` |
| Shots, motion fields, shot triggers | `src/core/spec/scene.ts`, `src/core/spec/triggers.ts` |
| Engine: shot layers, density, roles, grammar | `src/remotion/scene/scene-view.tsx`, `scene/transition.ts`, `engine/context.tsx`, `engine/animation.ts` |
| Services | `src/server/services/creative.ts` (plan, metrics) · `creative-reviews.ts` (reviews, issues, refinement) |
| GUI | `src/components/studio/creative/*` (Direction, Creative QA, scene Intent tab) |

## 1. Pipeline and authority

```
Script + Audio + Brand
  ─▶ Creative direction ─▶ Story arc ─▶ Visual language     .project/creative.json (CreativePlan, versioned)
  ─▶ Shot plan ─▶ Storyboard ─▶ Asset strategy                Scene.creative · asset request briefs
  ─▶ Scene specs ─▶ Motion design                             Scene.spec: shots, motion.density, motionRole / motionIntent
  ─▶ Remotion ─▶ Preview                                      deterministic frames
  ─▶ Creative QA ─▶ Refinement                                creative:metrics (measured) · CreativeReview (written) · refine_creative tasks
  ─▶ Render
```

| Layer | Authority over | Stored in |
| --- | --- | --- |
| **Audio / timeline** | Timing: scene boundaries, word anchors, when triggers fire | `VoiceTake`, `Transcript`, `Timeline`, scene start/end |
| **Creative plan** | Global intent: concept, story arc, visual language, visual distribution, asset consistency, references | `CreativeRevision` → `.project/creative.json` |
| **Storyboard / scene creative** | Storytelling intent per scene: purpose, beat, metaphor, treatment, composition, motion plan, shot plan, asset plan | Scene storyboard fields + `Scene.creative` |
| **Scene spec** | Implementation: elements, shots, triggers, motion density, motion roles and intents | `Scene.spec` |
| **Remotion** | Deterministic rendering of the spec — it never reads creative intent | `src/remotion` |
| **Claude Code** | Reasoning and orchestration: plans, designs, reviews and refines through tasks and the CLI | `AiTask`, `cli/studio.ts` |

Consequences enforced in code:

- Creative documents never move timing. Shot plans are informational; shot triggers in the spec
  are authoritative and always resolve inside the scene.
- Scene intent is not a Remotion input: editing only `creative` does not make renders stale and
  keeps the scene's approval (it still creates a scene version).
- Locked scenes reject intent edits the same way they reject spec edits.
- A creative review is read-only. Changes happen only in explicit `refine_creative` tasks.

## 2. Creative plan — `.project/creative.json`

| Section | Content |
| --- | --- |
| `direction` | Concept and philosophy (§2.1) |
| `storyArc` | Acts mapped to scene keys with planned intensity (§2.2) |
| `visualLanguage` | Typography, layout, composition, color, imagery, motion, transitions, camera, density rules (§2.3) |
| `visualDistribution` | Target screen-time share per treatment family (§2.4) |
| `assetStrategy` | `approach` and campaign-wide `consistency` (§11) |
| `references` | Analyses of style references (§12) |
| `notes` | Free text |

```bash
npm run studio -- creative <project> [--json]                              # print the current plan
npm run studio -- creative:apply <project> plan.json [--replace] [--note "…"]
npm run studio -- creative:revisions <project>
npm run studio -- creative:restore <project> <version>                     # saved as a new revision
```

- **Merge (default)**: each top-level section in the file replaces that whole section; a section set
  to `null` is removed; sections not in the file are kept. `--replace` stores exactly the file.
- File metadata keys `$schema`, `_readme`, `projectId`, `revision`, `source`, `updatedAt` are ignored.
- Every change is a new `CreativeRevision` (`source`: `claude` `user` `file` `restore`) with an
  activity entry. Saving an unchanged plan creates nothing; a first plan must contain at least one section.
- Non-blocking warnings: duplicate act ids, acts listing scene keys that don't exist, a scene in two
  acts, distribution shares that don't add up to 1 (±0.05 — they are normalized when compared).
- **Editing `creative.json` directly** imports the file as the *whole* plan (replace mode): deleting a
  section in the file removes it. If the plan changed in the GUI since the file was written, the GUI
  version wins and a sync issue is reported.

Text fields are capped at 400 characters (short: `concept`, `tone`, `visualStyle`, …) or 4000 (long:
`narrativeStrategy`, `pacing`, the philosophies, …).

Example (abridged from the Incep launch film, §18):

```json
{
  "direction": {
    "concept": "From scattered pieces to one point of focus",
    "tone": "Premium, confident, intelligent, calm",
    "motionPhilosophy": "Purposeful and restrained. One primary move per shot.",
    "avoid": ["excessive glow", "random particles", "decorative transitions", "gradients"]
  },
  "storyArc": {
    "summary": "Friction → The turn → Clarity → One place → Resolution",
    "acts": [
      { "id": "friction", "name": "Friction", "beat": "problem", "emotion": "frustration, tension", "visualLanguage": ["charcoal field", "unaligned fragments"], "intensity": 4, "scenes": ["scene_01", "scene_02"] },
      { "id": "turn", "name": "The turn", "beat": "turn", "emotion": "relief", "intensity": 5, "scenes": ["scene_03"] }
    ]
  },
  "visualLanguage": {
    "typography": { "hierarchy": "strong", "maxWordsOnScreen": 10 },
    "color": { "dominant": "primary", "accent": "secondary", "gradients": "none", "glow": "none" },
    "transitions": { "frequency": "restrained", "allowed": ["cut", "fade", "wipe"] },
    "camera": { "behavior": "static" },
    "density": "sparse"
  },
  "visualDistribution": { "productUI": 0.35, "kineticTypography": 0.25, "abstractGraphics": 0.15, "brandMoments": 0.15, "transformation": 0.1 }
}
```

### 2.1 Creative direction

`concept` (required) · `coreMessage` · `narrativeStrategy` · `tone` · `emotionalDirection` ·
`visualStyle` · `visualLanguage` · `pacing` · `motionPhilosophy` · `compositionPhilosophy` ·
`typographyDirection` · `colorStrategy` · `imageryDirection` · `transitionPhilosophy` ·
`visualDensity` · `brandTreatment` · `avoid[]` (≤ 40). An `avoid` entry mentioning particles raises
the `particles` finding to medium.

### 2.2 Story arc

`storyArc: { summary?, acts: [1–12] }`. Derive the acts from **this** script — not a template.

| Act field | Rule |
| --- | --- |
| `id` | 1–40 letters, digits, `_` or `-` (scene intent refers to it with `act`) |
| `name` | required |
| `purpose`, `emotion`, `notes` | text |
| `beat` | `hook problem tension turn solution feature benefit proof resolution cta brand statement` |
| `visualLanguage[]` | ≤ 12 short phrases, e.g. `"charcoal field"` |
| `intensity` | planned 1 (quiet) … 5 (peak) — the fallback planned intensity of its scenes (§10) |
| `scenes[]` | scene keys (`scene_01` …). A scene belongs to the act whose id it names in `creative.act`, else the act that lists it |

### 2.3 Visual language

Every sub-section also takes `notes`.

| Key | Fields | Used by metrics |
| --- | --- | --- |
| `summary` | text | – |
| `typography` | `style`, `hierarchy` (`strong moderate flat`), `case`, `maxWordsOnScreen` (1–40) | limit for `too-much-text` when a scene sets none |
| `layout` | `style`, `grid` | – |
| `composition` | `style`, `negativeSpace` (`minimal moderate generous`), `focalHierarchy` | – |
| `color` | `strategy`, `dominant`, `accent`, `neutrals[]` (colors or tokens, ≤ 8), `semantic`, `gradients` / `glow` (`none restrained expressive`) | `glow: "none"` → `glow-against-language` |
| `imagery` | `style`, `contrast` (`low medium high`), `subjects` | – |
| `lighting`, `texture`, `uiTreatment`, `shapeLanguage`, `iconTreatment` | text | – |
| `motion` | `style`, `energy` (`calm low medium medium-high high`), `easing` | – |
| `transitions` | `style`, `frequency` (`minimal restrained moderate frequent`), `allowed[]` (`none cut fade slide wipe zoom blur scale morph`) | `decorative-transitions`, `transition-not-allowed`, `transition-variety` severity |
| `camera` | `behavior` (`static restrained moderate dynamic`), `allowedOn` | `constant-camera` severity |
| `density` | `sparse balanced dense` | – |

### 2.4 Visual distribution

`visualDistribution` maps treatment families to a target share (0–1) of screen time — a balancing
aid, not a quota. Families: `kineticTypography productUI abstractGraphics imagery diagrams
transformation brandMoments` (§6). Metrics compare the normalized target with the measured share
and report `distribution-off-target` when a family is 15 points or more away.

## 3. Scene creative intent — `Scene.creative`

| Field | Content |
| --- | --- |
| `purpose` | What this moment must do |
| `narrativeBeat` | A narrative beat (§2.2) |
| `act` | Story arc act id |
| `emotion` | Short text |
| `visualMetaphor` | The strongest representation of the idea (§5) |
| `interpretation` | `metaphorical` `transformational` `literal` |
| `treatment`, `secondaryTreatments[]` (≤ 4) | Treatments (§6) |
| `intensity` | Planned 1–5 |
| `composition` | §7 |
| `motion` | `density` (§9), `primary` / `secondary` / `tertiary` (text, §8), `grammar[]` (motion intents, ≤ 10), `stillness` (intentional visual silence), `notes` |
| `typography` | `hierarchy` (`display headline title subtitle body caption none`), `emphasisWords[]` (≤ 12), `maxWords` (0–60, the scene's `too-much-text` limit), `notes` |
| `transition` | Text |
| `audioSync[]` | `{ word, occurrence?, action }` (≤ 24) — which spoken words drive which visual change |
| `shots[]` | Shot plan (§4, ≤ 12) |
| `assets[]` | `{ need, source, assetId?, requestId?, rationale?, brief? }` (≤ 12, §11) |
| `constraints` | `{ preserveTiming?, preserveVoice?, notes? }` |
| `overrides` | Intentional deviations from the project visual language, and why |

Write it with any of: a storyboard document (`creative` per scene, `storyboard:apply`), `scene:apply`
with `{ "spec": …, "creative": … }` (`"creative": null` clears it), the `creative` field of
`.project/storyboard.json` (editable, `null` clears), or Scenes editor → **Intent** tab (form plus a
JSON editor for shots, assets, audio sync and constraints). `scene:show` prints it.

Example (from scene_03 of the Incep film, abridged):

```json
{
  "purpose": "The turn: many pieces become one point, and the point becomes the brand.",
  "narrativeBeat": "turn",
  "act": "turn",
  "visualMetaphor": "Fragments converging into the Incep dot — the platform as the single point of focus.",
  "interpretation": "transformational",
  "treatment": "transformation",
  "intensity": 5,
  "composition": { "layout": "centered", "focalPoint": "center-left" },
  "motion": { "density": "peak" },
  "shots": [
    { "id": "converge", "purpose": "Many fragments become one point" },
    { "id": "reveal", "purpose": "The point becomes the brand" }
  ],
  "assets": [{ "need": "Incep mark", "source": "existing_asset" }]
}
```

## 4. Shot planning

A scene of several seconds either sits still or crams every change into one layout. Shots give it
rhythm inside its audio-locked timing.

| | Plan — `creative.shots[]` (ShotPlan) | Implementation — `spec.shots[]` (ShotSpec) |
| --- | --- | --- |
| Fields | `id`, `purpose` (required), `from` / `to` (planned seconds from the scene start), `startWord`, `composition`, `focalPoint`, `treatment`, `visual`, `motion`, `transition`, `audioSync`, `assetNeed` | `id`, `at` (trigger), `background`, `camera`, `transitionIn`, `elements[]` (≤ 40), `notes` |
| Timing | Informational | Authoritative |
| Linked by | `id` (1–40 letters, digits, `_`, `-`) | the same `id`; duplicate ids are a spec validation error |

**Timing rules** (`resolveShotWindows`):

- Shots run in array order (≤ 12). Each starts at its `at` trigger and ends where the next one
  starts; the last ends at the scene end. Shots never extend the scene.
- Only the first shot may omit `at` (it starts at the scene start). A later shot without `at` is
  invalid and placed at an even split so rendering stays deterministic.
- `at` resolves on the scene: use `word`, `phrase`, `wordIndex`, `sceneTime` or `time`. A shot that
  doesn't start at least 0.04 s after the previous one is invalid and moved to just after it.
- Invalid windows are reported by `validate`, `scene:show` and the `shot-timing` finding; planned
  `from`/`to` beyond the scene duration → `shot-plan-outside-scene`; planned ids missing from the
  spec → `shot-plan-unimplemented`.

**Shot triggers** (any `at` field inside a shot):

| Trigger | Inside a shot | Outside shots |
| --- | --- | --- |
| `{ "type": "shotStart", "offset"? }` | shot start | scene start |
| `{ "type": "shotEnd", "offset"? }` | shot end | scene end |
| `{ "type": "shotTime", "seconds", "offset"? }` | shot start + seconds | scene start + seconds |

Inside a shot an `enter` without `at` starts at the shot start and an `exit` without `at` ends at
the shot end. `sceneStart`, `sceneEnd`, `sceneTime`, `time` and word triggers keep their scene
meaning — an event that fires while its shot is not on screen is reported ("outside shot …").

**Layers**: scene-level `elements` persist across all shots — `z < 0` renders below the shots,
`z ≥ 0` above (use it for a thread element such as a brand dot). A shot's `background` covers the
scene background while the shot is on screen; its `camera` moves only that shot. The scene
background, camera and `transitionIn` apply to the whole scene.

**Shots cut** by default. Only an explicit shot `transitionIn` (other than `none`/`cut`) animates;
its duration defaults to the design's transition duration and the outgoing shot keeps rendering
underneath. The first shot enters with the scene's transition.

```json
{
  "version": 1,
  "background": { "type": "solid", "color": "text", "grain": 0.03, "vignette": 0.3 },
  "transitionIn": { "type": "cut" },
  "motion": { "density": "peak" },
  "elements": [
    { "id": "dot", "type": "circle", "z": 10, "size": 34, "fill": true, "color": "secondary", "x": 25.6, "y": 53.4,
      "motionRole": "secondary", "motionIntent": "transform",
      "enter": { "type": "pop", "at": { "type": "word", "value": "built", "offset": -0.04 }, "duration": 0.22 } }
  ],
  "shots": [
    { "id": "converge",
      "elements": [
        { "id": "svc", "type": "rect", "color": "white", "opacity": 0.1, "x": 38, "y": 53.4, "width": 20.8, "height": 15.7, "radius": 12, "rotation": 1.8,
          "motionRole": "secondary",
          "exit": { "type": "converge", "at": { "type": "word", "value": "why" }, "duration": 0.34, "easing": "easeIn", "to": [25.6, 53.4] } },
        { "id": "svc_l", "type": "text", "role": "label", "font": "mono", "text": "SERVICES?", "color": "white", "x": 29.2, "y": 48.9, "anchor": "left", "rotation": 1.8,
          "motionRole": "tertiary",
          "exit": { "type": "converge", "at": { "type": "word", "value": "why" }, "duration": 0.34, "easing": "easeIn", "to": [25.6, 53.4] } }
      ] },
    { "id": "reveal", "at": { "type": "word", "value": "incep", "offset": -0.08 },
      "background": { "type": "solid", "color": "primary" },
      "transitionIn": { "type": "wipe", "duration": 0.3, "direction": "right" },
      "elements": [
        { "id": "wordmark", "type": "text", "role": "display", "text": "Incep Platform", "color": "white", "x": 37.3, "anchor": "left",
          "motionRole": "primary", "motionIntent": "statement", "syncToVoice": true, "enter": { "type": "wordReveal" } }
      ] }
  ]
}
```

(Abridged from the Incep film's scene_03 spec. The converge shot opens with scene_02's four guessed
section blocks and labels exactly where scene_02 left them, so the hard cut only removes the page
frame, guides and hours counter. On "why" each block and its label converge on the dot's position
with a small stagger (offsets 0–0.1 s) and are gone before the reveal; the dot pops on "built" and
persists above both shots; the reveal shot wipes in on "Incep" with the logo's dot in exactly that
position. An earlier version used `cards` + `collapseAt` on "we": its 0.8 s collapse was cut off by
the reveal 0.31 s later, which is now reported as `motion-cut-off`.)

## 5. Don't visualize literally

Before designing a scene, ask:

- What is the strongest visual representation of this idea — not which objects the sentence mentions?
- What changes on screen, and what does that change mean?
- What is the single focal point, and what is allowed to move?
- Where does this scene sit on the intensity curve — and what comes before and after it?

Record the answer in `visualMetaphor` and `interpretation` (`metaphorical`, `transformational`,
`literal`). Literal is right when it is genuinely the strongest choice — real product UI proving the
product is literal and correct.

Measured signals (severity `info`):

| Code | Condition |
| --- | --- |
| `possibly-literal` | ≥ 3 card titles/labels or list items, and ≥ 75 % of them share a non-stop word with the narration of the scene |
| `text-echoes-narration` | A text element with ≥ 5 content words, ≥ 90 % of them spoken in the scene, without `syncToVoice` |

Limits: these compare words only. They cannot see images, icons, diagrams or metaphor, do not read
`interpretation`, and cannot tell whether a literal visual is the right one or a metaphor is weak.
They are prompts for the reviewer's question above, never verdicts.

## 6. Visual variety and treatments

| Treatment | Family | Meaning |
| --- | --- | --- |
| `kinetic_typography` | kineticTypography | The words are the visual — statements, emphasis, rhythm |
| `product_ui` | productUI | Real or native UI shown doing something meaningful |
| `dashboard_ui` | productUI | Overview surfaces: metrics, lists, status at a glance |
| `browser_mockup` / `phone_mockup` / `desktop_mockup` | productUI | Web app, mobile or laptop/monitor framing |
| `screenshot` | productUI | Captured product screen shown at readable size |
| `diagram` | diagrams | Relationships and flows: hubs, steps, cycles |
| `data_visualization` | diagrams | Numbers with movement: charts, counters, progress |
| `abstract_graphics` | abstractGraphics | Non-literal forms that carry mood or energy |
| `geometric_composition` | abstractGraphics | Shapes, lines and grids as structure |
| `iconographic_sequence` | abstractGraphics | Icons or tiles appearing in rhythm |
| `object_choreography` | abstractGraphics | Objects moving together with intent: grouping, orbit, alignment |
| `generated_imagery` / `generated_video` | imagery | AI imagery / video for what code can't draw |
| `full_bleed_imagery` | imagery | An image or video that owns the whole frame |
| `split_composition` | transformation | Two halves in dialogue — contrast, comparison |
| `before_after` | transformation | The same subject in two states |
| `transformation` | transformation | One state visibly becomes another (many → one, chaos → order) |
| `visual_metaphor` | transformation | An image that stands for the idea rather than depicting the words |
| `brand_moment` | brandMoments | Logo, name, tagline — the brand owns the frame |

**Detection** (heuristic): every element is classified — `text`/`kinetic` → kineticTypography;
`browser` `phone` `desktop` `dashboard` `badge` `button` `notification` → productUI; `chart`
`counter` `progress` `diagram` → diagrams; `card` `cards` `icon` `circle` `rect` and icon lists →
abstractGraphics; `cards` with `collapseAt` and any element with a `converge` exit → transformation; `logo` → brandMoments; images and
videos by asset (screenshot → productUI, logo → brandMoments, Claude-generated → imagery, ≥ 60 % of
the frame → full-bleed). Elements weigh by estimated area × attention factor (display/headline/
title/quote text and kinetic type weigh most). Background images/videos add imagery. Treatments
that are about arrangement or meaning (`split_composition`, `before_after`, `visual_metaphor`, …)
cannot be detected — `treatment-mismatch` is only `info` and skipped for scenes with shots.

Variety findings: `repetitive-treatment`, `repetitive-layout`, `template-like`,
`predictable-alternation`, `monotone-treatment`, `distribution-off-target` (§13).

## 7. Composition intelligence

Scene `composition`: `layout` (`centered asymmetric split thirds full_bleed layered grid stack
radial diagonal`), `focalPoint`, `textArea`, `subjectArea`, `negativeSpace` (regions),
`visualWeight` (`balanced centered left-heavy right-heavy top-heavy bottom-heavy`), `balance`
(`symmetric asymmetric radial`), `cameraDirection`, `notes`.

**Regions**: `center left right top bottom top-left top-right bottom-left bottom-right center-left
center-right center-top center-bottom full none`. Case-insensitive; aliases `left-center`,
`right-center`, `top-center`, `bottom-center`, `middle`, `centre` are accepted.

What the metrics measure, from estimated element boxes at each shot's fullest moment (the longest
shot represents the scene):

| Measure | How |
| --- | --- |
| Focal region | Region (thirds split at 38 % / 62 %) of the element with the highest area × attention weight |
| Text region | Region of the heaviest text or kinetic element |
| Negative space | Share of a 32 × 18 grid not covered by element boxes (boxes ≥ 90 % of the frame ignored) |
| Balance / weight | Area-weighted horizontal offset from center → `centered`, `balanced`, `left-heavy`, `right-heavy` |
| Layout signature | `family \| focal region \| text region` — the unit of repetition checks |
| Safe area | Text, kinetic and badge boxes outside `design.layout.safeMargin` → `text-outside-safe-area` |
| Overlap | Text covered > 30 % by UI, imagery or a diagram drawn above it → `text-covered` |
| Crowding | ≥ 5 boxes covering > 78 % of the frame → `cramped` |
| Plan check | Planned `focalPoint` vs measured focal region → `focal-mismatch` (info) |

Limits: boxes are estimates from element fields (text length × size, default sizes for devices and
cards, asset aspect ratio for media). Rotation, scale, animation and what is drawn inside screens
are ignored; `captions`, `cursor`, `line` and `grid` have no footprint.

## 8. Motion grammar and hierarchy

**Grammar — why an element moves.** `motionIntent` on an element. An element with an intent and no
explicit `enter` gets the grammar's entrance; an explicit `enter` always wins.

| Intent | Meaning | Motion | Default entrance |
| --- | --- | --- | --- |
| `emphasize` | Important information | scale + opacity | `scale` |
| `support` | Supporting information | subtle fade + short slide | `rise`, distance 26 |
| `transform` | A system or state changes | morph / resolve from blur | `blur` |
| `sequence` | Ordered or listed information | stagger | `rise`, distance 34, stagger 0.12 |
| `statement` | A strong claim | kinetic typography | text: `wordReveal`, stagger 0.06 · kinetic: none (it animates its words) · others: `scale` |
| `interact` | UI interaction | responsive micro-motion | `fade`, 0.3 s |
| `progress` | Data progression | animated values, chart growth | `fade` |
| `group` | Objects that belong together | coordinated movement | `rise`, distance 40 |
| `reveal` | Brand or answer revealed | mask / wipe | text: `mask` · others: `wipe` |
| `rest` | Visual silence | already present, still | none |

Grammar entrances have no trigger, so they start at the shot (or scene) start. To land an intent on
a word, write an explicit `enter` with `at`; the intent then documents why and drives
`grammar-mismatch`. Grammar entrances are scene events like explicit ones: they appear as timeline
markers and count in `validate`, measured density and `simultaneous-entrances`.

Entrance energy (used by the hierarchy findings): quiet `fade blur` · supportive `rise slide*` ·
emphasis `scale` · attention `pop zoom flip` · reveal `wipe mask draw` · textual `wordReveal
charReveal typewriter`.

**Hierarchy — how much attention motion may claim.** `motionRole` on an element: one `primary`
move per shot, supporting `secondary`, micro `tertiary`.

| Role | Enter duration | Travel | Emphasis | Idle |
| --- | --- | --- | --- | --- |
| `primary` / none | × 1 | × 1 | × 1 | × 1 |
| `secondary` | × 1 | × 0.75 | × 0.7 | × 0.6 |
| `tertiary` | × 0.85 | × 0.45 | × 0.45 | × 0 (never idles) |

Duration scales only default durations (an explicit `duration` is used as written). Travel scales
rise/slide distances (including an explicit `distance`), the scale/zoom amount and exit travel.
Describe the hierarchy in words in `creative.motion.primary/secondary/tertiary`.

Findings: `simultaneous-entrances`, `flat-motion-hierarchy`, `multiple-primary-motions`,
`grammar-mismatch`, `emphasis-heavy`, `motion-cut-off`.

## 9. Motion density

`spec.motion.density` scales the whole scene's motion; `creative.motion.density` is the plan.

| Density | Level | Use | Duration | Travel | Emphasis | Idle |
| --- | --- | --- | --- | --- | --- | --- |
| `minimal` | 1 | Premium or emotional moments, visual silence before a peak | × 1.4 | × 0.5 | × 0.5 | × 0.3 |
| `low` | 2 | Complex information the viewer must read | × 1.2 | × 0.75 | × 0.75 | × 0.6 |
| `medium` | 3 | Explanation and product walkthroughs | × 1 | × 1 | × 1 | × 1 |
| `high` | 4 | Hooks, important statements, tension | × 0.9 | × 1.15 | × 1.15 | × 1 |
| `peak` | 5 | The final reveal or the single biggest moment | × 0.8 | × 1.3 | × 1.3 | × 1 |

Engine: travel intensity = design intensity (`subtle` 0.65, `standard` 1, `energetic` 1.35) ×
density travel × role travel; default enter duration = design default × density × role; emphasis
and idle multiply the same way. Density changes how things move, not how many things move — the
spec's elements and triggers decide that.

**Peaks and valleys**: plan density along the story arc; a quiet scene before a peak makes the peak
land. **Visual silence**: set `creative.motion.stillness: true` when stillness is the design decision
(it suppresses `long-static-scene` and `dead-moment`), use `minimal` density, and give elements that
are simply present the `rest` intent.

**Measured density** per scene:
`(events/s + shot cuts/s × 0.8 + max(0, largest 0.3 s burst − 2) × 0.35 + continuous) × (0.55 + 0.45 × density travel, when spec.motion.density is set)`,
where events are enters, exits, emphasis and actions (collapse, press, animate, connect, list items,
clicks) and continuous motion = moving camera 1 + idle element 0.4 + video 0.8 + kinetic element 0.5
+ animated background 0.3. Levels: < 0.7 minimal · < 1.3 low · < 2.1 medium · < 3 high · else peak.

## 10. Visual budget and intensity curve

| | Source |
| --- | --- |
| **Planned** intensity | `creative.intensity` → else the level of `creative.motion.density` → else the act's `intensity` |
| **Measured** intensity | The measured density level (1–5) |

The curve is drawn planned (dashed) against measured (solid) in the Storyboard page's *Story arc &
rhythm* strip and on Creative QA, and printed by `creative:metrics`. Spend the budget deliberately:
reserve 5 for one or two moments (hook, turn, reveal), put a valley before each peak.

Findings: `intensity-mismatch` (planned and measured ≥ 2 apart), `density-mismatch` (planned density
vs measured ≥ 2 levels), `flat-intensity` (≥ 6 scenes, σ of measured levels < 0.55),
`sustained-peak` (≥ 4 consecutive scenes measured ≥ 4).

## 11. Asset strategy

Prefer earlier sources:

| Rank | `source` | Use when |
| --- | --- | --- |
| 1 | `existing_asset` | Always check the library first |
| 2 | `screenshot` | Product interfaces and proof |
| 3 | `remotion_graphic` | Typography, charts, diagrams, UI, shapes |
| 4 | `component` | Cards, devices, dashboards, buttons, cursors |
| 5 | `ai_image` | People, places, environments, textures code can't draw |
| 6 | `ai_video` | Cinematic live-action style movement |

**Plan**: `assetStrategy: { approach?, consistency? }`. `consistency` is what every generated asset
inherits: `visualStyle`, `lighting`, `camera`, `palette[]` (hex, ≤ 8), `contrast`, `texture`,
`subjectTreatment`, `environment`, `composition`, `avoid[]` (≤ 30), `notes`.

**Asset brief** (per request, or inside a scene's `assets[].brief`): `purpose` and `subject`
(required), `narrativeMeaning`, `composition`, `focalPoint` / `negativeSpace` (regions — where the
scene will place content), `palette[]` (hex), `lighting`, `style`, `camera`, `mood`, `textInImage`
(default `false`), `avoid[]`, `consistencyNotes`.

```bash
npm run studio -- assets:request <project> --kind image --prompt "…" --scene scene_02 --aspect 16:9 --purpose "…" --brief brief.json
```

In the GUI the new-request form has a *Composition brief* section (composition, negative space,
lighting, palette, avoid). `.project/assets.json` requests carry `brief` and **`generationBrief`**:
`composeGenerationBrief()` merges the brief with the plan's consistency deterministically, one
`Label: value` line each, empty lines omitted, in this order:

| Line | Value |
| --- | --- |
| Subject | brief subject, else the prompt; `Prompt` follows when they differ |
| Purpose · Narrative meaning | brief, else the request purpose |
| Format | `image\|video, <aspect>` |
| Composition | brief composition + `focal point <region>` + `keep negative space <region> (the scene places content there)`; else consistency composition |
| Palette · Lighting · Camera | brief, else consistency |
| Style | brief style; consistency visual style; request style notes (joined) |
| Mood | brief |
| Contrast · Texture · Subject treatment · Environment | consistency |
| Consistency | brief consistency notes + consistency notes |
| Avoid | brief + consistency avoid, `text, letters or logos inside the image` unless `textInImage`, and the negative prompt |

```
Subject: Unaligned paper wireframes on a charcoal desk
Prompt: Scattered paper wireframes on a desk
Purpose: Background for the problem act
Format: image, 16:9
Composition: top-down; focal point left; keep negative space right (the scene places content there)
Palette: #212121, #3FE7EF
Lighting: low, soft key light from the left
Style: Clean, flat
Contrast: medium
Avoid: people; stock photography; text, letters or logos inside the image
```

Generate from `generationBrief`. Finding: `ai-imagery-for-native` (AI imagery in a scene whose
treatment is best built natively).

## 12. Style references

`references[]` (≤ 20): `id`, `title` (required), `assetIds[]` (library assets, ≤ 20), `source`,
`typography`, `composition`, `motion`, `color`, `transitions`, `imagery`, `density`, `overall`,
`principles[]` (≤ 20). Analyse what makes a reference work and carry the **principles** into original
work — never copy the reference. The Direction page shows them in *References*.

## 13. Creative QA

| | Measured metrics | Written reviews |
| --- | --- | --- |
| Produced by | `analyzeCreative()` — deterministic, from specs, word timing, assets and the plan | A reviewer (Claude Code or the user) watching renders and frames |
| Stored | Computed on demand, memoized per project revision · `.project/creative-metrics.json` | `CreativeReview` rows (versioned) · latest in `.project/creative-review.json` |
| Answers | What is on screen, when and how much | Whether it works and what to change |
| Cannot | Judge taste or metaphor, or know whether a finding matters | – |
| Scores | None | Optional, advisory 0–100, only accepted with written issues or strengths |

Metrics are heuristics with conservative thresholds: verify each finding against real frames before
repeating it in a review. Scores are never computed — they belong to a written critique.

```bash
npm run studio -- creative:metrics <project> [--scene scene_03] [--all] [--json]   # --all includes info findings
npm run studio -- render <project> --kind preview --quality draft --force --wait
npm run studio -- creative:review <project> review.json
npm run studio -- creative:reviews <project> [--issues]
npm run studio -- creative:request-review <project> "Find the three weakest scenes." [--scenes scene_02,scene_03]
```

Illustrative review file:

```json
{
  "title": "Weakest scenes",
  "request": "Find the three weakest scenes.",
  "scope": [],
  "summary": "The arc reads clearly, but the walkthrough repeats one centered UI layout and the final lockup lands with four simultaneous entrances.",
  "overallScore": 74,
  "scores": { "composition": 70, "motion": 68, "storytelling": 80 },
  "strengths": ["One visual thread carries the story from the problem to the lockup."],
  "issues": [
    {
      "id": "ui-run",
      "scene": "scene_07",
      "severity": "medium",
      "category": "composition",
      "issue": "Third centered product screen in a row; the walkthrough loses momentum.",
      "recommendation": "Crop to the builder canvas, move the focal point left and let the cursor be the primary motion.",
      "evidence": "Draft preview frames of scene_05–scene_08; metrics: repetitive-treatment."
    }
  ],
  "weakestScenes": ["scene_07"],
  "basedOn": { "renderId": "<renderId>", "notes": "Draft preview render" }
}
```

Review rules:

- `summary` is required (≥ 20 characters). `scores` keys: `composition typography motion pacing
  storytelling consistency brand`; any score or `overallScore` requires at least one issue or strength.
- Issue: `severity` (`low medium high`), `category` (`composition typography motion pacing
  storytelling consistency brand quality assets`), `issue` and `recommendation` required; optional
  `id`, `scene`, `shot`, `evidence`, `status`. Ids default to `i1`, `i2` …; status defaults to `open`.
- Limits: ≤ 80 issues, ≤ 20 strengths, ≤ 12 `weakestScenes`. Every scene key in `scope`,
  `weakestScenes` and issues must exist. `basedOn: { renderId?, frames?: number[] (seconds on the master timeline), notes? }`.
- Saving stores a summary of the measured findings (counts + up to 40 non-info findings), the
  composition hash and the storyboard version. When the composition changes the review is marked
  **stale** — it stays as written.

### Finding codes

Scene findings (`<code>:<scene>`):

| Code | Severity | Category | Condition |
| --- | --- | --- | --- |
| `invalid-spec` | high | quality | The stored spec is invalid |
| `text-outside-safe-area` | medium | composition | Text/kinetic/badge box outside the safe margin (per shot) |
| `text-covered` | medium | composition | Text overlapped > 30 % by UI, imagery or a diagram drawn above it |
| `cramped` | low | composition | ≥ 5 boxes cover > 78 % of the frame |
| `focal-mismatch` | info | composition | Planned focal point vs measured focal region differ (≥ 1 column or 2 rows) |
| `simultaneous-entrances` | medium | motion | ≥ 4 entrances within 0.3 s |
| `flat-motion-hierarchy` | medium | motion | ≥ 5 animated elements, no motion roles, ≥ 60 % with scale/pop/zoom/flip entrances |
| `multiple-primary-motions` | low | motion | ≥ 2 animated `primary` elements in one shot (or scene) |
| `grammar-mismatch` | low | motion | Explicit pop/zoom/flip entrance on a `tertiary` or `support` element |
| `emphasis-heavy` | low | motion | ≥ 4 emphasis events |
| `motion-cut-off` | medium (low for an entrance ≥ 50 % done) | motion | An entrance, exit or `cards` collapse starts on screen but its shot/scene ends before it is 90 % complete (explicit duration, 0.8 s for a collapse, else the design default × density; text reveals are skipped) |
| `density-mismatch` | medium | motion | Planned density vs measured ≥ 2 levels apart |
| `camera-on-ui` | medium | quality | Moving camera (scene or shot) on a scene with product UI, screenshots or dashboards |
| `idle-on-screenshot` | medium | quality | Idle motion on a screenshot image |
| `particles` | low (medium if `direction.avoid` mentions particles) | quality | Particle background |
| `long-static-scene` | low | pacing | > 5.5 s, fewer than 2 shots, measured density ≤ low, not `stillness` |
| `dead-moment` | low | pacing | Otherwise: > 3 s without a visual event, little continuous motion, density ≤ medium, not `stillness` |
| `shot-timing` | high | pacing | A shot window is invalid (§4) |
| `shot-too-short` | low | pacing | A shot is on screen < 0.6 s |
| `shot-plan-outside-scene` | medium | pacing | Planned shot `from`/`to` beyond the scene duration |
| `shot-plan-unimplemented` | low | storytelling | Planned shot ids missing from `spec.shots` |
| `trigger-issues` | medium | pacing | Triggers that can't resolve, or fire outside their shot |
| `too-much-text` | low (medium above 1.6 × limit) | typography | Words readable at once > `creative.typography.maxWords` → `visualLanguage.typography.maxWordsOnScreen` → 14 |
| `small-text` | low | typography | Text below 24u |
| `low-contrast` | medium | typography | Text vs background < 4.5:1 (< 3:1 for kinetic or text ≥ 46u); skipped on image/video backgrounds and text on a surface |
| `low-contrast-accent` | low | typography | Kinetic `activeColor` < 2.2:1 |
| `text-echoes-narration` | info | typography | §5 |
| `possibly-literal` | info | storytelling | §5 |
| `glow-against-language` | medium | consistency | Glow shadow/emphasis while `visualLanguage.color.glow` is `none` |
| `treatment-mismatch` | info | consistency | Planned treatment family ≠ detected family (scenes without shots) |
| `off-palette` | low | brand | Hex colors outside the design system colors and palette |
| `ai-imagery-for-native` | low | assets | Claude-generated image/video in a `kinetic_typography`, `data_visualization`, `diagram`, `product_ui` or `dashboard_ui` scene |
| `no-creative-intent` | info | storytelling | No `creative` recorded |

Project findings:

| Code | Severity | Category | Condition |
| --- | --- | --- | --- |
| `monotone-treatment` | medium | storytelling | ≥ 6 scenes and one family fills > 60 % of screen time |
| `repetitive-treatment` | medium (low when at least half the run's compositions differ) | storytelling | ≥ 3 consecutive scenes with the same detected family |
| `predictable-alternation` | low | storytelling | A ↔ B family alternation over five scenes |
| `repetitive-layout` | medium | composition | ≥ 3 consecutive scenes with the same layout signature |
| `template-like` | medium | composition | ≥ 6 scenes and one layout signature in > 45 % of them |
| `distribution-off-target` | low | consistency | A family ≥ 15 points from the normalized target |
| `transition-variety` | low (medium with `minimal`/`restrained` frequency) | motion | ≥ 5 different scene transition types |
| `decorative-transitions` | medium | motion | `minimal`/`restrained` frequency, ≥ 4 transitions, > 50 % not cut/fade/none |
| `transition-not-allowed` | low | consistency | Scene transitions outside `visualLanguage.transitions.allowed` |
| `constant-camera` | low (medium with `static`/`restrained` camera) | motion | ≥ 4 scenes and the camera moves in > 50 % |
| `flat-intensity` | medium | pacing | ≥ 6 scenes, σ of measured intensity < 0.55 |
| `sustained-peak` | medium | pacing | ≥ 4 consecutive scenes measured ≥ 4 |
| `intensity-mismatch` | medium | pacing | Planned vs measured intensity ≥ 2 apart |
| `no-creative-direction` | info | storytelling | No `direction` in the plan |
| `arc-unknown-scenes` | low | storytelling | Acts reference scene keys that don't exist |

## 14. Refinement loop

```
Generate ─▶ Review ─▶ Identify issues ─▶ Propose ─▶ Apply approved ─▶ Review again
storyboard   metrics +   review issues     user accepts /  refine_creative   new review
& specs      frames →    (open)            dismisses →     task, inside      (the old one
             creative:                     refinement      timing and voice  shows stale)
             review                        task
```

| Issue status | Meaning | Set by |
| --- | --- | --- |
| `open` | Raised by a review (default) | review, or *Reopen* |
| `accepted` | The user wants it fixed; set automatically when a refinement task is created from it | user · `creative:refine` |
| `dismissed` | Won't fix | user |
| `resolved` | Addressed by a refinement | Claude after refining: `creative:issue <project> <reviewId> <issueId> --status resolved` |

| Task type | Purpose | Scope and locks |
| --- | --- | --- |
| `plan_creative` | Write the creative plan before scenes are designed; changes no scenes | Whole project |
| `creative_review` | Read-only review, answering the request, saved with `creative:review` | Locked scenes stay in scope (nothing changes); needs at least one scene |
| `refine_creative` | Apply approved issues or a refinement request inside existing timing and voice | Locked scenes are removed from scope (listed as skipped); a scope of only locked scenes is refused |

- **From issues**: Creative QA → select issues → *Refine*, or `creative:refine <project> <reviewId>
  <issueId,…> [--instruction "…"]`. The task lists every issue with its recommendation and the
  `creative:issue` command. Dismissed or resolved issues can't be refined.
- **Apply fix (one issue, automatic)**: every open issue has an *Apply fix* button. It creates a
  `refine_creative` task for that issue with `executor: "headless"`, whatever the AI execution
  setting is, so the worker runs Claude Code in the background right away. The issue row shows
  queued / fixing (with Claude's latest step) / failed with *Try again*, and Claude marks the issue
  resolved when done. Headless runs have their own worker lane of one, so fixes never overlap.
  The Claude Code CLI on the machine must be signed in.
- **Scene-scoped vs project-wide**: when every selected issue names a scene, the task's scope is those
  scenes; if any issue has no scene the task covers the project and Claude chooses (and names) the
  scenes it touches.
- **Free-form refinement**: command bar presets or *Ask Claude → Creative refinement* create a
  `refine_creative` task with the instruction.
- Refinement updates both `creative` intent and specs, runs `validate` and `creative:metrics`, checks a
  draft render, and never touches locked scenes or timing.

## 15. Commands and GUI

| Command | Does |
| --- | --- |
| `creative <project> [--json]` | Print the plan: concept, message, tone, pacing, avoid, acts with intensity, distribution |
| `creative:apply <project> <plan.json> [--replace] [--note "…"]` | Save the plan (merge by section, or replace); prints warnings |
| `creative:revisions <project>` · `creative:restore <project> <version>` | Plan history · restore as a new revision |
| `creative:metrics <project> [--scene scene_03] [--all] [--json]` | Per-scene table (detected vs planned treatment, density and intensity planned→measured, burst, words, shots, layout), distribution, intensity, transitions, findings |
| `creative:review <project> <review.json>` | Save a written review |
| `creative:reviews <project> [--issues]` | Review history with open issues and stale flag; `--issues` prints the latest review's issues |
| `creative:issue <project> <reviewId> <issueId[,issueId]> --status open\|accepted\|dismissed\|resolved` | Set issue status |
| `creative:refine <project> <reviewId> <issueId[,issueId]> [--instruction "…"]` | `refine_creative` task from issues (open → accepted) |
| `creative:request-review <project> "question…" [--scenes a,b]` | `creative_review` task |
| `assets:request … --brief brief.json` | Asset request with a composition brief |
| `scene:show` · `validate` | Also print scene `creative` and shot windows · also check shot elements |

API: `GET/PUT /api/projects/:id/creative` (`{ plan, mode: "merge"|"replace", note? }`) ·
`GET …/creative/revisions` · `POST …/creative/revisions/:version/restore` · `GET …/creative/metrics` ·
`GET …/creative/reviews` · `POST …/creative/reviews` (creates a review task: `{ request, sceneIds?, title? }`) ·
`GET …/creative/reviews/:reviewId` · `PATCH …/reviews/:reviewId/issues` (`{ issueIds, status }`) ·
`POST …/reviews/:reviewId/refine` (`{ issueIds, instruction? }`).

| GUI | What |
| --- | --- |
| **Direction** (`/projects/<id>/direction`) | Direction, story arc, visual language, visual distribution, asset strategy, references, plan revisions (restore), principles; ask Claude to plan (`plan_creative`) |
| **Creative QA** (`/projects/<id>/review`) | Latest review with issue status and *Refine* for selected issues, review requests with presets, story arc & rhythm, scenes planned vs measured, measured findings, distribution, coverage, review history |
| Scenes editor → **Intent** tab | Purpose, beat, act, metaphor, emotion, interpretation, treatment, intensity, composition, density, stillness, primary/secondary/tertiary motion, emphasis words; JSON for the full intent; planned vs measured |
| Storyboard | *Story arc & rhythm*: acts, measured family per scene, intensity curve; link to open findings |
| Overview | Creative direction card: concept, core message, intent coverage, latest review's open issues and stale state |
| Assets → AI requests | Composition brief when creating; brief shown on each request |
| **Ctrl K** command bar | *Plan the creative direction with Claude*; typed text → *Creative review, no changes*; review and refinement presets below |
| *Ask Claude* dialog | *Plan direction*, *Creative review* and *Creative refinement* (any scope; refinement needs an instruction) |

Review presets (read-only `creative_review` tasks): *Review this video like a senior motion
designer.* · *Find the three weakest scenes.* · *Find repetitive visual patterns.* · *Find scenes
with too much motion.* · *Find scenes where the visual is too literal.* · *Find typography that is
competing with the visuals.* · *Find scenes that don't follow the visual language.*

Refinement presets (`refine_creative`, timing and voice kept): *Make the pacing more premium without
changing the voice timing.* · *Make the entire video feel more cohesive.* · *Make the opening more
impactful.* · *Create more visual contrast between the problem and solution.* · *Reduce visual
clutter.* · *Make the animation more restrained.* — plus *Make <scene> more cinematic without
changing timing.* when a scene is selected.

## 16. Backward compatibility

- Every new field is optional: `Scene.creative` and `AssetRequest.brief` are nullable, the plan may
  not exist, and `spec.shots`, `spec.motion`, `motionRole` and `motionIntent` may be absent.
- Without them the engine is unchanged: neutral density and role scales, only explicit entrances,
  no shot layers. Existing specs and triggers render identically.
- Scene versions and project snapshots saved before the creative system have no `creative` key:
  restoring them keeps each scene's current intent; snapshots without a plan keep the current plan.
- Project packages exported before the system import without creative revisions or reviews.
- Missing intent or direction is reported only as `info` (`no-creative-intent`, `no-creative-direction`).

## 17. Incep brand support

The Incep palette is configured as design-system tokens — in the **Incep Platform** brand kit
(Settings → Brand kits), which the Incep projects follow (`.project/project.json → brandKit`), and
therefore in each project's `design.json` — and in the plan's visual language.
Nothing in the engine or the metrics hardcodes these colors.

| Role | Token | Color | Use |
| --- | --- | --- | --- |
| Dominant primary | `primary` | `#237DD8` | Decisive brand moments and fields. 3.86:1 on `#F5F5F5`: fine for large text (≥ 46u), too low for small copy |
| Energetic accent — sparingly | `secondary`, `accent` | `#3FE7EF` | A single thread element and highlights on dark; below 2:1 on `#F5F5F5`, never copy on light |
| Text | `text` | `#212121` | Copy; also usable as a dark field |
| Background | `background` | `#F5F5F5` | Light ground |
| Surface | `surface` | `#FFFFFF` | Cards and screens |
| Semantic | `success`, `danger` | `#16A34A`, `#E5484D` | Functional states only |

- Use tokens (`"primary"`) in specs, not hex — `off-palette` reports literal colors outside the design system.
- No gradients or glow: set `visualLanguage.color.gradients` and `glow` to `"none"` and list them in
  `direction.avoid`; glow then raises `glow-against-language`.
- `low-contrast` and `low-contrast-accent` catch accent colors used for text.

## 18. Worked example — Incep launch film

Project `incep-platform-launch-film-zs7c` (13 scenes, 43.7 s) was planned with creative plan v1:

- **Concept**: *From scattered pieces to one point of focus.* The cyan dot of the Incep mark is the
  visual thread: it can't settle in the fragmented world, becomes the logo at the turn, guides the
  walkthrough and lands in the final lockup.
- **Visual language**: two worlds — a charcoal world of unaligned fragments for the problem and a
  light world of real product UI for the solution; brand blue reserved for the turn and the
  resolution. `maxWordsOnScreen` 10, gradients and glow `none`, transitions `restrained` (cut, fade,
  wipe), camera `static` (typography of the opening only), density `sparse`.
- **Distribution target**: productUI 35 %, kineticTypography 25 %, abstractGraphics 15 %,
  brandMoments 15 %, transformation 10 %.
- **Asset strategy**: real Incep captures pre-sized to their on-screen pixels, native Remotion
  typography and geometry, no AI imagery.

| Act | Beat | Planned intensity | Scenes |
| --- | --- | --- | --- |
| Friction | problem | 4 | scene_01–scene_02 |
| The turn | turn | 5 | scene_03 |
| Clarity | solution | 3 | scene_04–scene_08 |
| One place | benefit | 4 | scene_09–scene_10 |
| Resolution | resolution | 5 | scene_11–scene_13 |

| Scene | Treatment | Interpretation | Density | Shots (`spec.shots`, `at`) |
| --- | --- | --- | --- | --- |
| 01 Weeks of Back and Forth | kinetic_typography | metaphorical | high | `unbuilt` · `statement` on "weeks" |
| 02 The Blank Canvas | geometric_composition | metaphorical | medium | `blank` · `sections` on "figure" · `hours` on "spend" |
| 03 One Point of Focus | transformation | transformational | peak | `converge` · `reveal` on "Incep" |
| 04 A Smarter Way to Build | product_ui | literal | medium | – |
| 05 Tell the Platform What You Need | kinetic_typography | literal | low | `business` · `intake` on "tell" |
| 06 From Idea to Complete Website | before_after | transformational | high | `plan` · `site` on "idea" |
| 07 Build Pages Visually | product_ui | literal | medium | – |
| 08 Edit Your Content with AI | product_ui | literal | medium | – |
| 09 Everything in One Place | object_choreography | transformational | medium | – |
| 10 Grows with Your Business | visual_metaphor | metaphorical | low | – |
| 11 No Scattered Tools | kinetic_typography | metaphorical | high | `tools` · `workflows` on the second "no" |
| 12 Just One Platform | visual_metaphor | metaphorical | minimal, `stillness` | – |
| 13 Build Better. Move Faster. | brand_moment | literal | high | – |

How the pieces connect:

- **Not literal**: "weeks of back and forth" is not a stack of email notifications. Scene_01 shows an
  unbuilt page and a dot bouncing on a track that never completes; scene_03 keeps scene_02's guessed
  sections through a subtractive cut and converges them into the dot (`converge` exits on "why") before
  the brand-blue wipe on "Incep"; scene_10 grows
  concentric rings from one point. Product scenes are marked `literal` on purpose — the real UI is
  the proof.
- **Thread across shots**: scene_03's dot is a scene-level element with `z: 10`, so it stays above
  both shots while they cut.
- **Peaks and valleys**: the turn (scene_03) is the `peak`; scene_12 is intentional stillness at
  `minimal` density ("one point, one line, moving forward") right before the closing brand moment.
- **First draft, measured**: 7 medium findings — a low-contrast `#237DD8` eyebrow on `#F5F5F5`
  (scene_04), entrance bursts (scene_06, scene_13), a label firing after its shot ended (scene_06),
  readable tool names cluttering scene_11, a finale quieter than planned — plus a grammar mismatch on
  scene_03's dot. Each was fixed in the specs before the first render. Measuring also exposed an
  engine bug (voice-synced text in a later shot matched the scene's first "No"), now fixed.
- **Measured on 2026-09-13 after refinement** (`creative:metrics`; re-run for current values): 13/13
  scenes with intent; 0 high · 0 medium · 1 low · 4 info; intensity planned `4 3 5 3 2 4 3 3 4 3 4 2 5`
  vs measured `5 4 5 3 3 5 4 4 3 3 4 1 4`; transitions cut ×5, fade ×5, wipe ×2. The low finding is
  `repetitive-treatment` for the product-led Clarity act (scene_04–scene_09, four compositions).
- **Refinement loop**: review v1 of the draft render (advisory 84) raised four issues. Three were
  applied through a `refine_creative` task (a legible blank page in scene_02, a longer scattered state
  before the scene_03 convergence, the back-and-forth track moved under the scene_01 statement) and
  marked resolved; the product-run issue was dismissed as intentional. Review v2 of the high-quality
  final (advisory 89) confirmed the fixes and left one low issue open for the creative director: the
  finale's inner ripple crosses the mark while it draws.
