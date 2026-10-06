# Remotion — scene specs, motion library & rendering

Every scene is a **SceneSpec**: structured JSON that the Remotion engine in `src/remotion`
interprets. Claude Code (or the Scenes editor) writes specs; the engine turns them into frames.
The schema lives in `src/core/spec/scene.ts` (zod) and is validated on every write.

- Preview (GUI Player) and final renders consume the **same input**: `StudioVideoProps`, built by
  `src/server/services/composition.ts`. Inspect it with `npm run studio -- composition <project> --json`.
- `npm run studio -- scene:show <project> <scene_key>` prints a scene's creative intent, spec, spoken
  words, shot windows and resolved trigger times. `npm run studio -- validate <project>` checks every
  spec, trigger (including shot elements) and asset.
- Specs implement the scene's creative intent; how scenes are planned and reviewed is in
  [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md).

## 1. Units, layout and colors

| Property | Unit |
| --- | --- |
| `x`, `y` | % of frame width / height — the element's **anchor** point (default `center`) |
| `anchor` | `center` `top-left` `top` `top-right` `left` `right` `bottom-left` `bottom` `bottom-right` |
| `width` | % of frame width · `height`: % of frame height |
| `size`, `gap`, `radius`, `itemWidth`, … | **u** — pixels at a 1080-px short edge (`1u = min(W,H)/1080`) |
| times, durations, offsets | seconds |
| colors | hex / `rgb()` / `hsl()` or tokens: `primary secondary accent background surface text muted success danger white black transparent` |

Relative units make one spec work in 16:9, 9:16, 1:1 and 4:5. Keep important content inside the
design system's safe margin (default 7% of the short edge).

## 2. Scene spec

```json
{
  "version": 1,
  "background": { "type": "mesh", "intensity": 0.3, "grain": 0.03, "vignette": 0.35 },
  "transitionIn": { "type": "fade", "duration": 0.45 },
  "camera": { "type": "pushIn", "amount": 0.035 },
  "motion": { "density": "medium" },
  "elements": [
    {
      "id": "headline",
      "type": "text",
      "role": "headline",
      "text": "Business shouldn't feel this complicated",
      "x": 50, "y": 50, "maxWidth": 70,
      "enter": { "type": "wordReveal", "stagger": 0.07 },
      "highlight": { "words": ["complicated"], "style": "color", "color": "primary", "at": "spoken" }
    }
  ]
}
```

`background`, `transitionIn`, `camera` and `motion` are optional — omitted values inherit the design
system (no `motion.density` = unscaled motion, §6). Elements render in order, sorted by `z`.
`shots` (optional) split the scene into shots (§5); `notes` is free text. Any element may also carry
compositing — `blend`, `effects`, `clip` — and a `group` element holds several elements as one layer (§13).

## 3. Triggers — syncing to the narration

Any `at` field (enter, exit, emphasis, `collapseAt`, `animateAt`, `pressAt`, `connectAt`, list
items, cursor points/clicks) takes a trigger. Triggers resolve to absolute seconds on the master
timeline, then to frames — the same function feeds the timeline markers in the GUI.

| Trigger | Example |
| --- | --- |
| `sceneStart` / `sceneEnd` | `{ "type": "sceneStart", "offset": 0.2 }` |
| `time` (absolute) | `{ "type": "time", "seconds": 12.4 }` |
| `sceneTime` (relative) | `{ "type": "sceneTime", "seconds": 1.5 }` |
| `word` | `{ "type": "word", "value": "payments", "occurrence": 1, "edge": "start", "offset": -0.1 }` |
| `phrase` | `{ "type": "phrase", "value": "one place", "edge": "end" }` |
| `wordIndex` | `{ "type": "wordIndex", "index": 31 }` (see `timeline.json` words) |
| `shotStart` / `shotEnd` | `{ "type": "shotStart", "offset": 0.1 }` — the element's shot (outside shots: the scene start / end) |
| `shotTime` (relative to the shot) | `{ "type": "shotTime", "seconds": 0.8 }` (outside shots: relative to the scene start) |

Words match case- and punctuation-insensitively within the scene (`"scope": "global"` searches the
whole voice-over). Unresolvable triggers clamp into the scene and are reported by `validate`. Inside a
shot, an `enter` or `exit` without `at` defaults to the shot's start / end, and events that fire while
their shot is off screen are reported.

## 4. Animation

**enter** `{ type, at?, delay?, duration?, easing?, stagger?, distance? }`

`fade rise slideUp slideDown slideLeft slideRight scale pop blur wipe zoom flip` animate the whole
element. Text-level reveals: `wordReveal` (with `syncToVoice: true` each word appears as it is
spoken), `charReveal`, `typewriter` (types the whole text over `duration`, default 35 ms per
character — set it to span the spoken words), `mask`, and `draw` (lines, circles, rects). For `cards`,
`list` and `diagram`, `stagger` applies per item.

