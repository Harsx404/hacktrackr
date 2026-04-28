/**
 * AI Service — Ollama backend (gemma3)
 *
 * Uses Ollama's /api/chat endpoint with format:"json" to force structured output.
 * Ollama must be running on the same network as the device.
 * Configure EXPO_PUBLIC_OLLAMA_URL and EXPO_PUBLIC_OLLAMA_MODEL in .env
 */

const OLLAMA_URL =
  process.env.EXPO_PUBLIC_OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL =
  process.env.EXPO_PUBLIC_OLLAMA_MODEL || 'gemma4:31b-cloud';
const OLLAMA_API_KEY =
  process.env.EXPO_PUBLIC_OLLAMA_API_KEY || '';

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
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.1,
    },
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Extract all hackathon metadata from the following text and return ONLY the JSON object:\n\n${rawText}`,
      },
    ],
  };

  let response: Response;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (OLLAMA_API_KEY) {
      headers['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;
    }

    // Cloud base is https://ollama.com/api — endpoint is /chat
    // Local base is http://host:11434   — endpoint is /api/chat
    const endpoint = OLLAMA_URL.endsWith('/api')
      ? `${OLLAMA_URL}/chat`
      : `${OLLAMA_URL}/api/chat`;

    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkError: any) {
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_URL}.\n\nMake sure:\n• Ollama is running: ollama serve\n• The model is pulled: ollama pull ${OLLAMA_MODEL}\n• Your device and PC are on the same network`
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
