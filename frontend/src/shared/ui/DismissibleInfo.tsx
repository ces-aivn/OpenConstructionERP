// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Info, X } from 'lucide-react';
import { useModuleInfoStore } from '@/stores/useModuleInfoStore';
import { useInfoBlockPrefsStore, readLegacyCollapsed } from '@/stores/useInfoBlockPrefsStore';

/**
 * Contextual info / help card used across every module page.
 *
 * It explains - in the UI itself - what a page is for and how it connects to
 * the rest of the platform, while staying out of the way of power users. It is
 * a light, notion-style help card (NOT a loud alert) with TWO states only:
 *
 *  - Expanded: a soft, translucent card with an info chip, a title and the
 *    body. Only the X (a button named "Collapse") collapses it; the title and
 *    the body are plain content, so clicking or selecting them does nothing.
 *  - Collapsed: NOTHING renders in the page (founder decision 2026-06-06).
 *    The card registers itself in `useModuleInfoStore`, and the top app bar
 *    shows a small info icon right after the module name (project pill >
 *    module name > info icon). Clicking that icon re-expands the card here.
 *
 * There is no longer a dismissed-forever state. The X simply collapses, and
 * the re-open control keeps the card always reachable on every breakpoint.
 *
 * Persistence is per-user (founder 2026-07-23: "пожелание пользователя ...
 * сохранено"). The collapsed/expanded flag lives in ``useInfoBlockPrefsStore``,
 * which writes localStorage (``oce.info-blocks``) for an instant offline paint
 * and syncs to ``/api/v1/users/me/info-blocks/`` so the preference follows the
 * user across browsers and devices. For cards this store has never seen it
 * falls back once to the legacy per-browser ``oce.intro.<storageKey>`` flag, so
 * preferences set before this change carry over seamlessly.
 *
 * Use the SAME ``storageKey`` you would pass to the old SectionIntro so
 * existing preferences carry over. The public API (storageKey, title,
 * children, links, className) is consumed by 18+ pages and must not change.
 */

export interface DismissibleInfoLink {
  label: string;
  onClick: () => void;
}

/* ── IntroRichText ────────────────────────────────────────────────────────
   Canonical formatter for the "Show more" long-form module explanations.
   Renders a translated plain string with a tiny markdown subset - enough
   for professional structure without pulling in a markdown dependency:

     - blank line ("\n\n")      -> paragraph break
     - lines starting with "- " -> bulleted list
     - lines starting with "1. "-> numbered list (any digits + dot)
     - **bold** inline          -> <strong> (lead-ins like "**You put in:**")

   Translators keep the same markers in all 29 locales; everything else is
   rendered verbatim, so there is no HTML-injection surface. */

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-content-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

export function IntroRichText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\.\s/.test(l))) {
          return (
            <ol key={bi} className="list-decimal space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\d+\.\s/, ''))}</li>
              ))}
            </ol>
          );
        }
        return <p key={bi}>{renderInline(lines.join(' '))}</p>;
      })}
    </div>
  );
}

