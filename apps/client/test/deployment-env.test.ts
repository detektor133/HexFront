import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = new URL('../../../.github/workflows/pages.yml', import.meta.url);

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function readDeployJob(workflow: string): string {
  return workflow.match(/^ {2}deploy:\n([\s\S]*)/m)?.[1] ?? '';
}

describe('условия публикации Pages через env', () => {
  it('критерий 1: секреты Cloudflare объявлены в env на уровне job', () => {
    const deployJob = readDeployJob(readWorkflow());
    const jobEnv = deployJob.match(/^ {4}env:\n((?:^ {6}.*(?:\n|$))*)/m)?.[1] ?? '';

    expect(jobEnv).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(jobEnv).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  });

  it('критерий 2: условия шагов публикации используют только env.*', () => {
    const workflow = readWorkflow();
    const publishConditions = [...workflow.matchAll(/if:\s*\$\{\{([^}]*)\}\}/g)]
      .map((match) => match[1] ?? '')
      .filter((condition) => condition.includes('CLOUDFLARE'));

    expect(publishConditions).toHaveLength(2);
    for (const condition of publishConditions) {
      expect(condition).toMatch(/env\.CLOUDFLARE_API_TOKEN/);
      expect(condition).toMatch(/env\.CLOUDFLARE_ACCOUNT_ID/);
    }
  });

  it('критерий 3: тест падает, если в if: workflow встречается secrets.', () => {
    const workflow = readWorkflow();
    const ifLines = workflow.split('\n').filter((line) => /^\s*if:\s*/.test(line));

    expect(ifLines.some((line) => line.includes('secrets.'))).toBe(false);
  });
});
