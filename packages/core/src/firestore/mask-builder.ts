/**
 * Types representing Firestore REST API document values.
 */
export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { bytesValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { referenceValue: string };

export interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

/**
 * Converts a JavaScript value into a Firestore REST Document Value.
 */
export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }

  if (typeof val === "string") {
    return { stringValue: val };
  }

  if (typeof val === "number") {
    if (Number.isInteger(val)) {
      return { integerValue: val.toString() };
    }
    return { doubleValue: val };
  }

  if (typeof val === "boolean") {
    return { booleanValue: val };
  }

  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }

  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFirestoreValue(item)),
      },
    };
  }

  if (typeof val === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return {
      mapValue: {
        fields,
      },
    };
  }

  return { stringValue: String(val) };
}

/**
 * Converts a Firestore REST Document Value back into a plain JavaScript value.
 */
export function fromFirestoreValue(val: FirestoreValue): unknown {
  if (!val || typeof val !== "object") return null;

  if ("nullValue" in val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) {
    const num = Number(val.integerValue);
    return Number.isSafeInteger(num) ? num : val.integerValue;
  }
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("bytesValue" in val) return val.bytesValue;
  if ("referenceValue" in val) return val.referenceValue;
  if ("geoPointValue" in val) return val.geoPointValue;

  if ("arrayValue" in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map((item) => fromFirestoreValue(item));
  }

  if ("mapValue" in val) {
    const fields = val.mapValue?.fields || {};
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }

  return null;
}

/**
 * Converts a JavaScript record into Firestore fields object.
 */
export function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

/**
 * Converts Firestore document fields into a plain JavaScript record.
 */
export function fromFirestoreFields<T = Record<string, unknown>>(
  fields?: Record<string, FirestoreValue>
): T {
  if (!fields) return {} as T;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj as T;
}

/**
 * Builds dot-notated field paths for Firestore updateMask.
 *
 * @param data Object or array of field path strings
 * @param options Mode: 'shallow' (top-level keys only) or 'deep' (nested dot notation)
 */
export function buildUpdateMask(
  data: string[] | Record<string, unknown>,
  options?: { mode?: "shallow" | "deep"; prefix?: string }
): string[] {
  if (Array.isArray(data)) {
    return data;
  }

  const mode = options?.mode ?? "shallow";
  const prefix = options?.prefix ? `${options.prefix}.` : "";
  const fieldPaths: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    const fullPath = `${prefix}${key}`;
    if (
      mode === "deep" &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      Object.keys(value).length > 0
    ) {
      fieldPaths.push(
        ...buildUpdateMask(value as Record<string, unknown>, {
          mode: "deep",
          prefix: fullPath,
        })
      );
    } else {
      fieldPaths.push(fullPath);
    }
  }

  return fieldPaths;
}
