export interface DurableObjectKvStoreOptions {
  objectName: string | ((key: string) => string);
}

export interface DurableObjectKvPutOptions {
  expiration?: number;
  expirationTtl?: number;
}

export function hashDurableObjectName(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export async function callStateDurableObject<T>(
  namespace: DurableObjectNamespace,
  objectName: string,
  operation: string,
  body: unknown
): Promise<T> {
  const id = namespace.idFromName(objectName);
  const stub = namespace.get(id);
  const response = await stub.fetch(`https://state.skillscat.internal/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`State Durable Object ${operation} failed: ${response.status}${text ? ` ${text}` : ''}`);
  }

  return await response.json() as T;
}

export function createDurableObjectKvStore(
  namespace: DurableObjectNamespace | undefined,
  options: DurableObjectKvStoreOptions
): KVNamespace | undefined {
  if (!namespace) {
    return undefined;
  }

  const resolveObjectName = (key: string) => typeof options.objectName === 'function'
    ? options.objectName(key)
    : options.objectName;

  return {
    async get(key: string): Promise<string | null> {
      const result = await callStateDurableObject<{ value: string | null }>(
        namespace,
        resolveObjectName(key),
        'kv/get',
        { key }
      );
      return result.value;
    },
    async put(key: string, value: string, putOptions?: DurableObjectKvPutOptions): Promise<void> {
      await callStateDurableObject<{ ok: true }>(
        namespace,
        resolveObjectName(key),
        'kv/put',
        {
          key,
          value,
          expiration: putOptions?.expiration,
          expirationTtl: putOptions?.expirationTtl,
        }
      );
    },
    async delete(key: string): Promise<void> {
      await callStateDurableObject<{ ok: true }>(
        namespace,
        resolveObjectName(key),
        'kv/delete',
        { key }
      );
    },
  } as unknown as KVNamespace;
}
