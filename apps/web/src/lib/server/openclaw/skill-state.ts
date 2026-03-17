import type { SkillFile } from '$lib/server/skill/files';
import {
  getOpenClawManifestLatestVersion,
  getOpenClawManifestVersion,
  readOpenClawManifest,
  readOpenClawVersionFiles,
  type OpenClawCompatManifest,
  type OpenClawCompatVersionEntry,
} from '$lib/server/openclaw/compat-store';
import { buildOpenClawLatestVersion, buildOpenClawTags } from '$lib/server/openclaw/registry';

export interface OpenClawResolvedVersionState {
  manifest: OpenClawCompatManifest | null;
  latestVersion: ReturnType<typeof buildOpenClawLatestVersion>;
  tags: Record<string, string>;
  versions: OpenClawCompatVersionEntry[];
  selectedVersion: OpenClawCompatVersionEntry | null;
  usesManifest: boolean;
}

export async function resolveOpenClawVersionState(input: {
  r2: R2Bucket | undefined;
  compatSlug: string;
  updatedAt: number | null | undefined;
  createdAt?: number | null | undefined;
  requestedVersion?: string | null | undefined;
  requestedTag?: string | null | undefined;
}): Promise<OpenClawResolvedVersionState> {
  const manifest = await readOpenClawManifest(input.r2, input.compatSlug);
  const manifestLatest = getOpenClawManifestLatestVersion(manifest);

  if (manifest && manifestLatest) {
    const selectedVersion = getOpenClawManifestVersion(
      manifest,
      input.requestedVersion,
      input.requestedTag
    );

    return {
      manifest,
      latestVersion: buildOpenClawLatestVersion({
        updatedAt: manifestLatest.createdAt,
        createdAt: manifestLatest.createdAt,
        version: manifestLatest.version,
        changelog: manifestLatest.changelog,
        changelogSource: manifestLatest.changelogSource,
        license: manifestLatest.license,
      }),
      tags: Object.keys(manifest.tags).length > 0 ? manifest.tags : buildOpenClawTags(manifestLatest.createdAt),
      versions: manifest.versions,
      selectedVersion,
      usesManifest: true,
    };
  }

  const fallback = buildOpenClawLatestVersion({
    updatedAt: input.updatedAt,
    createdAt: input.createdAt,
  });

  return {
    manifest: null,
    latestVersion: fallback,
    tags: buildOpenClawTags(input.updatedAt),
    versions: [
      {
        version: fallback.version,
        createdAt: fallback.createdAt,
        changelog: fallback.changelog,
        changelogSource: fallback.changelogSource,
        license: fallback.license,
        fingerprint: null,
      },
    ],
    selectedVersion:
      input.requestedVersion && input.requestedVersion !== fallback.version
        ? null
        : {
            version: fallback.version,
            createdAt: fallback.createdAt,
            changelog: fallback.changelog,
            changelogSource: fallback.changelogSource,
            license: fallback.license,
            fingerprint: null,
          },
    usesManifest: false,
  };
}

export async function resolveOpenClawFilesForVersion(input: {
  r2: R2Bucket | undefined;
  compatSlug: string;
  selectedVersion: OpenClawCompatVersionEntry | null;
  fallbackFiles: SkillFile[];
}): Promise<SkillFile[]> {
  if (!input.selectedVersion) {
    return [];
  }

  const versionFiles = await readOpenClawVersionFiles(
    input.r2,
    input.compatSlug,
    input.selectedVersion.version
  );

  return versionFiles.length > 0 ? versionFiles : input.fallbackFiles;
}
