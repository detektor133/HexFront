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
        const id = /^\/([a-z0-9-]+)\.json$/.exec(req.url ?? '')?.[1];
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

export default defineConfig({
  plugins: [react(), mapsPlugin()],
  server: { port: 5173, strictPort: true },
  // Прямой путь /dev/map отдаёт index.html — роутинг на клиенте.
  appType: 'spa',
});
