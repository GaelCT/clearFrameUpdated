/**
 * Issue categories a reviewer can file. Whether a category has a detector is
 * decided by the active analysis adapter's check list, not here.
 */
export interface IssueCategory {
  id: string;
  label: string;
  description: string;
}

export const ISSUE_CATEGORIES: readonly IssueCategory[] = [
  {
    id: 'road-markings',
    label: 'Altered road markings',
    description: 'Lane lines, crossings, or arrows change colour, pattern, or position.',
  },
  {
    id: 'object-deformation',
    label: 'Object deformation',
    description: 'A rigid object warps, stretches, or changes shape.',
  },
  {
    id: 'appearance-disappearance',
    label: 'Appearance / disappearance',
    description: 'Something pops into or vanishes from the scene without cause.',
  },
  {
    id: 'anatomy',
    label: 'Anatomy',
    description: 'Extra, missing, or malformed limbs, hands, or faces.',
  },
  {
    id: 'motion-inconsistency',
    label: 'Motion inconsistency',
    description: 'Jumps, teleporting, reversed motion, or implausible speed changes.',
  },
  {
    id: 'exposure-flicker',
    label: 'Exposure flicker',
    description: 'Brightness or colour pulses between frames.',
  },
  {
    id: 'script-adherence',
    label: 'Script adherence',
    description: 'The shot departs from the script, brief, or prompt.',
  },
  {
    id: 'text-signage',
    label: 'Text and signage',
    description: 'Illegible, misspelled, or changing text.',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Anything not covered above.',
  },
];

const byId = new Map(ISSUE_CATEGORIES.map((c) => [c.id, c]));

export function categoryLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}

export function getCategory(id: string): IssueCategory | undefined {
  return byId.get(id);
}
