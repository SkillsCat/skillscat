export interface DurableObjectKvStoreOptions {
  /**
   * 红线:objectName 只允许固定常量,禁止按 key/租户动态命名。
   * DO 实例数直接决定时长计费,按 key 哈希命名会产生几千个常驻实例。
   */
  objectName: string;
}

export interface DurableObjectKvPutOptions {
  expiration?: number;
  expirationTtl?: number;
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

  return {
    async get(key: string): Promise<string | null> {
      const result = await callStateDurableObject<{ value: string | null }>(
        namespace,
        options.objectName,
        'kv/get',
        { key }
      );
      return result.value;
    },
    async put(key: string, value: string, putOptions?: DurableObjectKvPutOptions): Promise<void> {
      await callStateDurableObject<{ ok: true }>(
        namespace,
        options.objectName,
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
        options.objectName,
        'kv/delete',
        { key }
      );
    },
  } as unknown as KVNamespace;
}
