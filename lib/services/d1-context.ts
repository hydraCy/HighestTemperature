import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function getD1() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as Record<string, unknown>)?.polymarket_shanghai as
      | {
          prepare: (sql: string) => {
            bind: (...values: unknown[]) => {
              first: <T = Record<string, unknown>>() => Promise<T | null>;
              all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
              run: () => Promise<unknown>;
            };
            first: <T = Record<string, unknown>>() => Promise<T | null>;
            all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
            run: () => Promise<unknown>;
          };
        }
      | undefined;
  } catch {
    return undefined;
  }
}
