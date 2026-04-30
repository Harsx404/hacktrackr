import * as cheerio from 'cheerio';
import { httpClient } from '../lib/httpClient';
import { ollamaChat } from '../lib/ollamaClient';
import { logger } from '../lib/logger';
import { NormalizedHackathon } from './normalizeHackathon';

const SYSTEM_PROMPT = `You are a hackathon data extractor. Given raw webpage text, extract hackathon details.
Respond ONLY with a single valid JSON object matching this shape exactly:
{
  "name": "string",
  "organizer": "string",
  "description": "string",
  "registration_url": "string — the main URL of the hackathon page",
  "start_date": "ISO 8601 or empty string",
  "end_date": "ISO 8601 or empty string",
  "deadline": "ISO 8601 registration deadline or empty string",
  "submission_deadline": "ISO 8601 or empty string",
  "team_size": number or 0,
  "mode": "online or offline or hybrid or empty string",
  "location": "string or empty string",
  "prize": "string or empty string",
  "tags": ["array", "of", "tags"],
  "eligibility": "string or empty string",
  "theme": "string or empty string"
}`;

/**
 * Fetches a URL, strips HTML to plain text, runs AI extraction.
 * Returns a NormalizedHackathon ready for preview/save.
 */
export async function extractFromUrl(url: string): Promise<NormalizedHackathon> {
  logger.info(`Extracting from URL: ${url}`);

  // 1. Fetch page
  let html: string;
  try {
    const res = await httpClient.get(url);
    html = res.data as string;
  } catch (err: any) {
    throw new Error(`Failed to fetch URL: ${err.message}`);
  }

  // 2. Strip to readable text using cheerio
  const $ = cheerio.load(html);
  // Remove noise
  $('script, style, nav, footer, header, noscript, iframe, [class*="cookie"], [class*="banner"]').remove();

  const rawText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000); // cap at 8k chars

  if (rawText.length < 100) {
    throw new Error('Page content is too short or heavily JS-rendered. Try pasting the text manually.');
  }

  // 3. AI extraction
  let parsed: NormalizedHackathon;
  try {
    const raw = await ollamaChat(
      SYSTEM_PROMPT,
      `Extract hackathon details from this webpage text. The page URL is: ${url}\n\n${rawText}`
    );
    parsed = JSON.parse(raw) as NormalizedHackathon;
  } catch (err: any) {
    throw new Error(`AI extraction failed: ${err.message}`);
  }

  // 4. Ensure registration_url is set
  if (!parsed.registration_url) parsed.registration_url = url;
  parsed.source = 'url_import';

  return parsed;
}
