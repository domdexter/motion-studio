import { z } from "zod";
import { analyzeScriptRules } from "@/core/script/analyze";
import { estimateTiming, parseScript, scriptSpokenHash } from "@/core/script/script";
import { ScriptAnalysisSchema } from "@/core/spec/analysis";
import { BrandProfileSchema } from "@/core/spec/brand";
import { compareScriptToTranscript } from "@/core/transcript/align";
import type { TimedWord } from "@/core/spec/timing";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { mutateProject, type Actor } from "./mutation";

export const SaveScriptSchema = z.object({
  content: z.string().max(200_000),
  note: z.string().max(500).optional(),
  /** Optimistic concurrency: the version the editor started from. */
  baseVersion: z.number().int().nonnegative().nullable().optional(),
});

const SOURCE_FOR_ACTOR: Record<Actor, string> = { user: "user", claude: "claude", file: "file", worker: "system", system: "system" };

export async function getScriptOverview(projectId: string) {
  const [revisions, project] = await Promise.all([
    db.scriptRevision.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, note: true, source: true, createdAt: true, contentHash: true, analysisSource: true, analyzedAt: true },
    }),
    db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTake: { select: { version: true, source: true, scriptHash: true, scriptRevisionId: true } } } }),
  ]);
  if (!project) throw notFound("Project");
  const current = revisions[0] ? await db.scriptRevision.findUnique({ where: { id: revisions[0].id } }) : null;
  const parsed = current ? parseScript(current.content) : null;
  const voice = project.activeVoiceTake;
  return {
    current: current
      ? {
          id: current.id,
          version: current.version,
          content: current.content,
          contentHash: current.contentHash,
          note: current.note,
          source: current.source,
          createdAt: current.createdAt.toISOString(),
          analysis: current.analysis ? ScriptAnalysisSchema.parse(current.analysis) : null,
          analysisSource: current.analysisSource,
          analyzedAt: current.analyzedAt?.toISOString() ?? null,
          spokenText: parsed!.spokenText,
          spokenParagraphs: parsed!.spokenParagraphs,
          wordCount: parsed!.wordCount,
          emphasis: parsed!.emphasis,
          blocks: parsed!.blocks.map((b) => ({ kind: b.kind, raw: b.raw, spoken: b.spoken })),
        }
      : null,
    estimate: parsed ? estimateTiming(parsed.spokenParagraphs) : null,
    revisions: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), analyzedAt: r.analyzedAt?.toISOString() ?? null })),
    voice: voice
      ? {
          version: voice.version,
          source: voice.source,
          generatedFromVersion: voice.scriptRevisionId ? revisions.find((r) => r.id === voice.scriptRevisionId)?.version ?? null : null,
          stale: !!voice.scriptHash && !!current && voice.scriptHash !== current.contentHash,
        }
      : null,
  };
}

export async function saveScript(projectId: string, input: z.input<typeof SaveScriptSchema>, actor: Actor) {
  const data = SaveScriptSchema.parse(input);
  const latest = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  if (latest && data.baseVersion !== undefined && data.baseVersion !== null && data.baseVersion !== latest.version) {
    throw new AppError("CONFLICT", `The script was changed elsewhere (now v${latest.version}, you started from v${data.baseVersion}).`, {
      hint: "Copy your edits, reload the latest version, and re-apply them.",
      details: { latestVersion: latest.version },
    });
  }
  if (latest && latest.content === data.content) return { version: latest.version, created: false, spokenChanged: false };
  const contentHash = scriptSpokenHash(data.content);
  return mutateProject(projectId, actor, async (tx) => {
    const created = await tx.scriptRevision.create({
      data: { projectId, version: (latest?.version ?? 0) + 1, content: data.content, contentHash, source: SOURCE_FOR_ACTOR[actor], note: data.note ?? "" },
    });
    const spokenChanged = !latest || latest.contentHash !== contentHash;
    return {
      result: { version: created.version, created: true, spokenChanged },
      activity: {
        type: "script.saved",
        message: `Saved script v${created.version}${data.note ? ` — ${data.note}` : ""}${spokenChanged ? "" : " (formatting only — voice unaffected)"}`,
      },
    };
  });
}

export async function getScriptRevision(projectId: string, version: number) {
  const rev = await db.scriptRevision.findUnique({ where: { projectId_version: { projectId, version } } });
  if (!rev) throw notFound(`Script v${version}`);
  return { version: rev.version, content: rev.content, note: rev.note, source: rev.source, createdAt: rev.createdAt.toISOString(), contentHash: rev.contentHash };
}

export async function restoreScriptRevision(projectId: string, version: number, actor: Actor) {
  const rev = await getScriptRevision(projectId, version);
  return saveScript(projectId, { content: rev.content, note: `Restored v${version}` }, actor);
}

export async function analyzeScriptWithRules(projectId: string, actor: Actor) {
  const [latest, project] = await Promise.all([
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } }),
    db.project.findUnique({ where: { id: projectId }, select: { brand: true } }),
  ]);
  if (!latest || !parseScript(latest.content).wordCount) throw new AppError("PRECONDITION", "Write or import a script before analyzing it.");
  const brand = BrandProfileSchema.parse(project?.brand ?? {});
  const analysis = analyzeScriptRules(latest.content, { brandName: brand.brandName || undefined });
  await mutateProject(projectId, actor, async (tx) => {
    await tx.scriptRevision.update({ where: { id: latest.id }, data: { analysis: json(analysis), analysisSource: "rules", analyzedAt: new Date() } });
    return { result: null, activity: { type: "script.analyzed", message: `Analyzed script v${latest.version} (rule-based): ${analysis.summary}` } };
  });
  return analysis;
}

export async function applyScriptAnalysis(projectId: string, input: unknown, actor: Actor) {
  const latest = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  if (!latest) throw new AppError("PRECONDITION", "There is no script to attach an analysis to.");
  const parsed = ScriptAnalysisSchema.safeParse({ ...(input as object), source: actor === "claude" ? "claude" : (input as { source?: string })?.source ?? "claude" });
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Invalid script analysis.", { details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  await mutateProject(projectId, actor, async (tx) => {
    await tx.scriptRevision.update({ where: { id: latest.id }, data: { analysis: json(parsed.data), analysisSource: parsed.data.source, analyzedAt: new Date() } });
    return { result: null, activity: { type: "script.analyzed", message: `Applied ${parsed.data.source} analysis to script v${latest.version}: ${parsed.data.beats.length} beats` } };
  });
  return parsed.data;
}

/** Script vs what was actually spoken. Never modifies the script. */
export async function compareScriptWithVoice(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { activeTranscript: true } });
  if (!project) throw notFound("Project");
  const latest = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  if (!latest) throw new AppError("PRECONDITION", "There is no script to compare.");
  if (!project.activeTranscript) throw new AppError("PRECONDITION", "Align the voice-over first.");
  const meta = (project.activeTranscript.meta ?? null) as { spoken?: { words: TimedWord[] } } | null;
  const words = (meta?.spoken?.words ?? project.activeTranscript.words) as TimedWord[];
  const result = compareScriptToTranscript(parseScript(latest.content).spokenText, words);
  return {
    scriptVersion: latest.version,
    transcriptVersion: project.activeTranscript.version,
    transcriptSource: project.activeTranscript.source,
    identical: result.identical,
    matchedRatio: result.matchedRatio,
    differences: result.differences,
  };
}
