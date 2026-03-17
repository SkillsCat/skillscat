export const DOT_FOLDER_MIN_STARS = 500;

export function isInDotFolder(path: string): boolean {
  return /^\.[\w-]+\//.test(path);
}
