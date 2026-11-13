import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Готовые карты лежат в packages/mapgen/maps и отдаются как статика по /maps/<id>.json;
// случайные клиент строит сам по зерну (mapgen подгружается отдельным куском).
const MAPS_DIR = new URL('../../packages/mapgen/maps/', import.meta.url);

function mapsPlugin(): Plugin {
  return {
    name: 'hexfront-maps',
    configureServer(server) {
      server.middlewares.use('/maps', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const id = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
        if (!id) return next();
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
  build: { manifest: true },
  server: { port: 5173, strictPort: true },
  // Прямой путь /dev/map отдаёт index.html — роутинг на клиенте.
  appType: 'spa',
}));
