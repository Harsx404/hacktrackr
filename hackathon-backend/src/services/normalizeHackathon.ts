/**
 * Normalized hackathon structure shared across all scrapers and services.
 */
export interface NormalizedHackathon {
  source: string;               // e.g. 'devfolio', 'mlh', 'unstop'
  source_id?: string;           // unique ID on the source platform
  name: string;                 // hackathon title
  organizer?: string;
  description?: string;
  registration_url: string;     // unique key for deduplication / card link
  image_url?: string;
  start_date?: string;          // ISO 8601
  end_date?: string;
  deadline?: string;            // registration deadline (maps to submission_deadline)
  submission_deadline?: string;
  team_size?: number;           // generic max team size
  team_size_min?: number;       // Unstop: regnRequirements.min_team_size
  team_size_max?: number;       // Unstop: regnRequirements.max_team_size
  mode?: 'online' | 'offline' | 'hybrid' | string;
  location?: string;
  prize?: string;
  tags?: string[];
  eligibility?: string;
  theme?: string;
  platform?: string;
  status?: 'Registered' | 'Planning' | 'Building' | 'Submitted';
  reg_status?: string;          // Unstop: regnRequirements.reg_status
  remain_days?: number;         // Unstop: regnRequirements.remain_days
  register_count?: number;      // Unstop: registerCount
}

/**
 * Maps a NormalizedHackathon to the personal hackathons table row shape.
 * Only includes columns that actually exist in the hackathons table.
 * Used by /api/save (URL-import flow).
 */
export function toSupabaseRow(h: NormalizedHackathon): Record<string, unknown> {
  return {
    name:             h.name,
    platform:         h.organizer || h.platform || null,
    deadline:         h.deadline || h.submission_deadline || h.end_date || null,
    theme:            h.theme || (h.tags?.join(', ') ?? null),
    team_size:        h.team_size || null,
    website_url:      h.registration_url,
    submission_link:  h.submission_deadline || null,
    status:           h.status || 'Registered',
    description:      h.description || null,
    image_url:        h.image_url || null,
    mode:             h.mode || null,
    location:         h.location || null,
    prize:            h.prize || null,
    tags:             h.tags || null,
    registration_url: h.registration_url,
  };
}
