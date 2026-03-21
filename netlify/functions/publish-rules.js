/**
 * publish-rules — Netlify serverless function
 *
 * POST { secret, versionId, name, description, content }
 *
 * Env vars (set in Netlify dashboard — never in code):
 *   GITHUB_PAT       fine-grained token, AIRuleBuilderWeb repo, Contents read+write
 *   PUBLISH_SECRET   shared team passphrase
 */
'use strict';

const GITHUB_API = 'https://api.github.com';
const OWNER = 'Maartinsh';
const REPO  = 'AIRuleBuilderWeb';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { secret, versionId, name, description, content } = body;

  if (!secret || secret !== process.env.PUBLISH_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!versionId || !name || !content) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: versionId, name, content' }) };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && !/^[a-z0-9]$/.test(name)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid name format' }) };
  }

  const pat = process.env.GITHUB_PAT;
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 1. Fetch current manifest (may not exist yet)
  let manifest = { versions: [] };
  let manifestSha = null;
  try {
    const mRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/rules/manifest.json`, { headers });
    if (mRes.ok) {
      const mData = await mRes.json();
      manifestSha = mData.sha;
      manifest = JSON.parse(Buffer.from(mData.content, 'base64').toString('utf8'));
    }
  } catch { /* manifest doesn't exist yet — start fresh */ }

  // 2. Enforce name uniqueness
  if ((manifest.versions || []).find(v => v.name === name)) {
    return { statusCode: 409, body: JSON.stringify({ error: `Name '${name}' already exists — choose a different name` }) };
  }

  // 3. Write version file
  const versionPath = `rules/${versionId}.json`;
  const versionBase64 = Buffer.from(content, 'utf8').toString('base64');

  // Check if version file already exists (get SHA for update)
  let versionSha = null;
  try {
    const vRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${versionPath}`, { headers });
    if (vRes.ok) versionSha = (await vRes.json()).sha;
  } catch { /* new file */ }

  const versionBody = { message: `Publish version ${versionId}`, content: versionBase64 };
  if (versionSha) versionBody.sha = versionSha;

  const vPutRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${versionPath}`, {
    method: 'PUT', headers, body: JSON.stringify(versionBody)
  });
  if (!vPutRes.ok) {
    const err = await vPutRes.json().catch(() => ({}));
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to write version file: ${err.message || vPutRes.status}` }) };
  }

  // 4. Update manifest
  const publishedAt = new Date().toISOString();
  let ruleCount = 0;
  try { ruleCount = JSON.parse(content)._meta?.ruleCount ?? JSON.parse(content).rules?.length ?? 0; } catch { /* ignore */ }

  const newEntry = { id: versionId, name, label: _formatLabel(publishedAt, name), publishedAt, ruleCount, description: description || '' };
  manifest.versions = [newEntry, ...(manifest.versions || [])];
  manifest.updatedAt = publishedAt;

  const manifestBase64 = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8').toString('base64');
  const manifestBody = { message: `Update manifest — add ${versionId}`, content: manifestBase64 };
  if (manifestSha) manifestBody.sha = manifestSha;

  const mPutRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/rules/manifest.json`, {
    method: 'PUT', headers, body: JSON.stringify(manifestBody)
  });
  if (!mPutRes.ok) {
    const err = await mPutRes.json().catch(() => ({}));
    return { statusCode: 500, body: JSON.stringify({ error: `Version saved but manifest update failed: ${err.message || mPutRes.status}` }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, versionId }),
  };
};

function _formatLabel(isoDate, name) {
  const d = new Date(isoDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} \u2013 ${name}`;
}
