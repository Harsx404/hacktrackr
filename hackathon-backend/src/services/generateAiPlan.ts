import { ollamaChat } from '../lib/ollamaClient';
import { logger } from '../lib/logger';

/**
 * Full AI planning engine.
 * Given raw scraped hackathon data, returns:
 *  - tasks        : string[]   – actionable step-by-step tasks
 *  - deliverables : string[]   – submission / checklist items
 *  - milestones   : { title: string, offset_days: number }[]
 *  - ideas        : string[]   – project idea recommendations
 */

const SYSTEM_PROMPT = `You are an expert hackathon coach and project manager.
You are given raw data scraped from a hackathon listing (name, theme, prizes, tags, description, mode, deadline, etc.).

Your job is to generate a complete hackathon execution plan in four categories:

1. tasks        – 4-6 short, concrete action items the team should do first (e.g. "Register team on the platform")
2. deliverables – 3-5 submission requirements or checklist items (e.g. "Working demo link", "3-min pitch video")
3. milestones   – 3-4 key project milestones with an offset_days from today (integer, e.g. 2, 5, 10). Milestones should fit within the hackathon duration.
4. ideas        – 3 innovative, creative project idea recommendations based on the hackathon theme and tech stack.
   Each idea should be 1-2 sentences describing a unique project angle.

IMPORTANT: The ideas are for inspiration only (NOT tasks).
Respond ONLY with a single valid JSON object in this exact shape:
{
  "tasks":        ["task 1", "task 2"],
  "deliverables": ["deliverable 1"],
  "milestones":   [{ "title": "string", "offset_days": 3 }],
  "ideas":        ["Idea 1: ...", "Idea 2: ...", "Idea 3: ..."]
}`;

export interface AiPlan {
  tasks:        string[];
  deliverables: string[];
  milestones:   { title: string; offset_days: number }[];
  ideas:        string[];
}

export async function generateAiPlan(hackathonData: any): Promise<AiPlan> {
  logger.info(`Generating full AI plan for hackathon: ${hackathonData.name || 'unknown'}...`);

  // Flatten the scraped data to key fields only — saves tokens
  const summary = {
    name:        hackathonData.name,
    theme:       hackathonData.theme,
    prize:       hackathonData.prize,
    tags:        hackathonData.tags,
    mode:        hackathonData.mode,
    location:    hackathonData.location,
    description: hackathonData.description
      ? String(hackathonData.description).replace(/<[^>]*>/g, ' ').slice(0, 1500)
      : '',
    deadline:    hackathonData.deadline || hackathonData.submission_deadline,
    start_date:  hackathonData.start_date,
    end_date:    hackathonData.end_date,
    team_size:   hackathonData.team_size,
    eligibility: hackathonData.eligibility,
  };

  const fallback: AiPlan = { tasks: [], deliverables: [], milestones: [], ideas: [] };

  try {
    const raw = await ollamaChat(
      SYSTEM_PROMPT,
      `Generate a complete plan for this hackathon:\n\n${JSON.stringify(summary, null, 2)}`
    );

    logger.info('[generateAiPlan] Raw response length:', raw.length);
    logger.debug('[generateAiPlan] Raw:', raw.slice(0, 300));

    // Robustly extract the first {...} block — handles markdown preamble, trailing text, etc.
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found in Ollama response');
    const jsonStr = raw.slice(jsonStart, jsonEnd + 1);

    const parsed = JSON.parse(jsonStr) as Partial<AiPlan>;
    const result: AiPlan = {
      tasks:        Array.isArray(parsed.tasks)        ? parsed.tasks.map(String).slice(0, 6)  : [],
      deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables.map(String).slice(0, 5) : [],
      milestones:   Array.isArray(parsed.milestones)   ? parsed.milestones.slice(0, 4)         : [],
      ideas:        Array.isArray(parsed.ideas)        ? parsed.ideas.map(String).slice(0, 3)  : [],
    };
    logger.info(`[generateAiPlan] Parsed OK: ${result.tasks.length}t ${result.deliverables.length}d ${result.milestones.length}m ${result.ideas.length}i`);
    return result;
  } catch (err: any) {
    logger.error(`[generateAiPlan] FAILED: ${err.message}`);
    return fallback;
  }
}