export function DismissibleInfo({
  storageKey,
  title,
  children,
  more,
  links,
  className,
}: {
  /** Stable key - display state is remembered under `oce.intro.<storageKey>`. */
  storageKey: string;
  title: string;
  children?: ReactNode;
  /**
   * Optional EXTENDED explanation (founder 2026-06-06): a few more
   * paragraphs revealed behind a "Show more" toggle inside the card -
   * a step-by-step, professionally formatted walkthrough of how the
   * module works. Pass `<IntroRichText text={t('x.intro_more', ...)} />`
   * for canonical formatting (paragraphs, bullets, bold lead-ins).
   */
  more?: ReactNode;
  /** Optional cross-module shortcuts rendered as inline pills. */
  links?: DismissibleInfoLink[];
  /** Extra classes for the outer wrapper (e.g. margin overrides). */
  className?: string;
}) {
  const { t } = useTranslation();

  // Per-user collapse state, synced across devices. `blocks[storageKey]` is
  // the authoritative value once known; until then (a card this browser/user
  // has never toggled) fall back once to the legacy per-card localStorage flag
  // so a preference set before this feature carries over. Server hydration
  // lands into the store and flips this reactively.
  const storedCollapsed = useInfoBlockPrefsStore((s) => s.blocks[storageKey]);
  const setCollapsedPref = useInfoBlockPrefsStore((s) => s.setCollapsed);
  const [legacyCollapsed] = useState(() => readLegacyCollapsed(storageKey));
  const collapsed = storedCollapsed ?? legacyCollapsed;

  const collapse = useCallback(
    () => setCollapsedPref(storageKey, true),
    [setCollapsedPref, storageKey],
  );
  const expand = useCallback(
    () => setCollapsedPref(storageKey, false),
    [setCollapsedPref, storageKey],
  );

  // "Show more" is session-local (not persisted): a returning user sees the
  // short card again and opens the long read only when they want it.
  const [showMore, setShowMore] = useState(false);

  // While collapsed the card renders nothing here - it hands itself to the
  // re-open control instead, the info icon the Header puts beside the module
  // name, which calls `expand`. Unmount (navigation) unregisters
  // automatically.
  const register = useModuleInfoStore((s) => s.register);
  const unregister = useModuleInfoStore((s) => s.unregister);
  useEffect(() => {
    if (!collapsed) return undefined;
    register({ key: storageKey, expand });
    return () => unregister(storageKey);
  }, [collapsed, storageKey, expand, register, unregister]);

  if (collapsed) return null;

  // Expanded: a plain card on the page ground - card surface, hairline
  // border, no tint, so the intro reads as help text beside the work rather
  // than as an alert. The accent lives only in the info icon and the links.
  // The row is a plain div with no handler: the X is the collapse control and
  // carries aria-expanded for AT, and the link pills act on their own.
  // No default margin: pages provide rhythm via the root space-y-5.
  const wrapper = `group rounded-lg border border-border-light bg-surface-elevated animate-fade-in ${
    className ?? ''
  }`;

  return (
    <div className={wrapper} data-testid="dismissible-info">
      {/* The card collapses through the X only. It used to collapse on a
          click anywhere in this row, the title included, so a reader who
          clicked the title (or selected a sentence to copy) lost the card
          without having asked for that. The title is plain text now, and the
          one collapse control is a real button with an accessible name. The
          way back is the info icon the Header shows beside the module name. */}
      <div className="flex items-start gap-3 rounded-lg px-4 py-3.5">
        {/* Icon and title share the same 24px midline. */}
        <span className="flex h-6 w-5 shrink-0 items-center justify-center">
          <Info size={16} className="text-oe-blue-text" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-h-6 items-center text-sm font-semibold leading-snug text-content-primary">
            {title}
          </p>
          {children != null && (
            <div className="mt-1.5 text-sm leading-relaxed text-content-secondary">{children}</div>
          )}
          {more != null && (
            <>
              {showMore && (
                <div className="mt-3 border-t border-border-light pt-3 text-sm leading-relaxed text-content-secondary animate-fade-in">
                  {more}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-oe-blue-text transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                {showMore
                  ? t('common.show_less', { defaultValue: 'Show less' })
                  : t('common.show_more', { defaultValue: 'Show more' })}
                {showMore ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </>
          )}
          {links && links.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {links.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={l.onClick}
                  className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-elevated px-2 py-1 text-xs font-medium text-content-secondary transition-colors hover:border-border hover:text-oe-blue-text"
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          // The only collapse control. It collapses, it never hides forever.
          onClick={collapse}
          aria-expanded
          aria-label={t('common.collapse', { defaultValue: 'Collapse' })}
          title={t('common.collapse', { defaultValue: 'Collapse' })}
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-content-tertiary opacity-60 transition-all hover:bg-surface-secondary hover:text-content-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
