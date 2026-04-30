import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { NormalizedHackathon } from './normalizeHackathon';

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Maps a source name to its Supabase table.
 * Adding a new platform = add one entry here + create its migration table.
 */
const SOURCE_TABLE: Record<string, string> = {
  mlh:      'mlh_hackathons',
  unstop:   'unstop_hackathons',
  devfolio: 'devfolio_hackathons',
};

/**
 * Converts a NormalizedHackathon to the shape expected by each platform table.
 */
function toSourceRow(source: string, h: NormalizedHackathon): Record<string, unknown> {
  const base = {
    source_id:          h.source_id!,
    name:               h.name,
    registration_url:   h.registration_url,
    image_url:          h.image_url ?? null,
    mode:               h.mode ?? null,
    location:           h.location ?? null,
    prize:              h.prize ?? null,
    tags:               h.tags ?? null,
    platform:           h.platform ?? source.toUpperCase(),
    updated_at:         new Date().toISOString(),
  };

  if (source === 'mlh') {
    return {
      ...base,
      start_date:          h.start_date ?? null,
      end_date:            h.end_date ?? null,
      submission_deadline: h.submission_deadline ?? h.end_date ?? null,
    };
  }

  if (source === 'unstop') {
    return {
      ...base,
      organizer:           h.organizer ?? null,
      description:         h.description ?? null,
      reg_start_date:      h.start_date ?? null,
      reg_end_date:        h.deadline ?? null,
      end_date:            h.end_date ?? null,
      submission_deadline: h.deadline ?? h.end_date ?? null, // for the unified view
      team_size_min:       h.team_size_min ?? null,
      team_size_max:       h.team_size_max ?? h.team_size ?? null,
      reg_status:          h.reg_status ?? null,
    };
  }

  if (source === 'devfolio') {
    return {
      ...base,
      organizer:           h.organizer ?? null,
      description:         h.description ?? null,
      start_date:          h.start_date ?? null,
      end_date:            h.end_date ?? null,
      submission_deadline: h.submission_deadline ?? h.deadline ?? null,
    };
  }

  return base;
}

/**
 * Upserts scraped hackathons into the correct platform-specific table.
 * Deduplicates by `source_id`.
 */
export async function upsertToSource(
  source: string,
  hackathons: NormalizedHackathon[]
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  const table = SOURCE_TABLE[source];
  if (!table) {
    logger.error(`Unknown source "${source}" — add it to SOURCE_TABLE in upsertToSource.ts`);
    return result;
  }

  for (const h of hackathons) {
    if (!h.source_id || !h.name) {
      logger.warn(`[${source}] Skipping hackathon with missing source_id or name`, h);
      result.skipped++;
      continue;
    }

    try {
      const row = toSourceRow(source, h);

      const { data: existing } = await supabase
        .from(table)
        .select('id')
        .eq('source_id', h.source_id)
        .maybeSingle();

      if (existing) {
        await supabase.from(table).update(row).eq('id', existing.id);
        result.updated++;
      } else {
        const { error } = await supabase.from(table).insert(row);
        if (error) {
          logger.error(`[${source}] Insert error for "${h.name}":`, error.message);
          result.errors++;
        } else {
          result.inserted++;
        }
      }
    } catch (err: any) {
      logger.error(`[${source}] Unexpected error for "${h.name}":`, err.message);
      result.errors++;
    }
  }

  logger.info(`[${source}] Upsert — inserted: ${result.inserted}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors}`);
  return result;
}
