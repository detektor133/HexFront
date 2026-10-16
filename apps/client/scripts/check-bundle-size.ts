import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_INITIAL_LOAD_BYTES = 10 * 1024 * 1024;
const INITIAL_LINK_RELATIONS = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'icon',
  'manifest',
]);

type ManifestEntry = {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
};

type BundleManifest = Record<string, ManifestEntry>;

function readInitialAssetPaths(indexHtml: string): string[] {
  const paths: string[] = [];
  const tags = indexHtml.match(/<(?:script|link)\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const script = /^<script\b[^>]*\bsrc=["']([^"']+)["']/i.test(tag);
    const linkRelation = /\brel=["']([^"']+)["']/i.exec(tag)?.[1];
    if (
      !script &&
      !linkRelation?.split(/\s+/).some((relation) => INITIAL_LINK_RELATIONS.has(relation))
    ) {
      continue;
    }
    const path = /\b(?:src|href)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (path) paths.push(path);
  }

  return paths;
}

function manifestEntriesByFile(manifest: BundleManifest): Map<string, ManifestEntry> {
  return new Map(Object.values(manifest).map((entry) => [entry.file, entry]));
}

function collectInitialFiles(initialPaths: string[], manifest: BundleManifest): Set<string> {
  const entries = manifestEntriesByFile(manifest);
  const files = new Set<string>();
  const pending = initialPaths.map((path) => path.replace(/^\//, ''));

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    files.add(file);

    const entry = entries.get(file);
    for (const importKey of entry?.imports ?? []) {
      const importedFile = manifest[importKey]?.file;
      if (importedFile) pending.push(importedFile);
    }
  }

  return files;
}

/** Суммирует байты первичной загрузки из собранного dist. */
export function calculateInitialLoadBytes(distDirectory: string): number {
  const indexHtml = readFileSync(resolve(distDirectory, 'index.html'), 'utf8');
  const manifest = JSON.parse(
    readFileSync(resolve(distDirectory, '.vite/manifest.json'), 'utf8'),
  ) as BundleManifest;
  const files = collectInitialFiles(readInitialAssetPaths(indexHtml), manifest);

  return [...files].reduce((total, file) => total + statSync(resolve(distDirectory, file)).size, 0);
}

/** Проверяет ограничение первичной загрузки в 10 МБ. */
export function assertInitialLoadWithinLimit(distDirectory: string): void {
  const bytes = calculateInitialLoadBytes(distDirectory);
  if (bytes > MAX_INITIAL_LOAD_BYTES) {
    throw new Error(`Начальная загрузка превышает 10 МБ: ${bytes} байт`);
  }
}

if (process.argv[1]?.endsWith('check-bundle-size.ts')) {
  const distDirectory = resolve(process.cwd(), 'dist');
  assertInitialLoadWithinLimit(distDirectory);
  console.log(`Размер начальной загрузки: ${calculateInitialLoadBytes(distDirectory)} байт`);
}
