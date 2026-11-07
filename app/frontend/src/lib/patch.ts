/**
 * SEARCH/REPLACE patch engine used for incremental edits.
 *
 * Format emitted by the engineer agent:
 * <<<<<<< SEARCH
 * (exact lines from the current code)
 * =======
 * (replacement lines)
 * >>>>>>> REPLACE
 */
export interface PatchBlock {
  search: string;
  replace: string;
}

const BLOCK_RE = /<{5,9} ?SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9} ?REPLACE/g;

export const normalizeEol = (text: string) => text.replace(/\r\n?/g, '\n');

/** Returns only complete blocks, so it is safe to call on a partial stream. */
export function parsePatches(text: string): PatchBlock[] {
  const blocks: PatchBlock[] = [];
  const source = normalizeEol(text);
  for (const match of source.matchAll(BLOCK_RE)) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

function trimEmptyEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

/** Applies one block. Exact match first, then a whitespace-tolerant line match. Returns null on failure. */
export function applyPatch(code: string, block: PatchBlock): string | null {
  const search = normalizeEol(block.search);
  const replace = normalizeEol(block.replace);
  if (!search.trim()) return null;

  const first = code.indexOf(search);
  if (first >= 0) {
    return code.slice(0, first) + replace + code.slice(first + search.length);
  }

  const codeLines = code.split('\n');
  const target = trimEmptyEdges(search.split('\n')).map((l) => l.trim());
  if (!target.length) return null;

  for (let i = 0; i + target.length <= codeLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < target.length; j += 1) {
      if (codeLines[i + j].trim() !== target[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const replacement = trimEmptyEdges(replace.split('\n'));
      return [...codeLines.slice(0, i), ...replacement, ...codeLines.slice(i + target.length)].join('\n');
    }
  }
  return null;
}

export const lineCount = (text: string) => (text ? text.split('\n').length : 0);