**exit** `{ type, at?, duration?, easing?, distance?, to? }` — `fade slide* scale blur wipe zoom collapse converge`.
Defaults to the end of the scene; usually the next scene's transition is enough. `converge` moves the
element's anchor to `to: [x, y]` (% of the frame, default center) while it shrinks, straightens and
fades — give several separate elements the same `to` and staggered `at` to make many pieces become
one point. Motion that can't finish before its shot or scene ends is reported as `motion-cut-off`.

**emphasis** `[{ type, at, duration?, color?, intensity? }]` — `pulse pop shake bounce glow highlight underline colorShift`.

**idle** — `float breathe drift spin pulse`.

Easings: `linear easeIn easeOut easeInOut expoOut expoInOut backOut circOut spring snappy smooth`.
Durations, stagger, easing and intensity default to the design system's motion tokens.

**keyframes** `[{ id, property, time, value, easing? }]` — explicit values of `x y scale rotation opacity`
over time (lines, cursors and grids: `scale rotation opacity` only). Each keyframe needs a unique `id`
(letters, digits, `_`, `-`) and one keyframe per property per moment.

What may be keyframed is the **animatable property registry**, `src/core/spec/animatable.ts` — one
definition per property (label, category, value type, unit, range, precision, default, which element
types animate it, its interpolation strategy, the element field the renderer reads, where a patch
writes it, and how the inspector edits it). The schema validates against it, the resolver interpolates
with it, and the inspector, timeline and CLI take their labels, units, ranges and steps from it, so
none of them keeps a property list of its own.

Animatable today:

| Category | Properties | Value | Notes |
|---|---|---|---|
| Transform | `x` `y` `scale` `scaleX` `scaleY` `rotation` `width` `height` | number | width/height only where the renderer reads them (`sizeModeOf`), never on wrapping text |
| Transform | `rotateX` `rotateY` `depth` | number | 3D tilt in degrees, seen from `depth` u away (1200 by default): the element stays flat, its perspective changes |
| Transform | `pivot` `from` `to` | point | what rotation and scale turn around; a line's two ends |
| Path | `pathProgress` | number | 0–1 along `motionPath` (only with one) |
| Appearance | `opacity` `radius` `borderWidth` `strokeWidth` `blur` | number | `borderWidth` and `blur` are `style` keys |
| Appearance | `color` `background` | colour | literal colours only — a design token can't be blended |
| Type | `size` | number | badges, counters, captions, logos, circles, icons, progress — sizes that don't re-wrap text |
| Type | `letterSpacing` | number (em) | text; wide spacing can re-wrap a long line |
| Compositing | `effectBlur` `glow` `shadowX` `shadowY` `shadowBlur` `brightness` `contrast` `saturate` | number | every element — the effects of §13 |
| Compositing | `glowColor` `shadowColor` | colour | |
| Compositing | `clipProgress` | number | 0–1 of the clip reveal (only with a `clip` that has a `reveal`) |

Resolution happens once per element per frame in `ElementRenderer`, which hands every element renderer
values already resolved — that is what lets any field a renderer reads (including a nested `style` key)
be animated.

- **Time** is seconds after the element **appears** (its entrance cue plus delay, else its scene or shot
  start): video time → scene time → element time → keyframe time. Keyframes move with their element — a
  timeline move, a new voice take moving the word it enters on, a scene copy. Editing only when it
  appears or leaves (a trim, a new entrance cue) keeps them where they were in the scene; keyframes that
  would fall outside its time on screen fold into one keyframe at that edge with the value it had there.
- **Values**: before the first keyframe a property holds the first value, after the last the last value;
  between two keyframes it follows the earlier one's `easing` (default `linear`; `hold` keeps the value
  until the next keyframe). Values: x/y in % of the frame, scale ×, rotation °, opacity 0–1.
- **Stretches and curves**: the piece between two keyframes is a *stretch*, and it belongs to the earlier
  keyframe — that keyframe's `easing` is the curve it travels. Two neighbouring stretches are therefore
  independent. `easing` is a named curve or a custom cubic Bézier, `{ bezier: [x1, y1, x2, y2] }`, like
  CSS `cubic-bezier`: x stays inside 0–1, y may overshoot. Both go through one solver
  (`core/motion/easing.ts`), so the curve drawn in the inspector is the curve that renders.
- **Value types**: a property's value is a number, a colour or a point, and it names the strategy that
  blends two of them (`core/motion/values.ts`): numbers and points move in a straight line, colours
  through OKLab. Easing is independent of the value type — progress goes through the curve, then the
  strategy turns that progress into a value, so a colour eases exactly like a number.
