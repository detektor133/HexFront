import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Карты лежат в packages/mapgen/maps; клиенту импортировать mapgen нельзя (overview.md, «Границы»),
// поэтому они отдаются как статика по /maps/<id>.json.
const MAPS_DIR = new URL('../../packages/mapgen/maps/', import.meta.url);
const MAPGEN_SCRIPT = fileURLToPath(
  new URL('../../packages/mapgen/scripts/generate-json.ts', import.meta.url),
);

function mapsPlugin(): Plugin {
  return {
    name: 'hexfront-maps',
    configureServer(server) {
      server.middlewares.use('/maps', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const id = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
        if (!id) return next();
        if (id === 'gen') {
          const seed = Number(url.searchParams.get('seed'));
          const players = Number(url.searchParams.get('players'));
          if (
            !Number.isSafeInteger(seed) ||
            !Number.isInteger(players) ||
            players < 2 ||
            players > 30
          ) {
            res.statusCode = 400;
            res.end('Некорректные параметры процедурной карты');
            return;
          }
          execFile(
            process.execPath,
            ['--experimental-strip-types', MAPGEN_SCRIPT, String(seed), String(players)],
            (error, stdout) => {
              if (error) {
                res.statusCode = 500;
                res.end('Не удалось сгенерировать карту');
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(stdout);
            },
          );
          return;
        }
        try {
          const body = readFileSync(new URL(`${id}.json`, MAPS_DIR));
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        } catch (error) {
          server.config.logger.warn(`map_not_found ${id}: ${String(error)}`);
          res.statusCode = 404;
          res.end();
        }
      });
    },
    generateBundle() {
      for (const file of readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'))) {
        this.emitFile({
          type: 'asset',
          fileName: `maps/${file}`,
          source: readFileSync(new URL(file, MAPS_DIR)),
        });
      }
    },
  };
}

/** Принимает JSONL телеметрии только от dev-сервера, чтобы production не получил endpoint записи. */
function telemetryPlugin(): Plugin {
  const started = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const directory = new URL('../../telemetry/', import.meta.url);
  const file = new URL(`${started}.jsonl`, directory);
  return {
    name: 'hexfront-telemetry',
    configureServer(server) {
      server.middlewares.use('/__telemetry', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(body);
            if (!parsed || typeof parsed !== 'object' || !('tick' in parsed))
              throw new Error('schema');
            mkdirSync(directory, { recursive: true });
            appendFileSync(file, `${JSON.stringify(parsed)}\n`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), mapsPlugin(), ...(command === 'serve' ? [telemetryPlugin()] : [])],
  server: { port: 5173, strictPort: true },
  // Прямой путь /dev/map отдаёт index.html — роутинг на клиенте.
  appType: 'spa',
}));
