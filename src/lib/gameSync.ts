/** Candidate diagnostics. Game data is never applied by the editor. */
export interface GameGroundCounts {
  groundCells: number;
  groundEntities: number;
  bySize: Record<string, number>;
}
export interface GameSyncReport {
  mapName?: string;
  baselineId?: string;
  unchanged?: boolean;
  mapUnchanged?: boolean;
  exactMapBytes?: boolean;
  changedCells?: number;
  affectedCells?: number;
  counts?: GameGroundCounts;
  before?: GameGroundCounts;
  groundEditingSupported?: boolean;
  objectEditingSupported?: boolean;
  objectChanges?: { moved: number; removed: number; added: number };
  editableObjects?: number;
  protectedObjects?: number;
  objectComparison?: {
    unchangedObjectsExact: boolean;
    existingIdsPreserved: boolean;
    permittedFieldsOnly: boolean;
  };
  npcEditingSupported?: boolean;
  npcEditingReasons?: string[];
  npcChanges?: { moved: number; added: number; removed: number; updated: number };
  npcComparison?: {
    currentMapRowsExact: boolean;
    unchangedOtherRowsExact: boolean;
    movedRows: number; updatedRows: number; addedRows: number; removedRows: number;
    sourceSha256: string; candidateSha256: string;
  };
  npcSourceFiles?: Array<{ relative: string; sha256: string }>;
  monsterChanges?: { moved: number; added: number; removed: number; updated: number };
  portalChanges?: { moved: number; added: number; removed: number; updated: number };
  spawnChanged?: boolean;
  walkEditingSupported?: boolean;
  walkEditingReasons?: string[];
  walkChangedCells?: number;
  walkComparison?: {
    unchanged?: boolean;
    currentMapCellsExact?: boolean;
    unchangedOtherRowsExact?: boolean;
    retainedCurrentMapRows?: number;
    addedRows?: number;
    removedRows?: number;
    sourceSha256?: string;
    candidateSha256?: string;
  };
  applyFiles?: string[];
  datasetReferenceDirectory?: string;
  datasetReferenceBasis?: "export-start";
  datasetsExact?: boolean;
  datasetsUnchangedSinceBaseline?: boolean;
  datasetChangesSinceBaseline?: Array<{
    path: string;
    status: "added" | "deleted" | "modified";
    baselineSha256: string | null;
    currentSha256: string | null;
  }>;
  preservedEntities?: number;
  sourceFilesUnchanged?: boolean;
  strictSourceFilesUnchangedSinceBaseline?: boolean;
  candidateOnly?: boolean;
  gameApplied?: boolean;
  runtimeVerified?: boolean;
  hiddenSpriteCount?: number;
  unsupportedSpriteCount?: number;
  warnings?: string[];
  [key: string]: unknown;
}
