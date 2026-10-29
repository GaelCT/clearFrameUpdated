import type { Finding } from './schemas';

/**
 * Template-based drafting for prompt corrections. This is deliberately simple
 * string assembly, not a language model: one instruction per issue category,
 * appended to the original prompt. The UI labels the result as a template draft.
 */
const CATEGORY_TEMPLATES: Record<string, string> = {
  'road-markings':
    'Keep all road markings unchanged for the whole shot: same colour, dash pattern, and position.',
  'object-deformation': 'Keep solid objects rigid, with constant shape and proportions; no warping or stretching.',
  'appearance-disappearance':
    'Keep every object in the scene continuously present; nothing appears or disappears without cause.',
  anatomy: 'Keep human anatomy correct and consistent: two arms, two legs, natural proportions.',
  'motion-inconsistency': 'Keep motion smooth and continuous at a constant, plausible speed; no jumps or skipped positions.',
  'exposure-flicker': 'Keep exposure and lighting steady across frames; no flicker or brightness pulses.',
  'text-signage': 'Keep any visible text and signage legible and unchanged throughout.',
};

export const TEMPLATE_HEADER = 'Corrections for this retake:';

function lineFor(category: string, findings: Finding[]): string {
  const template = CATEGORY_TEMPLATES[category];
  if (template) return template;
  // Script adherence and uncategorized issues reuse the reviewer's description.
  const details = findings
    .map((f) => f.description.trim())
    .filter(Boolean)
    .join(' ');
  if (category === 'script-adherence') return `Follow the brief: ${details || 'match the scripted action and setting.'}`;
  return `Avoid: ${details || 'the issue noted by the reviewer.'}`;
}

/** Builds a template draft from the original prompt and confirmed findings. */
export function draftCorrectionFromTemplates(originalPrompt: string, findings: Finding[]): string {
  const byCategory = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const lines = [...byCategory.entries()].map(([category, list]) => `- ${lineFor(category, list)}`);
  const base = originalPrompt.trim();
  if (lines.length === 0) return base;
  return `${base}${base ? '\n\n' : ''}${TEMPLATE_HEADER}\n${lines.join('\n')}`;
}
