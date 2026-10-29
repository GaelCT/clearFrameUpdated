import { create } from 'zustand';
import { z } from 'zod';

const SETTINGS_KEY = 'clearframe.settings.v1';

const SettingsSchema = z.object({
  adapterId: z.string(),
  demoBehavior: z.enum(['normal', 'no-findings', 'fail']),
  demoRunSeconds: z.number().min(0.2).max(30),
  /** Save imported video files in IndexedDB so they survive a reload. */
  storeVideosInBrowser: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  adapterId: 'demo',
  demoBehavior: 'normal',
  demoRunSeconds: 3,
  storeVideosInBrowser: true,
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const useSettings = create<Settings>(() => readSettings());

export function updateSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(useSettings.getState()));
  } catch {
    // Settings still apply for this session.
  }
}
