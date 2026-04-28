/**
 * AI Service — proxied through academia-backend (/ai/chat)
 *
 * The Ollama cloud API key lives on the server only (never in the app bundle).
 * Set EXPO_PUBLIC_ACADEMIA_API_URL to point to your deployed backend.
 */

const BACKEND_URL =
  (process.env.EXPO_PUBLIC_ACADEMIA_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export interface ParsedHackathonData {
  name: string;
  platform: string;
  website_url: string;
  theme: string;
  deadline: string; // ISO 8601 string
  team_size: number;
  submission_link: string;
  milestones: string[];
  tasks: string[];
  checklist_items: string[];
}

const SYSTEM_PROMPT = `You are a hackathon organization expert that extracts structured data from raw text.
You MUST respond with ONLY a single valid JSON object — no markdown, no code fences, no explanation.
Use this exact structure:
{
  "name": "string — full hackathon name",
  "platform": "string — e.g. Devfolio, MLH, Unstop, Devpost (empty string if unknown)",
  "website_url": "string — hackathon website URL (empty string if not mentioned)",
  "theme": "string — main theme or track e.g. AI, Web3, HealthTech (empty string if unknown)",
  "deadline": "string — submission deadline in strict ISO 8601 format e.g. 2026-10-10T23:59:59Z. Assume current year if year not mentioned. REQUIRED.",
  "team_size": number,
  "submission_link": "string — submission URL or portal (empty string if not mentioned)",
  "milestones": ["array of major timeline events as strings"],
  "tasks": ["array of suggested team tasks e.g. Create repo, Build MVP, Record demo, Write README"],
  "checklist_items": ["array of required deliverables e.g. GitHub repo, Demo video, Pitch deck"]
}`;

/**
 * Sends raw hackathon text to local Ollama (gemma3) and extracts structured data.
 * Falls back gracefully with a clear error message on network/parse failure.
 */
export async function parseHackathonDetails(rawText: string): Promise<ParsedHackathonData> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Extract all hackathon metadata from the following text and return ONLY the JSON object:\n\n${rawText}`,
    },
  ];

  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, format: 'json' }),
    });
  } catch (networkError: any) {
    throw new Error(
      `Cannot reach AI service at ${BACKEND_URL}.\n\nMake sure the backend is running.`
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama returned ${response.status}: ${errText || 'Unknown error'}`);
  }

  const json = await response.json();
  const content: string = json?.message?.content ?? '';

  if (!content) {
    throw new Error('Ollama returned an empty response. Try again or check the model.');
  }

  // Strip any accidental markdown code fences
  const cleaned = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: ParsedHackathonData;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('Raw Ollama response:', content);
    throw new Error('Failed to parse JSON from Ollama. The model may need more context.');
  }

  // Validate required fields
  if (!parsed.name || !parsed.deadline) {
    throw new Error(
      'Could not extract required fields (name, deadline) from your text. Add more detail and try again.'
    );
  }

  // Ensure array fields are arrays even if model returns strings
  parsed.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  parsed.checklist_items = Array.isArray(parsed.checklist_items) ? parsed.checklist_items : [];
  parsed.milestones = Array.isArray(parsed.milestones) ? parsed.milestones : [];

  return parsed;
}
