import type { SkillDetail } from '$lib/types';

export type DownloadSkillOutcome =
  | 'installed'
  | 'cancelled'
  | 'rate_limited'
  | 'fallback_download';

interface DirectSkillFilesPayload {
  folderName: string;
  files: Array<{ path: string; content: string }>;
}

interface DownloadSkillOptions {
  skill: SkillDetail;
  encodedApiSkillSlug: string;
  tooManyRequestsMessage: string;
  downloadFailedMessage: string;
}

function fallbackDownload(encodedApiSkillSlug: string): void {
  window.location.href = `/api/skills/${encodedApiSkillSlug}/download`;
}

async function writeSkillFilesToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  folderName: string,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  const skillDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

  for (const file of files) {
    let targetDir: FileSystemDirectoryHandle = skillDir;
    const pathParts = file.path.split('/');
    const fileName = pathParts.pop();

    if (!fileName) continue;

    for (const part of pathParts) {
      if (part) {
        targetDir = await targetDir.getDirectoryHandle(part, { create: true });
      }
    }

    const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.content);
    await writable.close();
  }
}

export async function downloadSkill(options: DownloadSkillOptions): Promise<DownloadSkillOutcome> {
  const { encodedApiSkillSlug, tooManyRequestsMessage, downloadFailedMessage } = options;

  if (!('showDirectoryPicker' in window)) {
    fallbackDownload(encodedApiSkillSlug);
    return 'fallback_download';
  }

  try {
    const dirHandle = await (window as unknown as {
      showDirectoryPicker: (config: { mode: string; startIn: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });

    const response = await fetch(`/api/skills/${encodedApiSkillSlug}/files`);

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(tooManyRequestsMessage);
        return 'rate_limited';
      }

      throw new Error(downloadFailedMessage);
    }

    const payload = await response.json() as DirectSkillFilesPayload;

    await writeSkillFilesToDirectory(dirHandle, payload.folderName, payload.files);
    return 'installed';
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return 'cancelled';
    }

    console.error('Download failed:', error);
    fallbackDownload(encodedApiSkillSlug);
    return 'fallback_download';
  }
}
