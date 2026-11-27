// Updating the reminders file on the site, from the app.
//
// A GitHub Pages site is static, so the only way for the app to change the
// calendar file that Calendar subscribes to is to commit a new version of it
// to the repository, which GitHub then publishes. That takes a GitHub key: a
// fine-grained personal access token limited to the one repository, allowed
// to write its files. The key stays on the device (see keyStore in store.js)
// and is only ever sent to api.github.com. Nothing in here logs it or puts it
// in an error message.

export const API = 'https://api.github.com';
export const FILE_NAME = 'meal-reminders.ics';

/** Opens GitHub's form for a new key, filled in as far as GitHub allows. */
export const NEW_KEY_URL = 'https://github.com/settings/personal-access-tokens/new?'
  + new URLSearchParams({
    name: 'Fuel reminders',
    description: 'Lets the Fuel app update meal-reminders.ics in this repository.',
    expires_in: '90',
    contents: 'write',
  }).toString();

export class PublishError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'PublishError';
    this.kind = kind;
  }
}

/**
 * The repository a GitHub Pages address comes from, as far as the address
 * tells: https://OWNER.github.io/REPO/ is a project site, and
 * https://OWNER.github.io/ is the OWNER.github.io repository. `path` is where
 * the calendar file sits in the repository, next to the app's index.html.
 * On any other host the owner and repository are left for you to fill in.
 */
export function guessRepo(href) {
  const url = new URL(href);
  const match = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname);
  if (!match) return { owner: '', repo: '', path: FILE_NAME };
  const owner = match[1].toLowerCase();
  const folders = url.pathname.split('/').slice(1, -1).filter(Boolean).map(decodeURIComponent);
  if (!folders.length) return { owner, repo: `${owner}.github.io`, path: FILE_NAME };
  return { owner, repo: folders[0], path: [...folders.slice(1), FILE_NAME].join('/') };
}

/** The calendar file's address on the site, and the same address for subscribing in Calendar. */
export function calendarUrls(href) {
  const url = new URL(FILE_NAME, href);
  url.hash = '';
  url.search = '';
  return { https: url.href, webcal: url.href.replace(/^https?:/, 'webcal:') };
}

/** Roughly what a GitHub key looks like: one word, at least 20 characters. */
export function looksLikeKey(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_]{20,255}$/.test(token.trim());
}

/** Classic keys reach every repository you can; fine-grained ones can be held to one. */
export function isClassicKey(token) {
  return typeof token === 'string' && /^ghp_/.test(token.trim());
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
export const isRepoName = (value) => typeof value === 'string' && NAME_RE.test(value) && value !== '.' && value !== '..';

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** Two calendar files say the same thing if they differ only in when they were made. */
export function sameCalendar(a, b) {
  const strip = (text) => String(text).replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('DTSTAMP:')).join('\n');
  return strip(a) === strip(b);
}

async function call(fetchImpl, token, method, path, body) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.trim()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new PublishError('Could not reach GitHub. Check the connection and try again.', 'network');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const limited = response.status === 403 && response.headers && response.headers.get('x-ratelimit-remaining') === '0';
  return { status: response.status, ok: response.ok, data, limited };
}

function failure(result, owner, repo) {
  const said = result.data && typeof result.data.message === 'string' ? result.data.message : '';
  switch (result.status) {
    case 401:
      return new PublishError('GitHub did not accept the key. It may have expired or been revoked. Make a new one and connect again.', 'auth');
    case 403:
      if (result.limited) return new PublishError('GitHub is limiting requests right now. Try again in a few minutes.', 'limited');
      return new PublishError(`The key is not allowed to change files in ${owner}/${repo}. It needs Contents set to Read and write.`, 'permission');
    case 404:
      return new PublishError(`GitHub found no repository ${owner}/${repo} for this key. Check the name, and that the key was given that repository.`, 'missing');
    case 409:
    case 422:
      return new PublishError(`GitHub would not take the file${said ? `: ${said}` : '.'}`, 'refused');
    default:
      return new PublishError(`GitHub answered with an error (${result.status})${said ? `: ${said}` : '.'}`, 'other');
  }
}

function repoPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Check that a key can see a repository. Returns its full name and the branch
 * the site is published from. Whether it may also write can only be known by
 * writing, which happens the first time the reminders are updated.
 */
export async function checkKey({ token, owner, repo, fetchImpl = fetch }) {
  const result = await call(fetchImpl, token, 'GET', repoPath(owner, repo));
  if (!result.ok) throw failure(result, owner, repo);
  return { fullName: result.data.full_name || `${owner}/${repo}`, branch: result.data.default_branch || 'main' };
}

/**
 * Write a text file to the repository's main branch, replacing what is there.
 * When the file already says the same thing (as judged by `same`) nothing is
 * written. If the file changes on GitHub between reading and writing, it reads
 * it again and tries once more.
 * Returns { unchanged, branch, commit }.
 */
export async function publishFile({ token, owner, repo, path, content, message, same = (a, b) => a === b, fetchImpl = fetch }) {
  const base = repoPath(owner, repo);
  const info = await call(fetchImpl, token, 'GET', base);
  if (!info.ok) throw failure(info, owner, repo);
  const branch = info.data.default_branch || 'main';
  const filePath = path.split('/').map(encodeURIComponent).join('/');

  for (let attempt = 0; ; attempt += 1) {
    const current = await call(fetchImpl, token, 'GET', `${base}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    let sha = null;
    if (current.ok && current.data && !Array.isArray(current.data)) {
      sha = current.data.sha;
      if (typeof current.data.content === 'string' && same(fromBase64(current.data.content), content)) {
        return { unchanged: true, branch, commit: null };
      }
    } else if (current.status !== 404) {
      throw failure(current, owner, repo);
    }
    const put = await call(fetchImpl, token, 'PUT', `${base}/contents/${filePath}`, {
      message,
      content: toBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    });
    if (put.ok) return { unchanged: false, branch, commit: put.data && put.data.commit ? put.data.commit.sha : null };
    if ((put.status === 409 || put.status === 422) && attempt === 0) continue;
    throw failure(put, owner, repo);
  }
}
