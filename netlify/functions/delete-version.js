/**
 * delete-version — Netlify serverless function
 *
 * DELETE { secret, versionId }
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
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { secret, versionId } = body;

  if (!secret || secret !== process.env.PUBLISH_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!versionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: versionId' }) };
  }

  const pat = process.env.GITHUB_PAT;
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const versionPath = `rules/${versionId}.json`;

  // 1. Get SHA for version file
  const vRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${versionPath}`, { headers });
  if (vRes.status === 404) {
    return { statusCode: 404, body: JSON.stringify({ error: `Version '${versionId}' not found` }) };
  }
  if (!vRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to fetch version file: ${vRes.status}` }) };
  }
  const { sha: versionSha } = await vRes.json();

  // 2. Delete version file
  const delRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${versionPath}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ message: `Delete version ${versionId}`, sha: versionSha }),
  });
  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({}));
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to delete version file: ${err.message || delRes.status}` }) };
  }

  // 3. Update manifest — remove entry
  let manifest = { versions: [] };
  let manifestSha = null;
  try {
    const mRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/rules/manifest.json`, { headers });
    if (mRes.ok) {
      const mData = await mRes.json();
      manifestSha = mData.sha;
      manifest = JSON.parse(Buffer.from(mData.content, 'base64').toString('utf8'));
    }
  } catch { /* manifest missing — nothing to update */ }

  if (manifestSha) {
    manifest.versions = (manifest.versions || []).filter(v => v.id !== versionId);
    manifest.updatedAt = new Date().toISOString();

    const manifestBase64 = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8').toString('base64');
    const mPutRes = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/rules/manifest.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message: `Update manifest — remove ${versionId}`, content: manifestBase64, sha: manifestSha }),
    });
    if (!mPutRes.ok) {
      // Version is deleted but manifest wasn't updated — log but don't fail the response
      console.error(`Manifest update failed after deleting ${versionId}: ${mPutRes.status}`);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
