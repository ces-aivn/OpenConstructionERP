// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Server error bodies, turned into a message in the reader's language.
 *
 * The server answers an error in one of these shapes, and all of them are
 * read here:
 *
 *   {code, field, message_key, detail, params}   the coded envelope
 *   {detail: {code, field, message_key, message, params}}   a coded refusal
 *   {detail: [{type, loc, msg, ctx}, ...]}       a Pydantic validation error
 *   {detail: "English sentence"}                 a plain HTTPException
 *
 * The rule the mapper keeps: a reader whose language is not English never
 * sees the server's English. A coded error is translated from its
 * `message_key` or `api_errors.<code>`; a validation error is rebuilt from its
 * type and field; a plain English sentence is replaced by the translated
 * message for its HTTP status. Server text that is already in the reader's
 * language (the backend translates some messages from `Accept-Language`) is
 * shown as it came.
 */
import i18next from 'i18next';

/** The machine-readable part of an error body. */
export interface ApiErrorInfo {
  code?: string;
  field?: string;
  messageKey?: string;
  params: Record<string, unknown>;
}

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;
const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/** The field a Pydantic `loc` points at: its last named segment. */
function fieldFromLoc(loc: unknown): string | undefined {
  if (!Array.isArray(loc)) return undefined;
  const named = loc.filter((p): p is string => typeof p === 'string' && p !== 'body' && p !== 'query');
  return named.length > 0 ? named[named.length - 1] : undefined;
}

/** Read the code, field, message key and parameters out of an error body. */
export function parseApiErrorBody(body: unknown): ApiErrorInfo {
  const obj = asDict(body);
  if (!obj) return { params: {} };

  const top: ApiErrorInfo = {
    code: asString(obj.code),
    field: asString(obj.field),
    messageKey: asString(obj.message_key),
    params: asDict(obj.params) ?? {},
  };

  const detail = asDict(obj.detail);
  if (detail) {
    return {
      code: top.code ?? asString(detail.code) ?? asString(detail.error),
      field: top.field ?? asString(detail.field),
      messageKey: top.messageKey ?? asString(detail.message_key),
      params: { ...(asDict(detail.params) ?? {}), ...top.params },
    };
  }

  if (Array.isArray(obj.detail) && obj.detail.length > 0) {
    const first = asDict(obj.detail[0]);
    if (first) {
      return {
        code: top.code ?? asString(first.type),
        field: top.field ?? fieldFromLoc(first.loc),
        messageKey: top.messageKey,
        params: { ...(asDict(first.ctx) ?? {}), ...top.params },
      };
    }
  }
  return top;
}

/** True when the reader reads English, so server English may be shown. */
export function readerReadsEnglish(): boolean {
  try {
    return String(i18next.language || 'en').toLowerCase().startsWith('en');
  } catch {
    return true;
  }
}

/** True for text with no letter outside ASCII, which is how English reads
 *  next to Vietnamese (every Vietnamese sentence carries tone marks). */
export function looksLikeEnglish(text: string): boolean {
  return /[a-z]/i.test(text) && ![...text].some((c) => c.charCodeAt(0) > 0x7f);
}

/** The label of a field name, translated when the locale knows it. */
export function fieldLabel(field: string): string {
  const human = field.replace(/_/g, ' ');
  return i18next.t(`api_errors.fields.${field}`, { defaultValue: human });
}

function translateIfKnown(key: string | undefined, params: Record<string, unknown>): string | null {
  if (!key || !i18next.exists(key)) return null;
  const text = i18next.t(key, params);
  return typeof text === 'string' && text.length > 0 ? text : null;
}

/**
 * The translated message for a coded or validation error body, or null when
 * the body carries nothing this build can translate.
 */
export function localizedApiErrorMessage(body: unknown): string | null {
  const info = parseApiErrorBody(body);
  const params: Record<string, unknown> = {
    ...info.params,
    ...(info.field ? { field: fieldLabel(info.field) } : {}),
  };

  const fromKey = translateIfKnown(info.messageKey, params);
  if (fromKey) return fromKey;
  if (!info.code) return null;
  // A Pydantic validation type reads as a sentence about the named field. Its
  // type (`missing`, `greater_than`, ...) is not a business code, so the
  // field-aware sentence is tried before any `api_errors.<type>` key.
  const isValidation = Array.isArray(asDict(body)?.detail) && !asString(asDict(body)?.code);
  if (isValidation && info.field) {
    const generic = translateIfKnown(`api_errors.validation.${info.code}`, params);
    if (generic) return generic;
    return i18next.t('api_errors.validation.invalid_field', {
      ...params,
      defaultValue: '{{field}}: the value is not valid.',
    });
  }
  return translateIfKnown(`api_errors.${info.code}`, params);
}

/**
 * Keep a server message only when the reader can read it. English server
 * text shown to a reader of another language is replaced by `fallback`.
 */
export function readableServerMessage(message: string | null, fallback: string): string {
  if (!message) return fallback;
  if (!readerReadsEnglish() && looksLikeEnglish(message)) return fallback;
  return message;
}