- **Precedence**: a keyframed property ignores its saved value. Entrance, exit, emphasis and idle motion
  still play **on top** of the keyframed value (a fade multiplies the keyframed opacity, a slide adds to
  the keyframed position). Cues decide *when* things happen, presets *how* they move procedurally,
  keyframes *what* a property's value is — none replaces another.
- Duplicating an element or a scene copies keyframes with new ids; splitting a scene rebases them into
  both parts (motion mid-curve at the cut restarts its easing there); merging keeps their times.

Edit keyframes with `scene:keyframes` / `scene:keyframe` (only when asked) or in the Scenes editor.

**motionPath** `{ type: linear|quadratic|cubic, from, to, c1?, c2?, orient? }` — a curve the element
travels instead of sitting at one x/y. Points are % of the frame, like x/y. `pathProgress` (0 → 1,
normally keyframed) picks the point on it, so the keyframe system still owns *when* it moves and the
path owns *where*. Progress is measured along the curve's **length**, not its Bézier parameter, so an
even progress moves at an even speed; length is measured in % space, which keeps a path resolving
identically in 16:9 and 9:16. `orient` turns the element along the curve and **adds** that angle to its
own rotation, so rotation keyframes still work and removing the orientation leaves them untouched.
While a path exists it decides x and y — x/y keyframes are ignored until it is removed (removing one
leaves the element where the path had put it). Edit it on the canvas, in the inspector's Motion path
section, or with `scene:path`.

**Adding an animatable property** — one definition, plus the renderer:

