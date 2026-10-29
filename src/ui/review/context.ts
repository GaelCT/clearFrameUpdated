import type { Asset, Project, Shot, Take } from '../../domain/schemas';
import { useUi } from '../../state/uiStore';

export interface ReviewContext {
  shot: Shot;
  take: Take;
  asset: Asset | null;
  reference: Asset | null;
  parentTake: Take | null;
  parentAsset: Asset | null;
}

export function resolveReviewContext(project: Project, takeId: string | null): ReviewContext | null {
  const take = project.takes.find((t) => t.id === takeId) ?? project.takes[0];
  if (!take) return null;
  const shot = project.shots.find((s) => s.id === take.shotId);
  if (!shot) return null;
  const asset = take.assetId ? (project.assets.find((a) => a.id === take.assetId) ?? null) : null;
  const reference = shot.referenceAssetId ? (project.assets.find((a) => a.id === shot.referenceAssetId) ?? null) : null;
  const parentTake = take.parentTakeId ? (project.takes.find((t) => t.id === take.parentTakeId) ?? null) : null;
  const parentAsset = parentTake?.assetId ? (project.assets.find((a) => a.id === parentTake.assetId) ?? null) : null;
  return { shot, take, asset, reference, parentTake, parentAsset };
}

export function useReviewContext(project: Project | null): ReviewContext | null {
  const takeId = useUi((s) => s.selectedTakeId);
  return project ? resolveReviewContext(project, takeId) : null;
}
