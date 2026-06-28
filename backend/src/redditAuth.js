import fs from 'fs';
import fetch from 'node-fetch';
import os from 'os';
import { XMLParser } from 'fast-xml-parser';

const TOKEN_PATH = os.homedir() + '/.devvit/token';
const USER_AGENT = 'MechAlert/1.0 (by /u/Apprehensive_Box2960)';

let cachedToken = null;
let tokenExpires = 0;
let useRssFallback = false;

function readDevvitFile() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
  const wrapper = JSON.parse(raw);
  return JSON.parse(Buffer.from(wrapper.token, 'base64').toString());
}

function readDevvitEnv() {
  const raw = process.env.REDDIT_TOKEN;
  if (!raw) return null;
  const wrapper = JSON.parse(raw);
  return JSON.parse(Buffer.from(wrapper.token, 'base64').toString());
}

async function getOAuthToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) return null;

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  });

  if (!res.ok) throw new Error(`Reddit OAuth token error: ${res.status}`);
  const data = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpires) return cachedToken;

  const oauth = await getOAuthToken();
  if (oauth) {
    cachedToken = oauth.accessToken;
    tokenExpires = Date.now() + (oauth.expiresIn - 60) * 1000;
    return cachedToken;
  }

  const devvit = readDevvitEnv() || readDevvitFile();
  if (!devvit || !devvit.accessToken) throw new Error('No Reddit auth configured. Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET + REDDIT_USERNAME + REDDIT_PASSWORD for OAuth, or provide a valid REDDIT_TOKEN');
  return devvit.accessToken;
}

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

async function fetchRedditViaRSS(path, attempt = 1) {
  const subreddit = extractSubreddit(path);
  if (!subreddit) throw new Error(`Cannot parse subreddit from path: ${path}`);

  const url = `https://www.reddit.com/r/${subreddit}/new/.rss`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (res.status === 429 && attempt < 3) {
    const backoff = attempt * 5000;
    console.warn(`RSS 429 on r/${subreddit}, retrying in ${backoff}ms (attempt ${attempt})`);
    await new Promise(r => setTimeout(r, backoff));
    return fetchRedditViaRSS(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`RSS fetch error: ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const feed = parser.parse(xml);
  const rawEntries = feed.feed?.entry;
  if (!rawEntries) return { data: { children: [] } };

  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  const children = entries.map(entry => {
    const id = parseEntryId(entry.id);
    const linkHref = entry.link?.['@_href'] || entry.id;
    const permalink = linkHref.replace('https://www.reddit.com', '');
    const rawContent = entry.content?.['#text'] || entry.content || '';
    const selftext = stripHtml(typeof rawContent === 'string' ? rawContent : String(rawContent));
    let thumbnail = null;
    if (entry['media:thumbnail']?.['@_url']) {
      thumbnail = entry['media:thumbnail']['@_url'];
    }

    return {
      data: {
        id,
        title: entry.title || '',
        selftext,
        permalink,
        preview: thumbnail ? { images: [{ source: { url: thumbnail } }] } : null,
        thumbnail,
      },
    };
  });

  return { data: { children } };
}

export async function fetchReddit(path) {
  if (!useRssFallback && process.env.REDDIT_CLIENT_ID) {
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(`https://oauth.reddit.com${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': USER_AGENT,
        },
      });
      if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`OAuth failed (${err.message}), falling back to RSS`);
      useRssFallback = true;
    }
  }

  return fetchRedditViaRSS(path);
}
