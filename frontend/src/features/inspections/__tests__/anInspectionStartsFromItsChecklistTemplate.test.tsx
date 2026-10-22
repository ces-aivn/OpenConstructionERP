// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// An inspection's checklist starts from the usual one for its type.
//
// Picking "structural" left the checklist empty. Now the type's default
// template is loaded while the checklist is untouched, any other template can
// be chosen, and rows somebody edited are never replaced without asking.

import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const fallback = opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
    },
    i18n: { language: 'vi', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
  I18nextProvider: ({ children }: { children: ReactNode }) => children,
}));

const api = vi.hoisted(() => ({ listChecklistTemplates: vi.fn() }));
vi.mock('../api', () => api);

import {
  ChecklistTemplatePicker,
  checklistIsPristine,
  rowsFromTemplate,
  type ChecklistRow,
} from '../ChecklistTemplatePicker';
import type { ChecklistTemplate, InspectionType } from '../api';

function template(code: string, name: string, texts: string[], isDefault = false): ChecklistTemplate {
  return {
    code,
    name_key: `inspections.checklist_tpl.${code}.name`,
    name,
    inspection_types: [],
    is_default: isDefault,
    items: texts.map((text, i) => ({
      key: `k${i}`,
      text_key: `inspections.checklist_tpl.${code}.k${i}`,
      text,
      critical: i === 0,
    })),
  };
}

const POUR = template('concrete_pour', 'Đổ bê tông', ['Cốt thép đã được nghiệm thu', 'Thử độ sụt'], true);
const REBAR = template('rebar', 'Cốt thép', ['Đường kính, khoảng cách thanh thép đúng bản vẽ']);
const MEP = template('mep_rough_in', 'Lắp đặt cơ điện (phần ngầm)', ['Thử áp lực đường ống'], true);

beforeEach(() => {
  api.listChecklistTemplates.mockReset();
  api.listChecklistTemplates.mockImplementation((type: InspectionType) =>
    Promise.resolve(type === 'mep' ? [MEP] : type === 'general' ? [POUR, REBAR, MEP].map((t) => ({ ...t, is_default: false })) : [POUR, REBAR]),
  );
});

afterEach(cleanup);

/** The form's checklist, with the controls the inspection modal gives the person. */
function Harness({ initialType = 'structural' as InspectionType, initialRows = [] as ChecklistRow[] }) {
  const [type, setType] = useState<InspectionType>(initialType);
  const [rows, setRows] = useState<ChecklistRow[]>(initialRows);
  const [code, setCode] = useState('');
  return (
    <div>
      <button type="button" onClick={() => setType('mep')}>
        pick-mep
      </button>
      <button type="button" onClick={() => setRows((r) => r.map((row, i) => (i === 0 ? { ...row, question: 'Sửa tay' } : row)))}>
        edit-first
      </button>
      <button type="button" onClick={() => setRows([])}>
        clear
      </button>
      <ChecklistTemplatePicker
        inspectionType={type}
        rows={rows}
        onLoad={(c, next) => {
          setCode(c);
          setRows(next);
        }}
      />
      <ol data-testid="rows">
        {rows.map((r, i) => (
          <li key={i}>{r.question}</li>
        ))}
      </ol>
      <span data-testid="code">{code}</span>
    </div>
  );
}

function renderHarness(props?: Parameters<typeof Harness>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

const rowTexts = () => Array.from(screen.getByTestId('rows').querySelectorAll('li')).map((li) => li.textContent);

describe('an inspection checklist starts from its template', () => {
  it("loads the type's default template, in the words the server sent", async () => {
    renderHarness();
    await waitFor(() => expect(rowTexts()).toEqual(['Cốt thép đã được nghiệm thu', 'Thử độ sụt']));
    expect(api.listChecklistTemplates).toHaveBeenCalledWith('structural');
    expect(screen.getByTestId('code').textContent).toBe('concrete_pour');
    expect(screen.getByTestId('inspection-template-loaded').textContent).toContain('Đổ bê tông');
  });

  it('loads the new type’s default when the type changes and nothing was edited', async () => {
    renderHarness();
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    fireEvent.click(screen.getByText('pick-mep'));
    await waitFor(() => expect(rowTexts()).toEqual(['Thử áp lực đường ống']));
    expect(screen.getByTestId('code').textContent).toBe('mep_rough_in');
  });

  it('asks before replacing rows somebody edited, and keeps them on "Keep mine"', async () => {
    renderHarness();
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    fireEvent.click(screen.getByText('edit-first'));
    fireEvent.change(screen.getByTestId('inspection-template-select'), { target: { value: 'rebar' } });
    expect(screen.getByTestId('inspection-template-replace').textContent).toContain('Cốt thép');
    fireEvent.click(screen.getByText('Keep mine'));
    expect(rowTexts()).toEqual(['Sửa tay', 'Thử độ sụt']);

    fireEvent.change(screen.getByTestId('inspection-template-select'), { target: { value: 'rebar' } });
    fireEvent.click(screen.getByText('Replace'));
    expect(rowTexts()).toEqual(['Đường kính, khoảng cách thanh thép đúng bản vẽ']);
    expect(screen.getByTestId('code').textContent).toBe('rebar');
  });

  it('does not change an edited checklist when the type changes', async () => {
    renderHarness();
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    fireEvent.click(screen.getByText('edit-first'));
    fireEvent.click(screen.getByText('pick-mep'));
    await waitFor(() => expect(api.listChecklistTemplates).toHaveBeenCalledWith('mep'));
    expect(rowTexts()).toEqual(['Sửa tay', 'Thử độ sụt']);
  });

  it('does not load the default again after the person removes every row', async () => {
    renderHarness();
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    fireEvent.click(screen.getByText('clear'));
    expect(rowTexts()).toEqual([]);
  });

  it('leaves an existing checklist alone when an inspection is opened for editing', async () => {
    renderHarness({ initialRows: [{ question: 'Bu lông đã siết', critical: true, notes: '' }] });
    await waitFor(() => expect(api.listChecklistTemplates).toHaveBeenCalled());
    await screen.findByTestId('inspection-template-select');
    expect(rowTexts()).toEqual(['Bu lông đã siết']);
  });
});

describe('the pure helpers', () => {
  it('turns template items into editable rows, hold points kept', () => {
    expect(rowsFromTemplate(POUR)).toEqual([
      { question: 'Cốt thép đã được nghiệm thu', critical: true, notes: '' },
      { question: 'Thử độ sụt', critical: false, notes: '' },
    ]);
  });

  it('calls a checklist pristine only when empty or exactly as loaded', () => {
    const loaded = rowsFromTemplate(POUR);
    const [first, second] = loaded as [ChecklistRow, ChecklistRow];
    expect(checklistIsPristine([], null)).toBe(true);
    expect(checklistIsPristine(loaded, loaded)).toBe(true);
    expect(checklistIsPristine([{ ...first, notes: 'x' }, second], loaded)).toBe(false);
    expect(checklistIsPristine(loaded, null)).toBe(false);
  });
});
