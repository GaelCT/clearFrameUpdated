import { useEffect, useId, useState } from 'react';
import { listAdapters } from '../analysis/registry';
import { formatBytes } from '../domain/time';
import { estimateStorage, requestPersistentStorage } from '../persistence/repository';
import { useStorageHealth } from '../state/projectStore';
import { updateSettings, useSettings } from '../state/settingsStore';
import { useUi } from '../state/uiStore';
import { Dialog } from './components/Dialog';

/** Technical configuration, kept out of the review workflow. */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const settings = useSettings();
  const storage = useStorageHealth();
  const [estimate, setEstimate] = useState<{ usage: number | null; quota: number | null; persisted: boolean | null } | null>(null);
  const behaviorId = useId();
  const secondsId = useId();
  const adapters = listAdapters();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void estimateStorage().then((e) => {
      if (!cancelled) setEstimate(e);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} title="Settings" onClose={() => useUi.setState({ settingsOpen: false })} wide>
      <div className="stack">
        <section className="settings-section">
          <h3>Analysis</h3>
          <fieldset className="stack stack--tight">
            <legend>Analysis service</legend>
            {adapters.map((a) => (
              <label key={a.id} className="check-item">
                <input type="radio" name="adapter" checked={settings.adapterId === a.id} onChange={() => updateSettings({ adapterId: a.id })} />
                <span className="check-item__text">
                  <span className="check-item__label">
                    {a.label} {a.simulated && <span className="badge badge--sim">Simulated</span>}
                  </span>
                  <span className="check-item__desc">{a.description}</span>
                </span>
              </label>
            ))}
            <label className="check-item check-item--disabled">
              <input type="radio" name="adapter" disabled />
              <span className="check-item__text">
                <span className="check-item__label">Local analysis backend</span>
                <span className="check-item__desc">
                  Not connected in this build. A backend adapter implements the AnalysisService interface; see
                  docs/analysis-integration.md.
                </span>
              </span>
            </label>
          </fieldset>
          {settings.adapterId === 'demo' && (
            <div className="settings-grid">
              <div className="field">
                <label htmlFor={behaviorId}>Demo adapter behavior</label>
                <select
                  id={behaviorId}
                  className="input"
                  value={settings.demoBehavior}
                  onChange={(e) => updateSettings({ demoBehavior: e.target.value as typeof settings.demoBehavior })}
                  data-testid="demo-behavior"
                >
                  <option value="normal">Return simulated findings</option>
                  <option value="no-findings">Complete with no findings</option>
                  <option value="fail">Fail every run</option>
                </select>
                <span className="field__hint">For trying the empty and error states.</span>
              </div>
              <div className="field">
                <label htmlFor={secondsId}>Simulated run time (seconds)</label>
                <input
                  id={secondsId}
                  type="number"
                  className="input"
                  min={0.2}
                  max={30}
                  step={0.1}
                  value={settings.demoRunSeconds}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0.2 && v <= 30) updateSettings({ demoRunSeconds: v });
                  }}
                  data-testid="demo-seconds"
                />
              </div>
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3>Storage</h3>
          {!storage.available && (
            <p className="notice notice--error notice--inline">
              Browser storage is unavailable: {storage.error}. Projects can't be saved in this browser session.
            </p>
          )}
          <label className="check-item">
            <input
              type="checkbox"
              checked={settings.storeVideosInBrowser}
              onChange={(e) => updateSettings({ storeVideosInBrowser: e.target.checked })}
            />
            <span className="check-item__text">
              <span className="check-item__label">Save imported video files in this browser</span>
              <span className="check-item__desc">
                When off, videos are held in memory for this tab only and must be reattached after a reload. Project data, scripts,
                findings, and decisions are always saved.
              </span>
            </span>
          </label>
          <p className="muted">
            {estimate?.usage != null && estimate.quota != null
              ? `Using ${formatBytes(estimate.usage)} of about ${formatBytes(estimate.quota)} available to this site.`
              : 'Storage usage is not reported by this browser.'}{' '}
            {estimate?.persisted === true
              ? 'Storage is marked persistent.'
              : estimate?.persisted === false
                ? 'The browser may clear this storage under pressure.'
                : ''}
          </p>
          {estimate?.persisted === false && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={async () => {
                await requestPersistentStorage();
                setEstimate(await estimateStorage());
              }}
            >
              Ask the browser to keep this storage
            </button>
          )}
          <p className="field__hint">Everything stays on this device. ClearFrame makes no network uploads.</p>
        </section>
      </div>
    </Dialog>
  );
}
