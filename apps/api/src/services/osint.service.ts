/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/osint.service.ts
 * Role    : External OSINT via Serper (URL discovery) + Apify (profile scraping)
 *           + xAI Vision (Instagram image analysis).
 *
 * Pipeline:
 *   1. Serper Google Search → find LinkedIn profile URL + Instagram profile URL by name
 *   2. LinkedIn scrape (harvestapi~linkedin-profile-scraper, Full mode)
 *      → headline, about, career path, posts, skills, education, connections
 *   3. Instagram scrape (apify~instagram-scraper)
 *      → profile metadata + last 6 posts with image URLs
 *   4. xAI Vision → analyze each post image for lifestyle/persona signals
 *
 * All calls optional — failures return null with error string. Never throws.
 *
 * Exports : runExternalOsint, formatExternalOsintForPrompt, ExternalOsintResult
 * DO NOT  : Import from apps/worker or apps/dashboard.
 */

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_LINKEDIN  = 'harvestapi~linkedin-profile-scraper';
const ACTOR_INSTAGRAM = 'apify~instagram-scraper';
const SERPER_ENDPOINT = 'https://google.serper.dev/search';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImageAnalysis {
  setting: string;           // e.g. "luxury restaurant", "home office", "outdoor travel"
  lifestyleSignals: string[];// e.g. ["fitness", "travel", "fashion", "family"]
  brandsVisible: string[];   // any brand logos/tags detected
  emotionalTone: string;     // e.g. "aspirational", "joyful", "professional", "casual"
  selfPresentation: string;  // e.g. "polished personal brand", "candid social", "professional headshot"
  genomeSignals: string[];   // explicit genome implications, e.g. "luxury context → socioeconomicFriction LOW"
}

export interface InstagramPost {
  url: string | null;
  timestamp: string | null;
  daysAgo: number | null;
  caption: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  imageUrl: string | null;
  imageAnalysis: ImageAnalysis | null;
}

export interface LinkedInPost {
  text: string;
  publishedAt: string | null;
  likesCount: number | null;
  commentsCount: number | null;
}

export interface LinkedInProfile {
  profileUrl: string;
  name: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  experience: Array<{ title: string; company: string; duration?: string; description?: string; startDate?: string; endDate?: string }>;
  education: Array<{ degree?: string; fieldOfStudy?: string; school: string }>;
  skills: string[];
  connectionsCount: number | null;
  followerCount: number | null;
  posts: LinkedInPost[];
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
  recentPosts: InstagramPost[];
  postingFrequency: string;  // e.g. "daily", "weekly", "monthly", "inactive"
}

export interface ExternalOsintResult {
  searched: boolean;
  nameSearched: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  linkedin: LinkedInProfile | null;
  linkedinError: string | null;
  instagram: InstagramProfile | null;
  instagramError: string | null;
}

// ─── Serper helper ────────────────────────────────────────────────────────────

interface SerperResult { link: string; title: string; snippet: string; }

