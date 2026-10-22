// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A correspondence party: a directory contact or a name typed as free text.
 *
 * A letter's sender is often a party that is not in the contacts directory
 * (the owner's representative, an authority, a supplier's site office). The
 * shared contact search only reports a value when a directory row is picked,
 * so a typed name was silently dropped and the required "From" field could
 * never be satisfied by typing. This input keeps whatever the user types and
 * still offers directory matches as suggestions:
 *
 * - typing reports the typed text as both the stored value and the display;
 * - picking a contact reports the contact id (single mode), so the register
 *   can link to the contact, and its name as the display;
 * - in `multiple` mode the value is one comma-separated line of names, and a
 *   pick replaces the segment being typed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { apiGet } from '@/shared/lib/api';

/** Same cap as the server's party fields. */
export const PARTY_MAX_LENGTH = 255;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ContactHit {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_type: string;
  primary_email: string | null;
}

export function contactName(c: Omit<ContactHit, 'id' | 'contact_type'> & { id?: string }): string {
  const parts: string[] = [];
  if (c.company_name) parts.push(c.company_name);
  if (c.first_name || c.last_name) parts.push([c.first_name, c.last_name].filter(Boolean).join(' '));
  return parts.join(' - ') || c.primary_email || c.id || '';
}

/** The text after the last comma: what the user is typing in multiple mode. */
export function currentSegment(line: string): string {
  const i = line.lastIndexOf(',');
  return (i === -1 ? line : line.slice(i + 1)).trim();
}

/** Replace the segment being typed with a picked name, keeping the earlier ones. */
export function replaceCurrentSegment(line: string, name: string): string {
  const i = line.lastIndexOf(',');
  const head = i === -1 ? '' : line.slice(0, i + 1).trimEnd() + ' ';
  return `${head}${name}`;
}

export interface PartyInputProps {
  id?: string;
  value: string;
  display: string;
  onChange: (value: string, display: string) => void;
  placeholder?: string;
  multiple?: boolean;
  invalid?: boolean;
}

export function PartyInput({ id, value, display, onChange, placeholder, multiple, invalid }: PartyInputProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // An entry saved with a picked contact holds the contact id; show its name.
  const storedId = !multiple && UUID_RE.test(value.trim()) && display === value ? value.trim() : '';
  const { data: resolved } = useQuery({
    queryKey: ['contact-name', storedId],
    queryFn: () => apiGet<Omit<ContactHit, 'id' | 'contact_type'>>(`/v1/contacts/${storedId}`),
    enabled: !!storedId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const shown = storedId && resolved ? contactName({ ...resolved, id: storedId }) : display;

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['correspondence-party-search', query],
    queryFn: async () =>
      (
        await apiGet<{ items: ContactHit[] }>(
          `/v1/contacts/search/?q=${encodeURIComponent(query)}&limit=10`,
        )
      ).items ?? [],
    enabled: query.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleType = useCallback(
    (text: string) => {
      onChange(text, text);
      const q = multiple ? currentSegment(text) : text.trim();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setQuery(q);
        setOpen(q.length > 0);
      }, 250);
    },
    [onChange, multiple],
  );

  const handlePick = (c: ContactHit) => {
    const name = contactName(c);
    if (multiple) {
      const line = replaceCurrentSegment(shown, name);
      onChange(line, line);
    } else {
      onChange(c.id, name);
    }
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-tertiary">
        <Search size={14} />
      </div>
      <input
        id={id}
        type="text"
        value={shown}
        maxLength={multiple ? undefined : PARTY_MAX_LENGTH}
        onChange={(e) => handleType(e.target.value)}
        onFocus={() => hits.length > 0 && query && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={`h-10 w-full rounded-lg border bg-surface-primary pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue ${
          invalid ? 'border-semantic-error' : 'border-border'
        }`}
      />
      {shown && (
        <button
          type="button"
          onClick={() => {
            onChange('', '');
            setQuery('');
            setOpen(false);
          }}
          aria-label={t('common.clear', { defaultValue: 'Clear' })}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-content-tertiary hover:text-content-primary"
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-light bg-surface-elevated shadow-md">
          {isFetching && hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-content-tertiary">
              {t('common.searching', { defaultValue: 'Searching...' })}
            </div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-content-tertiary">
              {t('correspondence.party_free_text_hint', {
                defaultValue: 'No matching contact - the name will be saved as typed.',
              })}
            </div>
          ) : (
            hits.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handlePick(c)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-content-primary">{contactName(c)}</span>
                  {c.primary_email && (
                    <span className="block truncate text-xs text-content-tertiary">{c.primary_email}</span>
                  )}
                </span>
                <span className="shrink-0 text-2xs text-content-tertiary">
                  {t(`contacts.type_${c.contact_type}`, { defaultValue: c.contact_type })}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
