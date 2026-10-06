/**
 * YouTube chapters from scene timing: the first chapter starts at 0:00, every chapter lasts at least
 * 10 seconds (short scenes join the chapter before them), and YouTube needs at least three.
 */

export interface Chapter {
  startSec: number;
  title: string;
}

export const MIN_CHAPTER_SEC = 10;
export const MIN_CHAPTERS = 3;

export function buildChapters(scenes: readonly { name: string; startSec: number; endSec: number }[], minChapterSec = MIN_CHAPTER_SEC): Chapter[] {
  const ordered = [...scenes].sort((a, b) => a.startSec - b.startSec);
  if (!ordered.length) return [];
  const chapters: { startSec: number; endSec: number; title: string }[] = [];
  for (const s of ordered) {
    const last = chapters[chapters.length - 1];
    // A short scene joins the chapter before it.
    if (last && s.endSec - s.startSec < minChapterSec) last.endSec = Math.max(last.endSec, s.endSec);
    else chapters.push({ startSec: chapters.length ? s.startSec : 0, endSec: s.endSec, title: s.name.trim() || "Untitled" });
  }
  // A chapter that is still too short (e.g. a short first scene) joins its neighbour.
  for (let i = chapters.length - 1; i >= 0 && chapters.length > 1; i--) {
    const c = chapters[i];
    if (c.endSec - c.startSec >= minChapterSec) continue;
    if (i > 0) {
      chapters[i - 1].endSec = c.endSec;
      chapters.splice(i, 1);
    } else {
      chapters[0].endSec = chapters[1].endSec;
      chapters.splice(1, 1);
    }
  }
  return chapters.map((c) => ({ startSec: Math.floor(c.startSec), title: c.title }));
}

export function formatChapterTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** “0:00 Title” lines, ready to paste into a YouTube description. */
export function chaptersText(chapters: readonly Chapter[]): string {
  return chapters.map((c) => `${formatChapterTime(c.startSec)} ${c.title}`).join("\n");
}