async function serperSearch(query: string, apiKey: string): Promise<SerperResult[]> {
  const res = await fetch(SERPER_ENDPOINT, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = await res.json() as { organic?: SerperResult[] };
  return data.organic ?? [];
}

function extractUrl(results: SerperResult[], pattern: RegExp): string | null {
  for (const r of results) {
    if (r.link && pattern.test(r.link)) return r.link;
  }
  return null;
}

// ─── Apify helper ─────────────────────────────────────────────────────────────

async function apifyRun(
  actorId: string,
  input: unknown,
  apiKey: string,
  timeoutSec = 90,
): Promise<unknown[]> {
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`
    + `?token=${apiKey}&timeout=${timeoutSec}&memory=512&maxItems=10`;

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

// ─── xAI Vision helper ────────────────────────────────────────────────────────

async function analyzePostImages(
  posts: Array<{ imageUrl: string | null; caption: string | null; timestamp: string | null }>,
  xaiApiKey: string,
  xaiBaseUrl: string,
): Promise<Map<number, ImageAnalysis>> {
  const results = new Map<number, ImageAnalysis>();
  const postsWithImages = posts.map((p, i) => ({ ...p, index: i })).filter(p => p.imageUrl);
  if (!postsWithImages.length || !xaiApiKey) return results;

  // Build a single multi-image message for all posts to minimise API calls
  const imageContent: unknown[] = [];
  for (const p of postsWithImages) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: p.imageUrl },
    });
    imageContent.push({
      type: 'text',
      text: `POST ${p.index + 1} (posted: ${p.timestamp ?? 'unknown'}, caption: "${(p.caption ?? '').slice(0, 100)}")`,
    });
  }
  imageContent.push({
    type: 'text',
    text: `For EACH post image numbered above, return a JSON array (one object per post) with this schema:
[{
  "postIndex": 0,
  "setting": "one phrase describing the environment",
  "lifestyleSignals": ["signal1", "signal2"],
  "brandsVisible": ["brand1"],
  "emotionalTone": "one word",
  "selfPresentation": "one phrase",
  "genomeSignals": ["specific genome implication e.g. luxury context → socioeconomicFriction LOW"]
}]
Be specific to each image. Output ONLY the JSON array.`,
  });

  try {
    const res = await fetch(`${xaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${xaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-2-vision-latest',
        messages: [{ role: 'user', content: imageContent }],
        max_tokens: 1500,
      }),
    });
    if (!res.ok) return results;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '';
    // Extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return results;
    const parsed = JSON.parse(match[0]) as Array<{ postIndex: number } & ImageAnalysis>;
    for (const item of parsed) {
      results.set(item.postIndex, {
        setting: item.setting ?? '',
        lifestyleSignals: item.lifestyleSignals ?? [],
        brandsVisible: item.brandsVisible ?? [],
        emotionalTone: item.emotionalTone ?? '',
        selfPresentation: item.selfPresentation ?? '',
        genomeSignals: item.genomeSignals ?? [],
      });
    }
  } catch { /* vision analysis is best-effort */ }
  return results;
}

// ─── LinkedIn scraper ─────────────────────────────────────────────────────────

