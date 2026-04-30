import { ollamaChat } from '../lib/ollamaClient';
import { logger } from '../lib/logger';
import { NormalizedHackathon } from './normalizeHackathon';

const SYSTEM_PROMPT = `You are an AI hackathon mentor.
Analyze the provided hackathon data.
Extract important info (like deep tech requirements, judging criteria, or themes) and use it to brainstorm 3 highly innovative, cutting-edge project ideas.
Your response MUST be a valid JSON array of strings. Each string should be a deliverable task for the user (e.g., "AI Idea: Build a distributed...").
Limit to exactly 3 ideas. Keep them actionable but visionary.
Respond ONLY with the JSON array, nothing else. Example: ["AI Idea 1", "AI Idea 2", "AI Idea 3"]`;

export async function generateInnovations(hackathonData: any): Promise<string[]> {
  logger.info(`Generating AI innovations for hackathon...`);

  const rawText = JSON.stringify(hackathonData, null, 2);

  try {
    const raw = await ollamaChat(
      SYSTEM_PROMPT,
      `Here is the hackathon data:\n\n${rawText}`
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(String).slice(0, 3);
    }
    return [];
  } catch (err: any) {
    logger.error(`AI innovation failed: ${err.message}`);
    return [];
  }
}
