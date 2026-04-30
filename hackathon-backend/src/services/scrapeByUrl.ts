import { httpClient } from '../lib/httpClient';
import { logger } from '../lib/logger';
import { parseDate } from '../lib/dateParser';
import { NormalizedHackathon } from './normalizeHackathon';

/**
 * Detects which known platform a URL belongs to and scrapes the specific hackathon.
 * Returns null if the URL doesn't match any known platform (fall back to AI extraction).
 */
export async function scrapeByUrl(url: string): Promise<NormalizedHackathon | null> {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'unstop.com') return await scrapeUnstopByUrl(url, parsed);
    if (host === 'devfolio.co') return await scrapeDevfolioByUrl(url, parsed);
    if (host === 'hack.mlh.io' || host === 'mlh.io' || host.endsWith('.mlh.io')) return null; // AI fallback

    return null; // Unknown domain — caller falls back to AI extraction
  } catch (err: any) {
    logger.error('[scrapeByUrl] Error:', err.message);
    return null;
  }
}

// ─── Unstop ────────────────────────────────────────────────────────────────
// Handles all Unstop URL patterns:
//   https://unstop.com/hackathons/<slug>-<id>
//   https://unstop.com/competitions/<slug>-<id>
//   https://unstop.com/o/<shortcode>   ← share/referral short links
//
// API discovery (UNSTOP_TENZORX_2026_SCRAPE_DOCUMENTATION.md):
//   /api/public/competition/<short_id_or_numeric_id>  → res.data.data.competition
//   /api/public/opportunity/<numeric_id>              → res.data.data  (legacy)
async function scrapeUnstopByUrl(url: string, parsed: URL): Promise<NormalizedHackathon | null> {

  // ── Case 1: /o/<shortcode> share/referral links ───────────────────────
  if (parsed.pathname.startsWith('/o/')) {
    const shortCode = parsed.pathname.replace('/o/', '').split(/[?#]/)[0];
    logger.info(`[scrapeByUrl] Unstop: resolving short code "${shortCode}" via /api/public/competition/`);

    // Primary: the competition API accepts short codes directly (discovered from Angular bundle)
    try {
      const res = await httpClient.get(
        `https://unstop.com/api/public/competition/${shortCode}`,
        { headers: { Accept: 'application/json', Referer: url } }
      );
      const comp = res.data?.data?.competition;
      if (comp?.id && comp?.title) {
        logger.info(`[scrapeByUrl] Unstop: resolved "${shortCode}" → "${comp.title}" (ID ${comp.id})`);
        return normalizeUnstopCompetition(comp, url);
      }
    } catch (err: any) {
      logger.warn(`[scrapeByUrl] Unstop: competition API failed: ${err.message}`);
    }

    // Fallback: try the opportunity API (some entries are "opportunities" not "competitions")
    try {
      const res = await httpClient.get(
        `https://unstop.com/api/public/opportunity/${shortCode}`,
        { headers: { Accept: 'application/json', Referer: url } }
      );
      const item = res.data?.data || res.data;
      if (item?.id && item?.title) {
        return normalizeUnstopOpportunity(item, url);
      }
    } catch { /* give up */ }

    logger.warn(`[scrapeByUrl] Unstop: could not resolve short code "${shortCode}"`);
    return null;
  }

  // ── Case 2: Standard URLs with a numeric ID in the path ───────────────
  // e.g. /hackathons/some-hack-1234567  or  /competitions/some-hack-1234567
  const pathname = parsed.pathname;
  let id: string | null = null;

  // Extract the trailing numeric segment (5+ digits)
  const pathMatch = pathname.match(/[-/](\d{5,})(?:\/|$|\?)/);
  if (pathMatch) id = pathMatch[1];

  // Last resort: standalone segment that is all digits
  if (!id) {
    const segments = pathname.split('/').filter(Boolean);
    const found = [...segments].reverse().find(s => /^\d{5,}$/.test(s));
    if (found) id = found;
  }

  if (!id) {
    logger.warn('[scrapeByUrl] Unstop: could not extract numeric ID from URL:', url);
    return null;
  }

  logger.info(`[scrapeByUrl] Unstop: fetching by numeric ID ${id}`);

  // Try competition API first (richer data), then opportunity API
  try {
    const res = await httpClient.get(
      `https://unstop.com/api/public/competition/${id}`,
      { headers: { Accept: 'application/json', Referer: 'https://unstop.com/' } }
    );
    const comp = res.data?.data?.competition;
    if (comp?.id && comp?.title) return normalizeUnstopCompetition(comp, url);
  } catch { /* fall through */ }

  const res = await httpClient.get(
    `https://unstop.com/api/public/opportunity/${id}`,
    { headers: { Accept: 'application/json', Referer: 'https://unstop.com/' } }
  );
  const item = res.data?.data || res.data;
  if (!item?.id) return null;
  return normalizeUnstopOpportunity(item, url);
}

// ─── Unstop normalization helpers ──────────────────────────────────────────

function normalizeUnstopCompetition(comp: any, sourceUrl: string): NormalizedHackathon {
  const slug = comp.public_url || comp.seo_url || comp.id;
  const registrationUrl = `https://unstop.com/${slug}`;

  const rawTags: string[] = [];
  if (Array.isArray(comp.tags)) rawTags.push(...comp.tags.map((t: any) => typeof t === 'string' ? t : t.name));
  if (comp.workfunction?.name) rawTags.push(comp.workfunction.name);

  let prizeStr: string | undefined;
  if (comp.overall_prizes) {
    prizeStr = String(comp.overall_prizes);
  } else if (Array.isArray(comp.prizes) && comp.prizes.length > 0) {
    const p = comp.prizes[0];
    prizeStr = p.cash ? `₹${p.cash}` : (p.others || p.rank || undefined);
  }

  // Parse eligibility (JSON string)
  let eligibility: string | undefined;
  try {
    const raw = comp.regnRequirements?.eligibility;
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      eligibility = parsed.eligibilitySummery || parsed.summary || undefined;
    }
  } catch { /* ignore */ }

  // Strip HTML from description
  const description = comp.details
    ? comp.details.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : (comp.tagline || comp.short_description || undefined);

  return {
    source: 'unstop',
    source_id: String(comp.id),
    name: comp.title,
    organizer: comp.organisation?.name || 'Unstop',
    description: description || undefined,
    registration_url: registrationUrl,
    image_url: comp.logoUrl || comp.logoUrl2 || comp.thumb || comp.image || undefined,
    deadline: parseDate(comp.regnRequirements?.end_regn_dt || comp.end_date) || undefined,
    start_date: parseDate(comp.regnRequirements?.start_regn_dt || comp.start_date) || undefined,
    end_date: parseDate(comp.end_date || comp.end) || undefined,
    team_size_min: comp.regnRequirements?.min_team_size ?? undefined,
    team_size_max: comp.regnRequirements?.max_team_size ?? undefined,
    team_size: comp.regnRequirements?.max_team_size ?? undefined,
    mode: comp.region || 'online',
    location: comp.address_with_country_logo?.address || comp.city || undefined,
    prize: prizeStr,
    eligibility,
    tags: [...new Set(rawTags.filter(Boolean))],
    platform: 'Unstop',
  };
}

function normalizeUnstopOpportunity(item: any, _sourceUrl: string): NormalizedHackathon {
  const slug = item.public_url || item.seo_url || item.id;
  const registrationUrl = `https://unstop.com/${slug}`;

  const rawTags: string[] = [];
  if (Array.isArray(item.tags)) rawTags.push(...item.tags.map((t: any) => typeof t === 'string' ? t : t.name));
  if (item.workfunction?.name) rawTags.push(item.workfunction.name);

  let prizeStr: string | undefined;
  if (Array.isArray(item.prizes) && item.prizes.length > 0) {
    const p = item.prizes[0];
    prizeStr = p.cash ? `₹${p.cash}` : (p.others || p.rank || undefined);
  } else if (item.prize) {
    prizeStr = String(item.prize);
  }

  return {
    source: 'unstop',
    source_id: String(item.id),
    name: item.title,
    organizer: item.organisation?.name || 'Unstop',
    description: item.details || item.tagline || item.short_description,
    registration_url: registrationUrl,
    image_url: item.logoUrl2 || item.thumb || item.image || undefined,
    deadline: parseDate(item.regnRequirements?.end_regn_dt || item.end_date) || undefined,
    start_date: parseDate(item.regnRequirements?.start_regn_dt || item.start_date) || undefined,
    end_date: parseDate(item.end_date || item.end) || undefined,
    team_size_min: item.regnRequirements?.min_team_size ?? undefined,
    team_size_max: item.regnRequirements?.max_team_size ?? undefined,
    team_size: item.regnRequirements?.max_team_size ?? undefined,
    mode: item.region || item.opportunity_format?.toLowerCase() || 'online',
    location: item.address_with_country_logo?.address || item.city || undefined,
    prize: prizeStr,
    tags: [...new Set(rawTags.filter(Boolean))],
    platform: 'Unstop',
  };
}

// ─── Devfolio ──────────────────────────────────────────────────────────────
// URL pattern: https://devfolio.co/hackathons/<slug>  OR  https://<slug>.devfolio.co
async function scrapeDevfolioByUrl(url: string, parsed: URL): Promise<NormalizedHackathon | null> {
  let slug: string | null = null;
  const pathMatch = parsed.pathname.match(/^\/hackathons\/([^/]+)/);
  if (pathMatch) {
    slug = pathMatch[1];
  } else {
    const subdomainMatch = parsed.hostname.match(/^([^.]+)\.devfolio\.co$/);
    if (subdomainMatch && subdomainMatch[1] !== 'www') slug = subdomainMatch[1];
  }
  if (!slug) {
    logger.warn('[scrapeByUrl] Devfolio: could not extract slug from URL:', url);
    return null;
  }

  logger.info(`[scrapeByUrl] Devfolio: fetching detail for slug "${slug}"`);
  const res = await httpClient.get(`https://api.devfolio.co/api/hackathons/${slug}`, {
    headers: { Accept: 'application/json' },
  });

  const item = res.data;
  if (!item?.slug) return null;

  return {
    source: 'devfolio',
    source_id: item.slug,
    name: item.name || item.title,
    organizer: item.team_name || item.organizer || 'Devfolio',
    description: item.tagline || item.description,
    registration_url: `https://${item.slug}.devfolio.co/`,
    image_url: item.cover_image || item.logo,
    start_date: parseDate(item.starts_at || item.start_date) || undefined,
    end_date: parseDate(item.ends_at || item.end_date) || undefined,
    deadline: parseDate(item.registration_deadline || item.ends_at) || undefined,
    submission_deadline: parseDate(item.submission_deadline) || undefined,
    team_size: item.max_team_size || item.team_size_max || 4,
    mode: item.mode?.toLowerCase() || 'online',
    location: item.location || undefined,
    prize: item.prize_amount ? `₹${item.prize_amount}` : item.prize || undefined,
    tags: item.themes || item.tags || [],
    theme: item.themes?.[0] || undefined,
    platform: 'Devfolio',
  };
}
