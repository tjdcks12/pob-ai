// Installs Path of Building (PoE2) for people who do not have it yet: the portable release from
// PoB's GitHub releases, unpacked into the PoB AI data folder. From then on PoB updates itself.
import fs from 'node:fs';
import { statePath, updateConfig } from '../state.mjs';
import { download, extractZip, packageRoot } from '../update/updater.mjs';
import { EXE_NAME, inspectInstall } from './locate.mjs';

const RELEASES = 'https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases/latest';

/** Picks the portable zip from a GitHub release. */
export function portableAsset(release) {
  const assets = release?.assets ?? [];
  return assets.find(a => /portable/i.test(a.name) && /\.zip$/i.test(a.name)) ?? null;
}

export async function installPob({ fetchImpl = fetch, dir = statePath('pob') } = {}) {
  const existing = inspectInstall(dir);
  if (existing) {
    updateConfig({ pobPath: existing.dir });
    return { installed: false, alreadyInstalled: true, ...existing };
  }
  const api = process.env.POB_AI_POB_RELEASES || RELEASES;
  const response = await fetchImpl(api, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status} for the PoB release list.`), { code: 'DOWNLOAD_FAILED' });
  const release = await response.json();
  const asset = portableAsset(release);
  if (!asset) {
    throw Object.assign(new Error(`The latest PoB release (${release.tag_name ?? '?'}) has no portable zip.`), { code: 'DOWNLOAD_FAILED', details: { assets: (release.assets ?? []).map(a => a.name) } });
  }
  const zip = statePath('downloads', asset.name);
  await download(asset.browser_download_url, zip, { size: asset.size, fetchImpl });
  const temp = `${dir}.partial`;
  fs.rmSync(temp, { recursive: true, force: true });
  await extractZip(zip, temp);
  const root = packageRoot(temp, EXE_NAME);
  if (!root || !inspectInstall(root)) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw Object.assign(new Error(`${asset.name} does not contain Path of Building (PoE2).`), { code: 'DOWNLOAD_CORRUPT' });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(root, dir);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  const install = inspectInstall(dir);
  updateConfig({ pobPath: install.dir });
  return { installed: true, release: release.tag_name ?? null, ...install };
}
