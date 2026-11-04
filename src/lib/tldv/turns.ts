// Speaker turns: tl;dv gives one sentence per line; the app merges consecutive sentences by the same
// speaker into turns so timestamps stay precise but the transcript reads naturally.

export interface SpeakerTurn {
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
}

/** Merge consecutive same-speaker sentences; split a turn past 60 s or 600 characters. */
export function mergeTurns(sentences: SpeakerTurn[], { maxSec = 60, maxChars = 600 } = {}): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  for (const s of [...sentences].sort((a, b) => a.startSec - b.startSec)) {
    const last = turns[turns.length - 1];
    const text = s.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (last && last.speaker === s.speaker && s.endSec - last.startSec <= maxSec && last.text.length + text.length + 1 <= maxChars) {
      last.text = `${last.text} ${text}`;
      last.endSec = Math.max(last.endSec, s.endSec);
    } else {
      turns.push({ speaker: s.speaker, startSec: s.startSec, endSec: Math.max(s.startSec, s.endSec), text });
    }
  }
  return turns;
}

export function wordCount(turns: SpeakerTurn[]): number {
  return turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
}
