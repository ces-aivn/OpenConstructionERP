// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The bill's activity feed in the reader's language.
 *
 * The server stores each activity entry as one English sentence built from a
 * fixed template ("Added 9 position(s)", "Updated position 0010"), so the feed
 * read in English whatever language the screen was in. Every template the bill
 * writes is recognised here and shown through a translation key with its
 * values (count, ordinal, name) carried over; a sentence that matches none of
 * them is shown as it was stored.
 */

type Translate = (key: string, options?: Record<string, string | number>) => string;

interface ActivityTemplate {
  pattern: RegExp;
  key: string;
  defaultValue: string;
  /** Names of the pattern's capture groups, in order. */
  params?: readonly string[];
}

const TEMPLATES: readonly ActivityTemplate[] = [
  { pattern: /^Created BOQ '(.*)'$/s, key: 'boq.activity.boq_created_named', defaultValue: "Created bill '{{name}}'", params: ['name'] },
  { pattern: /^Created BOQ from template$/, key: 'boq.activity.boq_created_from_template', defaultValue: 'Created bill from a template' },
  { pattern: /^Created BOQ$/, key: 'boq.activity.boq_created', defaultValue: 'Created bill' },
  { pattern: /^Updated BOQ$/, key: 'boq.activity.boq_updated', defaultValue: 'Updated bill' },
  { pattern: /^Deleted BOQ$/, key: 'boq.activity.boq_deleted', defaultValue: 'Deleted bill' },
  { pattern: /^Duplicated BOQ$/, key: 'boq.activity.boq_duplicated', defaultValue: 'Duplicated bill' },
  { pattern: /^Added (\d+) position\(s\)$/, key: 'boq.activity.positions_added', defaultValue: 'Added {{count}} positions', params: ['count'] },
  { pattern: /^Added position '(.*)'$/s, key: 'boq.activity.position_added_named', defaultValue: "Added position '{{name}}'", params: ['name'] },
  { pattern: /^Added position (\S+)$/, key: 'boq.activity.position_added', defaultValue: 'Added position {{ordinal}}', params: ['ordinal'] },
  { pattern: /^Updated position (\S+)$/, key: 'boq.activity.position_updated', defaultValue: 'Updated position {{ordinal}}', params: ['ordinal'] },
  { pattern: /^Updated position$/, key: 'boq.activity.position_updated_plain', defaultValue: 'Updated a position' },
  { pattern: /^Deleted position\b.*$/s, key: 'boq.activity.position_deleted', defaultValue: 'Deleted a position' },
  { pattern: /^Duplicated position$/, key: 'boq.activity.position_duplicated', defaultValue: 'Duplicated a position' },
  { pattern: /^Reordered (\d+) positions$/, key: 'boq.activity.positions_reordered', defaultValue: 'Reordered {{count}} positions', params: ['count'] },
  { pattern: /^Bulk \w+ on (\d+) position\(s\)\b.*$/s, key: 'boq.activity.positions_bulk_edited', defaultValue: 'Edited {{count}} positions at once', params: ['count'] },
  { pattern: /^Propagated a resource definition to (\d+) position\(s\)$/, key: 'boq.activity.resource_propagated', defaultValue: 'Applied a resource definition to {{count}} positions', params: ['count'] },
  { pattern: /^Linked a position quantity to a model$/, key: 'boq.activity.quantity_linked', defaultValue: 'Linked a position quantity to a model' },
  { pattern: /^Bound \S+ → quantity from (\d+) model element\(s\)$/, key: 'boq.activity.quantity_bound', defaultValue: 'Linked the quantity to {{count}} model elements', params: ['count'] },
  { pattern: /^Updated (\d+) position quantities from linked models$/, key: 'boq.activity.quantities_from_models', defaultValue: 'Updated the quantities of {{count}} positions from linked models', params: ['count'] },
  { pattern: /^Applied (\d+) model-driven quantity update\(s\)$/, key: 'boq.activity.quantities_from_models', defaultValue: 'Updated the quantities of {{count}} positions from linked models', params: ['count'] },
  { pattern: /^Updated (\d+) position quantities from a new BIM model version$/, key: 'boq.activity.quantities_from_bim_version', defaultValue: 'Updated the quantities of {{count}} positions from a new BIM model version', params: ['count'] },
  { pattern: /^Created section (\S+)$/, key: 'boq.activity.section_created', defaultValue: 'Created section {{ordinal}}', params: ['ordinal'] },
  { pattern: /^Added markup: (.*)$/s, key: 'boq.activity.markup_added', defaultValue: 'Added markup: {{name}}', params: ['name'] },
  { pattern: /^Updated markup$/, key: 'boq.activity.markup_updated', defaultValue: 'Updated a markup' },
  { pattern: /^Deleted markup$/, key: 'boq.activity.markup_deleted', defaultValue: 'Deleted a markup' },
  { pattern: /^Applied default markups \((.*)\)$/, key: 'boq.activity.default_markups_applied', defaultValue: 'Applied the default markups ({{region}})', params: ['region'] },
  { pattern: /^Applied estimate-audit fix '(.*)'$/, key: 'boq.activity.audit_fix_applied', defaultValue: "Applied the estimate check fix '{{fix}}'", params: ['fix'] },
  { pattern: /^Scenario '(.*)' created from BOQ \S+$/s, key: 'boq.activity.scenario_created', defaultValue: "Created scenario '{{name}}'", params: ['name'] },
];

/** The text the feed shows for a stored activity description. */
export function activityText(description: string, t: Translate): string {
  const text = description.trim();
  for (const tpl of TEMPLATES) {
    const m = tpl.pattern.exec(text);
    if (!m) continue;
    const values: Record<string, string | number> = { defaultValue: tpl.defaultValue };
    tpl.params?.forEach((name, i) => {
      const raw = m[i + 1] ?? '';
      values[name] = name === 'count' ? Number(raw) : raw;
    });
    return t(tpl.key, values);
  }
  return description;
}
