import { create } from 'zustand';

export type InspectorTab = 'findings' | 'correction' | 'take' | 'script';
export type CompareMode = 'off' | 'reference' | 'parent';
export type FindingFilter = 'all' | 'candidate' | 'confirmed' | 'dismissed';

interface UiState {
  selectedShotId: string | null;
  selectedTakeId: string | null;
  selectedFindingId: string | null;
  inspectorTab: InspectorTab;
  compareMode: CompareMode;
  /** Offset for parent-vs-retake comparison, per retake. Not persisted. */
  parentOffsets: Record<string, number>;
  showAllOverlays: boolean;
  drawMode: boolean;
  findingFilter: FindingFilter;
  runFilter: string;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
}

export const useUi = create<UiState>(() => ({
  selectedShotId: null,
  selectedTakeId: null,
  selectedFindingId: null,
  inspectorTab: 'findings',
  compareMode: 'off',
  parentOffsets: {},
  showAllOverlays: false,
  drawMode: false,
  findingFilter: 'all',
  runFilter: 'all',
  shortcutsOpen: false,
  settingsOpen: false,
}));

export function selectTake(shotId: string, takeId: string | null): void {
  useUi.setState((s) =>
    s.selectedTakeId === takeId && s.selectedShotId === shotId
      ? {}
      : {
          selectedShotId: shotId,
          selectedTakeId: takeId,
          selectedFindingId: null,
          drawMode: false,
          runFilter: 'all',
          compareMode: s.compareMode === 'parent' ? 'off' : s.compareMode,
        },
  );
}

export function selectFinding(findingId: string | null): void {
  useUi.setState((s) => ({
    selectedFindingId: findingId,
    drawMode: findingId === s.selectedFindingId ? s.drawMode : false,
  }));
}

export function setInspectorTab(tab: InspectorTab): void {
  useUi.setState({ inspectorTab: tab });
}

export function resetUi(): void {
  useUi.setState({
    selectedShotId: null,
    selectedTakeId: null,
    selectedFindingId: null,
    inspectorTab: 'findings',
    compareMode: 'off',
    drawMode: false,
    findingFilter: 'all',
    runFilter: 'all',
  });
}
