import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { extractFromUrl } from './services/extractFromUrl';
import { generateAiPlan } from './services/generateAiPlan';
import { scrapeByUrl } from './services/scrapeByUrl';
import { upsertHackathons } from './services/upsertHackathons';
import { scrapeUnstop } from './scrapers/unstop.scraper';
import { scrapeMLH } from './scrapers/mlh.scraper';
import { scrapeDevfolio } from './scrapers/devfolio.scraper';
import { globalCache } from './services/cache';
import { logger } from './lib/logger';
import { supabase } from './lib/supabase';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const CRON_SECRET = process.env.CRON_SECRET || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'hacktrackr-backend', time: new Date().toISOString() });
});

// ─── URL extraction ─────────────────────────────────────────────────────────
/**
 * POST /api/extract
 * Body: { url: string }
 * Returns: NormalizedHackathon
 *
 * Called from the mobile "Add Hackathon" → URL tab.
 * Fetches the page, strips HTML, runs AI extraction.
 */
app.post('/api/extract', async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  try {
    // 1. Try platform-specific scraper first (richer, faster, no AI tokens needed)
    const scraped = await scrapeByUrl(url);
    if (scraped) {
      logger.info(`[extract] Used platform scraper for: ${scraped.platform}`);
      return res.json({ ok: true, data: scraped, scraped: true });
    }

    // 2. Fall back to AI-based generic extraction
    logger.info(`[extract] No platform scraper matched, using AI extraction for: ${url}`);
    const hackathon = await extractFromUrl(url);
    return res.json({ ok: true, data: hackathon, scraped: false });
  } catch (err: any) {
    logger.error('/api/extract error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── AI Planning Engine ────────────────────────────────────────────────────
/**
 * POST /api/ai-plan
 * Body: { hackathon_id: string, user_id: string, data: any }
 * Generates AI tasks, deliverables, milestones, and idea recommendations.
 * Returns 202 immediately, then inserts into Supabase in the background.
 */
app.post('/api/ai-plan', async (req, res) => {
  const { hackathon_id, user_id, data } = req.body;
  if (!hackathon_id || !user_id || !data) {
    return res.status(400).json({ error: 'Missing: hackathon_id, user_id, data' });
  }

  // Respond immediately — we do the heavy lifting in the background
  res.json({ ok: true, status: 'processing' });

  (async () => {
    try {
      logger.info(`[ai-plan] Starting AI generation for hackathon: ${hackathon_id}`);

      // Clear old recommendations first so polling can detect a fresh UPDATE
      await supabase.from('hackathons').update({ ai_recommendations: null }).eq('id', hackathon_id);

      const plan = await generateAiPlan(data);
      logger.info(`[ai-plan] AI generated: ${plan.tasks.length}t ${plan.deliverables.length}d ${plan.milestones.length}m ${plan.ideas.length}i`);

      // 1. Tasks
      if (plan.tasks.length > 0) {
        const { error: taskErr } = await supabase.from('tasks').insert(
          plan.tasks.map(t => ({ hackathon_id, user_id, title: t, status: 'todo' }))
        );
        if (taskErr) logger.error('[ai-plan] tasks insert error:', taskErr.message);
        else logger.info('[ai-plan] tasks inserted ✓');
      }

      // 2. Deliverables (checklist_items)
      if (plan.deliverables.length > 0) {
        const { error: checkErr } = await supabase.from('checklist_items').insert(
          plan.deliverables.map(d => ({ hackathon_id, user_id, title: d, is_completed: false }))
        );
        if (checkErr) logger.error('[ai-plan] checklist insert error:', checkErr.message);
        else logger.info('[ai-plan] checklist items inserted ✓');
      }

      // 3. Milestones
      if (plan.milestones.length > 0) {
        const { error: mileErr } = await supabase.from('milestones').insert(
          plan.milestones.map(m => {
            const due = new Date();
            due.setDate(due.getDate() + (m.offset_days || 3));
            return { hackathon_id, user_id, title: m.title, due_date: due.toISOString().split('T')[0] };
          })
        );
        if (mileErr) logger.error('[ai-plan] milestones insert error:', mileErr.message);
        else logger.info('[ai-plan] milestones inserted ✓');
      }

      // 4. AI Recommendations — stored as JSONB on hackathon row
      if (plan.ideas.length > 0) {
        const { error: ideaErr } = await supabase
          .from('hackathons')
          .update({ ai_recommendations: plan.ideas })
          .eq('id', hackathon_id);
        if (ideaErr) logger.error('[ai-plan] ai_recommendations update error:', ideaErr.message);
        else logger.info('[ai-plan] ai_recommendations updated ✓');
      }

      logger.info(`[ai-plan] DONE for ${hackathon_id}`);
    } catch (err: any) {
      logger.error('[ai-plan] FATAL background error:', err.message, err.stack);
    }
  })();
});

// ─── Save extracted hackathon ────────────────────────────────────────────────
/**
 * POST /api/save
 * Body: NormalizedHackathon (after user edits preview)
 * Upserts into Supabase.
 */
app.post('/api/save', async (req, res) => {
  const hackathon = req.body;
  if (!hackathon?.name || !hackathon?.registration_url) {
    return res.status(400).json({ error: 'name and registration_url are required.' });
  }

  try {
    const result = await upsertHackathons([hackathon]);
    return res.json({ ok: true, result });
  } catch (err: any) {
    logger.error('/api/save error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Live Discover endpoint (Cached) ───────────────────────────────────
/**
 * GET /api/discover?source=all&page=1&per_page=15&mode=online&has_prize=true
 * Returns hackathons instantly from the in-memory cache.
 */
app.get('/api/discover', async (req, res) => {
  const source   = (req.query.source   as string) || 'all';
  const mode     = (req.query.mode     as string) || 'all';
  const hasPrize = (req.query.has_prize === 'true');
  const page     = parseInt(req.query.page     as string) || 1;
  const perPage  = parseInt(req.query.per_page as string) || 15;
  const now      = new Date();

  try {
    let all = globalCache.get();

    // 1. Filter by Source
    if (source !== 'all') {
      all = all.filter(h => h.source === source);
    }

    // 2. Filter by Mode
    if (mode === 'online') {
      all = all.filter(h => h.mode === 'online' || h.mode === 'hybrid');
    } else if (mode === 'offline') {
      all = all.filter(h => h.mode === 'offline' || h.mode === 'hybrid');
    }

    // 3. Filter by Prize
    if (hasPrize) {
      all = all.filter(h => !!h.prize);
    }

    // 4. Filter out expired (allow up to 30 days in the past)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    all = all.filter(h => {
      const endDate  = h.end_date || h.deadline || h.submission_deadline;
      const startDate = h.start_date;
      if (endDate)   return new Date(endDate) >= thirtyDaysAgo;
      if (startDate) return new Date(startDate) >= thirtyDaysAgo;
      return false;
    });

    // 5. Sort
    all.sort((a, b) => {
      const da = new Date(a.deadline || a.submission_deadline || a.start_date || a.end_date || 0).getTime();
      const db = new Date(b.deadline || b.submission_deadline || b.start_date || b.end_date || 0).getTime();
      return da - db;
    });

    // 6. Paginate slice
    const start = (page - 1) * perPage;
    const paginated = all.slice(start, start + perPage);

    // FIRE AND FORGET: Auto-update any saved personal hackathons that match these live results
    if (paginated.length > 0) {
      autoUpdateSavedHackathons(paginated).catch(err => logger.error('Auto-update failed:', err.message));
    }

    return res.json({ 
      ok: true, 
      data: paginated, 
      page, 
      per_page: perPage,
      total: all.length,
      last_updated: globalCache.getLastUpdated()
    });
  } catch (err: any) {
    logger.error('/api/discover error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Cache Background Sync ───────────────────────────────────────────────────
// Refresh cache automatically every 30 minutes
cron.schedule('*/30 * * * *', () => {
  logger.info('Cron: Running scheduled cache refresh...');
  globalCache.refresh();
});

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  logger.info(`HackTrackr backend running on port ${PORT}`);
  logger.info('Discover: cache fetch mode (instant responses)');
  // Pre-warm the cache on boot
  await globalCache.refresh();
});

// ─── Auto Update Logic ───────────────────────────────────────────────────────
async function autoUpdateSavedHackathons(liveData: any[]) {
  // We only care about hackathons that the user saved from Discover (they have a registration_url and source)
  const urls = liveData.map(h => h.registration_url).filter(Boolean);
  if (urls.length === 0) return;

  // Find any personal hackathons in the DB that match these URLs
  const { data: savedHackathons, error } = await supabase
    .from('hackathons')
    .select('id, website_url, deadline, name')
    .in('website_url', urls)
    .not('user_id', 'is', null);

  if (error || !savedHackathons || savedHackathons.length === 0) return;

  let updatedCount = 0;

  for (const saved of savedHackathons) {
    const liveMatch = liveData.find(h => h.registration_url === saved.website_url);
    if (!liveMatch) continue;

    const liveDeadline = liveMatch.deadline || liveMatch.submission_deadline || liveMatch.end_date;
    const hasDeadlineChanged = liveDeadline && saved.deadline !== liveDeadline;
    
    // If the deadline changed (or other fields in the future), update it
    if (hasDeadlineChanged) {
      await supabase
        .from('hackathons')
        .update({
          deadline: liveDeadline,
          submission_deadline: liveDeadline,
          // We can also sync other non-user-editable things if we want
        })
        .eq('id', saved.id);
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    logger.info(`Auto-updated ${updatedCount} saved personal hackathon(s) from live data.`);
  }
}

