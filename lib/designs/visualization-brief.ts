import type { CatalogCandidate } from "@/lib/catalog/schema";
import { toRoomAIProduct } from "@/lib/catalog/customer-product";
import type { DesignSpecification } from "@/lib/designs/types";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

type DesignObject = Tables<"design_objects">;

export type VisualizationBrief = {
  instruction: "VISUALIZE THE EXISTING DESIGN. DO NOT REDESIGN THE ROOM.";
  project: {
    name: string;
    roomType: string;
  };
  design: {
    name: string;
    summary: string;
    palette: DesignSpecification["palette"];
    surfaces: DesignSpecification["surfaces"];
    lighting: DesignSpecification["lighting"];
  };
  room: {
    shapeType: RoomGeometry["shapeType"];
    ceilingHeightCm: number | null;
    polygon: Array<{ xCm: number; yCm: number }>;
    walls: RoomGeometry["wallSegments"];
    openings: Array<{
      openingType: RoomOpening["openingType"];
      wallSegmentId: string;
      offsetCm: number;
      widthCm: number;
      heightCm: number;
      sillHeightCm: number | null;
      hingeSide: RoomOpening["hingeSide"];
      swingDirection: RoomOpening["swingDirection"];
    }>;
  };
  furniture: Array<{
    role: string | null;
    name: string;
    position: { xCm: number; yCm: number; zCm: number };
    rotationDegrees: number;
    dimensions: { widthCm: number; depthCm: number; heightCm: number };
    material: string | null;
    color: string | null;
    style: string | null;
    configuration: string | null;
  }>;
  decorations: Array<{
    role: string | null;
    name: string;
    position: { xCm: number; yCm: number; zCm: number } | null;
    rotationDegrees: number;
    material: string | null;
    color: string | null;
  }>;
};

export function buildVisualizationBrief(input: {
  project: { name: string; roomType: string };
  specification: DesignSpecification;
  geometry: RoomGeometry;
  openings: RoomOpening[];
  objects: DesignObject[];
  catalogByVariantId: Map<string, CatalogCandidate>;
}): VisualizationBrief {
  return {
    instruction: "VISUALIZE THE EXISTING DESIGN. DO NOT REDESIGN THE ROOM.",
    project: input.project,
    design: {
      name: input.specification.designName,
      summary: input.specification.summary,
      palette: input.specification.palette,
      surfaces: input.specification.surfaces,
      lighting: input.specification.lighting,
    },
    room: {
      shapeType: input.geometry.shapeType,
      ceilingHeightCm: input.geometry.ceilingHeightCm,
      polygon: input.geometry.vertices.map(({ xCm, yCm }) => ({ xCm, yCm })),
      walls: input.geometry.wallSegments.map((wall) => ({ ...wall })),
      openings: input.openings.map((opening) => ({
        openingType: opening.openingType,
        wallSegmentId: opening.wallSegmentId,
        offsetCm: opening.offsetCm,
        widthCm: opening.widthCm,
        heightCm: opening.heightCm,
        sillHeightCm: opening.sillHeightCm,
        hingeSide: opening.hingeSide,
        swingDirection: opening.swingDirection,
      })),
    },
    furniture: input.objects
      .filter((object) => object.object_type === "furniture")
      .map((object) => {
        const candidate = object.catalog_product_variant_id
          ? input.catalogByVariantId.get(object.catalog_product_variant_id)
          : undefined;
        const product = candidate ? toRoomAIProduct(candidate) : null;
        return {
          role: object.category,
          name: product?.name ?? object.name ?? object.category ?? "Furniture",
          position: {
            xCm: object.x_cm ?? 0,
            yCm: object.y_cm ?? 0,
            zCm: object.z_cm ?? 0,
          },
          rotationDegrees: object.rotation_degrees,
          dimensions: {
            widthCm: object.width_cm ?? 1,
            depthCm: object.depth_cm ?? 1,
            heightCm: object.height_cm ?? 1,
          },
          material: product?.material ?? object.material,
          color: product?.color ?? object.primary_color,
          style: product?.style ?? null,
          configuration: product?.configuration ?? null,
        };
      }),
    decorations: input.objects
      .filter((object) => object.object_type === "decoration")
      .map((object) => ({
        role: object.category,
        name: object.name ?? object.category ?? "Decoration",
        position: object.x_cm !== null && object.y_cm !== null && object.z_cm !== null
          ? { xCm: object.x_cm, yCm: object.y_cm, zCm: object.z_cm }
          : null,
        rotationDegrees: object.rotation_degrees,
        material: object.material,
        color: object.primary_color,
      })),
  };
}

export function visualizationPrompt(brief: VisualizationBrief): string {
  return `${brief.instruction}\n\nCreate a realistic interior room visualization from this authoritative JSON brief:\n${JSON.stringify(brief)}\n\nPreserve the room polygon, proportions, walls, doors, windows, furniture dimensions, positions, rotations, materials, colors, styles, decorations, and design intent. Do not add, remove, replace, or reposition major furniture or decorations. Do not invent different finishes or dimensions. Do not display logos, vendor names, websites, product labels, measurements, captions, or text overlays. This is a visual interpretation of existing structured state, not permission to redesign it.`;
}
