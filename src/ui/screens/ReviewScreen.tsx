import { useState } from 'react';
import { VIDEO_ACCEPT } from '../../media/probe';
import { importGeneratedVideos, type ImportReport } from '../../state/mediaActions';
import { useProjectStore } from '../../state/projectStore';
import { DropZone } from '../components/DropZone';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { routeHref } from '../router';
import { useReviewContext } from '../review/context';
import { Inspector } from '../review/Inspector';
import { ShotList } from '../review/ShotList';
import { Stage } from '../review/Stage';
import { useReviewShortcuts } from '../review/useReviewShortcuts';

function EmptyStage({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ImportReport | null>(null);
  return (
    <div className="empty-state empty-state--stage">
      <h1>No videos in this project yet</h1>
      <p>Add generated videos to start reviewing. Each file becomes a take in a new shot. You can attach reference footage and a script on the Media page.</p>
      <DropZone
        label="Drop generated videos here"
        accept={VIDEO_ACCEPT}
        multiple
        testId="stage-drop"
        onFiles={async (files) => setReport(await importGeneratedVideos(files, { mode: 'new-shots' }))}
      />
      {report?.rejected.map((r) => (
        <p key={r.fileName} className="notice notice--error notice--inline">
          <strong>{r.fileName}</strong> was not imported. {r.reason}
        </p>
      ))}
      <a className="btn btn--secondary" href={routeHref({ name: 'media', projectId })}>
        Go to Media
      </a>
    </div>
  );
}

export function ReviewScreen() {
  const project = useProjectStore((s) => s.project);
  const ctx = useReviewContext(project);
  useReviewShortcuts(ctx?.take.id ?? null, ctx?.asset?.media.durationSec ?? null);
  if (!project) return null;
  return (
    <div className="review">
      <aside className="review__shots">
        <ShotList project={project} currentTakeId={ctx?.take.id ?? null} />
      </aside>
      <section className="review__stage" aria-label="Player and timeline">
        <ErrorBoundary label="The player hit an error">
          {ctx ? <Stage project={project} ctx={ctx} /> : <EmptyStage projectId={project.id} />}
        </ErrorBoundary>
      </section>
      <aside className="review__inspector" aria-label="Findings, corrections, and decisions">
        <ErrorBoundary label="This panel hit an error">
          <Inspector project={project} ctx={ctx} />
        </ErrorBoundary>
      </aside>
    </div>
  );
}
