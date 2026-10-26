import { execFileSync } from 'node:child_process';

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|ttf|otf|woff2?|zip|jar|keystore)$/i;

/** Tracked and untracked-but-not-ignored text files, relative to the repo root. */
export function repoTextFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f && !BINARY.test(f));
}