1. Add a definition to `ANIMATABLE_PROPERTIES` in `src/core/spec/animatable.ts`: its id, labels,
   category, value type, unit, `field` (the element field holding the value), `defaultValue`, `range`,
   `precision`, optional `renderRange` (how far a resolved value may overshoot), `interpolation`,
   `elements` (`"all"`, `{ except }` or `{ only }`) and `editing` (the control, its step, and the
   narrower `staticRange` / `staticMin` the element's own field takes).
2. Make sure the element's renderer reads that `field` — `elementAtTime` writes the resolved value into
   it, so anything the renderer already reads (like `x` or `opacity`) needs no renderer change.
3. Add the id to `ENABLED_IDS`, say where an edit of it goes in a patch (`patchIn`: the element itself,
   its type's `props`, or a `style` key), and set `status: "enabled"`. The schema, resolver, inspector
   (its control comes from `editing.kind`), timeline rows, CLI commands and undo then all cover it; only
   the inspector's transform grid places its field by hand (layout, not metadata).

**Adding a value type** (say an enum or a boolean): add it to `PropertyValueType`, add a `ValueOps` entry
to `VALUE_TYPES` in `core/motion/values.ts` (is / clamp / issue / render / format / blank), add its
blending strategy to `INTERPOLATIONS`, widen `KeyframeValueSchema`, and give the inspector a control for
that `editing.kind`. Nothing in the resolver changes.

**Adding a motion-path type**: add it to `MOTION_PATH_TYPES` and give `pathControlPoints`,
`pointAtParam` and `derivativeAtParam` in `core/motion/path.ts` its case; the length table, the canvas
handles, the SVG drawing and the CLI follow from those.

A property that isn't ready keeps `status: "planned"`: it is described (with a `blocked` reason) but the
schema, editor, timeline, CLI and renderer ignore it. Today that is `weight` — only the weights a font
actually loads can render, so an animated weight steps between them until engine/fonts.ts loads variable
fonts.

## 5. Shots

A scene can be split into up to 12 **shots** that run in order inside its audio-locked timing —
rhythm without new scenes. The intent of each shot lives in the scene's `creative.shots` with the
same ids ([CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md#4-shot-planning)).

```json
{
  "version": 1,
  "background": { "type": "solid", "color": "text" },
  "elements": [
    { "id": "dot", "type": "circle", "z": 10, "size": 34, "fill": true, "color": "secondary", "x": 26, "y": 53 }
  ],
  "shots": [
    { "id": "converge", "elements": [ … ] },
    {
      "id": "reveal",
      "at": { "type": "word", "value": "incep", "offset": -0.08 },
      "background": { "type": "solid", "color": "primary" },
      "transitionIn": { "type": "wipe", "duration": 0.3, "direction": "right" },
      "elements": [ … ]
    }
  ]
}
```

| Shot field | |
| --- | --- |
| `id` | 1–40 letters, digits, `_` or `-`; unique within the scene (duplicates fail validation) |
| `at` | Trigger where the shot starts. Only the first shot may omit it (scene start). Resolved on the scene — use `word`, `phrase`, `wordIndex`, `sceneTime` or `time` |
| `background` | Covers the scene background while the shot is on screen |
| `camera` | Camera move for this shot only |
| `transitionIn` | How the shot enters over the previous one. Omitted → **cut** (the first shot uses the scene transition) |
| `elements` | ≤ 40 elements from the same library |
| `notes` | Free text |

- A shot ends where the next one starts; the last ends at the scene end. Each shot must start at
  least 0.04 s after the previous one — invalid starts are repaired deterministically and reported by
  `validate` and `scene:show`.
- Scene-level `elements` persist across all shots: `z < 0` renders below the shots, `z ≥ 0` above.
- Inside a shot, `shotStart` / `shotEnd` / `shotTime` and default `enter` / `exit` timing refer to the
  shot; `sceneStart`, `sceneTime` and word triggers keep their scene meaning.
- With a shot `transitionIn` the outgoing shot keeps rendering underneath for the transition
  (duration defaults to the design's transition duration).

## 6. Motion grammar, hierarchy and density

Three optional fields make motion follow meaning. Without them motion is exactly as described in §4.

| Field | On | Values |
| --- | --- | --- |
| `motionIntent` | element | `emphasize support transform sequence statement interact progress group reveal rest` |
| `motionRole` | element | `primary secondary tertiary` |
| `motion.density` | scene spec | `minimal low medium high peak` |

**Grammar.** An element with `motionIntent` and no `enter` uses the grammar's entrance: emphasize
`scale` · support `rise` (26u) · transform `blur` · sequence `rise` (34u, stagger 0.12) · statement
`wordReveal` (stagger 0.06) on text, none on kinetic, `scale` otherwise · interact `fade` (0.3 s) ·
progress `fade` · group `rise` (40u) · reveal `mask` on text, `wipe` otherwise · rest: none. Grammar
entrances start at the shot (or scene) start; an explicit `enter` always wins. They are scene events
like explicit entrances (timeline markers, `validate`, creative metrics).

**Hierarchy and density** multiply motion:

| | Enter duration | Travel | Emphasis | Idle |
| --- | --- | --- | --- | --- |
| `primary` / no role | × 1 | × 1 | × 1 | × 1 |
| `secondary` | × 1 | × 0.75 | × 0.7 | × 0.6 |
| `tertiary` | × 0.85 | × 0.45 | × 0.45 | × 0 |
| density `minimal` | × 1.4 | × 0.5 | × 0.5 | × 0.3 |
| density `low` | × 1.2 | × 0.75 | × 0.75 | × 0.6 |
| density `medium` / none | × 1 | × 1 | × 1 | × 1 |
| density `high` | × 0.9 | × 1.15 | × 1.15 | × 1 |
| density `peak` | × 0.8 | × 1.3 | × 1.3 | × 1 |

- `ctx.intensity` = design motion intensity (`subtle` 0.65 · `standard` 1 · `energetic` 1.35) × density travel.
- Enter duration: only when `enter.duration` is not set — design default duration × density × role.
- Travel: rise/slide distances (an explicit `distance` too), the scale/zoom amount and exit travel ×
  `ctx.intensity` × role. `fade`, `pop`, `blur`, `wipe`, `flip` and text-level reveals have no travel to scale.
- Emphasis intensity and idle amplitude × design intensity × density × role; tertiary elements never idle.
- Density changes how elements move, not which events happen — elements and triggers decide that.
  When to use each level: [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md#9-motion-density).

## 7. Element library

Common fields on every element: `id x y width height anchor rotation scale scaleX scaleY pivot rotateX rotateY depth opacity z enter exit
emphasis idle keyframes motionPath pathProgress motionRole motionIntent notes`, `style { color background borderColor borderWidth radius shadow blur padding glass }` and the compositing fields `blend effects clip` (§13).

### Typography
| Type | Key fields |
| --- | --- |
| `text` | `text`, `role` (`display headline title subtitle body caption label eyebrow quote`), `size`, `weight`, `font` (`heading`/`body`/`mono`/family), `color`, `align`, `maxWidth` (%), `lineHeight`, `letterSpacing` (em), `transform`, `gradient`, `highlight { words, style: color\|marker\|underline\|box, color, at: enter\|spoken }`, `syncToVoice` |
| `kinetic` | `source` (`voice`/`text`), `mode` (`phrase word stack karaoke`), `size`, `font`, `weight`, `color`, `activeColor`, `emphasisWords`, `maxWidth`, `transform` — the narration becomes typography |
| `captions` | `variant` (`minimal boxed bold karaoke`), `position` (`bottom top center`), `size`, `maxWords` |
| `badge` | `text`, `icon`, `variant` (`solid soft outline glass`), `color`, `size` |

### Layer
| Type | Key fields |
| --- | --- |
| `group` | `name`, `children[]` — several elements as one layer with one transform, opacity, timing and compositing (§13) |

Role base sizes (u): display 150 · headline 104 · title 76 · quote 58 · subtitle 46 · body 36 ·
caption 28 · label 24 · eyebrow 22 — multiplied by the type scale (compact 0.86, large 1.16).

### UI
| Type | Key fields |
| --- | --- |
| `card` | `title body icon value label image(assetId) color`, `variant` (`default glass solid outline app stat feature testimonial`), `accent` |
| `cards` | `items[{ title body icon value label image color at }]`, `layout` (`row column grid scatter stack orbit cascade`), `variant`, `accent`, `gap`, `itemWidth`, `itemHeight`, `collapseAt` (items converge and fade — "many tools → one platform") |
| `browser` | `url`, `title`, `screen`, `theme` (`light`/`dark`) |
| `phone` / `desktop` | `screen`, `theme`; desktop `device` (`laptop monitor`) |
| `screen` (inside devices) | `kind` (`dashboard analytics list chat landing form image video blank`), `title`, `items[]`, `assetId`, `accent`, `brand` (name shown inside the mock screen — e.g. a customer's site; defaults to the project brand) |
| `dashboard` | `title`, `sidebar[]`, `kpis[{label value delta}]` (numbers count up), `chart[{label value color}]`, `rows[{label value status}]`, `theme` |
| `button` | `label`, `variant` (`primary secondary outline ghost`), `icon`, `size` (`sm md lg`), `pressAt` |
| `notification` | `title body icon app time`, `variant` (`toast ios banner`) |
| `cursor` | `path[{ x, y, at }]` (% of frame), `clicks[trigger]`, `variant` (`arrow hand`) |

### Data, diagrams & shapes
| Type | Key fields |
| --- | --- |
| `chart` | `kind` (`bar line area donut`), `data[{label value color}]`, `unit`, `showValues`, `showLabels`, `highlight` (index), `color`, `animateAt` |
| `counter` | `from to decimals prefix suffix label size color animateAt countDuration` |
| `progress` | `value from variant(bar\|ring) label showValue color size animateAt` |
| `diagram` | `layout` (`hub flow cycle grid`), `center{label icon}`, `nodes[{label icon color}]`, `edges[[a,b]]`, `color`, `connectAt` |
| `list` | `items[{ text icon at }]`, `variant` (`bullets checks numbers icons`), `size`, `gap`, `color` |
| `icon` | `name` (lucide, kebab-case e.g. `calendar-check`), `size`, `color`, `container` (`none circle square glass`), `strokeWidth` |
| `line` | `from [x,y]`, `to [x,y]` (% of frame), `color strokeWidth dashed arrow curve(-1..1)` |
| `circle` / `rect` / `grid` | `size color fill strokeWidth` · `color fill strokeWidth radius` · `variant spacing color perspective` |

### Media & brand
| Type | Key fields |
| --- | --- |
| `image` | `assetId`, `fit`, `radius`, `mask` (`none circle rounded`), `kenBurns{from to panX panY}`, `overlay{color opacity}`, `zooms` (zoom regions as on overlay clips, seconds from when the image appears), `crop`, `annotations` (see below) |
| `video` | `assetId`, `fit`, `radius`, `startFrom` / `endAt` (trim, seconds into the source), `playbackRate` (0.1–4), `volume` (default 0 — the voice is primary), `loop` (otherwise the trimmed part holds its last frame), `overlay`, `zooms`, `crop`, `speedSegments`, `annotations`, `duckUnderVoice` (lower its own sound while the narrator speaks). With a delayed `enter.at` the clip starts playing when it appears, and zoom times count from there |

**Clip picture edits** (image/video elements and overlay clips; times are seconds from when the clip appears):
`crop{left top right bottom}` — fractions cut from each side (each ≤ 0.45); the clip's box keeps the cropped aspect.
`speedSegments[{id startSec endSec rate}]` — speed ramps inside the clip (rate 0–16, `0` = freeze frame); outside a segment the clip plays at `playbackRate`.
`annotations[{id type startSec endSec x y w h text? color? strength?}]` — `blur` (redact), `box`, `arrow`, `label`, `spotlight` (darkens the rest), `click` (ripple);
x/y/w/h are fractions of the clip frame, and annotations move with zooms. Max 40 segments and 40 annotations per clip.
| `logo` | `assetId` (defaults to the brand logo), `text`, `size`, `variant` (`mark wordmark lockup`), `color` |

Asset ids come from the asset library (`npm run studio -- assets <project>`). A scene referencing a
missing asset shows “Scene requires asset X.” and blocks rendering until fixed.

## 8. Backgrounds, transitions, camera

- **Backgrounds**: `solid{color}` · `gradient{colors angle radial animate}` · `mesh{base colors intensity}` ·
  `grid{base color variant spacing fade drift}` · `noise{base intensity}` · `particles{base color count speed}` ·
  `image{assetId overlay tint blur kenBurns}` · `video{assetId overlay tint blur startFrom}` — all accept `grain` (≤ 0.08) and `vignette`.
  `tint{color amount?}` recolors the media toward a hue while keeping its light and shadow (e.g. a brand
  graphic tinted to a customer site's palette); `overlay` lays a flat translucent color on top.
- **Transitions** (`transitionIn`): `none cut fade slide wipe zoom blur scale morph`, `duration`, `direction`.
- **Overlay track** (project-level, not part of a scene spec): images and videos drawn above every
  scene at absolute video times, so a clip can run across scene cuts. A video plays its trimmed part
  (`trimStartSec`–`trimEndSec`, at `playbackRate`) and, if it stays on screen longer, holds its last
  frame or loops (`endBehavior`); `placement` `fullscreen` / `framed` / `pip`, `fit`, `dim`, `opacity`,
  fades and clip `volume`. **Zoom regions** (`zooms`) zoom the media into a square area of the clip
  frame (`{ x, y, size }` fractions, so no distortion), optionally pan to a second area while holding,
  and ease back out (`easeSec`); times are clip seconds, and moving the in-point keeps them on the same
  picture. Overlay clips also take the clip picture edits above (`crop`, `speedSegments`, `annotations`)
  and `duckUnderVoice`. Edit on the Scenes or Timeline page (drag to move, drag an edge to trim, *Zoom*
  and *Split* in the overlay panel) or with `overlays` / `overlay:add` / `overlay:update` / `overlay:zoom` /
  `overlay:unzoom` / `overlay:edits` / `overlay:split` / `overlay:remove`; read `.project/overlays.json`.
- **Scene templates**: `builtin:title-card` and `builtin:end-screen` replace a scene's design;
  `builtin:lower-third` adds `lt_panel` / `lt_bar` / `lt_name` / `lt_title` (z 95–97, `sceneTime` enter and
  exit). Saved templates (`template:save`) are whole scene specs or a set of top-level elements. Overlay
  clips still draw above any scene element, including a lower third.
  Use it for cutaways and B-roll over the narration; design-integrated media belongs in the scene spec.
  The incoming scene still starts on its audio-locked frame; the previous scene keeps rendering underneath for the transition.
  Shots use the same types but cut unless they set `transitionIn` (§5).
- **Camera**: `static pushIn pullOut panLeft panRight panUp panDown drift`, `amount` (0.02–0.06 is tasteful).

## 9. Design system

`design.json` holds the tokens every scene inherits: `colors` (9), `typography` (heading/body/mono
fonts, weights, scale, letter spacing, transform, line height), `motion` (easing, durations,
stagger, intensity), `shape` (radius, border, shadow), default `background` and `transition`,
`layout.safeMargin` and an optional `palette`. Presets: `premium_saas clean_corporate playful
bold_editorial minimal_mono tech_neon` (`npm run studio -- design:preset`). Changing the design
system restyles the whole video without touching scene structure or timing — prefer tokens
(`"color": "primary"`) over literal colors in specs.

## 10. Engine internals

```
src/remotion/
  index.ts / Root.tsx      registerRoot + <Composition id="StudioVideo"> (calculateMetadata from props)
  StudioVideo.tsx          scenes as <Sequence>s on absolute frames, voice-over, music/SFX (fades, trims, ducking), font loading
  scene/scene-view.tsx     transition-in → camera → background → elements (error boundary per element); with shots:
                           scene elements z<0 → shot layers (own background, camera, shot transition) → scene elements z≥0
  scene/background.tsx     background layers, grain, vignette
  scene/transition.ts      scene and shot transition styles (shots cut by default), overlap, camera moves
  engine/context.tsx       per-scene context: units, design, words, frameAt(trigger), frameOfWord; shotContext() narrows
                           default timing and shot triggers to a shot's segment frames; intensity = design × density
  engine/animation.ts      enter / exit / emphasis / idle motion; effectiveEnter() (motion grammar); role and density scaling
  engine/layout.tsx        ElementBox positioning + surface styles; KeyframeClock (when an element appears) and keyframed
                           x/y/scale/rotation/opacity resolved per frame before the motion above composes on top
  engine/easing.ts         re-exports core/motion/easing.ts — the one set of curves, shared with keyframe interpolation
src/core/spec/animatable.ts   animatable property registry: what can be keyframed, on which elements, with what
                           values, units, labels, editors and interpolation — schema, resolver, editor and CLI read it
src/core/motion/keyframes.ts  keyframe model: resolution (valueAt / elementAtTime), editing, retiming and folding —
                           the editor's inspector, canvas and timeline, the CLI and the renderer all use it
  engine/fonts.ts          curated Google fonts (dynamic imports) + uploaded brand fonts
  elements/*               text, kinetic, captions, badge · cards · devices & dashboard · button,
                           notification, cursor · shapes & progress · chart, counter, diagram, icon, list · image, video, logo
```

- **Frames**: `from = round(start·fps)`, sequence length = `round(end·fps) − from` (+ the next
  scene's transition overlap). Adjacent scenes share boundary frames, so there is no drift.
- **Determinism**: all randomness uses Remotion's seeded `random()`; everything is a pure function of the frame.
- **Errors**: in preview a crashing element shows a red chip; in a final render it fails the render
  with “Scene S element #n (type) failed to render: …” so a broken element is never silently dropped.
- **Media**: the GUI loads project files through `/api/projects/:id/files/…`; renders use a private
  loopback file server in the worker (random port + token, paths confined to the project).

## 11. Render pipeline (worker)

1. **Bundle** `src/remotion/index.ts` with `@remotion/bundler`; cached in `storage/cache/remotion-bundles`
   keyed by the source of `src/remotion` + `src/core`.
2. **Browser**: `ensureBrowser()` (Remotion's headless Chrome, downloaded once).
3. **Props**: `buildComposition()` with loopback media URLs; render size/preset and audio toggle applied.
4. **renderMedia**: H.264 + AAC, CRF 18/23/30 for high/standard/draft. High quality renders lossless
   PNG frames with the x264 `slow` preset (crisp UI text and screenshots); standard and draft render
   JPEG frames (quality 85 / 70). Optional frame range (scene/range renders), cancellable. Progress (`renderedFrames`, stage) streams to the GUI.
5. **Thumbnail** with `renderStill`; the final render's thumbnail becomes the project card image.
6. **History**: every render is a row with settings, size, duration and a `compositionHash`; it is
   marked stale when any composition input changes. Failures store stage, frame, scene and browser logs.

CLI: `render`, `renders`, `render:cancel`, `still`.

## 12. Creative quality rules

The full system — creative plan, story arc, treatments, composition, motion grammar and density,
Creative QA and refinement — is in [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md). In short:

- Design every scene from `.project/creative.json` and record its `creative` intent. One idea per scene.
- Don't visualize the script literally: choose the strongest representation of the idea (metaphor,
  transformation, contrast) unless the literal visual is genuinely the strongest.
- One focal point and one `primary` motion per shot; supporting elements are `secondary`/`tertiary`.
  Use shots for rhythm inside longer scenes.
- Few words on screen (the visual language's `maxWordsOnScreen`); whitespace is a feature. Keep text
  inside safe margins, readable (≥ 36u for body), and never cover the key visual.
- Sync visuals to words that carry meaning (names, numbers, pain points, the product) — not every word.
- Density follows the story: peaks and valleys, intentional stillness before big moments, transitions
  with a meaning, a still camera on UI.
- Use real brand assets and tokens; never invent logos. Follow the asset hierarchy (existing assets →
  screenshots → Remotion graphics → components → AI imagery).
- Vary treatments across the arc while keeping one visual language; check with `creative:metrics`.

## 13. Compositing — groups, effects, clips and blend modes

Compositing is how an element is drawn **onto what is already there**. One implementation
(`src/remotion/engine/compositing.ts`) produces it for the canvas and for the render, so the editor and
the exported file composite identically — every value here is CSS that Chrome (which draws both) applies
the same way.

**The stack**, outermost to innermost. This is the order the DOM produces, and the order to reason about:

```
position (x/y, anchor, width/height, z)      the element's box in the frame
  └ blend (mix-blend-mode)                   it mixes with the layer below
    └ transform (translate, perspective + 3D tilt, rotate, scale, around the pivot)
      └ motion filters (entrance blur, emphasis glow)
        └ effects (blur → brightness → contrast → saturate → glow → drop shadow)
          └ clip (clip-path, in % of the element's own box)
            └ opacity
              └ the element's own renderer
```

Effects and the clip sit *inside* the transform, so a scaled element's blur and clip scale with it.
The blend sits *outside* it, so what mixes with the background is the element after it has moved.

**blend** — `normal multiply screen overlay darken lighten colorDodge softLight difference`. Only modes
Chrome composites identically in the preview and the render are offered.

**effects** `{ blur, glow, glowColor, shadowX, shadowY, shadowBlur, shadowColor, brightness, contrast, saturate }`
— structured numbers and colours, never raw CSS. Lengths are design units (u), so they scale with the
frame. `blur` blurs the element itself (`style.blur` blurs what is *behind* a glass surface, and
`style.shadow` is the surface elevation preset — `effects.shadowBlur` is a drop shadow of the element's
shape). Neutral values (0, or 1 for the colour effects) emit nothing.

**clip** `{ type: rect|circle|ellipse, inset?, radius?, progress?, reveal? }` — a shape the element is
seen through, in % of its own box. `inset` is `[top, right, bottom, left]`, `radius` rounds a rect, and
a `reveal` direction (`left right up down`) turns `progress` into a wipe: at 0 nothing shows, at 1 the
whole shape does. A round clip renders as two layers — the inset box, then `closest-side` inside it —
because a single CSS `circle()` percentage resolves against the box's diagonal, which would flatten a
circle on a box that isn't square.

Every effect parameter and the clip's `progress` are ordinary animatable properties
(`effectBlur glow glowColor shadowX shadowY shadowBlur shadowColor brightness contrast saturate clipProgress`),
so they keyframe, curve and retime like position or colour — there is no separate effect animation.

**group** — several elements treated as one.

```json
{ "type": "group", "id": "title_block", "name": "Title block", "x": 50, "y": 50,
  "children": [ { "type": "rect", "…": "…" }, { "type": "text", "…": "…" } ],
  "keyframes": [ { "id": "g1", "property": "scale", "time": 0, "value": 0.7 } ] }
```

A group is an element that holds other elements, and it renders as one layer the size of the frame:

- Children keep their own **frame coordinates** and their own **cues**, so grouping never moves anything
  and a child still lands on its word. Groups do not nest (at most one level, up to 24 children).
- The group's own transform, opacity, timing, entrance/exit/emphasis/idle, keyframes, motion path,
  effects, clip and blend apply to **all of them at once**. `x`/`y` shift the whole layer (50/50 = where
  it already is) and scale and rotation turn around `pivot`, in % of the frame.
- Ungrouping bakes what can belong to a single element (the layer's offset and opacity) into the
  children and reports what could not follow (a group scale, rotation, keyframes or effects).
- A child is addressed as `#2.1` (the first child of the second element) or by its id; the canvas selects
  the group first and the child on the next click, and the layers list shows children under their group.

Edit all of it in the inspector's **Compositing** section, or with `scene:effect`, `scene:clip`,
`scene:group` and `scene:ungroup` (only when asked). Group and ungroup are Ctrl+G and Ctrl+Shift+G.

## 14. AI editing — the structured edit plan

Claude edits a scene the way the editor does: through **element patches**, not by writing specs by hand
and not through a second mutation path. The contract is `src/core/ai/edit-plan.ts`:

```
request → plan → validate → apply (core patches) → validated spec → preview → accept → commit
```

```json
{ "note": "Land the headline on the product name",
  "edits": [
    { "op": "set", "target": "headline", "patch": { "enter": { "type": "slideLeft", "duration": 0.6 } } },
    { "op": "cue", "target": "card", "cue": "emphasis+pop", "at": { "type": "phrase", "value": "our new platform" } },
    { "op": "keyframe", "target": "logo", "keyframe": { "property": "x", "at": 0, "value": 12, "easing": "expoOut" } },
    { "op": "path", "target": "icon", "path": { "type": "quadratic", "from": [20, 80], "to": [80, 30], "c1": [50, 10] } }
  ] }
```

Operations: `set` (any element patch — position, size, appearance, typography, timing, cues, effects,
clip, blend, keyframes), `add`, `remove`, `duplicate`, `arrange`, `keyframe`, `clearKeyframes`, `path`,
`cue`, `group`, `ungroup`, `scene` (transition, camera, density).

- **Targets** are an element's id, or its place: `#2`, `shot_b/#1`, `#2.1` (a group's child). An unknown
  target is refused with the list of what the scene holds.
- **Validation** is the same as a hand edit's: the element patch, the animatable property registry (the
  property exists, the element supports it, the value is in range), then the scene schema. A plan
  applies whole or not at all, and a refusal names the edit that failed and why.
- **Locking and approval** are respected — a locked scene refuses an AI edit exactly as it refuses a drag.
- **Preview**: `scene:edit … --preview` (or `preview: true` on the API) applies the plan and returns the
  resulting spec and the change list **without saving**, which is what "accept or reject" is built on.
- **Explanation**: each operation returns one plain sentence in the editor's own words ("moved it to 38%,
  50%", "added a pop emphasis on the phrase “our new platform”"), produced by the code that made the
  change, so it can't drift from it.
- **Undo**: an accepted plan is one scene version and one undo step. A plan the editor posts (the user
  accepted it) lands on the user's undo stack — Ctrl+Z takes it back; one Claude applies itself lands on
  Claude's, which is what keeps two editors from fighting.

`scene:context <project> <scene> [--element id]` is the other half: the focused structured state to
reason over — the scene's timing, its elements with what they animate and what they are cued to, the
words available for cues, the design tokens and the motion vocabulary to prefer, and the project's
assets. Not the whole application state.
