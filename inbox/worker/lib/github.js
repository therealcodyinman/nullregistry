// Minimal GitHub REST client for the relay — just the calls needed to turn a
// verified record into a labeled pull request, using a fine-grained bot PAT
// (Contents RW + Pull requests RW on the one repo). No dependencies; fetch only.

const API = 'https://api.github.com';

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class GitHub {
  constructor(token, repo) {
    const [owner, name] = repo.split('/');
    this.token = token;
    this.owner = owner;
    this.repo = name;
  }

  async api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + this.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nullregistry-inbox',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async json(method, path, body) {
    const res = await this.api(method, path, body);
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const msg = (data && (data.message || JSON.stringify(data))) || ('HTTP ' + res.status);
      const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  base() { return `/repos/${this.owner}/${this.repo}`; }

  // true if a file exists on `ref` at `path`; false on a clean 404.
  async contentExists(path, ref) {
    const res = await this.api('GET', `${this.base()}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    const data = await res.json().catch(() => null);
    const msg = (data && data.message) || ('HTTP ' + res.status);
    const err = new Error(`GitHub contents lookup → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }

  async defaultBranch() {
    const repo = await this.json('GET', this.base());
    return repo.default_branch;
  }

  async refSha(branch) {
    const ref = await this.json('GET', `${this.base()}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  }

  async createBranch(branch, sha) {
    return this.json('POST', `${this.base()}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async putFile(path, branch, message, text) {
    const content = bytesToBase64(new TextEncoder().encode(text));
    return this.json('PUT', `${this.base()}/contents/${path}`, { message, content, branch });
  }

  async createPR(title, head, base, body) {
    return this.json('POST', `${this.base()}/pulls`, { title, head, base, body });
  }

  async addLabels(issueNumber, labels) {
    return this.json('POST', `${this.base()}/issues/${issueNumber}/labels`, { labels });
  }
}
