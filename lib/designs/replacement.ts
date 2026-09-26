import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { DesignSpecification } from "@/lib/designs/types";
import type { Tables, TablesInsert } from "@/types/database.types";

type DesignObject = Tables<"design_objects">;
type DesignObjectInsert = TablesInsert<"design_objects">;

export const REPLACEMENT_VISUALIZATION_WARNING =
  "Furniture selection updated. The room visualization has not yet been refreshed.";

function matchesSpecificationObject(
  object: DesignObject,
  furniture: DesignSpecification["furniture"][number],
) {
  return object.name === furniture.name
    && object.category === furniture.category
    && object.x_cm === furniture.position.xCm
    && object.y_cm === furniture.position.yCm
    && object.z_cm === furniture.position.zCm
    && object.rotation_degrees === furniture.rotationDegrees;
}

export function createReplacementClone(
  designId: string,
  specification: DesignSpecification,
  objects: DesignObject[],
  selectedObjectId: string,
  candidate: CatalogCandidate,
): { specification: DesignSpecification; objects: DesignObjectInsert[] } | null {
  if (
    candidate.widthCm === null
    || candidate.depthCm === null
    || candidate.heightCm === null
    || candidate.widthCm <= 0
    || candidate.depthCm <= 0
    || candidate.heightCm <= 0
  ) return null;

  const selectedObject = objects.find((object) => object.id === selectedObjectId);
  if (!selectedObject || selectedObject.object_type !== "furniture") return null;
  const matchingIndexes = specification.furniture.flatMap((furniture, index) =>
    matchesSpecificationObject(selectedObject, furniture) ? [index] : []);
  if (matchingIndexes.length !== 1) return null;
  const selectedFurnitureIndex = matchingIndexes[0];
  const replacementName = candidate.productTitle ?? selectedObject.name ?? specification.furniture[selectedFurnitureIndex].name;

  const nextSpecification: DesignSpecification = {
    ...specification,
    furniture: specification.furniture.map((furniture, index) => index === selectedFurnitureIndex
      ? {
          ...furniture,
          name: replacementName,
          dimensions: {
            widthCm: candidate.widthCm!,
            depthCm: candidate.depthCm!,
            heightCm: candidate.heightCm!,
          },
          material: candidate.normalizedMaterial ?? furniture.material,
          color: candidate.normalizedColor ?? furniture.color,
          catalogSelectionKey: null,
        }
      : { ...furniture }),
    warnings: specification.warnings.includes(REPLACEMENT_VISUALIZATION_WARNING)
      ? [...specification.warnings]
      : [...specification.warnings, REPLACEMENT_VISUALIZATION_WARNING],
  };

  const nextObjects: DesignObjectInsert[] = objects.map((object) => {
    const base: DesignObjectInsert = {
      design_id: designId,
      object_type: object.object_type,
      category: object.category,
      name: object.name,
      x_cm: object.x_cm,
      y_cm: object.y_cm,
      z_cm: object.z_cm,
      width_cm: object.width_cm,
      depth_cm: object.depth_cm,
      height_cm: object.height_cm,
      rotation_degrees: object.rotation_degrees,
      material: object.material,
      primary_color: object.primary_color,
      product_id: object.product_id,
      catalog_product_id: object.catalog_product_id,
      catalog_product_variant_id: object.catalog_product_variant_id,
      reasoning: object.reasoning,
    };
    return object.id === selectedObjectId
      ? {
          ...base,
          name: replacementName,
          width_cm: candidate.widthCm,
          depth_cm: candidate.depthCm,
          height_cm: candidate.heightCm,
          material: candidate.normalizedMaterial ?? object.material,
          primary_color: candidate.normalizedColor ?? object.primary_color,
          catalog_product_id: candidate.productId,
          catalog_product_variant_id: candidate.variantId,
        }
      : base;
  });

  return { specification: nextSpecification, objects: nextObjects };
}
