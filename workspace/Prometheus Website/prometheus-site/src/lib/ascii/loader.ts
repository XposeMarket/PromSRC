export function parseAsciiToLines(ascii: string): string[] {
  return ascii.split("\n");
}

export function getMaxLineWidth(lines: string[]): number {
  return Math.max(...lines.map((l) => l.length));
}

export function padLines(lines: string[], width: number): string[] {
  return lines.map((l) => l.padEnd(width));
}
