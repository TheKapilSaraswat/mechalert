import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';

const USER_AGENT = 'MechAlert/1.0 (by /u/Apprehensive_Box2960)';
const ALL_SUBREDDITS = ['mechmarket', 'hardwareswap', 'appleswap', 'photomarket', 'homelabsales', 'AVexchange', 'gamesale', 'Pen_Swap'];
const CACHE_TTL = 15 * 60 * 1000;
const INITIAL_DELAY = 10 * 60 * 1000;
const COOLDOWN_AFTER_429 = 15 * 60 * 1000;

let cachedPosts = [];
let cachedTime = 0;
let last429At = 0;
let firstAttempt = true;

function extractSubreddit(path) {
  const m = path.match(/^\/r\/(\w+)/);
  return m ? m[1] : null;
}

function stripHtml(html) {
  return html ? html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim() : '';
}

function parseEntryId(id) {
  const m = id.match(/\/comments\/([a-z0-9]+)\//i);
  return m ? m[1] : id;
}

function parseRSS(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const feed = parser.parse(xml);
  const rawEntries = feed.feed?.entry;
  if (!rawEntries) return [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  return entries.map(entry => ({
    id: parseEntryId(entry.id),
    title: entry.title || '',
    selftext: stripHtml(typeof entry.content === 'string' ? entry.content : (entry.content?.['#text'] || '')),
    permalink: (entry.link?.['@_href'] || entry.id).replace('https://www.reddit.com', ''),
    thumbnail: entry['media:thumbnail']?.['@_url'] || null,
    subreddit: entry.category?.['@_term'] ? entry.category['@_term'].replace('r/', '') : null,
  }));
}

function parseJSON(body) {
  const children = body?.data?.children || [];
  return children.map(c => {
    const d = c.data;
    return {
      id: d.id,
      title: d.title || '',
      selftext: d.selftext || '',
      permalink: d.permalink || '',
      thumbnail: d.thumbnail || (d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&')) || null,
      subreddit: d.subreddit || null,
      url: d.url || '',
    };
  });
}

function deduplicate(posts) {
  const seen = new Set();
  return posts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

async function fetchAllSubreddits() {
  const now = Date.now();
  if (firstAttempt) {
    firstAttempt = false;
    await new Promise(r => setTimeout(r, INITIAL_DELAY));
  }
  if (cachedPosts.length > 0 && (now - cachedTime) < CACHE_TTL) {
    return cachedPosts;
  }
  const cooldown = now - last429At;
  if (cooldown < COOLDOWN_AFTER_429) {
    if (cachedPosts.length > 0) {
      console.warn(`Reddit 429 cooldown active, serving ${cachedPosts.length} cached posts`);
      return cachedPosts;
    }
    return [];
  }
  const subs = ALL_SUBREDDITS.join('+');
  const jsonUrl = `https://www.reddit.com/r/${subs}/new.json?limit=100`;
  const rssUrl = `https://www.reddit.com/r/${subs}/new/.rss?limit=100`;
  let posts = [];
  for (const url of [jsonUrl, rssUrl]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429) {
        last429At = Date.now();
        continue;
      }
      if (!res.ok) continue;
      posts = url.includes('.json') ? parseJSON(await res.json()) : parseRSS(await res.text());
      if (posts.length > 0) break;
    } catch {
      continue;
    }
  }
  if (posts.length === 0) {
    last429At = Date.now();
    if (cachedPosts.length > 0) return cachedPosts;
    return [];
  }
  posts = deduplicate(posts);
  cachedPosts = posts;
  cachedTime = Date.now();
  return posts;
}

export async function fetchReddit(path) {
  const subreddit = extractSubreddit(path);
  const allPosts = await fetchAllSubreddits();
  const filtered = subreddit ? allPosts.filter(p => p.subreddit === subreddit) : allPosts;
  return {
    data: {
      children: filtered.map(p => ({
        data: {
          id: p.id,
          title: p.title,
          selftext: p.selftext,
          permalink: p.permalink,
          preview: p.thumbnail ? { images: [{ source: { url: p.thumbnail } }] } : null,
          thumbnail: p.thumbnail,
          subreddit: p.subreddit,
        },
      })),
    },
  };
}
