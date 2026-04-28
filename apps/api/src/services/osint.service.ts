/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/osint.service.ts
 * Role    : External OSINT via Apify — searches LinkedIn and scrapes Instagram by name.
 *           No Google Search intermediary.
 *
 * Data flow:
 *   1. LinkedIn Name Search (harvestapi~linkedin-profile-search-by-name)
 *      → Input: { firstName, lastName, maxItems: 1 }
 *      → Output: linkedinUrl, headline, about, experience, education, skills, location,
 *                connectionsCount, followerCount
 *
 *   2. Instagram Profile Scraper (apify~instagram-scraper)
 *      → Input: { searchTerm: name, searchType: "user", resultsType: "details", resultsLimit: 3 }
 *        OR { directUrls: [...], resultsType: "details" } when exact username is provided.
 *      → Output: biography, follower/following counts, post count, isPrivate, verified
 *
 * All calls are fully optional — failures return null and are noted in the result.
 * Never throws. If APIFY_API_KEY is empty, returns a skipped result immediately.
 *
 * Exports : runExternalOsint, ExternalOsintResult
 * DO NOT  : Import from apps/worker or apps/dashboard.
 */

const APIFY_BASE = 'https://api.apify.com/v2';
// Apify REST API uses tilde (~) as owner/name separator.
const ACTOR_LINKEDIN = 'harvestapi~linkedin-profile-search-by-name';
const ACTOR_INSTAGRAM = 'apify~instagram-scraper';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInProfile {
  profileUrl: string;
  name: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  experience: Array<{ title: string; company: string; duration?: string; description?: string }>;
  education: Array<{ degree?: string; fieldOfStudy?: string; school: string }>;
  skills: string[];
  connectionsCount: number | null;
}

export interface InstagramProfile {
  profileUrl: string;
  username: string;
  fullName: string | null;
  biography: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  isPrivate: boolean;
  isVerified: boolean;
  externalUrl: string | null;
}

export interface ExternalOsintResult {
  searched: boolean;
  nameSearched: string | null;
  linkedin: LinkedInProfile | null;
  linkedinSearchError: string | null;
  instagram: InstagramProfile | null;
  instagramSearchError: string | null;
}

// ─── Apify helper ─────────────────────────────────────────────────────────────

