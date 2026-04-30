import { httpClient } from '../lib/httpClient';
import { logger } from '../lib/logger';
import { parseDate } from '../lib/dateParser';
import { NormalizedHackathon } from '../services/normalizeHackathon';

/**
 * Unstop scraper — uses Unstop's public search API.
 * No auth required for public listings.
 *
 * To add more sources, follow the same pattern:
 * 1. Create src/scrapers/<platform>.scraper.ts
 * 2. Export a scrapeXxx() function returning NormalizedHackathon[]
 * 3. Import and call it in src/jobs/syncHackathons.ts
 */
export async function scrapeUnstop(page = 1, perPage = 15): Promise<NormalizedHackathon[]> {
  logger.info(`Scraping Unstop (page ${page})...`);
  const results: NormalizedHackathon[] = [];

  try {
    const res = await httpClient.get('https://unstop.com/api/public/opportunity/search-result', {
      params: {
        opportunity: 'hackathons',
        per_page: perPage,
        page,
        status: 'open',
      },
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://unstop.com/',
      },
    });

    const items: any[] = res.data?.data?.data || res.data?.data || [];

    for (const item of items) {
      if (!item.id || !item.title) continue;
      
      // Filter out finished events even if the endpoint returned them
      if (item.regnRequirements?.reg_status === 'FINISHED') continue;

      const slug = item.public_url || item.seo_url || item.id;
      const url = `https://unstop.com/${slug}`;

      // Combine tags
      const rawTags: string[] = [];
      if (Array.isArray(item.tags)) {
        rawTags.push(...item.tags.map((t: any) => typeof t === 'string' ? t : t.name));
      }
      if (item.workfunction?.name) {
        rawTags.push(item.workfunction.name);
      }
      const tags = [...new Set(rawTags.filter(Boolean))];

      // Prize
      let prizeStr = undefined;
      if (Array.isArray(item.prizes) && item.prizes.length > 0) {
        const p = item.prizes[0];
        prizeStr = p.cash ? `₹${p.cash}` : (p.others || p.rank || undefined);
      } else if (item.prize) {
        prizeStr = String(item.prize);
      }

      // Eligibility — API returns it as a JSON string, parse it to a readable summary
      let eligibilityStr: string | undefined;
      try {
        const rawElig = item.regnRequirements?.eligibility;
        if (rawElig) {
          const parsed = typeof rawElig === 'string' ? JSON.parse(rawElig) : rawElig;
          const sectors: string[] = [];
          if (parsed.sector?.includes('students')) sectors.push('Students');
          if (parsed.experience?.length && !parsed.experience.includes('all')) sectors.push('Professionals');
          if (parsed.others?.includes('all') || sectors.length === 0) sectors.push('Open to all');
          eligibilityStr = sectors.join(', ');
        }
      } catch {
        eligibilityStr = undefined;
      }

      results.push({
        source: 'unstop',
        source_id: String(item.id),
        name: item.title,
        organizer: item.organisation?.name || item.organizer || 'Unstop',
        description: item.details || item.tagline || item.short_description,
        registration_url: url,
        image_url: item.logoUrl2 || item.thumb || item.image || undefined,
        deadline: parseDate(item.regnRequirements?.end_regn_dt || item.end_date || item.registration_deadline) || undefined,
        start_date: parseDate(item.regnRequirements?.start_regn_dt || item.start_date || item.start) || undefined,
        end_date: parseDate(item.end_date || item.end) || undefined,
        team_size_min: item.regnRequirements?.min_team_size ?? undefined,
        team_size_max: item.regnRequirements?.max_team_size ?? undefined,
        team_size: item.regnRequirements?.max_team_size ?? undefined,
        mode: item.region || item.opportunity_format?.toLowerCase() || 'online',
        location: item.address_with_country_logo?.address || item.city || item.location || undefined,
        prize: prizeStr,
        tags: tags,
        platform: 'Unstop',
        reg_status: item.regnRequirements?.reg_status || undefined,
        // Correctly extract numeric days remaining (not the "9 days left" string)
        remain_days: item.regnRequirements?.remainingDaysArray?.durations ?? undefined,
        register_count: item.registerCount ?? undefined,
        eligibility: eligibilityStr,
      });
    }
  } catch (err: any) {
    logger.error('Unstop scraper failed:', err.message);
  }

  logger.info(`Unstop: found ${results.length} hackathons`);
  return results;
}
