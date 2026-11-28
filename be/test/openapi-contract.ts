/**
 * Minimal OpenAPI 3.0 response validator for E2E contract checks (FE-011 support).
 * Covers the subset @nestjs/swagger emits: $ref, allOf, type, properties, required, items, enum,
 * nullable, additionalProperties and the uuid/date-time/date formats. No extra dependency needed.
 */
type Schema = Record<string, any>;
type Document = { paths: Record<string, Record<string, any>>; components?: { schemas?: Record<string, Schema> } };

const FORMATS: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/
};

function resolve(doc: Document, schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = String(schema.$ref).replace('#/components/schemas/', '');
  const target = doc.components?.schemas?.[name];
  if (!target) throw new Error(`Unresolved schema reference ${schema.$ref}`);
  return resolve(doc, target);
}

function validate(doc: Document, input: Schema, value: unknown, path: string, errors: string[]) {
  const schema = resolve(doc, input);
  // Nullability is declared on the wrapper (`nullable` next to `allOf: [$ref]`), so check it before descending.
  if (value === null) { if (!schema.nullable) errors.push(`${path}: null is not allowed`); return; }
  if (schema.allOf) { for (const part of schema.allOf) validate(doc, part, value, path, errors); return; }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  const type = schema.type ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'string':
      if (typeof value !== 'string') { errors.push(`${path}: expected string, got ${typeof value}`); return; }
      if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format].test(value)) errors.push(`${path}: ${JSON.stringify(value)} is not ${schema.format}`);
      return;
    case 'number': case 'integer':
      if (typeof value !== 'number') errors.push(`${path}: expected number, got ${typeof value}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean, got ${typeof value}`);
      return;
    case 'array':
      if (!Array.isArray(value)) { errors.push(`${path}: expected array`); return; }
      value.forEach((item, index) => validate(doc, schema.items ?? {}, item, `${path}[${index}]`, errors));
      return;
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected object`); return; }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${path}.${key}: required property missing`);
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in record && record[key] !== undefined) validate(doc, child as Schema, record[key], `${path}.${key}`, errors);
      }
      if (schema.properties && schema.additionalProperties !== true) {
        for (const key of Object.keys(record)) if (!(key in schema.properties)) errors.push(`${path}.${key}: property not declared in the contract`);
      }
      return;
    }
    default:
      return;
  }
}

/** Throws with every mismatch when `body` does not match the documented JSON response for the operation. */
export function assertMatchesContract(doc: Document, method: string, routeTemplate: string, status: number, body: unknown) {
  const operation = doc.paths[routeTemplate]?.[method.toLowerCase()];
  if (!operation) throw new Error(`No OpenAPI operation for ${method.toUpperCase()} ${routeTemplate}`);
  const schema = operation.responses?.[String(status)]?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`No JSON schema for ${method.toUpperCase()} ${routeTemplate} ${status}`);
  const errors: string[] = [];
  validate(doc, schema, body, 'body', errors);
  if (errors.length) throw new Error(`${method.toUpperCase()} ${routeTemplate} ${status} does not match OpenAPI:\n${errors.slice(0, 20).join('\n')}`);
}
