export function CreateChunks<T>(ids: T[], size: number) {
  const result: T[][] = [];

  for (let i = 0; i < ids.length; i += size) {
    result.push(ids.slice(i, i + size));
  }

  return result;
}
