/**
 * Chooses the active analysis service.
 *
 * To connect a local backend, implement AnalysisService (see contract.ts) in
 * a new adapter module and add it to ADAPTERS below. Nothing else in the UI
 * needs to change: components read results from the project store, which the
 * review runner fills from whichever service is active.
 */
import { useSettings } from '../state/settingsStore';
import type { AnalysisService, AnalyzerInfo } from './contract';
import { DemoAnalysisService } from './demoAdapter';

interface AdapterEntry {
  info: Pick<AnalyzerInfo, 'id' | 'label' | 'simulated' | 'description'>;
  create: () => AnalysisService;
}

const ADAPTERS: Record<string, AdapterEntry> = {
  demo: {
    info: {
      id: 'demo',
      label: 'Demo adapter',
      simulated: true,
      description: 'Simulated findings for trying the workflow. Does not analyse video.',
    },
    create: () =>
      new DemoAnalysisService(() => {
        const s = useSettings.getState();
        return { behavior: s.demoBehavior, durationMs: s.demoRunSeconds * 1000 };
      }),
  },
  // localBackend: { info: {...}, create: () => new LocalBackendAnalysisService({ baseUrl: 'http://127.0.0.1:8765' }) },
};

const instances = new Map<string, AnalysisService>();

export function listAdapters(): AdapterEntry['info'][] {
  return Object.values(ADAPTERS).map((a) => a.info);
}

export function getAnalysisService(): AnalysisService {
  const requested = useSettings.getState().adapterId;
  const id = ADAPTERS[requested] ? requested : 'demo';
  let service = instances.get(id);
  if (!service) {
    service = ADAPTERS[id].create();
    instances.set(id, service);
  }
  return service;
}
