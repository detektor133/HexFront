import { generateGenMap } from '../src/index.ts';

const seed = Number(process.argv[2]);
const players = Number(process.argv[3]);

process.stdout.write(JSON.stringify(generateGenMap(seed, players)));
