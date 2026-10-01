export const furnitureRoles = [
  "PRIMARY_SEATING",
  "SECONDARY_SEATING",
  "COFFEE_TABLE",
  "SIDE_TABLE",
  "AREA_RUG",
  "MEDIA_CONSOLE",
  "STORAGE",
  "TASK_LIGHTING",
  "AMBIENT_LIGHTING",
] as const;
export type FurnitureRole = (typeof furnitureRoles)[number];

export const placementModes = [
  "AGAINST_WALL",
  "NEAR_WALL",
  "FLOATING",
  "CENTERED_IN_ZONE",
  "CORNER_PLACEMENT",
] as const;
export type PlacementMode = (typeof placementModes)[number];

export const alignments = [
  "CENTERED",
  "LEFT_ALIGNED",
  "RIGHT_ALIGNED",
] as const;
export type Alignment = (typeof alignments)[number];

export const relationshipTypes = [
  "FACES",
  "ADJACENT_TO",
  "GROUPED_WITH",
  "IN_FRONT_OF",
  "FLANKS",
  "ANCHORS",
] as const;
export type RelationshipType = (typeof relationshipTypes)[number];

export type SemanticPlacementRelationship = {
  type: RelationshipType;
  targetItemId: string;
};

export type SemanticPlacement = {
  role: FurnitureRole;
  mode: PlacementMode;
  alignment: Alignment | null;
  zoneId: string | null;
  targetWallId: string | null;
  relationships: SemanticPlacementRelationship[];
  fallbackModes: PlacementMode[];
};
