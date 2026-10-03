export type ClearanceRule = {
  id: string;
  minimumCm: number;
  priority: "P1";
  classification: "hard" | "soft";
  regulatoryGuarantee: false;
} & (
  { context: "SEATING_COFFEE_TABLE"; preferredRangeCm: readonly [number, number]; sourceRole: "COFFEE_TABLE"; targetRoles: readonly ("PRIMARY_SEATING" | "SECONDARY_SEATING")[]; relationshipType: "IN_FRONT_OF" }
  | { context: "DOOR_APPROACH" }
);

/** RoomAI planning defaults, not regulatory guarantees or aesthetic maximum-spacing rules. */
export const seatingCoffeeTableClearanceRule = {
  id: "seating-coffee-table-minimum",
  context: "SEATING_COFFEE_TABLE",
  minimumCm: 35,
  preferredRangeCm: [35, 50],
  priority: "P1",
  classification: "hard",
  regulatoryGuarantee: false,
  sourceRole: "COFFEE_TABLE",
  targetRoles: ["PRIMARY_SEATING", "SECONDARY_SEATING"],
  relationshipType: "IN_FRONT_OF",
} as const satisfies ClearanceRule;

export const doorApproachClearanceRule = {
  id: "door-interior-approach",
  context: "DOOR_APPROACH",
  minimumCm: 75,
  priority: "P1",
  classification: "hard",
  regulatoryGuarantee: false,
} as const satisfies ClearanceRule;