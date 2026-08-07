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

export interface DurableObjectKvPutIfChangedOptions extends DurableObjectKvPutOptions {
  /** JSON 浅层比较时忽略的字段(如时间戳) */
  ignoreFields?: string[];
  /** 旧值在窗口内且等价时跳过写入 */
  noopWithinMs?: number;
  /** 旧值 JSON 中表示更新时间的字段名 */
  updatedAtField?: string;
}

export interface DurableObjectKvPutIfChangedResult {
  written: boolean;
  value: string;
}

/**
 * DO 版 KV 适配器在标准 KVNamespace 之上暴露批量读和条件写,
 * 用于把多次 DO fetch 合并成一次,压缩 DO active 计费时长。
 * KV fallback 路径没有这两个方法,用 isDurableObjectKvStore 区分。
 */
export interface DurableObjectKvStore extends KVNamespace {
  getMany(keys: string[]): Promise<(string | null)[]>;
  putIfChanged(
    key: string,
    value: string,
    options?: DurableObjectKvPutIfChangedOptions
  ): Promise<DurableObjectKvPutIfChangedResult>;
}

export function isDurableObjectKvStore(kv: KVNamespace | undefined): kv is DurableObjectKvStore {
  if (!kv) return false;
  const candidate = kv as Partial<DurableObjectKvStore>;
  return typeof candidate.getMany === 'function' && typeof candidate.putIfChanged === 'function';
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
): DurableObjectKvStore | undefined {
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
    async getMany(keys: string[]): Promise<(string | null)[]> {
      if (keys.length === 0) {
        return [];
      }

      const result = await callStateDurableObject<{ values: (string | null)[] }>(
        namespace,
        options.objectName,
        'kv/getMany',
        { keys }
      );
      return result.values;
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
    async putIfChanged(
      key: string,
      value: string,
      putOptions?: DurableObjectKvPutIfChangedOptions
    ): Promise<DurableObjectKvPutIfChangedResult> {
      return await callStateDurableObject<DurableObjectKvPutIfChangedResult>(
        namespace,
        options.objectName,
        'kv/putIfChanged',
        {
          key,
          value,
          expiration: putOptions?.expiration,
          expirationTtl: putOptions?.expirationTtl,
          ignoreFields: putOptions?.ignoreFields,
          noopWithinMs: putOptions?.noopWithinMs,
          updatedAtField: putOptions?.updatedAtField,
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
  } as unknown as DurableObjectKvStore;
}
