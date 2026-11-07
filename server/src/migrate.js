import env from './env.js';
import { closeDatabase, initDatabase, migrate } from './db.js';
import { seedDefaults } from './seed.js';

const seedOnly = process.argv.includes('--seed-only');
const forceSeed = process.argv.includes('--force');

async function main() {
  await initDatabase();

  if (!seedOnly) {
    await migrate();
    console.log('[migrate] schéma vérifié');
  }

  if (seedOnly || env.autoSeed) {
    await seedDefaults({ force: forceSeed });
  }

  await closeDatabase();
  console.log('[migrate] terminé');
}

main().catch(async (error) => {
  console.error('[migrate] échec:', error?.stack || error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
