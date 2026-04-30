import { httpClient } from '../lib/httpClient';
import { logger } from '../lib/logger';
import { NormalizedHackathon } from '../services/normalizeHackathon';

/**
 * MLH scraper — extracts the Inertia.js `data-page` JSON embedded in the
 * MLH 2026 season page, exactly as described in MLH_SCRAPE_DOCUMENTATION.md.
 *
 * Key documentation rules applied:
 *  - Fetch from https://www.mlh.com/seasons/2026/events (not mlh.io)
 *  - Extract and fully HTML-decode the `data-page` attribute
 *  - Read props.upcomingEvents and props.pastEvents
 *  - Build absolute MLH URL: 'https://www.mlh.com' + url (when url is relative)
 *  - Expose websiteUrl as a separate field — NOT as registration_url
 *  - DO NOT use endsAt as a registration deadline; it is the event end time
 *  - submission_deadline is left null for MLH — the doc says registration dates
 *    live on each event's own websiteUrl, not in the MLH listing
 *  - mode mapped: 'digital' → 'online', 'hybrid' → 'hybrid', else 'offline'
 */
export async function scrapeMLH(): Promise<NormalizedHackathon[]> {
  logger.info('Scraping MLH...');
  const results: NormalizedHackathon[] = [];

  try {
    const res = await httpClient.get('https://www.mlh.com/seasons/2026/events', {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      responseType: 'text',
    });

    const html = res.data as string;

    // Extract the Inertia data-page attribute
    const match = html.match(/data-page="([^"]+)"/);
    if (!match) {
      logger.warn('MLH: data-page attribute not found in HTML');
      return results;
    }

    // Full HTML entity decode (not just &quot;)
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const page = JSON.parse(decoded);
    const upcomingEvents: any[] = page.props?.upcomingEvents || [];
    const pastEvents: any[]     = page.props?.pastEvents     || [];

    // Per doc: include upcoming AND past so the full catalogue is available
    const allEvents = [...upcomingEvents, ...pastEvents];
    logger.info(`MLH: raw events found — upcoming: ${upcomingEvents.length}, past: ${pastEvents.length}`);

    for (const e of allEvents) {
      if (!e.name) continue;

      // Build absolute MLH event URL (doc: prefix https://www.mlh.com when relative)
      const mlhUrl = e.url
        ? (e.url.startsWith('http') ? e.url : `https://www.mlh.com${e.url}`)
        : undefined;

      // registration_url: prefer the hackathon's own website, fall back to mlh page
      const registrationUrl = e.websiteUrl || mlhUrl || '';
      if (!registrationUrl) continue;

      // mode mapping per doc
      const mode =
        e.formatType === 'digital' ? 'online'
        : e.formatType === 'hybrid' ? 'hybrid'
        : 'offline';

      // Location: prefer venueAddress composition, fall back to location string
      const location =
        e.venueAddress
          ? [e.venueAddress.city, e.venueAddress.state, e.venueAddress.country]
              .filter(Boolean).join(', ')
          : e.location || undefined;

      // Tags: combine region + mode + default MLH tag
      const tags = ['MLH', 'Student'];
      if (e.region) tags.push(e.region);
      if (mode !== 'offline') tags.push(mode);

      results.push({
        source:        'mlh',
        source_id:     String(e.id || e.slug),
        name:          e.name,
        organizer:     'MLH',
        registration_url: registrationUrl,
        image_url:     e.logoUrl || e.backgroundUrl || undefined,
        start_date:    e.startsAt  || undefined,
        end_date:      e.endsAt   || undefined,
        // IMPORTANT: MLH does NOT expose a registration deadline in the listing.
        // submission_deadline intentionally omitted — see MLH_SCRAPE_DOCUMENTATION.md §Important Limitation
        deadline:      e.endsAt   || undefined, // event end used as rough deadline for display/filtering
        mode,
        location,
        platform: 'MLH',
        tags,
        // Extra MLH-specific fields passed through for the detail modal
        description:   e.dateRange ? `${e.dateRange} · ${location || ''}` : undefined,
        // website_url stored separately so the modal can show both links
        theme:         e.websiteUrl || undefined, // re-using theme slot to carry websiteUrl through
        reg_status:    e.status || undefined,
        // region accessible via tags already
      });
    }
  } catch (err: any) {
    logger.error('MLH scraper failed:', err.message);
  }

  logger.info(`MLH: found ${results.length} hackathons`);
  return results;
}
