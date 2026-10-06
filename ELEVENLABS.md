# ElevenLabs — voice, alignment and transcription

ElevenLabs is **optional**. It provides high-quality voice generation with word timings, forced
alignment of a script to existing audio, and speech-to-text. Every capability has a local
alternative, and nothing in the studio requires it.

| Need | ElevenLabs | Without ElevenLabs |
| --- | --- | --- |
| Voice-over | Text-to-speech **with timestamps** | Import MP3/WAV/M4A/AAC/OGG/FLAC, or the Windows system voice (scratch takes) |
| Word timing for a generated voice | Returned by the TTS call (no extra step) | System voice word events |
| Align a script to existing audio | Forced alignment | whisper.cpp transcription, or import SRT/VTT/JSON timestamps |
| Transcribe audio without a script | Speech-to-text (`scribe_v2`) | whisper.cpp (install from Settings) |
| Background music & sound effects | Music and sound-effect generation (§8) | Upload MP3/WAV/M4A/OGG/FLAC to the audio library |

## 1. API key — server-side only

- Set `ELEVENLABS_API_KEY` in `.env` **or** save it in Settings → ElevenLabs. Saved keys are written
  to `storage/config/secrets.json` (gitignored). The environment variable wins when both exist.
- The key is read only by server code (`src/server/providers/elevenlabs.ts`). The browser never
  receives it: the settings API returns only `configured` and the last four characters.
- All ElevenLabs calls happen in the local server or worker. Settings → ElevenLabs → *Test connection*
  checks the key permission by permission (Models, Voices and User read access) and shows character usage
  when allowed.
- **Restricted keys.** ElevenLabs keys can be limited to specific permissions. A valid key without a
  permission gets `401 missing_permissions`; the studio reports the exact permission instead of calling
  the key invalid. Enable what you use: *Text to Speech* and *Voices (read)* (voice-over), *Forced
  Alignment* / *Speech to Text* (alignment), *Music Generation* and *Sound Effects* (audio page),
  *Models (read)*, and optionally *User (read)* for usage. Generation permissions can't be checked
  without spending credits, so they are reported the first time a request needs them.

## 2. Endpoints used

| Purpose | Endpoint |
| --- | --- |
| Voices | `GET /v2/voices` |
| Models | `GET /v1/models` (also used for per-model character limits) |
| Subscription / usage | `GET /v1/user/subscription` |
| Voice generation + timing | `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=…` |
| Forced alignment | `POST /v1/forced-alignment` (audio + script text) |
| Speech-to-text | `POST /v1/speech-to-text` (`model_id` from settings, default `scribe_v2`) |
| Music (background beds) | `POST /v1/music?output_format=mp3_44100_128` (`prompt`, `music_length_ms` 3 000–600 000, `force_instrumental`) |
| Sound effects | `POST /v1/sound-generation?output_format=mp3_44100_128` (`text`, `duration_seconds` 0.5–30, `prompt_influence`, `loop`, `eleven_text_to_sound_v2`) |

The base URL is configurable (`elevenlabs.apiBaseUrl`, default `https://api.elevenlabs.io`).

## 3. Settings (`storage/config/settings.json → elevenlabs`)

| Setting | Default | Notes |
| --- | --- | --- |
| `defaultVoiceId` / `defaultVoiceName` | none | Chosen in Settings or per generation on the Voice page |
| `defaultModelId` | `eleven_multilingual_v2` | Any TTS model from `/v1/models` |
| `outputFormat` | `mp3_44100_128` | `mp3_44100_128`, `mp3_44100_192`, `pcm_44100`, `pcm_24000` (PCM is stored as WAV) |
| `voiceSettings` | stability 0.5 · similarity 0.75 · style 0 · speed 1 · speaker boost on | Per-generation overrides on the Voice page |
| `sttModelId` | `scribe_v2` | Speech-to-text model |

`voice.defaultProvider` (`elevenlabs` or `system`) and `alignment.defaultMethod`
(`elevenlabs_forced_alignment`, `elevenlabs_stt`, `whisper_cpp`) choose the defaults.

