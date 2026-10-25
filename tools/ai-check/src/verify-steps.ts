const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORMAT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|yml|yaml)$/;
const SKIP_RE =
  /^(docs\/|coverage\/|\.ai-logs\/|pnpm-lock\.yaml|apps\/client\/src\/theme\/tokens\.)/;

export interface VerifyStep {
  readonly name: string;
  readonly cmd: string;
  readonly args: readonly string[];
}

/** Одинаковые архитектурные проверки выполняются и в рабочем, и в финальном gate. */
export function buildVerifySteps(files: readonly string[] | null): VerifyStep[] {
  const changedOnly = files !== null;
  const pick = (re: RegExp): string[] =>
    files === null ? ['.'] : files.filter((file) => re.test(file) && !SKIP_RE.test(file));
  const code = pick(CODE_RE);
  const format = pick(FORMAT_RE);
  const steps: VerifyStep[] = [
    { name: 'build', cmd: 'pnpm', args: ['-r', '--if-present', 'build'] },
    { name: 'types', cmd: 'pnpm', args: ['typecheck'] },
    { name: 'depcheck', cmd: 'pnpm', args: ['depcheck'] },
  ];
  if (code.length > 0) {
    steps.push({
      name: 'lint',
      cmd: 'pnpm',
      args: ['exec', 'eslint', '--max-warnings', '0', ...code],
    });
  }
  if (format.length > 0) {
    steps.push({ name: 'prettier', cmd: 'pnpm', args: ['exec', 'prettier', '--check', ...format] });
  }
  steps.push({
    name: 'tests',
    cmd: 'pnpm',
    args: ['exec', 'vitest', 'run', ...(changedOnly ? ['--changed', 'HEAD'] : [])],
  });
  return steps;
}
