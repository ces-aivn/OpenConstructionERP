// A Vietnamese reader never sees the server's English: coded errors are
// translated from their code or message key, a Pydantic validation list is
// rebuilt from its type and field, and a plain English sentence gives way to
// the translated message for its status.
import i18next from 'i18next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  localizedApiErrorMessage,
  looksLikeEnglish,
  parseApiErrorBody,
  readableServerMessage,
} from '../apiErrors';
import { ApiError, reportUnhandledWriteError, UNHANDLED_ERROR_TOAST_DELAY_MS } from '../api';
import { useToastStore } from '@/stores/useToastStore';
import { notifyMutationError } from '../mutationErrorToast';

const VI = {
  'api_errors.boq_locked': 'Bảng khối lượng đã khóa.',
  'api_errors.custom_key': 'Thông điệp riêng {{n}}',
  'api_errors.validation.greater_than': '{{field}} phải lớn hơn {{gt}}.',
  'api_errors.fields.quantity': 'Khối lượng',
  'errors.conflict': 'Xung đột dữ liệu.',
  'errors.validation': 'Một số trường không hợp lệ.',
};

let previous = 'en';
beforeAll(async () => {
  previous = i18next.language;
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'vi', resources: {} });
  }
  i18next.addResourceBundle('vi', 'translation', VI, true, true);
  await i18next.changeLanguage('vi');
});
afterAll(async () => {
  await i18next.changeLanguage(previous || 'en');
});

describe('parseApiErrorBody', () => {
  it('reads the top-level envelope and keeps the detail', () => {
    expect(parseApiErrorBody({ code: 'boq_locked', field: 'boq_id', message_key: 'x.y', detail: 'Locked' })).toEqual({
      code: 'boq_locked',
      field: 'boq_id',
      messageKey: 'x.y',
      params: {},
    });
  });

  it('reads a coded refusal inside detail', () => {
    expect(parseApiErrorBody({ detail: { code: 'boq_locked', params: { n: 1 } } }).code).toBe('boq_locked');
  });

  it('reads the first Pydantic entry', () => {
    const info = parseApiErrorBody({
      detail: [{ type: 'greater_than', loc: ['body', 'items', 0, 'quantity'], msg: 'Input should be greater than 0', ctx: { gt: 0 } }],
    });
    expect(info).toEqual({ code: 'greater_than', field: 'quantity', messageKey: undefined, params: { gt: 0 } });
  });
});

describe('localizedApiErrorMessage', () => {
  it('translates by message key first, then by code', () => {
    expect(localizedApiErrorMessage({ code: 'boq_locked', message_key: 'api_errors.custom_key', params: { n: 2 } })).toBe(
      'Thông điệp riêng 2',
    );
    expect(localizedApiErrorMessage({ detail: { code: 'boq_locked', message: 'BOQ is locked' } })).toBe(
      'Bảng khối lượng đã khóa.',
    );
  });

  it('rebuilds a validation error around the translated field label', () => {
    const body = { detail: [{ type: 'greater_than', loc: ['body', 'quantity'], msg: 'Input should be greater than 0', ctx: { gt: 0 } }] };
    expect(localizedApiErrorMessage(body)).toBe('Khối lượng phải lớn hơn 0.');
  });

  it('returns null when nothing is coded', () => {
    expect(localizedApiErrorMessage({ detail: 'Something broke' })).toBeNull();
  });
});

describe('ApiError for a Vietnamese reader', () => {
  it('replaces an English detail with the translated status message', () => {
    const err = new ApiError(409, 'Conflict', { detail: 'BOQ is locked and cannot be edited' });
    expect(err.message).toBe('Xung đột dữ liệu.');
  });

  it('keeps a server message already in Vietnamese', () => {
    const err = new ApiError(409, 'Conflict', { detail: 'Bảng khối lượng đã khóa, không thể thêm hạng mục' });
    expect(err.message).toBe('Bảng khối lượng đã khóa, không thể thêm hạng mục');
  });

  it('exposes code and field', () => {
    const err = new ApiError(422, 'Unprocessable', { code: 'boq_locked', field: 'boq_id', detail: 'x' });
    expect(err.code).toBe('boq_locked');
    expect(err.field).toBe('boq_id');
    expect(err.message).toBe('Bảng khối lượng đã khóa.');
  });

  it('never shows Pydantic English', () => {
    const err = new ApiError(422, 'Unprocessable', {
      detail: [{ type: 'string_too_long', loc: ['body', 'title'], msg: 'String should have at most 10 characters' }],
    });
    expect(looksLikeEnglish(err.message)).toBe(false);
  });
});

describe('readableServerMessage', () => {
  it('falls back when the reader cannot read the server text', () => {
    expect(readableServerMessage('Not found', 'Không tìm thấy.')).toBe('Không tìm thấy.');
    expect(readableServerMessage(null, 'Không tìm thấy.')).toBe('Không tìm thấy.');
  });
});

describe('reportUnhandledWriteError', () => {
  it('toasts a failed write nobody reported, once', () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [], history: [] } as never);
    reportUnhandledWriteError(new ApiError(409, 'Conflict', { detail: 'Locked' }));
    vi.advanceTimersByTime(UNHANDLED_ERROR_TOAST_DELAY_MS + 1);
    const history = useToastStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0]?.type).toBe('error');
    vi.useRealTimers();
  });

  it('stays quiet when the screen already raised an error toast', () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [], history: [] } as never);
    reportUnhandledWriteError(new ApiError(409, 'Conflict', { detail: 'Locked' }));
    useToastStore.getState().addToast({ type: 'error', title: 'Không thêm được', message: 'BOQ đã khóa' });
    vi.advanceTimersByTime(UNHANDLED_ERROR_TOAST_DELAY_MS + 1);
    expect(useToastStore.getState().history).toHaveLength(1);
    vi.useRealTimers();
  });

  it('stays quiet for a mutation that shows its failure inline', () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [], history: [] } as never);
    const error = new ApiError(409, 'Conflict', { detail: 'Locked' });
    reportUnhandledWriteError(error);
    notifyMutationError(error, { meta: { suppressGlobalErrorToast: true } });
    vi.advanceTimersByTime(UNHANDLED_ERROR_TOAST_DELAY_MS + 1);
    expect(useToastStore.getState().history).toHaveLength(0);
    vi.useRealTimers();
  });

  it('ignores a 401, which signs the reader out instead', () => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [], history: [] } as never);
    reportUnhandledWriteError(new ApiError(401, 'Unauthorized', undefined));
    vi.advanceTimersByTime(UNHANDLED_ERROR_TOAST_DELAY_MS + 1);
    expect(useToastStore.getState().history).toHaveLength(0);
    vi.useRealTimers();
  });
});