## 4. Voice generation flow

1. **Script → spoken text.** Markdown, headings and notes are stripped; the spoken-text hash is recorded
   so a later script change marks the voice-over stale.
2. **Chunking.** Long scripts are split on paragraph/sentence boundaries under the model's character
   limit (`chunkSpokenText`), generated part by part.
3. **Generation (worker job `voice.generate`).** Each part returns audio plus character timings. Parts
   are decoded, stitched into one file, and their timings offset onto one timeline.
4. **Normalization.** Character timings become `TimedWord[]` (`src/core/transcript/normalize.ts`) and a
   `Transcript` with source `elevenlabs_tts` is created. The master timeline is built automatically when
   none exists; otherwise the GUI shows “Voice-over changed. Existing scene timing may no longer match.”
   with *Recalculate*, *Keep* and *Compare*.
5. **Versions.** Every generation is a new `VoiceTake` (v1, v2, …) — previous takes stay playable and
   can be re-activated. Previews (`voice.preview`) generate a short sample without creating a take.

Errors surface plainly: “Voice generation failed.” plus the provider message (invalid key, quota,
unknown voice, network), with a link to Settings. Jobs can be cancelled and retried.

## 5. Alignment flow

- **Forced alignment** (`alignment.forced`): the active voice take's audio + the current script → word
  timings that keep the script's wording. Differences between script and audio are reported.
- **Speech-to-text** (`alignment.stt`): audio only → transcribed words with timings.
- **whisper.cpp** (`alignment.whisper`): local transcription with the model chosen in Settings
  (`tiny.en` … `medium`); install once from Settings (worker job `tools.whisper-install`).
- **Imported timing**: SRT, WebVTT or JSON on the Voice page, mapped to the script and validated.

Each result is a new `Transcript` version (raw responses kept under `alignment/`), activated for the
timeline. `npm run studio -- align <project> --method … --wait` runs the same jobs from the CLI.

## 6. Provider interfaces (`src/server/providers/types.ts`)

```ts
interface VoiceProvider {
  id: "elevenlabs" | "system";
  label: string;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  listVoices(): Promise<VoiceInfo[]>;
  generateVoice(input: GenerateVoiceInput): Promise<GeneratedVoice>; // audio + normalized words (+ characters)
  maxCharacters(modelId?: string | null): Promise<number | null>;
}

interface AlignmentProvider {
  id: "elevenlabs_forced_alignment" | "elevenlabs_stt" | "whisper_cpp";
  label: string;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  getAlignment(input: AlignmentInput): Promise<AlignmentResult>;     // words, characters, text
}
```

Providers only convert their native responses into the normalized `TimedWord` format; everything
downstream (timeline, scenes, triggers, Remotion) is provider-agnostic. A new provider implements one of
these interfaces and registers in `src/server/providers/index.ts`.

## 7. System voice (Windows)

The Windows SAPI voice (`src/server/providers/system-voice/`) produces scratch voice-overs with word
events — useful for blocking out timing before a final voice exists. It runs a PowerShell script with a
JSON request file (no user text on the command line). On other platforms, import audio instead.

## 8. Music and sound effects

Audio → **Generate with ElevenLabs** (or `audio:generate` in the CLI) queues an `audio.generate` worker job:

1. **Music** calls `POST /v1/music` with the prompt, `force_instrumental` (on by default) and a length
   that defaults to the video's duration (3–600 s). **Sound effects** call `POST /v1/sound-generation`
   (`eleven_text_to_sound_v2`, 0.5–30 s or model-chosen, optional seamless loop and prompt influence).
2. The MP3 is validated and stored in the project's audio library as a `music`/`sfx` asset with
   `source: "elevenlabs"`, the prompt and the generator recorded.
3. Unless disabled, it is placed on the timeline as an audio track (music: 35% volume, 1 s/2 s fades,
   ducking under the voice; SFX: 80%, no ducking) — adjust it in the mixer like any uploaded audio.

Up to three generations run per project at once. Without a key the panel explains how to configure
one; uploading your own music and SFX always works.
