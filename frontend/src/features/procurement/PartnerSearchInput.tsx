// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// PartnerSearchInput - the supplier picker of the purchase-order form.
//
// A company keeps its partners in three registers: contacts, the vendor
// register of the supplier catalogue and the subcontractor register. The
// picker searches all three in one list (GET /v1/procurement/partners/), so a
// supplier kept in any of them can be ordered from. A purchase order stores a
// contact; picking a register entry that has no contact yet asks the server to
// link one (POST /v1/procurement/partners/resolve/) before the form takes it.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import clsx from 'clsx';

import { apiGet, apiPost, getErrorMessage } from '@/shared/lib/api';

export type PartnerSource = 'contact' | 'vendor' | 'subcontractor';

export interface Partner {
  source: PartnerSource;
  id: string;
  contact_id: string | null;
  name: string;
  code?: string | null;
  contact_type?: string | null;
  tax_id?: string | null;
  country_code?: string | null;
  also_in?: PartnerSource[];
}

interface PartnerPage {
  items: Partner[];
  total: number;
}

interface ResolvedPartner {
  contact_id: string;
  name: string;
  created: boolean;
}

export interface PartnerSearchInputProps {
  /** The contact id the order stores, or '' when none is picked. */
  value: string;
  /** What to show for the picked partner. */
  displayValue: string;
  onChange: (contactId: string, displayName: string) => void;
  placeholder?: string;
  /** Marks the field as failing validation. */
  invalid?: boolean;
  /** id of the element describing the validation error. */
  errorId?: string;
  /** Accessible name of the field. */
  ariaLabel?: string;
}

const DEBOUNCE_MS = 250;

/** The query string the directory is asked with. */
export function partnersUrl(q: string, limit = 20): string {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) });
  return `/v1/procurement/partners/?${params.toString()}`;
}

export function PartnerSearchInput({
  value,
  displayValue,
  onChange,
  placeholder,
  invalid = false,
  errorId,
  ariaLabel,
}: PartnerSearchInputProps) {
  const { t } = useTranslation();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(displayValue);
  const [debounced, setDebounced] = useState(displayValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Follow a value set from outside (edit prefill, form reset). Un-picking
  // because the user typed over the name also changes it, and must not wipe
  // what they are typing.
  const unpickedByTyping = useRef(false);
  useEffect(() => {
    if (unpickedByTyping.current) {
      unpickedByTyping.current = false;
      return;
    }
    setQuery(displayValue);
  }, [displayValue]);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Close on a click outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // While a partner is picked, the box shows its name; searching that name
  // again would only list it, so the list searches what the user typed.
  const searchText = value && debounced === displayValue ? '' : debounced;
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['procurement-partners', searchText],
    queryFn: () => apiGet<PartnerPage>(partnersUrl(searchText)),
    enabled: open,
    staleTime: 30_000,
  });
  const partners = data?.items ?? [];

  const sourceLabel = (source: PartnerSource): string => {
    switch (source) {
      case 'vendor':
        return t('procurement.partner_source_vendor', { defaultValue: 'Supplier register' });
      case 'subcontractor':
        return t('procurement.partner_source_subcontractor', { defaultValue: 'Subcontractor' });
      default:
        return t('procurement.partner_source_contact', { defaultValue: 'Contacts' });
    }
  };

  const pick = async (partner: Partner) => {
    setResolveError(null);
    if (partner.contact_id) {
      onChange(partner.contact_id, partner.name);
      setQuery(partner.name);
      setOpen(false);
      return;
    }
    setResolving(true);
    try {
      // The failure is shown under the field, so no global toast as well.
      const resolved = await apiPost<ResolvedPartner>(
        '/v1/procurement/partners/resolve/',
        { source: partner.source, id: partner.id },
        { suppressErrorToast: true },
      );
      onChange(resolved.contact_id, resolved.name);
      setQuery(resolved.name);
      setOpen(false);
    } catch (err) {
      setResolveError(getErrorMessage(err));
    } finally {
      setResolving(false);
    }
  };

  const clear = () => {
    onChange('', '');
    setQuery('');
    setResolveError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(partners.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && partners[active]) {
      e.preventDefault();
      void pick(partners[active]);
    } else if (e.key === 'Escape' && open) {
      // Close the list only; the dialog around it must not read this Escape.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
        aria-hidden
      />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          // Typing over a picked partner un-picks it; the order needs a real choice.
          if (value) {
            unpickedByTyping.current = displayValue !== '';
            onChange('', '');
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={
          placeholder ??
          t('procurement.search_partner', { defaultValue: 'Search contacts, suppliers and subcontractors...' })
        }
        className={clsx(
          'h-10 w-full rounded-lg border bg-surface-primary pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue',
          invalid ? 'border-semantic-error' : 'border-border',
        )}
      />
      {(query || value) && !resolving && (
        <button
          type="button"
          onClick={clear}
          aria-label={t('common.clear', { defaultValue: 'Clear' })}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-content-tertiary hover:text-content-primary"
        >
          <X size={14} />
        </button>
      )}
      {resolving && (
        <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-content-tertiary" />
      )}
      {resolveError && <p className="mt-1 text-xs text-semantic-error">{resolveError}</p>}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border-light bg-surface-elevated shadow-md"
        >
          {isFetching && partners.length === 0 ? (
            <li className="px-3 py-2 text-xs text-content-tertiary">
              {t('common.searching', { defaultValue: 'Searching...' })}
            </li>
          ) : isError ? (
            <li className="px-3 py-2 text-xs text-semantic-error">{getErrorMessage(error)}</li>
          ) : partners.length === 0 ? (
            <li className="px-3 py-2 text-xs text-content-tertiary">
              {t('procurement.partner_no_results', { defaultValue: 'No partner found in contacts, suppliers or subcontractors' })}
            </li>
          ) : (
            partners.map((p, idx) => (
              <li key={`${p.source}:${p.id}`} role="option" aria-selected={idx === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(p)}
                  onMouseEnter={() => setActive(idx)}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    idx === active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-content-primary">{p.name}</span>
                    {(p.code || p.tax_id) && (
                      <span className="block truncate text-xs text-content-tertiary">
                        {[p.code, p.tax_id].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {[p.source, ...(p.also_in ?? [])].map((src) => (
                      <span
                        key={src}
                        className="rounded bg-surface-secondary px-1.5 py-0.5 text-2xs text-content-secondary"
                      >
                        {sourceLabel(src)}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
