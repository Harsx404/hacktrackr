import { scrapeDevfolio } from '../scrapers/devfolio.scraper';
import { scrapeMLH } from '../scrapers/mlh.scraper';
import { scrapeUnstop } from '../scrapers/unstop.scraper';
import { upsertToSource, UpsertResult } from '../services/upsertToSource';
import { logger } from '../lib/logger';

/**
 * Runs all scrapers and upserts each source into its dedicated table.
 * To add a new platform:
 *   1. Create src/scrapers/<platform>.scraper.ts
 *   2. Add its table to 003_platform_tables.sql + SOURCE_TABLE in upsertToSource.ts
 *   3. Add one scrape + upsert call below
 */
export async function syncHackathons(): Promise<UpsertResult> {
  logger.info('=== Starting hackathon sync ===');
  const start = Date.now();

  // Run all scrapers in parallel
  const [devfolioItems, mlhItems, unstopItems] = await Promise.all([
    scrapeDevfolio(),
    scrapeMLH(),
    scrapeUnstop(),
    // scrapeDevpost(),   ← add new scrapers here
    // scrapeEthGlobal(),
  ]);

  logger.info(`Total scraped: ${devfolioItems.length + mlhItems.length + unstopItems.length} hackathons from 3 sources`);

  // Upsert each source independently into its own table
  const [devfolioResult, mlhResult, unstopResult] = await Promise.all([
    upsertToSource('devfolio', devfolioItems),
    upsertToSource('mlh',      mlhItems),
    upsertToSource('unstop',   unstopItems),
  ]);

  // Aggregate totals
  const result: UpsertResult = {
    inserted: devfolioResult.inserted + mlhResult.inserted + unstopResult.inserted,
    updated:  devfolioResult.updated  + mlhResult.updated  + unstopResult.updated,
    skipped:  devfolioResult.skipped  + mlhResult.skipped  + unstopResult.skipped,
    errors:   devfolioResult.errors   + mlhResult.errors   + unstopResult.errors,
  };

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`=== Sync done in ${elapsed}s ===`, result);
  return result;
}

// Allow running as a standalone script: ts-node src/jobs/syncHackathons.ts
if (require.main === module) {
  syncHackathons().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
