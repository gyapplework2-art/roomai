import type { FurnitureRole, PlacementMode, Alignment } from "./semantic-types";
import type { FunctionalZone } from "./zones";

export type CompositionType = "sofa" | "armchair" | "sectional" | "loveseat" | "modular_seating" | "coffee_table" | "rug";
export type CompositionTemplateId = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";
export type RoleRelationship = {
  type: "IN_FRONT_OF" | "ADJACENT_TO" | "FACES";
  targetRoleKey: string;
  targetOccurrence: number;
};
export type RolePlacementIntent = {
  mode: PlacementMode;
  alignment: Alignment | null;
  targetWall: "PRIMARY_WALL" | null;
  relationships: readonly RoleRelationship[];
};
export type CompositionRole = {
  key: string;
  role: FurnitureRole;
  category: CompositionType;
  count: number;
  zoneType: FunctionalZone["type"];
  placements: readonly RolePlacementIntent[];
};
export type CompositionTemplate = {
  id: CompositionTemplateId;
  group: {
    type: "PRIMARY_SEATING_GROUP";
    primaryAnchorKey: string;
    secondaryAnchorKeys: readonly string[];
    dependentKeys: readonly string[];
  };
  roles: readonly CompositionRole[];
};

const primaryIntent: RolePlacementIntent = { mode: "AGAINST_WALL", alignment: "CENTERED", targetWall: "PRIMARY_WALL", relationships: [] };
const tableIntent: RolePlacementIntent = {
  mode: "FLOATING", alignment: null, targetWall: null,
  relationships: [{ type: "IN_FRONT_OF", targetRoleKey: "primary-seating", targetOccurrence: 1 }],
};
const rugIntent: RolePlacementIntent = { mode: "CENTERED_IN_ZONE", alignment: "CENTERED", targetWall: null, relationships: [] };

function dependentIntent(targetRoleKey: string): RolePlacementIntent {
  return {
    mode: "FLOATING", alignment: null, targetWall: null,
    relationships: [
      { type: "ADJACENT_TO", targetRoleKey, targetOccurrence: 1 },
      { type: "FACES", targetRoleKey: "primary-seating", targetOccurrence: 1 },
    ],
  };
}

function role(key: string, furnitureRole: FurnitureRole, category: CompositionType, placements: RolePlacementIntent[]): CompositionRole {
  return { key, role: furnitureRole, category, count: placements.length, zoneType: "PRIMARY_SEATING", placements };
}

function template(id: CompositionTemplateId, primary: CompositionType, dependent?: CompositionRole): CompositionTemplate {
  return {
    id,
    group: {
      type: "PRIMARY_SEATING_GROUP",
      primaryAnchorKey: "primary-seating",
      secondaryAnchorKeys: ["area-rug", "coffee-table"],
      dependentKeys: dependent ? [dependent.key] : [],
    },
    roles: [
      role("primary-seating", "PRIMARY_SEATING", primary, [primaryIntent]),
      role("coffee-table", "COFFEE_TABLE", "coffee_table", [tableIntent]),
      role("area-rug", "AREA_RUG", "rug", [rugIntent]),
      ...(dependent ? [dependent] : []),
    ],
  };
}

export const livingRoomCompositions: readonly CompositionTemplate[] = [
  template("T1", "sofa", role("chairs", "SECONDARY_SEATING", "armchair", [dependentIntent("primary-seating"), dependentIntent("primary-seating")])),
  template("T2", "sofa", role("chairs", "SECONDARY_SEATING", "armchair", [dependentIntent("primary-seating")])),
  template("T3", "sectional"),
  template("T4", "loveseat", role("chairs", "SECONDARY_SEATING", "armchair", [dependentIntent("primary-seating"), dependentIntent("primary-seating")])),
  template("T5", "sofa", role("secondary-seating", "SECONDARY_SEATING", "loveseat", [dependentIntent("coffee-table")])),
  template("T6", "modular_seating"),
];