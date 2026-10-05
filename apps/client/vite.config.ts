import { readFileSync, readdirSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Карты лежат в packages/mapgen/maps; клиенту импортировать mapgen нельзя (overview.md, «Границы»),
// поэтому они отдаются как статика по /maps/<id>.json.
const MAPS_DIR = new URL('../../packages/mapgen/maps/', import.meta.url);

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
          void import('../../packages/mapgen/src/index.ts').then(({ generateMap }) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(generateMap(seed, { width: 80, height: 60, players })));
          });
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

export default defineConfig({
  plugins: [react(), mapsPlugin()],
  server: { port: 5173, strictPort: true },
  // Прямой путь /dev/map отдаёт index.html — роутинг на клиенте.
  appType: 'spa',
});