async function apifyRun(
  actorId: string,
  input: unknown,
  apiKey: string,
  timeoutSec = 60,
): Promise<unknown[]> {
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`
    + `?token=${apiKey}&timeout=${timeoutSec}&memory=256&maxItems=5`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSec + 15) * 1000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apify HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

/** Split "Ahmad Rizky Pratama" → { firstName: "Ahmad", lastName: "Rizky Pratama" } */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function scrapeLinkedIn(
  name: string,
  apiKey: string,
): Promise<{ profile: LinkedInProfile | null; error: string | null }> {
  try {
    const { firstName, lastName } = splitName(name);

    // profileScraperMode is required — "Short" returns core profile fields fast
    const items = await apifyRun(
      ACTOR_LINKEDIN,
      { firstName, lastName, maxItems: 1, profileScraperMode: 'Short' },
      apiKey,
      60,
    ) as Record<string, unknown>[];

    if (!items.length) {
      return { profile: null, error: `LinkedIn search returned no results for "${name}"` };
    }

    const raw = items[0] as Record<string, unknown>;

    type ExpEntry = {
      title?: string; position?: string;
      companyName?: string; company?: string | { name?: string };
      duration?: string; period?: string;
      description?: string;
    };
    const experience = (Array.isArray(raw.experience) ? raw.experience : []) as ExpEntry[];

    type EduEntry = {
      degreeName?: string; degree?: string; fieldOfStudy?: string;
      schoolName?: string; school?: string | { name?: string };
    };
    const education = (Array.isArray(raw.education) ? raw.education : []) as EduEntry[];

    type SkillEntry = string | { name?: string };
    const rawSkills = Array.isArray(raw.skills) ? (raw.skills as SkillEntry[]) : [];
    const skills = rawSkills
      .map(s => (typeof s === 'string' ? s : (s.name ?? '')))
      .filter(Boolean)
      .slice(0, 20);

    const loc = raw.location;
    const locationStr: string | null = typeof loc === 'string'
      ? loc
      : (loc && typeof loc === 'object'
          ? Object.values(loc as Record<string, unknown>).filter(Boolean).join(', ')
          : null);

    const rawFirstName = (raw.firstName as string | null | undefined) ?? '';
    const rawLastName = (raw.lastName as string | null | undefined) ?? '';
    const fullNameFromParts = `${rawFirstName} ${rawLastName}`.trim();

    const profile: LinkedInProfile = {
      profileUrl: (raw.linkedinUrl as string | null | undefined)
        ?? (raw.url as string | null | undefined)
        ?? (raw.profileUrl as string | null | undefined)
        ?? `https://www.linkedin.com/in/${(raw.publicIdentifier as string | null | undefined) ?? 'unknown'}`,
      name: fullNameFromParts || (raw.fullName as string | null | undefined) || null,
      headline: (raw.headline as string | null | undefined) ?? null,
      about: (raw.about as string | null | undefined) ?? (raw.summary as string | null | undefined) ?? null,
      location: locationStr,
      experience: experience.map(e => ({
        title: (e.title ?? e.position ?? 'Unknown role') as string,
        company: typeof e.company === 'object' && e.company !== null
          ? ((e.company as { name?: string }).name ?? 'Unknown')
          : ((e.companyName ?? (e.company as string | undefined) ?? 'Unknown')) as string,
        duration: e.duration ?? e.period ?? undefined,
        description: e.description ?? undefined,
      })),
      education: education.map(e => ({
        degree: e.degreeName ?? e.degree ?? undefined,
        fieldOfStudy: e.fieldOfStudy ?? undefined,
        school: typeof e.school === 'object' && e.school !== null
          ? ((e.school as { name?: string }).name ?? 'Unknown')
          : ((e.schoolName ?? (e.school as string | undefined) ?? 'Unknown')) as string,
      })),
      skills,
      connectionsCount: typeof raw.connectionsCount === 'number' ? raw.connectionsCount
        : typeof raw.followerCount === 'number' ? (raw.followerCount as number)
        : null,
    };

    return { profile, error: null };
  } catch (err) {
    return {
      profile: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Instagram ────────────────────────────────────────────────────────────────

async function scrapeInstagram(
  name: string,
  instagramUsername: string | null,
  apiKey: string,
): Promise<{ profile: InstagramProfile | null; error: string | null }> {
  try {
    // Instagram public user search is disabled — must use directUrls.
    // If no username supplied, construct best-guess from name: "Ahmad Rizky" → "ahmad.rizky"
    const resolvedUsername = instagramUsername
      ? instagramUsername.replace(/^@/, '')
      : name.trim().toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');

    const canonicalUrl = `https://www.instagram.com/${resolvedUsername}/`;

    const items = await apifyRun(
      ACTOR_INSTAGRAM,
      { directUrls: [canonicalUrl], resultsType: 'details', resultsLimit: 1 },
      apiKey,
      60,
    ) as Record<string, unknown>[];

    if (!items.length || (items[0] as Record<string, unknown>).error) {
      return { profile: null, error: `Instagram: no profile found for @${resolvedUsername}` };
    }

    const raw = items[0] as Record<string, unknown>;
    const username = (raw.username as string | null | undefined) ?? resolvedUsername;

    const postsCount: number | null =
      typeof raw.postsCount === 'number' ? raw.postsCount
      : typeof raw.mediaCount === 'number' ? (raw.mediaCount as number)
      : (raw.edge_owner_to_timeline_media != null && typeof raw.edge_owner_to_timeline_media === 'object')
        ? (((raw.edge_owner_to_timeline_media as Record<string, unknown>).count) as number | null) ?? null
      : null;

    const profile: InstagramProfile = {
      profileUrl: `https://instagram.com/${username}`,
      username,
      fullName: (raw.fullName as string | null | undefined) ?? (raw.full_name as string | null | undefined) ?? null,
      biography: (raw.biography as string | null | undefined) ?? (raw.bio as string | null | undefined) ?? null,
      followersCount: typeof raw.followersCount === 'number' ? raw.followersCount
        : typeof raw.followers === 'number' ? (raw.followers as number) : null,
      followingCount: typeof raw.followingCount === 'number' ? raw.followingCount
        : typeof raw.following === 'number' ? (raw.following as number) : null,
      postsCount,
      isPrivate: Boolean(raw.private ?? raw.isPrivate ?? raw.is_private),
      isVerified: Boolean(raw.verified ?? raw.isVerified ?? raw.is_verified),
      // externalUrls is an array of { url, title } objects; grab first url
      externalUrl: Array.isArray(raw.externalUrls) && (raw.externalUrls as Record<string, unknown>[]).length
        ? ((raw.externalUrls as Record<string, unknown>[])[0].url as string | null | undefined) ?? null
        : (raw.externalUrl as string | null | undefined)
          ?? (raw.external_url as string | null | undefined)
          ?? null,
    };

    return { profile, error: null };
  } catch (err) {
    return {
      profile: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run external OSINT for a buyer by name.
 * @param name               Full name to search
 * @param apiKey             Apify API key — if empty, returns { searched: false }
 * @param instagramUsername  Optional: exact Instagram username (skips name search)
 */
export async function runExternalOsint(
  name: string | null,
  _region: string,
  apiKey: string,
  _linkedinUrl?: string | null,
  instagramUsername?: string | null,
): Promise<ExternalOsintResult> {
  if (!apiKey || !name || name.trim().length < 2) {
    return {
      searched: false,
      nameSearched: name,
      linkedin: null,
      linkedinSearchError: !apiKey ? 'APIFY_API_KEY not configured' : 'Name unavailable — cannot search',
      instagram: null,
      instagramSearchError: !apiKey ? 'APIFY_API_KEY not configured' : 'Name unavailable — cannot search',
    };
  }

  const cleanName = name.trim();

  const [linkedinResult, instagramResult] = await Promise.all([
    scrapeLinkedIn(cleanName, apiKey),
    scrapeInstagram(cleanName, instagramUsername ?? null, apiKey),
  ]);

  return {
    searched: true,
    nameSearched: cleanName,
    linkedin: linkedinResult.profile,
    linkedinSearchError: linkedinResult.error,
    instagram: instagramResult.profile,
    instagramSearchError: instagramResult.error,
  };
}

// ─── Format for LLM prompt ────────────────────────────────────────────────────

export function formatExternalOsintForPrompt(result: ExternalOsintResult): string {
  if (!result.searched) {
    return `External OSINT: SKIPPED — ${result.linkedinSearchError ?? 'unknown reason'}`;
  }

  const lines: string[] = [`Name searched: "${result.nameSearched}"`];

  if (result.linkedin) {
    const li = result.linkedin;
    lines.push(`\nLINKEDIN PROFILE: ${li.profileUrl}`);
    if (li.name) lines.push(`  Name on profile: ${li.name}`);
    if (li.headline) lines.push(`  Headline: ${li.headline}`);
    if (li.location) lines.push(`  Location: ${li.location}`);
    if (li.connectionsCount) lines.push(`  Connections/Followers: ${li.connectionsCount}+`);
    if (li.about) lines.push(`  About: ${li.about.slice(0, 600)}${li.about.length > 600 ? '…' : ''}`);
    if (li.experience.length) {
      lines.push(`  Experience (${li.experience.length} roles):`);
      for (const e of li.experience.slice(0, 4)) {
        lines.push(`    • ${e.title} @ ${e.company}${e.duration ? ` (${e.duration})` : ''}`);
        if (e.description) lines.push(`      ${e.description.slice(0, 200)}`);
      }
    }
    if (li.education.length) {
      lines.push(`  Education:`);
      for (const e of li.education.slice(0, 3)) {
        const deg = [e.degree, e.fieldOfStudy].filter(Boolean).join(', ');
        lines.push(`    • ${deg ? `${deg} — ` : ''}${e.school}`);
      }
    }
    if (li.skills.length) {
      lines.push(`  Top skills: ${li.skills.slice(0, 10).join(', ')}`);
    }
  } else {
    lines.push(`\nLINKEDIN: Not found — ${result.linkedinSearchError ?? 'unknown error'}`);
  }

  if (result.instagram) {
    const ig = result.instagram;
    lines.push(`\nINSTAGRAM PROFILE: ${ig.profileUrl}`);
    if (ig.fullName) lines.push(`  Name on profile: ${ig.fullName}`);
    if (ig.biography) lines.push(`  Bio: ${ig.biography.slice(0, 400)}${ig.biography.length > 400 ? '…' : ''}`);
    lines.push(`  Followers: ${ig.followersCount?.toLocaleString() ?? 'unknown'} | Following: ${ig.followingCount?.toLocaleString() ?? 'unknown'} | Posts: ${ig.postsCount?.toLocaleString() ?? 'unknown'}`);
    if (ig.externalUrl) lines.push(`  External URL in bio: ${ig.externalUrl}`);
    lines.push(`  Account: ${ig.isPrivate ? 'PRIVATE' : 'PUBLIC'}${ig.isVerified ? ' · VERIFIED ✓' : ''}`);
  } else {
    lines.push(`\nINSTAGRAM: Not found — ${result.instagramSearchError ?? 'unknown error'}`);
  }

  return lines.join('\n');
}
