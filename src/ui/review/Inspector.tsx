import { useState, type ReactNode } from 'react';
import type { Project } from '../../domain/schemas';
import { readScriptFile, SCRIPT_ACCEPT } from '../../media/probe';
import { setScript } from '../../state/projectActions';
import { setInspectorTab, useUi, type InspectorTab } from '../../state/uiStore';
import { FileButton } from '../components/DropZone';
import { AutoTextarea } from '../components/Fields';
import { TabPanel, Tabs } from '../components/Tabs';
import type { ReviewContext } from './context';
import { CorrectionPanel } from './CorrectionPanel';
import { FindingsPanel } from './FindingsPanel';
import { TakePanel } from './TakePanel';

function ScriptPanel({ project }: { project: Project }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="script-panel">
      <div className="section-header">
        <h3 className="panel-title">Script</h3>
        <FileButton
          label="Load .txt / .md"
          accept={SCRIPT_ACCEPT}
          onFile={async (file) => {
            try {
              setScript(await readScriptFile(file), file.name);
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
      {error && (
        <p className="notice notice--error notice--inline" role="alert">
          {error}
        </p>
      )}
      <AutoTextarea
        label={
          <span className="muted">
            Project script or brief{project.script.sourceFileName ? ` · from ${project.script.sourceFileName}` : ''}
          </span>
        }
        value={project.script.text}
        rows={18}
        placeholder="No script yet. Paste the creative brief or script here. Review works without it."
        onChange={(v) => setScript(v)}
        testId="inspector-script"
      />
    </div>
  );
}

export function Inspector({ project, ctx }: { project: Project; ctx: ReviewContext | null }) {
  const tab = useUi((s) => s.inspectorTab);
  const findings = ctx ? project.findings.filter((f) => f.takeId === ctx.take.id) : [];
  const candidates = findings.filter((f) => f.reviewState === 'candidate').length;
  const pendingRechecks = ctx?.take.recheck.filter((r) => r.status === 'pending').length ?? 0;
  const tabs: { id: InspectorTab; label: string; badge?: ReactNode }[] = [
    {
      id: 'findings',
      label: 'Findings',
      badge: findings.length ? <span className="tabs__count">{candidates ? `${candidates}/${findings.length}` : findings.length}</span> : undefined,
    },
    { id: 'correction', label: 'Correction' },
    { id: 'take', label: 'Take', badge: pendingRechecks ? <span className="tabs__count tabs__count--warn">{pendingRechecks}</span> : undefined },
    { id: 'script', label: 'Script' },
  ];
  return (
    <div className="inspector">
      <Tabs idBase="inspector" label="Review panels" tabs={tabs} value={tab} onChange={setInspectorTab} />
      <div className="inspector__body">
        <TabPanel idBase="inspector" id="findings" active={tab === 'findings'}>
          {ctx ? <FindingsPanel project={project} ctx={ctx} /> : <p className="empty-note">Select a take to see its findings.</p>}
        </TabPanel>
        <TabPanel idBase="inspector" id="correction" active={tab === 'correction'}>
          {ctx ? <CorrectionPanel project={project} ctx={ctx} /> : <p className="empty-note">Select a take first.</p>}
        </TabPanel>
        <TabPanel idBase="inspector" id="take" active={tab === 'take'}>
          {ctx ? <TakePanel project={project} ctx={ctx} /> : <p className="empty-note">Select a take first.</p>}
        </TabPanel>
        <TabPanel idBase="inspector" id="script" active={tab === 'script'}>
          <ScriptPanel project={project} />
        </TabPanel>
      </div>
    </div>
  );
}
