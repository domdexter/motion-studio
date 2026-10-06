# Creative pipeline assessment (before the creative system upgrade)

Written after inspecting the repository on 2026-09-13, before any creative-system changes. The
codebase is the source of truth; this documents what existed, what is good, and what the upgrade
extends. The upgrade itself is described in [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md).

## 1. What exists

| Area | Implementation | Notes |
| --- | --- | --- |
| Stack | Next.js 16 (App Router) + React 19, Prisma 7/Postgres, worker process, Remotion 4, zod, TanStack Query | Local-first, loopback only |
| Project model | `Project` row + `projects/<id>/` folder, `revision` counter, `mutateProject()` (transaction → revision++ → Activity → `.project/` materialization) | Single service layer in `src/server/services` |
| Script | `ScriptRevision` (versioned) + optional `analysis` (beats, emphasis, visual opportunities, ESTIMATED timing) from rules or Claude | `src/core/script`, `src/core/spec/analysis.ts` |
| Audio / alignment | `VoiceTake` → `Transcript` (normalized words) → `Timeline` (sentences, phrases, paragraphs, pauses) | Audio is authoritative; staleness computed |
| Storyboard | `Scene` rows = creative intent (`visualConcept`, `visualType`, `animationNotes`, `onScreenText`, `assetsRequired`, `notes`) + `spec` + audio-locked timing (word anchors) | Rule drafter (`src/core/storyboard`) or Claude documents (`storyboard:apply`) |
| Assets | Asset library, AI `AssetRequest` flow (requested → generating → generated → approved by the user), brand kits | Requests carry prompt/style/purpose only |
| Scene spec | `SceneSpec` (zod): background, transitionIn, camera, ≤60 elements of 26 types, word/phrase/time triggers | `src/core/spec/scene.ts` |
| Renderer | `StudioVideo` → `SceneView` (transition → camera → background → elements) → `ElementBox` + `motionFor()` | Deterministic, frame-pure |
| Claude Code | Explicit `AiTask`s (7 types) with markdown briefs in `.project/tasks/`, manual or headless `claude -p`; CLI is the action surface; `.project/*.json` edits 3-way merged | No hidden agent |
| Design system | `DesignSystem` tokens (colors, typography, motion easing/durations/intensity, shape, default background/transition, safe margin) + presets | Brand kits copy brand + design into projects |
| Preview / render | Remotion Player (same props) · worker `renderMedia` with PNG frames for high quality | Composition hash → stale renders |

## 2. What is already good (keep unchanged)

- **Authority boundaries**: audio owns timing, storyboard owns intent, Remotion owns visuals. Locks,
  approvals and versioning are enforced in services, CLI and file import alike.
- **Explicit AI boundary**: tasks + CLI + validated documents. Nothing pretends an AI API exists.
- **Trigger system**: word/phrase triggers resolve on the master timeline for both engine and GUI markers.
- **Versioning**: scene versions, storyboard revisions, project snapshots, activity attribution.
- **Element library & engine**: reusable, configurable, deterministic. No need for a new renderer.
- **Real product captures** at exact on-screen size (the sharpness work) and the asset request flow.

## 3. Where creative decisions are made today

1. `src/core/storyboard/heuristics.ts` + `templates.ts` — keyword rules pick one archetype per scene
   ("never repeat the previous archetype" is the only cross-scene rule).
2. Claude's storyboard documents — per scene `visualConcept` + `spec`. The only global context is
   `creative-brief.md`, `brand.md` (free text) and `design.json` (tokens).
3. `.claude/commands/storyboard.md` / REMOTION.md §10 — six short quality rules.

## 4. Gaps (why output can look generic)

| Gap | Effect |
| --- | --- |
| No project-level creative direction, story arc or visual language object | Each scene is designed in isolation; nothing to inherit, nothing to review against |
| Scene intent is one free-text `visualConcept` + a coarse `visualType` (8 values) | No purpose, narrative beat, metaphor, composition, motion hierarchy, density or intensity — so none can be checked |
| No shots inside a scene | Long scenes (e.g. 6.7 s) either sit still or cram every change into one layout; pacing depends on element-by-element triggers |
| Motion is chosen per element with equal weight | Everything enters with similar energy; no primary/secondary/tertiary hierarchy, no density peaks and valleys |
| No visual variety tracking | Repetition (headline-left + screenshot-right, rise/pop entrances, 7 different transition types used at random) goes unnoticed |
| Literal visualization is the default | Rules map nouns to visuals (tools → tool tiles, grows → chart, hours → counter) |
| Asset requests have no composition brief or consistency context | Generated imagery can dictate composition and drift in style |
| No Creative QA stage | Only schema/trigger validation exists; no measured creative signals and no stored critique or refinement loop |

Observed in the current Incep launch film (render v3, 13 scenes): 6 scenes share a
"headline + product screenshot (+ cursor)" structure, intensity is flat (almost every element
enters with rise/pop at similar energy), transitions vary without meaning (fade, slide, zoom, wipe,
blur, scale), the problem section uses the same light UI look as the solution (weak contrast), and
scenes 1, 2, 10 and 11 visualize the script literally (notifications, numbered list + hours counter,
chart for "grows", tool tiles for "scattered tools").

## 5. Plan — extend, don't replace

| Keep | Extend | Add |
| --- | --- | --- |
| Scene rows, specs, triggers, versions, locks, tasks, CLI, `.project/` sync, renderer | `Scene` gains `creative` (intent, composition, motion hierarchy, density, intensity, shots, asset strategy) · `SceneSpec` gains optional `shots`, `motion.density` and element `motionRole`/`motionIntent` · `AssetRequest` gains `brief` · task briefs inherit the creative context | Versioned project `CreativePlan` (direction, story arc, visual language, distribution, asset consistency/strategy, references) · deterministic creative metrics · stored `CreativeReview`s with issue workflow → refinement tasks · Direction and Review pages · creative review commands · `CREATIVE_SYSTEM.md` |

Refactoring needed: none structural. Duplication to avoid: the rule drafter stays a deterministic
first draft; creative judgment remains Claude's, stored as inspectable documents. Measured metrics
are labelled as measurements; quality scores only come from a reviewer's written critique.