async function scrapeLinkedIn(
  profileUrl: string,
  apifyKey: string,
): Promise<{ profile: LinkedInProfile | null; error: string | null }> {
  try {
    // Full mode returns complete profile including posts
    const items = await apifyRun(
      ACTOR_LINKEDIN,
      { url: profileUrl, profileScraperMode: 'Full' },
      apifyKey,
      90,
    ) as Record<string, unknown>[];

    if (!items.length) {
      return { profile: null, error: `LinkedIn scraper returned no data for ${profileUrl}` };
    }

    const raw = items[0] as Record<string, unknown>;

    type ExpEntry = {
      title?: string; position?: string;
      companyName?: string; company?: string | { name?: string };
      duration?: string; period?: string; description?: string;
      startDate?: string | { month?: number; year?: number };
      endDate?: string | { month?: number; year?: number };
    };
    const experience = (Array.isArray(raw.experience) ? raw.experience : []) as ExpEntry[];

    type EduEntry = {
      degreeName?: string; degree?: string; fieldOfStudy?: string;
      schoolName?: string; school?: string | { name?: string };
    };
    const education = (Array.isArray(raw.education) ? raw.education : []) as EduEntry[];

    type SkillEntry = string | { name?: string };
    const skills = (Array.isArray(raw.skills) ? raw.skills as SkillEntry[] : [])
      .map(s => typeof s === 'string' ? s : (s.name ?? ''))
      .filter(Boolean).slice(0, 20);

    type PostEntry = { text?: string; publishedAt?: string; likesCount?: number; commentsCount?: number };
    const posts = (Array.isArray(raw.posts) ? raw.posts as PostEntry[] : []).slice(0, 6).map(p => ({
      text: (p.text ?? '').slice(0, 500),
      publishedAt: p.publishedAt ?? null,
      likesCount: p.likesCount ?? null,
      commentsCount: p.commentsCount ?? null,
    }));

    const loc = raw.location;
    const locationStr: string | null = typeof loc === 'string' ? loc
      : (loc && typeof loc === 'object' ? Object.values(loc as Record<string, unknown>).filter(Boolean).join(', ') : null);

    const rawFirstName = (raw.firstName as string | null | undefined) ?? '';
    const rawLastName = (raw.lastName as string | null | undefined) ?? '';

    const profile: LinkedInProfile = {
      profileUrl: (raw.linkedinUrl as string | null | undefined)
        ?? (raw.url as string | null | undefined) ?? profileUrl,
      name: `${rawFirstName} ${rawLastName}`.trim() || (raw.fullName as string | null | undefined) || null,
      headline: (raw.headline as string | null | undefined) ?? null,
      about: (raw.about as string | null | undefined) ?? (raw.summary as string | null | undefined) ?? null,
      location: locationStr,
      experience: experience.map(e => ({
        title: (e.title ?? e.position ?? 'Unknown role') as string,
        company: typeof e.company === 'object' && e.company !== null
          ? ((e.company as { name?: string }).name ?? 'Unknown')
          : (e.companyName ?? (e.company as string | undefined) ?? 'Unknown'),
        duration: e.duration ?? e.period ?? undefined,
        description: typeof e.description === 'string' ? e.description.slice(0, 300) : undefined,
      })),
      education: education.map(e => ({
        degree: e.degreeName ?? e.degree ?? undefined,
        fieldOfStudy: e.fieldOfStudy ?? undefined,
        school: typeof e.school === 'object' && e.school !== null
          ? ((e.school as { name?: string }).name ?? 'Unknown')
          : (e.schoolName ?? (e.school as string | undefined) ?? 'Unknown'),
      })),
      skills,
      connectionsCount: typeof raw.connectionsCount === 'number' ? raw.connectionsCount : null,
      followerCount: typeof raw.followerCount === 'number' ? raw.followerCount : null,
      posts,
    };

    return { profile, error: null };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Instagram scraper ────────────────────────────────────────────────────────

function computePostingFrequency(posts: InstagramPost[]): string {
  const withDates = posts.filter(p => p.daysAgo !== null) as (InstagramPost & { daysAgo: number })[];
  if (!withDates.length) return 'unknown';
  const oldestDaysAgo = Math.max(...withDates.map(p => p.daysAgo));
  if (oldestDaysAgo === 0) return 'daily';
  const postsPerDay = withDates.length / oldestDaysAgo;
  if (postsPerDay >= 1)    return 'daily';
  if (postsPerDay >= 0.14) return 'weekly';
  if (postsPerDay >= 0.03) return 'monthly';
  if (oldestDaysAgo > 180) return 'inactive';
  return 'occasional';
}

async function scrapeInstagram(
  profileUrl: string,
  apifyKey: string,
  xaiApiKey: string,
  xaiBaseUrl: string,
): Promise<{ profile: InstagramProfile | null; error: string | null }> {
  try {
    // Run profile + posts scraping in parallel
    const [profileItems, postItems] = await Promise.all([
      apifyRun(ACTOR_INSTAGRAM, { directUrls: [profileUrl], resultsType: 'details', resultsLimit: 1 }, apifyKey, 60),
      apifyRun(ACTOR_INSTAGRAM, { directUrls: [profileUrl], resultsType: 'posts', resultsLimit: 6 }, apifyKey, 90),
    ]) as [Record<string, unknown>[], Record<string, unknown>[]];

    if (!profileItems.length || (profileItems[0] as Record<string, unknown>).error) {
      return { profile: null, error: `Instagram: no profile found at ${profileUrl}` };
    }

    const raw = profileItems[0] as Record<string, unknown>;
    const username = (raw.username as string | null | undefined)
      ?? profileUrl.match(/instagram\.com\/([^/?#]+)/i)?.[1]
      ?? 'unknown';

    const now = Date.now();
    const rawPosts: InstagramPost[] = (postItems as Record<string, unknown>[])
      .filter(p => !p.error)
      .slice(0, 6)
      .map(p => {
        const ts = (p.timestamp as string | null | undefined) ?? null;
        const daysAgo = ts ? Math.floor((now - new Date(ts).getTime()) / 86_400_000) : null;
        return {
          url: (p.url as string | null | undefined) ?? null,
          timestamp: ts,
          daysAgo,
          caption: ((p.caption as string | null | undefined) ?? (p.text as string | null | undefined) ?? null)?.slice(0, 300) ?? null,
          likesCount: typeof p.likesCount === 'number' ? p.likesCount : null,
          commentsCount: typeof p.commentsCount === 'number' ? p.commentsCount : null,
          imageUrl: (p.displayUrl as string | null | undefined) ?? (p.imageUrl as string | null | undefined) ?? null,
          imageAnalysis: null,
        };
      });

    // Vision-analyse all post images in a single batched call
    const analysisMap = await analyzePostImages(rawPosts, xaiApiKey, xaiBaseUrl);
    const posts = rawPosts.map((p, i) => ({ ...p, imageAnalysis: analysisMap.get(i) ?? null }));

    const postsCount: number | null = typeof raw.postsCount === 'number' ? raw.postsCount
      : typeof raw.mediaCount === 'number' ? (raw.mediaCount as number)
      : (raw.edge_owner_to_timeline_media != null && typeof raw.edge_owner_to_timeline_media === 'object')
        ? (((raw.edge_owner_to_timeline_media as Record<string, unknown>).count) as number | null) ?? null
      : null;

    const externalUrls = Array.isArray(raw.externalUrls) ? (raw.externalUrls as Record<string, unknown>[]) : [];
    const externalUrl = externalUrls.length
      ? (externalUrls[0].url as string | null | undefined) ?? null
      : (raw.externalUrl as string | null | undefined) ?? (raw.external_url as string | null | undefined) ?? null;

    const profile: InstagramProfile = {
      profileUrl,
      username,
      fullName: (raw.fullName as string | null | undefined) ?? (raw.full_name as string | null | undefined) ?? null,
      biography: (raw.biography as string | null | undefined) ?? null,
      followersCount: typeof raw.followersCount === 'number' ? raw.followersCount : null,
      followingCount: typeof raw.followingCount === 'number' ? raw.followingCount : null,
      postsCount,
      isPrivate: Boolean(raw.private ?? raw.isPrivate ?? raw.is_private),
      isVerified: Boolean(raw.verified ?? raw.isVerified ?? raw.is_verified),
      externalUrl,
      recentPosts: posts,
      postingFrequency: computePostingFrequency(posts),
    };

    return { profile, error: null };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runExternalOsint(
  name: string | null,
  region: string,
  apifyKey: string,
  serperKey: string,
  xaiApiKey: string,
  xaiBaseUrl: string,
): Promise<ExternalOsintResult> {
  if (!name || name.trim().length < 2) {
    return {
      searched: false, nameSearched: name,
      linkedinUrl: null, instagramUrl: null,
      linkedin: null, linkedinError: 'Name unavailable — cannot search',
      instagram: null, instagramError: 'Name unavailable — cannot search',
    };
  }
  if (!apifyKey) {
    return {
      searched: false, nameSearched: name,
      linkedinUrl: null, instagramUrl: null,
      linkedin: null, linkedinError: 'APIFY_API_KEY not configured',
      instagram: null, instagramError: 'APIFY_API_KEY not configured',
    };
  }

  const cleanName = name.trim();
  const regionContext = region !== 'Unknown' ? ` ${region}` : '';

  // ── Step 1: Serper — find profile URLs ────────────────────────────────────
  let linkedinUrl: string | null = null;
  let instagramUrl: string | null = null;

  if (serperKey) {
    const [liResults, igResults] = await Promise.all([
      serperSearch(`"${cleanName}" site:linkedin.com/in${regionContext}`, serperKey).catch(() => []),
      serperSearch(`"${cleanName}" site:instagram.com${regionContext}`, serperKey).catch(() => []),
    ]);
    linkedinUrl  = extractUrl(liResults,  /linkedin\.com\/in\/[^/?#\s]+/i);
    instagramUrl = extractUrl(igResults, /instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/|stories\/)([^/?#\s]+)/i);
  }

  // ── Step 2: Scrape both profiles in parallel ──────────────────────────────
  const [linkedinResult, instagramResult] = await Promise.all([
    linkedinUrl
      ? scrapeLinkedIn(linkedinUrl, apifyKey)
      : Promise.resolve({ profile: null, error: serperKey ? 'LinkedIn profile not found via search' : 'SERPER_API_KEY not configured' }),
    instagramUrl
      ? scrapeInstagram(instagramUrl, apifyKey, xaiApiKey, xaiBaseUrl)
      : Promise.resolve({ profile: null, error: serperKey ? 'Instagram profile not found via search' : 'SERPER_API_KEY not configured' }),
  ]);

  return {
    searched: true,
    nameSearched: cleanName,
    linkedinUrl,
    instagramUrl,
    linkedin: linkedinResult.profile,
    linkedinError: linkedinResult.error,
    instagram: instagramResult.profile,
    instagramError: instagramResult.error,
  };
}

// ─── Format for LLM prompt ────────────────────────────────────────────────────

export function formatExternalOsintForPrompt(result: ExternalOsintResult): string {
  if (!result.searched) {
    return `External OSINT: SKIPPED — ${result.linkedinError ?? 'unknown reason'}`;
  }

  const lines: string[] = [`Name searched: "${result.nameSearched}"`];

  // ── LinkedIn ────────────────────────────────────────────────────────────────
  if (result.linkedin) {
    const li = result.linkedin;
    lines.push(`\n── LINKEDIN: ${li.profileUrl} ──`);
    if (li.name)            lines.push(`Name: ${li.name}`);
    if (li.headline)        lines.push(`Headline: ${li.headline}`);
    if (li.location)        lines.push(`Location: ${li.location}`);
    if (li.connectionsCount) lines.push(`Connections: ${li.connectionsCount}+ | Followers: ${li.followerCount ?? 'unknown'}`);
    if (li.about)           lines.push(`About: ${li.about.slice(0, 500)}${li.about.length > 500 ? '…' : ''}`);

    if (li.experience.length) {
      lines.push(`\nCAREER PATH (${li.experience.length} roles):`);
      li.experience.slice(0, 6).forEach((e, i) => {
        lines.push(`  ${i + 1}. ${e.title} @ ${e.company}${e.duration ? ` · ${e.duration}` : ''}`);
        if (e.description) lines.push(`     "${e.description.slice(0, 150)}"`);
      });
      // Career pattern analysis
      const titles = li.experience.map(e => e.title.toLowerCase());
      const isFounder = titles.some(t => /founder|ceo|owner|entrepreneur|co-founder/i.test(t));
      const isCreative = titles.some(t => /design|creative|artist|writer|content/i.test(t));
      const isTechnical = titles.some(t => /engineer|developer|analyst|data|tech/i.test(t));
      const isSales = titles.some(t => /sales|marketing|growth|business dev/i.test(t));
      const patterns: string[] = [];
      if (isFounder)   patterns.push('FOUNDER/EXECUTIVE profile');
      if (isCreative)  patterns.push('CREATIVE profile');
      if (isTechnical) patterns.push('TECHNICAL profile');
      if (isSales)     patterns.push('SALES/MARKETING profile');
      if (li.experience.length >= 4) patterns.push('HIGH career mobility');
      if (patterns.length) lines.push(`  Career pattern: ${patterns.join(' + ')}`);
    }

    if (li.education.length) {
      lines.push(`\nEDUCATION:`);
      li.education.slice(0, 3).forEach(e => {
        const deg = [e.degree, e.fieldOfStudy].filter(Boolean).join(', ');
        lines.push(`  • ${deg ? `${deg} — ` : ''}${e.school}`);
      });
    }

    if (li.skills.length) lines.push(`\nTop skills: ${li.skills.slice(0, 12).join(', ')}`);

    if (li.posts.length) {
      lines.push(`\nRECENT LINKEDIN POSTS (${li.posts.length}):`);
      li.posts.forEach((p, i) => {
        lines.push(`  Post ${i + 1}${p.publishedAt ? ` [${p.publishedAt}]` : ''}: "${p.text.slice(0, 200)}"`);
        if (p.likesCount) lines.push(`    Engagement: ${p.likesCount} likes, ${p.commentsCount ?? 0} comments`);
      });
    }
  } else {
    lines.push(`\nLINKEDIN: Not found — ${result.linkedinError ?? 'unknown error'}`);
  }

  // ── Instagram ───────────────────────────────────────────────────────────────
  if (result.instagram) {
    const ig = result.instagram;
    lines.push(`\n── INSTAGRAM: ${ig.profileUrl} ──`);
    if (ig.fullName)  lines.push(`Name: ${ig.fullName}`);
    if (ig.biography) lines.push(`Bio: ${ig.biography.slice(0, 300)}${ig.biography.length > 300 ? '…' : ''}`);
    lines.push(`Stats: ${ig.followersCount?.toLocaleString() ?? '?'} followers | ${ig.followingCount?.toLocaleString() ?? '?'} following | ${ig.postsCount?.toLocaleString() ?? '?'} posts`);
    if (ig.followersCount && ig.followingCount && ig.followingCount > 0) {
      const ratio = (ig.followersCount / ig.followingCount).toFixed(1);
      lines.push(`Follower ratio: ${ratio}x (${parseFloat(ratio) > 5 ? 'INFLUENCER/CREATOR personality' : parseFloat(ratio) < 0.5 ? 'FOLLOWER/CONSUMER personality' : 'PEER personality'})`);
    }
    if (ig.externalUrl) lines.push(`Bio link: ${ig.externalUrl}`);
    lines.push(`Account: ${ig.isPrivate ? 'PRIVATE' : 'PUBLIC'}${ig.isVerified ? ' · VERIFIED ✓' : ''} | Posting: ${ig.postingFrequency}`);

    if (ig.recentPosts.length) {
      lines.push(`\nLAST ${ig.recentPosts.length} POSTS:`);
      ig.recentPosts.forEach((p, i) => {
        const recency = p.daysAgo !== null ? `${p.daysAgo}d ago` : 'date unknown';
        lines.push(`  Post ${i + 1} [${recency}]:`);
        if (p.caption)  lines.push(`    Caption: "${p.caption.slice(0, 150)}"`);
        if (p.likesCount !== null) lines.push(`    ${p.likesCount.toLocaleString()} likes · ${(p.commentsCount ?? 0).toLocaleString()} comments`);
        if (p.imageAnalysis) {
          const ia = p.imageAnalysis;
          lines.push(`    Image: ${ia.setting} | Tone: ${ia.emotionalTone} | Presentation: ${ia.selfPresentation}`);
          if (ia.lifestyleSignals.length) lines.push(`    Lifestyle: ${ia.lifestyleSignals.join(', ')}`);
          if (ia.brandsVisible.length)   lines.push(`    Brands visible: ${ia.brandsVisible.join(', ')}`);
          if (ia.genomeSignals.length)   lines.push(`    Genome signals: ${ia.genomeSignals.join(' | ')}`);
        }
      });
    }
  } else {
    lines.push(`\nINSTAGRAM: Not found — ${result.instagramError ?? 'unknown error'}`);
  }

  return lines.join('\n');
}
