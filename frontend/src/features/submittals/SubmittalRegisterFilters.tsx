// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The cuts of the submittal register: the type tabs above the table and the
 * filters beside the search box.
 *
 * The tabs are one register filtered by type, one tab per submittal type,
 * labelled exactly as the type picker labels it. They are not separate pages,
 * which is also how the export route names the document it prints for each.
 *
 * The lists are the vocabulary route's. The discipline list adds the codes
 * the project itself has filed under, taken from the summary, because the
 * column takes any code and a filter that cannot reach a row is a lie.
 */
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, FilterX } from 'lucide-react';

import { TabBar, type TabBarTab } from '@/shared/ui/TabBar';
import { SUBMITTAL_TYPES, type SubmittalRegisterSummary, type SubmittalVocabulary } from './api';
import { outcomeLabel } from './registerCells';
import { NO_FILTERS, disciplineLabel, disciplineMark, hasActiveFilter, type RegisterFilters } from './registerView';

const ALL_TAB = 'all';

function countFor(summary: SubmittalRegisterSummary | null, type: string): number | undefined {
  if (!summary) return undefined;
  return summary.by_type.find((row) => row.code === type)?.count ?? 0;
}

/**
 * The type codes the register offers, in picker order: the vocabulary route's
 * list when it has answered, otherwise the module's own list. The tabs, the
 * type filter and the type picker on the form all read this one list, so a
 * type can never be pickable in one place and missing (or named differently)
 * in another.
 */
export function registerTypeCodes(vocabulary: SubmittalVocabulary | null): string[] {
  const served = vocabulary?.types.map((entry) => entry.code) ?? [];
  return served.length > 0 ? served : [...SUBMITTAL_TYPES];
}

export function SubmittalTypeTabs({
  filters,
  onFilters,
  summary,
  vocabulary,
  typeLabel,
}: {
  filters: RegisterFilters;
  onFilters: (next: RegisterFilters) => void;
  summary: SubmittalRegisterSummary | null;
  vocabulary: SubmittalVocabulary | null;
  /** The label of a type, the same one the type picker and the filter print. */
  typeLabel: (type: string) => string;
}) {
  const { t } = useTranslation();

  const tabs = useMemo<TabBarTab[]>(() => {
    const out: TabBarTab[] = [
      { id: ALL_TAB, label: t('submittals.tab_all', { defaultValue: 'All' }), badge: summary?.total },
      ...registerTypeCodes(vocabulary).map((type) => ({
        id: type,
        label: typeLabel(type),
        badge: countFor(summary, type),
      })),
    ];
    // A type outside the vocabulary (imported data) that the filter points at
    // gets a tab while it is active, so the strip always shows what is on screen.
    if (filters.type && !out.some((tab) => tab.id === filters.type)) {
      out.push({ id: filters.type, label: typeLabel(filters.type), badge: countFor(summary, filters.type) });
    }
    return out;
  }, [t, summary, vocabulary, filters.type, typeLabel]);

  return (
    <TabBar
      tabs={tabs}
      activeId={filters.type || ALL_TAB}
      onChange={(id) => onFilters({ ...filters, type: id === ALL_TAB ? '' : id })}
      ariaLabel={t('submittals.tabs_aria', { defaultValue: 'Register by submittal type' })}
      idPrefix="submittals-type"
    />
  );
}

const selectCls =
  'h-10 appearance-none rounded-lg border border-border bg-surface-primary ps-3 pe-9 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue';

function FilterSelect({
  label,
  value,
  onChange,
  testId,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        data-testid={testId}
        className={clsx(selectCls, 'sm:w-44')}
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2.5 text-content-tertiary">
        <ChevronDown size={14} />
      </div>
    </div>
  );
}

function Toggle({
  label,
  pressed,
  onPress,
  testId,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onPress}
      className={clsx(
        'h-10 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40',
        pressed
          ? 'border-oe-blue bg-oe-blue-subtle text-oe-blue-text font-medium'
          : 'border-border bg-surface-primary text-content-secondary hover:bg-surface-secondary',
      )}
    >
      {label}
    </button>
  );
}

