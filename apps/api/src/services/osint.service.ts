/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/osint.service.ts
 * Role    : External OSINT via Apify — scrapes LinkedIn and Instagram profiles
 *           by searching for the buyer's name via Google, then scraping found URLs.
 *
 * Data flow:
 *   1. Google Search (apify/google-search-scraper)
 *      → find linkedin.com/in/* and instagram.com/* URLs for the given name
 *   2. LinkedIn Profile Scraper (harvestapi/linkedin-profile-scraper)
 *      → headline, about, experience, education, skills, location
 *      Actor ID: LpVuK3Zozwuipa5bp
 *      Input:  { url: "https://linkedin.com/in/..." }
 *      Output: firstName, lastName, headline, about, location, experience[], education[], skills[], connectionsCount
 *   3. Instagram Profile Scraper (apify/instagram-scraper)
 *      → bio, follower/following counts, post count, isPrivate, verified
 *      Actor ID: shu8hvrXbJbY3Eb9W
 *      Input:  { directUrls: ["https://instagram.com/username/"], resultsType: "details" }
 *      Output: username, fullName, biography, followersCount, followingCount, postsCount, isPrivate, verified, externalUrl
 *
 * All calls are fully optional — failures return null and are noted in the result.
 * Never throws. If APIFY_API_KEY is empty, returns a skipped result immediately.
 *
 * Exports : runExternalOsint, ExternalOsintResult
 * DO NOT  : Import from apps/worker or apps/dashboard.
 */

const APIFY_BASE = 'https://api.apify.com/v2';
// Actor IDs — using alphanumeric IDs for stability (immune to slug renames)
const ACTOR_GOOGLE_SEARCH = 'apify/google-search-scraper';
const ACTOR_LINKEDIN = 'LpVuK3Zozwuipa5bp';     // harvestapi/linkedin-profile-scraper
const ACTOR_INSTAGRAM = 'shu8hvrXbJbY3Eb9W';    // apify/instagram-scraper

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
  searched: boolean;        // false if APIFY_API_KEY not set or name unavailable
  nameSearched: string | null;
  linkedin: LinkedInProfile | null;
  linkedinSearchError: string | null;
  instagram: InstagramProfile | null;
  instagramSearchError: string | null;
}

// ─── Apify helper ─────────────────────────────────────────────────────────────

/**
 * Run an Apify actor synchronously and return dataset items.
 * Uses run-sync-get-dataset-items which waits for completion and returns results directly.
 * Times out after timeoutSec seconds (actor) + 15s (network buffer).
 */
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

// ─── Google Search helper ─────────────────────────────────────────────────────

interface GoogleResult {
  url: string;
  title?: string;
  description?: string;
}

async function googleSearch(query: string, apiKey: string): Promise<GoogleResult[]> {
  const items = await apifyRun(
    ACTOR_GOOGLE_SEARCH,
    { queries: query, maxPagesPerQuery: 1, resultsPerPage: 5, languageCode: '' },
    apiKey,
    45,
  ) as Record<string, unknown>[];

  // Response shape: [{ searchQuery, organicResults: [...] }]
  const firstPage = items[0] as Record<string, unknown> | undefined;
  const organic = firstPage?.organicResults as GoogleResult[] | undefined;
  return Array.isArray(organic) ? organic : [];
}

