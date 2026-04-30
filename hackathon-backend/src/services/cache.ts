import { scrapeUnstop } from '../scrapers/unstop.scraper';
import { scrapeMLH } from '../scrapers/mlh.scraper';
import { scrapeDevfolio } from '../scrapers/devfolio.scraper';
import { scrapeHack2Skill } from '../scrapers/hack2skill.scraper';
import { NormalizedHackathon } from './normalizeHackathon';
import { logger } from '../lib/logger';

class HackathonCache {
  private cache: NormalizedHackathon[] = [];
  private isRefreshing = false;
  private lastUpdated: Date | null = null;

  public get() {
    return this.cache;
  }

  public getLastUpdated() {
    return this.lastUpdated;
  }

  public async refresh() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    logger.info('Cache: Starting background refresh...');

    try {
      // Fetch MLH, Devfolio, and Hack2Skill concurrently
      const mlhPromise     = scrapeMLH();
      const devfolioPromise = scrapeDevfolio();
      const h2sPromise      = scrapeHack2Skill();

      // Fetch Unstop (pages 1 to 4) sequentially to be nice to their API
      const unstopResults: NormalizedHackathon[] = [];
      for (let p = 1; p <= 4; p++) {
        try {
          const pageRes = await scrapeUnstop(p, 15);
          unstopResults.push(...pageRes);
        } catch (err: any) {
          logger.warn(`Cache: Unstop page ${p} fetch failed:`, err.message);
        }
      }

      const [mlhResults, devfolioResults, h2sResults] = await Promise.all([mlhPromise, devfolioPromise, h2sPromise]);

      const newCache = [...unstopResults, ...mlhResults, ...devfolioResults, ...h2sResults];

      if (newCache.length > 0) {
        this.cache = newCache;
        this.lastUpdated = new Date();
        logger.info(`Cache: Background refresh complete. Cached ${this.cache.length} events.`);
      } else {
        logger.warn('Cache: Background refresh returned 0 results. Keeping old cache.');
      }
    } catch (err: any) {
      logger.error('Cache: Background refresh failed completely:', err.message);
    } finally {
      this.isRefreshing = false;
    }
  }
}

export const globalCache = new HackathonCache();
