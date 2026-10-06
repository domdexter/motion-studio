# Project schema — database, files and formats

Motion Studio keeps **metadata, relationships and history in Postgres** (Prisma) and **binaries
on disk** in the project folder. Creative documents that are read and written as a whole (brand,
design system, scene specs, word timings) are JSON columns validated with zod schemas in
`src/core/spec`. Every derived artifact records the identity of its inputs, so staleness is
computed rather than stored.

## 1. Database models (`prisma/schema.prisma`)

| Model | Purpose | Key fields |
| --- | --- | --- |
| `Project` | A video production | `id` (slug + suffix, doubles as folder name), `name`, `workflow`, `formatPreset`, `width`, `height`, `fps`, `brief`, `brand` (BrandProfile), `design` (DesignSystem), `markers`, `mix` (voice-over `volume`, `muted` and `cuts`: muted sections `{ startSec, endSec }[]` in video seconds; timing is unchanged), `activeVoiceTakeId`, `activeTranscriptId`, `activeTimelineId`, `timelineDecision`, `thumbnailPath`, `revision` (bumped on every mutation), `archivedAt`, `brandKitId` (the brand kit it follows; null = custom brand), `brandKitVersion` (kit version last synced) |
| `BrandKit` | Reusable brand from Settings → Brand kits | `name`, `description`, `brand` (BrandProfile whose asset ids are `BrandKitFile` ids), `design` (DesignSystem), `version` (bumped on identity/design changes — following projects are re-synced) |
| `BrandKitFile` | Logo, font, guide or reference stored with a kit | `kind` (`logo font brand_guide reference`), `filePath` (under `storage/brand-kits/<kitId>/`), `mimeType`, `sizeBytes`, `contentHash`, `width`, `height`. Copied into a project as an `Asset` (source `brand_kit`, deduplicated by hash) when the project follows the kit |
| `ScriptRevision` | Every saved script | `version`, `content`, `contentHash` (whitespace-normalized spoken text), `source`, `analysis` (ScriptAnalysis, ESTIMATED timing), `analysisSource` |
| `VoiceTake` | Generated or imported voice-over revision | `version`, `source` (`elevenlabs` `system_tts` `import`), `filePath`, `durationSec`, `contentHash`, `peaksPath`, `scriptRevisionId` + `scriptHash` (staleness), `voiceId`, `voiceName`, `modelId`, `settings`, `providerMeta` |
| `Transcript` | Normalized word timing for a voice take | `version`, `voiceTakeId`, `source` (`elevenlabs_tts` `elevenlabs_forced_alignment` `elevenlabs_stt` `whisper_cpp` `system_tts` `import_json` `import_srt` `import_vtt` `manual`), `text`, `words` (TimedWord[]), `charactersPath`, `rawPath`, `quality`, `meta` |
| `Timeline` | Master timeline derived from a transcript (or imported) | `version`, `transcriptId`, `source` (`derived` `imported`), `durationSec`, `data` (TimelineData) |
| `StoryboardRevision` | Snapshot of all scenes after storyboard-level changes | `version`, `timelineId`, `source`, `note`, `scenes` |
| `Scene` | Storyboard intent + Remotion spec + timing | `key` (`scene_01`…, matches order), `order`, `name`, `startSec`, `endSec`, `timingMode` (`audio_locked` `user_adjusted`), `wordStart`/`wordEnd` (anchor into the transcript), `timelineId`, `voiceText`, `visualConcept`, `visualType`, `animationNotes`, `onScreenText`, `assetsRequired`, `notes`, `spec` (SceneSpec), `creative` (SceneCreative; null = no creative intent recorded), `status` (`draft` `approved`), `locked`, `approvedFingerprint`, `version`, `source` |
| `SceneVersion` | Every version of a scene | `version`, `snapshot`, `source`, `message` |
| `Asset` | File in the asset library | `kind` (`image video audio music sfx logo font screenshot icon brand_guide reference`), `source` (`upload claude elevenlabs render import hyperframes brand_kit`), `filePath`, `mimeType`, `sizeBytes`, `contentHash`, `width`, `height`, `durationSec`, `prompt`, `generator`, `requestId`, `sceneId`, `tags`, `status` (`ready approved rejected`), `version` (bumped on replace; id stays stable) |
| `AssetRequest` | AI image/video request fulfilled by Claude Code | `kind`, `prompt`, `negativePrompt`, `aspectRatio`, `width`, `height`, `durationSec`, `styleNotes`, `purpose`, `brief` (AssetBrief: composition-aware brief, optional), `count`, `status` (`requested generating generated approved rejected cancelled`), `requestedBy`, `approvedAssetId`, `feedback`, `error`, `attempt`, `sceneId` |
| `AudioTrack` | Music/SFX/voice lines on the timeline | `assetId`, `kind` (`music` `sfx` `voice`), `startSec`, `trimStartSec`, `durationSec`, `volume`, `fadeInSec`, `fadeOutSec`, `muted`, `loop`, `duckUnderVoice`, `order` |
| `OverlayClip` | Image/video on the overlay track, above the scenes in absolute video time (can span scene cuts) | `assetId`, `name`, `placement` (`fullscreen` `framed` `pip`), `fit`, `startSec`, `durationSec`, `trimStartSec`, `trimEndSec` (null = clip end), `playbackRate`, `endBehavior` (`hold` `loop` when on screen longer than the trimmed part), `volume`, `dim`, `opacity`, `fadeInSec`, `fadeOutSec`, `hidden`, `zooms` (zoom regions `{ id, startSec, endSec, rect, toRect, easeSec }[]` in clip seconds; `rect`/`toRect` = `{ x, y, size }` squares in fractions of the clip frame), `crop` (`{ left, top, right, bottom }` fractions cut from each side, null = none), `speedSegments` (`{ id, startSec, endSec, rate }[]` in clip seconds, rate 0 = freeze), `annotations` (`{ id, type: blur box arrow label spotlight click, startSec, endSec, x, y, w, h, text?, color?, strength? }[]`, fractions of the clip frame), `duckUnderVoice` (lower the clip's sound while the narrator speaks), `order` |
| `SceneTemplate` | Scene design saved for reuse in any project (built-in templates live in `src/core/templates/builtin.ts`, not here) | `id` (`tpl_…`), `name`, `description`, `kind` (`scene` = a SceneSpec, `elements` = `{ elements }` added to a scene), `spec`, `files` (images/videos it uses, copied to `storage/scene-templates/<id>/` and imported into the target project by hash), `sourceProjectId`, `sourceSceneKey` |
| `Render` | Render history (one row per render version) | `kind` (`final preview scene range`), `status` (`queued bundling rendering encoding complete failed cancelled`), `progress`, `stage`, `label`, `settings`, `outputPath`, `thumbnailPath`, `sizeBytes`, `durationSec`, `renderedFrames`, `totalFrames`, `compositionHash`, `error`, `jobId` |
| `Job` | Background work for the worker | `type` (`voice.generate voice.preview alignment.* render.video render.still render.thumbnail export.package tools.whisper-install ai.headless audio.generate`), `status`, `progress`, `stage`, `payload`, `result`, `error`, `cancelRequested`, `heartbeatAt` |
| `AiTask` | Explicit task for Claude Code | `type` (`analyze_script generate_storyboard regenerate_scenes edit_scene scene_alternatives generate_assets plan_creative creative_review refine_creative command`), `status` (`pending running completed failed cancelled`), `title`, `instruction`, `scope` (`sceneIds`, `sceneKeys`, `skippedLocked`, `keepTiming`, `keepVoice`, `reviewId` + `issueIds` for refinements, …), `executor` (`manual` `headless`), `log`, `resultSummary`, `error` |
| `CreativeRevision` | Versioned project creative plan (highest version is current) | `version`, `source` (`claude user file restore`), `note`, `data` (CreativePlan: direction, storyArc, visualLanguage, visualDistribution, assetStrategy, references, notes) |
| `CreativeReview` | Written creative review (Creative QA) | `id` (`crv_…`), `version`, `source` (`claude user`), `title`, `request`, `summary`, `overallScore` + `scores` (advisory 0–100), `strengths`, `issues` (ReviewIssue[] with `id` and `status` `open accepted dismissed resolved`), `scope` ([] = whole video), `weakestScenes`, `basedOn`, `measured` (metrics summary when saved), `compositionHash`, `storyboardVersion` |
| `ProjectSnapshot` | Named project version | `version`, `label`, `reason`, `data` (project fields, scenes incl. `creative`, audio tracks, overlay clips, latest creative plan) |
| `EditStep` | One undoable edit (Scenes/Timeline undo & redo), per actor | `actor`, `label`, `coalesceKey`, `undone`, `changes` (before/after of only the changed scenes, overlay clips and markers; bookkeeping like `version` and `locked` ignored) |
| `Activity` | Who changed what | `actor` (`user claude system file worker`), `type`, `message`, `data` |
| `SyncIssue` | Rejected external edit of a `.project/` file | `file`, `message`, `details`, `resolved` |
| `AppSetting` | Reserved for app-level settings | `key`, `value` |

Settings and secrets live in files: `storage/config/settings.json` and
`storage/config/secrets.json` (environment variables such as `ELEVENLABS_API_KEY` take precedence).

## 2. Staleness & derived status

| Artifact | Stale when |
| --- | --- |
| Generated voice take | its `scriptHash` ≠ hash of the current script's spoken text |
| Transcript | its `voiceTakeId` ≠ active voice take |
| Timeline | its `transcriptId` ≠ active transcript (unless the user chose *Keep existing timeline*) |
| Audio-locked scene | its `timelineId` ≠ active timeline |
| Approved scene | fingerprint of spec + timing + referenced asset hashes ≠ `approvedFingerprint` (“Needs review”) |
| Render | its `compositionHash` ≠ hash of all Remotion inputs |
| Creative review | its `compositionHash` ≠ current composition hash (shown as *stale*; the review is kept as written) |

Production status is derived (`src/core/status/pipeline.ts`): `DRAFT → SCRIPT_READY → VOICE_READY →
TIMELINE_READY → STORYBOARD_READY → ASSETS_READY → ANIMATION_READY → READY_TO_RENDER → RENDERING → COMPLETE`,
with per-stage states (`ready missing stale running attention optional`) and the next suggested action.

## 3. Project context files

`projects/<id>/.project/` is re-materialized after every mutation (atomic writes). Editable files:
`creative-brief.md`, `design.json`, `script.md`, `creative.json`, `storyboard.json`, `scenes.json`.
The last materialized copy of each is kept in `.project/.sync/base/` for 3-way merges.

| File | Format |
| --- | --- |
| `project.json` | `{ id, name, workflow, revision, format{width,height,fps,aspect,preset}, status, stages, next, durationSec, voice, transcript, timeline, timelineDecision, scenes{count, approved[], locked[], invalid[], staleTiming[]}, assets{count, openRequests, awaitingApproval}, compositionHash, updatedAt }` |
| `creative-brief.md` · `script.md` | Markdown (editable) |
| `brand.md` | Markdown mirror of the brand profile + token summary (read-only) |
| `design.json` | `DesignSystem` (editable, validated) |
| `creative.json` | `{ $schema: "motion-studio/creative@1", _readme, projectId, revision, ...CreativePlan }` — editable; an edit is imported as the whole plan and saved as a new revision (the GUI wins on conflict) |
| `creative-metrics.json` | `{ _readme, version, durationSec, scenes: SceneMetrics[], coverage, distribution{measured, planned, target}, transitions, intensity[], findings[], counts }` — MEASURED signals, read-only (`{ metrics: null }` if they can't be computed) |
| `creative-review.json` | `{ _readme, ...latest CreativeReview (id, version, summary, scores, strengths, issues[], weakestScenes, measured, stale, …) }` or `{ review: null, note }` — change issue status via `creative:issue` |
| `script-analysis.json` | `{ scriptVersion, source, note, analysis: ScriptAnalysis }` — ESTIMATED timing |
| `transcript.json` | `{ version, source, sourceLabel, voiceTakeVersion, durationSec, language, quality, text, words: TimedWord[] }` |
| `timeline.json` | `{ timebase: "seconds", fps, version, source, duration, segments[], phrases[], paragraphs[], pauses[], cues?, words[] }` |
| `storyboard.json` | `{ $schema: "motion-studio/storyboard@1", projectId, timelineVersion, scenes: [{ uid, sceneId, name, start, end, duration, timingMode, wordStart, wordEnd, locked, status, voiceText, visualConcept, visualType, animation[], onScreenText, assetsRequired[], notes, creative }] }` — creative fields editable (`creative`: SceneCreative, `null` clears it) |
| `scenes.json` | `{ $schema: "motion-studio/scenes@1", projectId, fps, width, height, scenes: [{ uid, id, name, start, end, duration, locked, status, ...SceneSpec }] }` — spec fields editable |
| `assets.json` | `{ assets: [{ id, kind, name, source, file, mimeType, width, height, durationSec, status, scene, prompt, requestId, contentHash }], requests: [{ id, kind, status, scene, prompt, negativePrompt, aspectRatio, width, height, durationSec, purpose, styleNotes, brief, generationBrief, count, feedback, attempt, resultAssetIds[], approvedAssetId }] }` — `generationBrief` is the brief merged with the plan's asset consistency (what generation must follow) |
| `audio.json` | `{ voice: { file, volume, muted, cuts }, tracks: [...] }` |
| `renders.json` | Render history with settings, status, stale flag, output file, errors |
| `tasks/<taskId>.md` | Brief for each pending/running AI task |

## 4. Core formats (`src/core/spec`)

**TimedWord** — `{ i, text, start, end, confidence?, interpolated? }` (seconds from the start of the voice-over; `i` contiguous).

**Segment** — `{ id, kind: sentence|phrase|paragraph|cue, text, start, end, wordStart, wordEnd, paragraph? }` (`[wordStart, wordEnd)`).

**TimelineData** — `{ timebase: "seconds", duration, sentences[], phrases[], paragraphs[], pauses[{ start, end, afterWord }], cues? }`.

**Scene timing** — audio-locked scenes store word anchors; boundaries sit in the gap before the
first word of the next scene (`word.start − min(0.12 s, gap/2)`). Recalculating a timeline remaps
anchors onto the new words; user-adjusted scenes keep their absolute times.

**SceneSpec** (incl. `shots`, `motion.density`) — see [REMOTION.md](REMOTION.md). **DesignSystem** — `src/core/spec/design.ts`.
**CreativePlan**, **SceneCreative**, **AssetBrief**, **CreativeReview** — `src/core/creative/schema.ts`;
**CreativeMetrics** — `src/core/creative/metrics.ts`; both described in [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md).
**BrandProfile** — `src/core/spec/brand.ts`. **Markers** — `[{ id, time, label, kind: beat|note|music|sfx|emphasis }]`.

**StudioVideoProps** (Remotion input) — `{ projectId, width, height, fps, durationSec, design, brand{brandName, logoAssetId}, scenes[{ id, key, name, start, end, spec, valid }], words[], voice{src, volume, muted, durationSec} | null, tracks[], assets{id → {kind, name, src, mimeType, width, height, durationSec}}, fonts[{family, src}], overlays? }`.

## 5. Project folder

```
projects/<id>/
  audio/voice/        voice takes (v1.mp3, v2.wav, …) + peaks JSON
  audio/music/        music assets          audio/sfx/   sound effects
  assets/images/ assets/videos/ assets/logos/ assets/fonts/ assets/screenshots/ assets/icons/
  assets/brand/       brand guides          assets/references/
  alignment/          raw provider responses, character timings
  renders/            <project-name>-v<N>-<kind>.mp4 + .jpg thumbnails, e.g. my-film-v7-final.mp4,
                      my-film-v8-scene-03.mp4 (older renders: <renderId>.mp4 → `renders:rename`)
  exports/            stills, thumbnails, project packages
  .project/           context files for Claude Code (above)
```

Paths stored in the database are relative to the project folder. Every path is resolved inside the
project root; uploads are checked by extension, magic bytes and size.

## 6. Import & export

- **Timing import**: SRT, WebVTT and JSON (word or segment timings) with mapping to the script.
- **Project package**: zip of the project folder (script, audio, assets, specs, optionally renders)
  plus a database bundle (including creative plan revisions and reviews; packages exported before
  the creative system import without them); importing creates a new project with fresh ids.
- **Exports**: MP4 renders, thumbnails/stills, `timeline.json`, `storyboard.json`, `scenes.json`
  (Render page → Exports, or `/api/projects/:id/exports/<file>`).
