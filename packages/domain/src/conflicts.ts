/**
 * Git markers outside literal Markdown fences make a file unsafe to interpret.
 * An incomplete block also remains a conflict: deleting one delimiter must not
 * silently enable editing. A bare run of '=' is not a marker (Setext headings).
 */
export function hasMergeConflict(text: string): boolean {
  let fence: { character: string; length: number } | undefined;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    if (fence) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length)
        fence = undefined;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
      fence = { character: open[1][0], length: open[1].length };
      continue;
    }
    if (/^(?:<{7,}|>{7,}|\|{7,})(?:[ \t].*)?$/.test(line)) return true;
  }
  return false;
}