/** Extract first matching URL from Google results */
function extractUrl(results: GoogleResult[], pattern: RegExp): string | null {
  for (const r of results) {
    if (r.url && pattern.test(r.url)) return r.url;
  }
  return null;
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

async function scrapeLinkedIn(
  name: string,
  region: string,
  apiKey: string,
): Promise<{ profile: LinkedInProfile | null; error: string | null }> {
  try {
    // Step 1: Google to find profile URL
    const query = region !== 'Unknown'
      ? `"${name}" site:linkedin.com/in ${region}`
      : `"${name}" site:linkedin.com/in`;

    const googleResults = await googleSearch(query, apiKey);
    const profileUrl = extractUrl(googleResults, /linkedin\.com\/in\//i);

    if (!profileUrl) {
      return { profile: null, error: `No LinkedIn profile found in Google results for "${name}"` };
    }

    // Step 2: Scrape the profile
    // harvestapi/linkedin-profile-scraper accepts { url: "https://..." }
    const items = await apifyRun(
      ACTOR_LINKEDIN,
      { url: profileUrl },
      apiKey,
      60,
    ) as Record<string, unknown>[];

    if (!items.length) {
      return { profile: null, error: `LinkedIn scraper returned no data for ${profileUrl}` };
    }

    const raw = items[0] as Record<string, unknown>;

    // Normalise experience entries — harvestapi uses position/company (object or string)
    type ExpEntry = {
      title?: string;
      position?: string;
      companyName?: string;
      company?: string | { name?: string };
      duration?: string;
      period?: string;
      description?: string;
    };
    const experience = (Array.isArray(raw.experience) ? raw.experience : []) as ExpEntry[];

    type EduEntry = {
      degreeName?: string;
      degree?: string;
      fieldOfStudy?: string;
      schoolName?: string;
      school?: string | { name?: string };
    };
    const education = (Array.isArray(raw.education) ? raw.education : []) as EduEntry[];

    // Skills may be an array of strings or objects { name, endorsements }
    type SkillEntry = string | { name?: string };
    const rawSkills = Array.isArray(raw.skills) ? (raw.skills as SkillEntry[]) : [];
    const skills = rawSkills
      .map(s => (typeof s === 'string' ? s : (s.name ?? '')))
      .filter(Boolean)
      .slice(0, 20);

    // Location may be string or nested { city, country, ... }
    const loc = raw.location;
    const locationStr: string | null = typeof loc === 'string'
      ? loc
      : (loc && typeof loc === 'object' ? Object.values(loc as Record<string, unknown>).filter(Boolean).join(', ') : null);

    const profile: LinkedInProfile = {
      profileUrl: (raw.linkedinUrl ?? raw.url ?? raw.profileUrl ?? profileUrl) as string,
      name: (
        ((raw.firstName ?? '') as string + ' ' + (raw.lastName ?? '') as string).trim()
        || (raw.fullName as string | null)
        || null
      ),
      headline: (raw.headline as string | null) ?? null,
      about: (raw.about ?? raw.summary as string | null) ?? null,
      location: locationStr,
      experience: experience.map(e => ({
        title: (e.title ?? e.position ?? 'Unknown role') as string,
        company: typeof e.company === 'object' && e.company !== null
          ? ((e.company as { name?: string }).name ?? 'Unknown')
          : (e.companyName ?? (e.company as string) ?? 'Unknown') as string,
        duration: e.duration ?? e.period ?? undefined,
        description: e.description ?? undefined,
      })),
      education: education.map(e => ({
        degree: e.degreeName ?? e.degree ?? undefined,
        fieldOfStudy: e.fieldOfStudy ?? undefined,
        school: typeof e.school === 'object' && e.school !== null
          ? ((e.school as { name?: string }).name ?? 'Unknown')
          : (e.schoolName ?? (e.school as string) ?? 'Unknown') as string,
      })),
      skills,
      connectionsCount: typeof raw.connectionsCount === 'number' ? raw.connectionsCount
        : typeof raw.followerCount === 'number' ? raw.followerCount as number : null,
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
  region: string,
  apiKey: string,
): Promise<{ profile: InstagramProfile | null; error: string | null }> {
  try {
    // Step 1: Google to find Instagram profile URL
    const query = region !== 'Unknown'
      ? `"${name}" site:instagram.com ${region}`
      : `"${name}" site:instagram.com`;

    const googleResults = await googleSearch(query, apiKey);
    const profileUrl = extractUrl(googleResults, /instagram\.com\/[^/?\s]+\/?$/i);

    if (!profileUrl) {
      return { profile: null, error: `No Instagram profile found in Google results for "${name}"` };
    }

    // Extract username from URL: instagram.com/username or instagram.com/username/
    const usernameMatch = profileUrl.match(/instagram\.com\/([^/?#]+)/i);
    const username = usernameMatch?.[1];
    if (!username || ['p', 'reels', 'explore', 'accounts', 'stories'].includes(username.toLowerCase())) {
      return { profile: null, error: `Could not extract valid Instagram username from ${profileUrl}` };
    }

    // Normalise to canonical profile URL
    const canonicalUrl = `https://www.instagram.com/${username}/`;

    // Step 2: Scrape the profile
    // apify/instagram-scraper: use directUrls with resultsType: 'details' for profile data
    const items = await apifyRun(
      ACTOR_INSTAGRAM,
      {
        directUrls: [canonicalUrl],
        resultsType: 'details',
        resultsLimit: 1,
      },
      apiKey,
      60,
    ) as Record<string, unknown>[];

    if (!items.length) {
      return { profile: null, error: `Instagram scraper returned no data for @${username}` };
    }

    const raw = items[0] as Record<string, unknown>;

    // postsCount — may be nested under edge_owner_to_timeline_media.count
    const postsCount: number | null =
      typeof raw.postsCount === 'number' ? raw.postsCount
      : typeof raw.mediaCount === 'number' ? raw.mediaCount as number
      : (raw.edge_owner_to_timeline_media != null && typeof raw.edge_owner_to_timeline_media === 'object')
        ? ((raw.edge_owner_to_timeline_media as Record<string, unknown>).count as number | null) ?? null
      : null;

    const profile: InstagramProfile = {
      profileUrl: `https://instagram.com/${username}`,
      username: (raw.username as string | null) ?? username,
      fullName: (raw.fullName ?? raw.full_name as string | null) ?? null,
      biography: (raw.biography ?? raw.bio as string | null) ?? null,
      followersCount: typeof raw.followersCount === 'number' ? raw.followersCount
        : typeof raw.followers === 'number' ? raw.followers as number : null,
      followingCount: typeof raw.followingCount === 'number' ? raw.followingCount
        : typeof raw.following === 'number' ? raw.following as number : null,
      postsCount,
      isPrivate: Boolean(raw.private ?? raw.isPrivate ?? raw.is_private),
      isVerified: Boolean(raw.verified ?? raw.isVerified ?? raw.is_verified),
      externalUrl: (raw.externalUrl ?? raw.external_url ?? raw.website as string | null) ?? null,
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
 * @param name         Full name to search (display name or expressed name from conversation)
 * @param region       Inferred region string (e.g. "Indonesia") to narrow Google results
 * @param apiKey       Apify API key — if empty, returns { searched: false }
 */
export async function runExternalOsint(
  name: string | null,
  region: string,
  apiKey: string,
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

  // Run LinkedIn and Instagram scraping in parallel
  const [linkedinResult, instagramResult] = await Promise.all([
    scrapeLinkedIn(cleanName, region, apiKey),
    scrapeInstagram(cleanName, region, apiKey),
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

/** Render ExternalOsintResult as a readable text block for the LLM prompt */
export function formatExternalOsintForPrompt(result: ExternalOsintResult): string {
  if (!result.searched) {
    return `External OSINT: SKIPPED — ${result.linkedinSearchError ?? 'unknown reason'}`;
  }

  const lines: string[] = [`Name searched: "${result.nameSearched}" | Region context: used for Google search disambiguation`];

  // LinkedIn
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

  // Instagram
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
