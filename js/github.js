// Dünner Client für die GitHub-API. Geschrieben wird über die Git-Data-API:
// ein Eintrag mit fünf Fotos wird so zu *einem* Commit statt zu sechs.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

function humanError(status, body, path) {
  const msg = body?.message || '';
  if (status === 401) return 'Token ungültig oder abgelaufen.';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub-Ratelimit erreicht. In einer Stunde nochmal.';
  if (status === 403) return 'Token fehlen die Rechte für dieses Repo (Contents: Read and write nötig).';
  if (status === 404) return `Nicht gefunden: ${path}. Repo-Name, Branch oder Token-Zugriff prüfen.`;
  if (status === 409) return 'Repo ist leer oder der Branch existiert noch nicht.';
  if (status === 422) return `GitHub hat die Anfrage abgelehnt: ${msg}`;
  return `GitHub-Fehler ${status}${msg ? ': ' + msg : ''}`;
}

export class GitHub {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
  }
  get base() { return `${API}/repos/${this.owner}/${this.repo}`; }

  async req(path, { method = 'GET', body, raw = false, absolute = false } = {}) {
    const url = absolute ? path : this.base + path;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new GitHubError('Keine Verbindung zu GitHub.', 0, null);
    }
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* kein JSON */ }
      throw new GitHubError(humanError(res.status, payload, path), res.status, payload);
    }
    if (raw) return res.arrayBuffer();
    return res.status === 204 ? null : res.json();
  }

  verify() { return this.req(''); }

  async headSha() {
    const ref = await this.req(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
    return ref.object.sha;
  }
  commit(sha) { return this.req(`/git/commits/${sha}`); }

  /** @returns {{sha:string, tree:Array, truncated:boolean}} */
  tree(sha) { return this.req(`/git/trees/${sha}?recursive=1`); }

  blobRaw(sha) { return this.req(`/git/blobs/${sha}`, { raw: true }); }

  async blobText(sha) {
    const buf = await this.blobRaw(sha);
    return new TextDecoder('utf-8').decode(buf);
  }

  async createBlobFromBlob(blob) {
    const content = await toBase64(blob);
    const r = await this.req('/git/blobs', { method: 'POST', body: { content, encoding: 'base64' } });
    return r.sha;
  }
  async createBlobFromText(text) {
    const r = await this.req('/git/blobs', { method: 'POST', body: { content: text, encoding: 'utf-8' } });
    return r.sha;
  }

  createTree(baseTree, entries) {
    return this.req('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
  }
  createCommit(message, treeSha, parents) {
    return this.req('/git/commits', { method: 'POST', body: { message, tree: treeSha, parents } });
  }
  updateRef(sha, force = false) {
    return this.req(`/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: 'PATCH', body: { sha, force }
    });
  }

  /** Erster Commit in ein leeres Repo. */
  async initBranch(files) {
    const entries = [];
    for (const f of files) entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
    const tree = await this.req('/git/trees', { method: 'POST', body: { tree: entries } });
    const commit = await this.createCommit('Krankenakte angelegt', tree.sha, []);
    await this.req('/git/refs', { method: 'POST', body: { ref: `refs/heads/${this.branch}`, sha: commit.sha } });
    return commit.sha;
  }
}

export function toBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',', 2)[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
