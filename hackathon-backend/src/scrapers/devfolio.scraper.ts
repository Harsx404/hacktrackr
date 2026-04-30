import { httpClient } from '../lib/httpClient';
import { logger } from '../lib/logger';
import { parseDate } from '../lib/dateParser';
import { NormalizedHackathon } from '../services/normalizeHackathon';

const DEVFOLIO_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/**
 * Scrapes Devfolio for open hackathons.
 *
 * Strategy (per DEVFOLIO_SCRAPE_DOCUMENTATION.md):
 *   1. Fetch https://devfolio.co/hackathons — extract __NEXT_DATA__ JSON
 *   2. Pull open_hackathons slugs from the embedded page props
 *   3. For each slug, fetch https://<slug>.devfolio.co/ and extract __NEXT_DATA__
 *   4. Return normalized records
 *
 * Falls back to the public REST API (/api/hackathons) if __NEXT_DATA__ parsing fails.
 */
export async function scrapeDevfolio(): Promise<NormalizedHackathon[]> {
  logger.info('Scraping Devfolio...');
  const results: NormalizedHackathon[] = [];

  try {
    // ── Step 1: Fetch the listing page and extract __NEXT_DATA__ ─────────
    const listingRes = await httpClient.get('https://devfolio.co/hackathons', {
      headers: DEVFOLIO_HEADERS,
    });

    const html: string = typeof listingRes.data === 'string' ? listingRes.data : '';
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

    if (!nextDataMatch) {
      logger.warn('Devfolio: __NEXT_DATA__ not found on listing page, falling back to REST API');
      return scrapeDevfolioViaApi();
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const pageData = nextData?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data;

    if (!pageData) {
      logger.warn('Devfolio: Could not find pageProps data in __NEXT_DATA__, falling back');
      return scrapeDevfolioViaApi();
    }

    // Collect open + featured hackathons
    const openItems: any[] = [
      ...(pageData.open_hackathons || []),
      ...(pageData.featured_hackathons || []),
      ...(pageData.upcoming_hackathons || []),
    ];

    // Deduplicate by slug
    const seen = new Set<string>();
    const uniqueItems = openItems.filter(item => {
      if (!item?.slug || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    });

    logger.info(`Devfolio: found ${uniqueItems.length} listings from __NEXT_DATA__`);

    // ── Step 2: Fetch details for each slug ──────────────────────────────
    const BATCH = 5;
    for (let i = 0; i < uniqueItems.length; i += BATCH) {
      const batch = uniqueItems.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(item => fetchDevfolioDetail(item.slug))
      );

      for (let j = 0; j < batch.length; j++) {
        const listing = batch[j];
        const res = settled[j];

        // Use detail if available, otherwise fall back to listing data
        const detail = res.status === 'fulfilled' ? res.value : null;
        const item = detail || listing;

        const slug = item.slug || listing.slug;
        if (!slug) continue;

        const mode = item.is_online ? 'online' : 'offline';
        const themes: string[] = (item.themes || []).map((t: any) =>
          typeof t === 'string' ? t : t?.theme?.name || t?.name || ''
        ).filter(Boolean);

        results.push({
          source: 'devfolio',
          source_id: slug,
          name: item.name || item.title || listing.name,
          organizer: item.team_name || item.organizer || 'Devfolio',
          description: stripMarkdown(item.desc || item.tagline || listing.tagline) || undefined,
          registration_url: `https://${slug}.devfolio.co/`,
          image_url: item.cover_img || item.cover_image || item.logo || listing.cover_img,
          start_date: parseDate(item.starts_at || item.start_date || listing.starts_at) || undefined,
          end_date: parseDate(item.ends_at || item.end_date || listing.ends_at) || undefined,
          deadline: parseDate(
            item.settings?.reg_ends_at || item.registration_deadline || listing.settings?.reg_ends_at || item.ends_at
          ) || undefined,
          submission_deadline: parseDate(item.submission_deadline) || undefined,
          team_size: item.max_team_size || item.team_size_max || listing.max_team_size || 4,
          mode,
          location: mode === 'offline' ? (item.location || listing.location || item.country) : undefined,
          prize: item.prize_amount ? `₹${item.prize_amount}` : item.prize || undefined,
          tags: themes,
          theme: themes[0] || item.apply_mode || undefined,
          platform: 'Devfolio',
        });
      }
    }
  } catch (err: any) {
    logger.error('Devfolio scraper failed:', err.message);
    // Fall back to REST API
    return scrapeDevfolioViaApi();
  }

  logger.info(`Devfolio: found ${results.length} hackathons`);
  return results;
}

// ─── Detail fetch via subdomain __NEXT_DATA__ ──────────────────────────────

async function fetchDevfolioDetail(slug: string): Promise<any | null> {
  try {
    const res = await httpClient.get(`https://${slug}.devfolio.co/`, {
      headers: DEVFOLIO_HEADERS,
      timeout: 12000,
    });

    const html: string = typeof res.data === 'string' ? res.data : '';
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return null;

    const nextData = JSON.parse(match[1]);
    const queries: any[] = nextData?.props?.pageProps?.dehydratedState?.queries || [];

    // Find the query that has the hackathon object
    for (const q of queries) {
      const qdata = q?.state?.data;
      if (!qdata) continue;

      // It can be an array of parts or a direct object
      const parts: any[] = Array.isArray(qdata) ? qdata : [qdata];
      for (const part of parts) {
        const hackathons: any[] = Array.isArray(part?.hackathons) ? part.hackathons : [];
        if (hackathons.length > 0) return hackathons[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── REST API fallback ─────────────────────────────────────────────────────

async function scrapeDevfolioViaApi(): Promise<NormalizedHackathon[]> {
  const results: NormalizedHackathon[] = [];
  try {
    const res = await httpClient.get('https://api.devfolio.co/api/hackathons', {
      params: { sort: 'published_at.desc', page: 1, count: 30, status: 'open' },
      headers: { 'Accept': 'application/json' },
    });

    const items: any[] = res.data?.results || res.data?.hackathons || [];
    for (const item of items) {
      if (!item.slug) continue;
      const mode = item.mode?.toLowerCase() || (item.is_online ? 'online' : 'offline');
      const themes: string[] = (item.themes || []).map((t: any) =>
        typeof t === 'string' ? t : t?.theme?.name || t?.name || ''
      ).filter(Boolean);

      results.push({
        source: 'devfolio',
        source_id: item.slug,
        name: item.name || item.title,
        organizer: item.team_name || item.organizer || 'Devfolio',
        description: stripMarkdown(item.tagline || item.description) || undefined,
        registration_url: `https://${item.slug}.devfolio.co/`,
        image_url: item.cover_image || item.logo,
        start_date: parseDate(item.starts_at || item.start_date) || undefined,
        end_date: parseDate(item.ends_at || item.end_date) || undefined,
        deadline: parseDate(item.registration_deadline || item.ends_at) || undefined,
        submission_deadline: parseDate(item.submission_deadline) || undefined,
        team_size: item.max_team_size || item.team_size_max || 4,
        mode,
        location: mode === 'offline' ? item.location : undefined,
        prize: item.prize_amount ? `₹${item.prize_amount}` : item.prize || undefined,
        tags: themes,
        theme: themes[0] || undefined,
        platform: 'Devfolio',
      });
    }
  } catch (err: any) {
    logger.error('Devfolio REST API fallback failed:', err.message);
  }
  logger.info(`Devfolio (REST fallback): found ${results.length} hackathons`);
  return results;
}

// ─── Markdown strip helper ────────────────────────────────────────────────

function stripMarkdown(s?: string | null): string | null {
  if (!s) return null;
  const t = s
    .replace(/\r?\n/g, ' ')
    .replace(/\*\*|__|`|>|#{1,6}\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 500 ? t.slice(0, 500) + '...' : t || null;
}
