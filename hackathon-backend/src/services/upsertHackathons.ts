import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { NormalizedHackathon, toSupabaseRow } from './normalizeHackathon';

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Deduplicates by registration_url and upserts each hackathon into Supabase.
 * Also auto-generates default tasks for new hackathons.
 */
export async function upsertHackathons(hackathons: NormalizedHackathon[]): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const h of hackathons) {
    if (!h.registration_url || !h.name) {
      logger.warn('Skipping hackathon with missing name or registration_url', h);
      result.skipped++;
      continue;
    }

    try {
      const row = toSupabaseRow(h);

      // Check if exists
      const { data: existing } = await supabase
        .from('hackathons')
        .select('id')
        .eq('registration_url', h.registration_url)
        .maybeSingle();

      if (existing) {
        // Update
        await supabase
          .from('hackathons')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        result.updated++;
      } else {
        // Insert
        const { data: newHack, error } = await supabase
          .from('hackathons')
          .insert(row)
          .select('id, name, deadline')
          .single();

        if (error) throw error;
        result.inserted++;

        // Auto-generate checklist tasks only for user-created hackathons
        if (newHack && row.user_id) {
          await generateDefaultTasks(newHack.id, newHack.deadline, row.user_id as string);
        }
      }
    } catch (err: any) {
      logger.error(`Failed to upsert "${h.name}":`, err.message);
      result.errors++;
    }
  }

  logger.info(`Upsert complete — inserted: ${result.inserted}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors}`);
  return result;
}

async function generateDefaultTasks(hackathonId: string, deadline: string | null, userId: string) {
  const tasks = [
    'Register for hackathon',
    'Form or join a team',
    'Read problem statement / theme',
    'Submit initial idea / proposal',
    'Build MVP prototype',
    'Upload to GitHub repository',
    'Prepare demo video',
    'Write README and documentation',
    'Submit final project',
    'Attend judging or presentation',
  ];

  const rows = tasks.map((title, i) => ({
    hackathon_id: hackathonId,
    user_id: userId,
    title,
    // Spread tasks: each one 1 day earlier than the deadline
    due_date: deadline
      ? new Date(new Date(deadline).getTime() - (tasks.length - i) * 86_400_000).toISOString()
      : null,
  }));

  const { error } = await supabase.from('tasks').insert(rows);
  if (error) logger.warn(`Could not insert default tasks for ${hackathonId}:`, error.message);
}