export function SubmittalRegisterFilters({
  filters,
  onFilters,
  vocabulary,
  summary,
  typeLabel,
}: {
  filters: RegisterFilters;
  onFilters: (next: RegisterFilters) => void;
  vocabulary: SubmittalVocabulary | null;
  summary: SubmittalRegisterSummary | null;
  typeLabel: (type: string) => string;
}) {
  const { t } = useTranslation();

  const typeCodes = useMemo<string[]>(() => registerTypeCodes(vocabulary), [vocabulary]);

  // Offered disciplines first, then whatever else the project files under.
  const disciplineCodes = useMemo<string[]>(() => {
    const codes = vocabulary?.disciplines.map((entry) => entry.code) ?? [];
    for (const row of summary?.by_discipline ?? []) {
      if (row.code !== '' && !codes.includes(row.code)) codes.push(row.code);
    }
    if (filters.discipline && !codes.includes(filters.discipline)) codes.push(filters.discipline);
    return codes;
  }, [vocabulary, summary, filters.discipline]);

  const outcomeCodes = useMemo<string[]>(() => {
    const served = vocabulary?.outcomes.map((entry) => entry.code) ?? [];
    return served.length > 0 ? served : (summary?.by_outcome.map((row) => row.code) ?? []);
  }, [vocabulary, summary]);

  return (
    <>
      <FilterSelect
        label={t('submittals.filter_type', { defaultValue: 'Type' })}
        value={filters.type}
        onChange={(type) => onFilters({ ...filters, type })}
        testId="submittals-filter-type"
      >
        <option value="">{t('submittals.filter_type_all', { defaultValue: 'All types' })}</option>
        {typeCodes.map((code) => (
          <option key={code} value={code}>
            {typeLabel(code)}
          </option>
        ))}
      </FilterSelect>

      {disciplineCodes.length > 0 && (
        <FilterSelect
          label={t('submittals.field_discipline', { defaultValue: 'Discipline' })}
          value={filters.discipline}
          onChange={(discipline) => onFilters({ ...filters, discipline })}
          testId="submittals-filter-discipline"
        >
          <option value="">{t('submittals.filter_discipline_all', { defaultValue: 'All disciplines' })}</option>
          {disciplineCodes.map((code) => (
            <option key={code} value={code}>
              {disciplineMark(vocabulary, code)} - {disciplineLabel(vocabulary, code)}
            </option>
          ))}
        </FilterSelect>
      )}

      {outcomeCodes.length > 0 && (
        <FilterSelect
          label={t('submittals.filter_outcome', { defaultValue: 'Review outcome' })}
          value={filters.outcome}
          onChange={(outcome) => onFilters({ ...filters, outcome })}
          testId="submittals-filter-outcome"
        >
          <option value="">{t('submittals.filter_outcome_all', { defaultValue: 'All outcomes' })}</option>
          {outcomeCodes.map((code) => (
            <option key={code} value={code}>
              {outcomeLabel(t, code)}
            </option>
          ))}
        </FilterSelect>
      )}

      <Toggle
        label={t('submittals.filter_long_lead', { defaultValue: 'Long lead' })}
        pressed={filters.longLead}
        onPress={() => onFilters({ ...filters, longLead: !filters.longLead })}
        testId="submittals-filter-long-lead"
      />
      <Toggle
        label={t('submittals.filter_review_overdue', { defaultValue: 'Review overdue' })}
        pressed={filters.reviewOverdue}
        onPress={() => onFilters({ ...filters, reviewOverdue: !filters.reviewOverdue })}
        testId="submittals-filter-review-overdue"
      />
      <Toggle
        label={t('submittals.filter_approval_late', { defaultValue: 'Approval late' })}
        pressed={filters.approvalLate}
        onPress={() => onFilters({ ...filters, approvalLate: !filters.approvalLate })}
        testId="submittals-filter-approval-late"
      />

      {hasActiveFilter(filters) && (
        <button
          type="button"
          data-testid="submittals-filter-clear"
          onClick={() => onFilters(NO_FILTERS)}
          className="inline-flex h-10 items-center gap-1.5 px-2 text-sm font-medium text-oe-blue-text hover:underline"
        >
          <FilterX size={14} aria-hidden />
          {t('submittals.filter_clear', { defaultValue: 'Clear filters' })}
        </button>
      )}
    </>
  );
}
