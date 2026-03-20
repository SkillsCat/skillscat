const ARCHIVE_PREFIX = 'archive/';

export function isSkillArchiveObjectKey(key: string, skillId: string): boolean {
  return key.startsWith(ARCHIVE_PREFIX) && key.endsWith(`/${skillId}.json`);
}

export async function findSkillArchiveObjectKey(
  r2: R2Bucket,
  skillId: string
): Promise<string | null> {
  let cursor: string | undefined;

  do {
    const listed = await r2.list({
      prefix: ARCHIVE_PREFIX,
      cursor,
      limit: 1000,
    });

    for (const object of listed.objects) {
      if (isSkillArchiveObjectKey(object.key, skillId)) {
        return object.key;
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return null;
}
