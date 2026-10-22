// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Global project context store.
 *
 * Remembers the active project and BOQ across all pages so modules
 * (Schedule, Cost Model, Tendering, etc.) know what they're working on.
 *
 * Persists to localStorage so context survives page reloads.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { numberLocaleForProjectLanguage, setProjectNumberLocale } from '@/shared/lib/marketNumberLocale';

const STORAGE_KEY = 'oe_active_project';
const PINNED_KEY = 'oe_pinned_projects';
const LOCALES_KEY = 'oe_project_locales';
/** Enough for any real portfolio; the oldest entries go first beyond it. */
const LOCALES_CAP = 500;

interface ProjectContext {
  id: string;
  name: string;
  boqId: string | null;
}

function readContext(): ProjectContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function readPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(ctx: ProjectContext | null) {
  try {
    if (ctx) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

function persistPinned(ids: string[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

function readLocales(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCALES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, lang] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof lang === 'string' && lang) out[id] = lang;
    }
    return out;
  } catch {
    return {};
  }
}

function persistLocales(locales: Record<string, string>) {
  try {
    localStorage.setItem(LOCALES_KEY, JSON.stringify(locales));
  } catch { /* ignore */ }
}

/** Tell the number formatter which locale the active project writes in. */
function publishNumberLocale(activeProjectId: string | null, locales: Record<string, string>) {
  setProjectNumberLocale(activeProjectId ? numberLocaleForProjectLanguage(locales[activeProjectId]) : null);
}

interface ProjectContextState {
  activeProjectId: string | null;
  activeProjectName: string;
  activeBOQId: string | null;
  pinnedProjectIds: string[];
  /** Project id -> project language (`Project.locale`), as last seen from the server. */
  projectLocales: Record<string, string>;

  setActiveProject: (id: string, name: string) => void;
  setActiveBOQ: (boqId: string | null) => void;
  /**
   * Make the project of the record on screen the active one. A no-op when it
   * already is; on a switch the remembered BOQ is dropped, since it belongs
   * to the project being left.
   */
  followRecordProject: (id: string, name: string) => void;
  clearProject: () => void;
  /**
   * Remember the language of projects the app has loaded, so money in the
   * active project is written the way its language writes numbers.
   */
  rememberProjectLocales: (projects: ReadonlyArray<{ id: string; locale?: string | null }>) => void;

  togglePinned: (projectId: string) => void;
  isPinned: (projectId: string) => boolean;
}

const initial = readContext();
const initialPinned = readPinned();
const initialLocales = readLocales();
publishNumberLocale(initial?.id ?? null, initialLocales);

export const useProjectContextStore = create<ProjectContextState>((set, get) => ({
  activeProjectId: initial?.id ?? null,
  activeProjectName: initial?.name ?? '',
  activeBOQId: initial?.boqId ?? null,
  pinnedProjectIds: initialPinned,
  projectLocales: initialLocales,

  setActiveProject: (id: string, name: string) => {
    const ctx: ProjectContext = { id, name, boqId: get().activeBOQId };
    persist(ctx);
    set({ activeProjectId: id, activeProjectName: name });
    publishNumberLocale(id, get().projectLocales);
  },

  setActiveBOQ: (boqId: string | null) => {
    const state = get();
    if (state.activeProjectId) {
      persist({ id: state.activeProjectId, name: state.activeProjectName, boqId });
    }
    set({ activeBOQId: boqId });
  },

  followRecordProject: (id: string, name: string) => {
    const state = get();
    if (state.activeProjectId === id) {
      if (name && state.activeProjectName !== name) get().setActiveProject(id, name);
      return;
    }
    persist({ id, name, boqId: null });
    set({ activeProjectId: id, activeProjectName: name, activeBOQId: null });
    publishNumberLocale(id, get().projectLocales);
  },

  clearProject: () => {
    persist(null);
    set({ activeProjectId: null, activeProjectName: '', activeBOQId: null });
    publishNumberLocale(null, get().projectLocales);
  },

  rememberProjectLocales: (projects) => {
    const current = get().projectLocales;
    let changed = false;
    const next: Record<string, string> = { ...current };
    for (const p of projects) {
      const lang = (p.locale ?? '').trim();
      if (!p.id || !lang || next[p.id] === lang) continue;
      // Re-inserting moves the entry to the newest end for the cap below.
      delete next[p.id];
      next[p.id] = lang;
      changed = true;
    }
    if (!changed) return;
    const ids = Object.keys(next);
    for (const id of ids.slice(0, Math.max(0, ids.length - LOCALES_CAP))) delete next[id];
    persistLocales(next);
    set({ projectLocales: next });
    publishNumberLocale(get().activeProjectId, next);
  },

  togglePinned: (projectId: string) => {
    const current = get().pinnedProjectIds;
    const next = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];
    persistPinned(next);
    set({ pinnedProjectIds: next });
  },

  isPinned: (projectId: string) => {
    return get().pinnedProjectIds.includes(projectId);
  },
}));

/**
 * Keep the header's active project equal to the project of the record a page
 * shows (a bill, an RFI, a drawing opened by its URL).
 *
 * Pages used to set the context only when none was active, so a bill of
 * project A opened by link left the header on project B, and every module
 * that reads the header context then worked on the wrong project. Pass the
 * record's project once it is known; `undefined` waits.
 */
export function useSyncActiveProjectWithRecord(
  projectId: string | null | undefined,
  projectName: string | null | undefined,
): void {
  const follow = useProjectContextStore((s) => s.followRecordProject);
  useEffect(() => {
    if (!projectId || !projectName) return;
    follow(projectId, projectName);
  }, [projectId, projectName, follow]);
}
