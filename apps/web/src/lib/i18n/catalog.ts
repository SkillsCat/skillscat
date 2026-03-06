export type DeepLocalized<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly (infer U)[]
      ? DeepLocalized<U>[]
      : T[K] extends object
        ? DeepLocalized<T[K]>
        : T[K];
};
