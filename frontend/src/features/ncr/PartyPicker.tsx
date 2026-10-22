// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Pick the party a quality record is about: a subcontractor, a directory
 * contact, a platform user, or simply a name.
 *
 * The quality registers used to offer either a free-text box wired to an id
 * column (an inspector's name longer than 36 characters came back as an English
 * validation error) or a list of internal users only (an NCR could never be put
 * on the subcontractor who did the work). This control keeps both halves: the
 * typed text is always the party's name, and choosing a suggestion adds the
 * reference to the record it came from.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Link2, X } from 'lucide-react';
import { apiGet, type Page } from '@/shared/lib/api';
import { fmtList, useIntlLocale } from '@/shared/lib/formatters';
import { useHasPermission } from '@/shared/lib/permissionGates';
import { listSubcontractors } from '@/features/subcontractors/api';

export type PartyKind = 'subcontractor' | 'contact' | 'user' | 'text';
export type PartySource = Exclude<PartyKind, 'text'>;

/** What a record stores about its party. `id` is empty for a typed name. */
export interface PartyValue {
  id: string;
  name: string;
  kind: PartyKind;
}

export interface PartyOption {
  id: string;
  name: string;
  kind: PartySource;
  /** A second line: e-mail, trade, role. */
  detail?: string;
}

export const EMPTY_PARTY: PartyValue = { id: '', name: '', kind: 'text' };

/** Longest name the server stores for a party. */
export const PARTY_NAME_MAX = 255;

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_active?: boolean;
}

interface ContactRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  contact_type: string;
}

function contactName(c: ContactRow): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return [c.company_name, person].filter(Boolean).join(' - ') || c.primary_email || '';
}

/**
 * Load the suggestion list for the given sources.
 *
 * Fail-soft per source: a module that is not installed or a permission the
 * reader lacks just contributes nothing, and the field still takes a name.
 */
export function usePartyOptions(sources: PartySource[]): PartyOption[] {
  const canListUsers = useHasPermission('users.list');
  const wantUsers = sources.includes('user');
  const wantContacts = sources.includes('contact');
  const wantSubs = sources.includes('subcontractor');
  // The trade list is joined in the reader's language, so it is rebuilt when that changes.
  const intlLocale = useIntlLocale();

  const { data: users = [] } = useQuery({
    queryKey: ['party-options', 'users'],
    queryFn: () => apiGet<UserRow[]>('/v1/users/?limit=100&is_active=true'),
    enabled: wantUsers && canListUsers,
    staleTime: 60_000,
    retry: false,
  });
  const { data: contacts } = useQuery({
    queryKey: ['party-options', 'contacts'],
    queryFn: () => apiGet<Page<ContactRow>>('/v1/contacts/?limit=200'),
    enabled: wantContacts,
    staleTime: 60_000,
    retry: false,
  });
  const { data: subs } = useQuery({
    queryKey: ['party-options', 'subcontractors'],
    queryFn: () => listSubcontractors({ limit: 200 }),
    enabled: wantSubs,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo(() => {
    const out: PartyOption[] = [];
    if (wantSubs) {
      for (const s of subs?.items ?? []) {
        const name = (s.trade_name || s.legal_name || '').trim();
        const trades = s.trade_categories?.length ? fmtList(s.trade_categories) : undefined;
        if (name) out.push({ id: s.id, name, kind: 'subcontractor', detail: trades });
      }
    }
    if (wantContacts) {
      for (const c of contacts?.items ?? []) {
        const name = contactName(c).trim();
        if (name) out.push({ id: c.id, name, kind: 'contact', detail: c.primary_email ?? undefined });
      }
    }
    if (wantUsers) {
      for (const u of users) {
        if (u.is_active === false) continue;
        const name = (u.full_name || u.email || '').trim();
        if (name) out.push({ id: u.id, name, kind: 'user', detail: u.email });
      }
    }
    return out;
  }, [wantSubs, wantContacts, wantUsers, subs, contacts, users, intlLocale]);
}

/** Suggestions for what has been typed, best matches first. */
export function matchPartyOptions(options: PartyOption[], query: string, limit = 8): PartyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const starts: PartyOption[] = [];
  const contains: PartyOption[] = [];
  for (const o of options) {
    const name = o.name.toLowerCase();
    if (name.startsWith(q)) starts.push(o);
    else if (name.includes(q) || (o.detail ?? '').toLowerCase().includes(q)) contains.push(o);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function PartyPicker({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  className,
}: {
  id?: string;
  value: PartyValue;
  onChange: (next: PartyValue) => void;
  options: PartyOption[];
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => matchPartyOptions(options, value.name), [options, value.name]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const kindLabel = (kind: PartyKind) =>
    ({
      subcontractor: t('quality_party.kind_subcontractor', { defaultValue: 'Subcontractor' }),
      contact: t('quality_party.kind_contact', { defaultValue: 'Contact' }),
      user: t('quality_party.kind_user', { defaultValue: 'Team member' }),
      text: t('quality_party.kind_text', { defaultValue: 'Name only' }),
    })[kind];

  const pick = (o: PartyOption) => {
    onChange({ id: o.id, name: o.name, kind: o.kind });
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={clsx('relative', className)}>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          autoComplete="off"
          maxLength={PARTY_NAME_MAX}
          value={value.name}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            // Typing makes it a name again: the reference belonged to the
            // record whose name was there before.
            onChange({ id: '', name: e.target.value, kind: 'text' });
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open || matches.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % matches.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
            } else if (e.key === 'Enter') {
              const o = matches[active];
              if (o) {
                e.preventDefault();
                pick(o);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className={clsx(
            'h-10 w-full rounded-lg border bg-surface-primary px-3 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue',
            invalid ? 'border-semantic-error' : 'border-border',
          )}
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
          {value.id && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-oe-blue/10 px-1.5 py-0.5 text-2xs text-oe-blue"
              title={t('quality_party.linked', { defaultValue: 'Linked to the {{kind}} record', kind: kindLabel(value.kind) })}
            >
              <Link2 size={10} aria-hidden="true" />
              {kindLabel(value.kind)}
            </span>
          )}
          {value.name && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_PARTY)}
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              className="text-content-tertiary hover:text-content-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-light bg-surface-elevated shadow-md"
        >
          {matches.map((o, i) => (
            <li
              key={`${o.kind}-${o.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={clsx(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                i === active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-content-primary">{o.name}</span>
                {o.detail && <span className="block truncate text-xs text-content-tertiary">{o.detail}</span>}
              </span>
              <span className="shrink-0 text-2xs text-content-tertiary">{kindLabel(o.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
