import { splitSentences } from "../util/text";

/**
 * Splits spoken paragraphs into provider-sized chunks (e.g. ElevenLabs per-request character
 * limits) at paragraph, then sentence, then word boundaries — never mid-word.
 */
export function chunkSpokenText(paragraphs: string[], maxChars: number): string[] {
  if (maxChars < 50) throw new RangeError("maxChars must be at least 50");
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  const append = (piece: string, separator: string) => {
    if (!current) current = piece;
    else if (current.length + separator.length + piece.length <= maxChars) current += separator + piece;
    else {
      flush();
      current = piece;
    }
  };
  const appendLong = (text: string, separator: string) => {
    if (text.length <= maxChars) return append(text, separator);
    const sentences = splitSentences(text);
    let first = true;
    for (const sentence of sentences) {
      if (sentence.length <= maxChars) {
        append(sentence, first ? separator : " ");
      } else {
        for (const word of sentence.split(/\s+/)) append(word, " ");
      }
      first = false;
    }
  };

  for (const p of paragraphs) {
    const text = p.trim();
    if (text) appendLong(text, "\n\n");
  }
  flush();
  return chunks;
}
