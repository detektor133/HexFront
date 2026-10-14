import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = new URL('../../../.github/workflows/pages.yml', import.meta.url);
const ADR_DIRECTORY = new URL('../../../docs/architecture/adr/', import.meta.url);
const DIST_DIRECTORY = new URL('../dist/', import.meta.url);
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIST_PATH = fileURLToPath(DIST_DIRECTORY);
const DEPLOY_COMMAND =
  'pages deploy apps/client/dist --project-name=hexfront --branch=${{ github.ref_name }}';

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@hexfront/client', 'build'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  },
);

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
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toMatch(/uses: cloudflare\/wrangler-action@v3/);
    expect(workflow).toContain(`command: ${DEPLOY_COMMAND}`);

    const mainDeployment = DEPLOY_COMMAND.replace('${{ github.ref_name }}', 'main');
    const previewDeployment = DEPLOY_COMMAND.replace('${{ github.ref_name }}', 'stage-07');
    expect(mainDeployment).toBe(
      'pages deploy apps/client/dist --project-name=hexfront --branch=main',
    );
    expect(previewDeployment).toBe(
      'pages deploy apps/client/dist --project-name=hexfront --branch=stage-07',
    );
  });

  it('критерий 3: сборка отдаёт index.html для прямых маршрутов / и /match', () => {
    expect(existsSync(new URL('index.html', DIST_DIRECTORY))).toBe(true);
    expect(existsSync(new URL('404.html', DIST_DIRECTORY))).toBe(false);

    expect(readFileSync(join(DIST_PATH, 'index.html'), 'utf8')).toContain('<div id="root">');
  });

  it('критерий 4: без CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID публикация пропускается с сообщением', () => {
    const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';

    expect(workflow).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(workflow).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    expect(workflow).toContain(
      "if: ${{ secrets.CLOUDFLARE_API_TOKEN != '' && secrets.CLOUDFLARE_ACCOUNT_ID != '' }}",
    );
    expect(workflow).toContain(
      "if: ${{ secrets.CLOUDFLARE_API_TOKEN == '' || secrets.CLOUDFLARE_ACCOUNT_ID == '' }}",
    );
    expect(workflow).toMatch(/Публикация пропущена: секреты Cloudflare не настроены/);
  });
});
