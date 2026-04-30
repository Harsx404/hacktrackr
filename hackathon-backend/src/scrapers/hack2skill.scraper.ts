import { httpClient } from '../lib/httpClient';
import { logger } from '../lib/logger';
import { parseDate } from '../lib/dateParser';
import { NormalizedHackathon } from '../services/normalizeHackathon';

const API_BASE = 'https://hack2skill.com/api/v1';
const LISTING_URL = `${API_BASE}/innovator/public/event/public-list`;

const H2S_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://hack2skill.com',
  'Referer': 'https://hack2skill.com/hackathons-listing',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

interface H2SListingItem {
  _id: string;
  eventUrl: string;
  title: string;
  thumbnail?: string;
  registrationStart?: string;
  registrationEnd?: string;
  submissionStart?: string;
  submissionEnd?: string;
  ticket?: string;
  mode?: string;
  participation?: string;
  flag?: string;
  index?: number;
}

interface H2SDetail {
  type?: string;
  status?: string;
  logo?: string;
  title?: string;
  registrationStart?: string;
  registrationEnd?: string;
  submissionStart?: string;
  submissionEnd?: string;
  tags?: {
    mode?: { value?: string };
    ticket?: { value?: string };
    teamSize?: { min?: number; max?: number };
    technology?: { value?: string[] };
    region?: { value?: string[] };
  };
  sections?: Array<{
    type: string;
    isHidden?: boolean;
    category?: Array<{
      data?: Array<{
        title?: string;
        description?: string;
        type?: string;
        start?: string;
        end?: string;
      }>;
    }>;
  }>;
}

/**
 * Scrapes Hack2Skill for open hackathons using their public listing + detail APIs.
 * Only returns records with type=HACKATHON and open registration.
 */
export async function scrapeHack2Skill(): Promise<NormalizedHackathon[]> {
  logger.info('Scraping Hack2Skill...');
  const results: NormalizedHackathon[] = [];

  try {
    // ─── Step 1: Fetch all listing pages ────────────────────────────────
    const now = new Date();
    const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ago
    const end   = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ahead

    const allListings: H2SListingItem[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const params = new URLSearchParams({
        page: String(page),
        records: '100',
        search: '',
        start,
        end,
      });

      const res = await httpClient.get(`${LISTING_URL}?${params}`, { headers: H2S_HEADERS });
      if (!res.data?.success) break;

      totalPages = Number(res.data.pages || 1);
      allListings.push(...(res.data.data || []));
      page += 1;

      // Safety cap: never fetch more than 5 pages (~500 records)
      if (page > 5) break;
    }

    logger.info(`Hack2Skill: fetched ${allListings.length} listing records across ${Math.min(totalPages, 5)} pages`);

    // ─── Step 2: Filter to open-registration records ─────────────────────
    const openListings = allListings.filter(item =>
      item.registrationEnd && new Date(item.registrationEnd) >= now
    );

    logger.info(`Hack2Skill: ${openListings.length} records with open registration`);

    // ─── Step 3: Fetch detail for each open record ───────────────────────
    // Run in small batches of 5 concurrently to avoid rate limiting
    const BATCH = 5;
    for (let i = 0; i < openListings.length; i += BATCH) {
      const batch = openListings.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(item => fetchH2SDetail(item.eventUrl))
      );

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const res = settled[j];

        if (res.status !== 'fulfilled' || !res.value) continue;
        const detail = res.value;

        // Only include HACKATHON type records
        if (detail.type && detail.type !== 'HACKATHON') continue;
        if (detail.status && detail.status !== 'APPROVED') continue;

        const description = extractH2SDescription(detail);
        const mode = normalizeMode(detail.tags?.mode?.value || item.mode);

        results.push({
          source: 'hack2skill',
          source_id: item._id,
          name: detail.title || item.title,
          organizer: 'Hack2Skill',
          description: description || undefined,
          registration_url: `https://hack2skill.com/event/${item.eventUrl}/`,
          image_url: detail.logo || item.thumbnail || undefined,
          deadline: parseDate(detail.registrationEnd || item.registrationEnd) || undefined,
          start_date: parseDate(item.registrationStart || detail.registrationStart) || undefined,
          end_date: parseDate(item.submissionEnd || detail.submissionEnd) || undefined,
          submission_deadline: parseDate(item.submissionEnd || detail.submissionEnd) || undefined,
          team_size_min: detail.tags?.teamSize?.min ?? undefined,
          team_size_max: detail.tags?.teamSize?.max ?? undefined,
          team_size: detail.tags?.teamSize?.max ?? undefined,
          mode,
          location: mode === 'offline' ? extractH2SVenue(detail) : undefined,
          prize: extractH2SPrize(detail),
          tags: detail.tags?.technology?.value?.filter(Boolean) ?? [],
          platform: 'Hack2Skill',
        });
      }
    }
  } catch (err: any) {
    logger.error('Hack2Skill scraper failed:', err.message);
  }

  logger.info(`Hack2Skill: found ${results.length} hackathons`);
  return results;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchH2SDetail(eventUrl: string): Promise<H2SDetail | null> {
  try {
    const res = await httpClient.get(
      `${API_BASE}/event/${eventUrl}/event-details`,
      { headers: H2S_HEADERS }
    );
    if (!res.data?.success) return null;
    return res.data.data as H2SDetail;
  } catch {
    return null;
  }
}

function normalizeMode(raw?: string): string {
  if (!raw) return 'online';
  const v = raw.toUpperCase();
  if (v === 'IN_PERSON') return 'offline';
  if (v === 'VIRTUAL') return 'online';
  if (v === 'HYBRID') return 'hybrid';
  return 'online';
}

function extractH2SDescription(detail: H2SDetail): string | null {
  const sections = detail.sections || [];
  const aboutSection = sections.find(s => s.type === 'ABOUT' && !s.isHidden)
    || sections.find(s => s.type === 'OVERVIEW' && !s.isHidden);
  if (!aboutSection) return null;

  const parts: string[] = [];
  for (const cat of aboutSection.category || []) {
    for (const d of cat.data || []) {
      if (d.description) {
        const cleaned = d.description
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned) parts.push(cleaned);
      }
    }
  }
  const joined = parts.join(' ').trim();
  return joined.length > 500 ? joined.slice(0, 500) + '...' : joined || null;
}

function extractH2SVenue(detail: H2SDetail): string | undefined {
  // Look for venue info in the ABOUT or OVERVIEW sections
  const sections = detail.sections || [];
  for (const s of sections) {
    if (s.isHidden) continue;
    for (const cat of s.category || []) {
      for (const d of cat.data || []) {
        if (d.title?.toLowerCase().includes('venue') || d.title?.toLowerCase().includes('location')) {
          return d.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
    }
  }
  return undefined;
}

function extractH2SPrize(detail: H2SDetail): string | undefined {
  const sections = detail.sections || [];
  const prizeSection = sections.find(s => s.type === 'PRIZES' && !s.isHidden);
  if (!prizeSection) return undefined;

  const parts: string[] = [];
  for (const cat of prizeSection.category || []) {
    for (const d of cat.data || []) {
      if (d.title) parts.push(d.title);
    }
  }
  return parts.length > 0 ? parts.slice(0, 3).join(', ') : undefined;
}
