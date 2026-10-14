import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = new URL('../../../.github/workflows/pages.yml', import.meta.url);
const ADR_DIRECTORY = new URL('../../../docs/architecture/adr/', import.meta.url);
const DIST_DIRECTORY = new URL('../dist/', import.meta.url);

function readFirstMatchingFile(pattern: RegExp): string | null {
  if (!existsSync(ADR_DIRECTORY)) return null;

  const files = readdirSync(ADR_DIRECTORY).filter((file) => file.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(new URL(file, ADR_DIRECTORY), 'utf8');
    if (pattern.test(content)) return content;
  }

  return null;
}

describe('публикация сборки клиента', () => {
  it('критерий 1: ADR записан для публикации через cloudflare/wrangler-action', () => {
    const adr = readFirstMatchingFile(/cloudflare\/wrangler-action/i);

    expect(adr).not.toBeNull();
    expect(adr).toMatch(/cloudflare\/wrangler-action/);
  });

  it('критерий 2: workflow запускается на push веток stage-* и main и собирает клиент', () => {
    const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';

    expect(workflow).toMatch(/push:[\s\S]*branches:[\s\S]*main[\s\S]*stage-\*/);
    expect(workflow).toContain('pnpm --filter @hexfront/client build');
    expect(workflow).toContain('apps/client/dist');
    expect(workflow).toContain('cloudflare/wrangler-action');
  });

  it('критерий 3: в dist есть index.html и нет 404.html', () => {
    expect(existsSync(new URL('index.html', DIST_DIRECTORY))).toBe(true);
    expect(existsSync(new URL('404.html', DIST_DIRECTORY))).toBe(false);
  });

  it('критерий 4: без CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID публикация пропускается с сообщением', () => {
    const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';

    expect(workflow).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(workflow).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    expect(workflow).toMatch(/if:[\s\S]*(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)/);
    expect(workflow).toMatch(/(?:skip|пропуск|нет секрет|secrets)/i);
  });
});
