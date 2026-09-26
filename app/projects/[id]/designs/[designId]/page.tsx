import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { RoomAIAlternative } from "@/lib/catalog/customer-alternative";
import { buildCustomerAlternativeMap } from "@/lib/catalog/customer-alternative-map";
import { toRoomAIProduct } from "@/lib/catalog/customer-product";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";
import {
  findCatalogProductsByVariantIds,
  findCatalogProductsForAlternativeContexts,
} from "@/lib/catalog/query";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import { calculateEstimatedDesignCost, designSpecificationSchema } from "@/lib/designs/schema";
import { replaceFurnitureAction } from "@/lib/designs/replacement-actions";
import { validateRoomOpenings } from "@/lib/geometry/openings";
import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database.types";

type Design = Tables<"designs">;
type DesignObject = Tables<"design_objects">;
type GeometryRow = Tables<"room_geometries">;

export const instant = false;

function parseGeometry(row: GeometryRow): RoomGeometry | null {
  const result = roomGeometrySchema.safeParse({
    schemaVersion: row.schema_version,
    shapeType: row.shape_type,
    templateTransform: {
      rotationDegrees: row.template_rotation_degrees,
      mirroredHorizontal: row.template_mirrored_horizontal,
      mirroredVertical: row.template_mirrored_vertical,
    },
    ceilingHeightCm: row.ceiling_height_cm,
    vertices: row.vertices as Json,
    wallSegments: row.wall_segments as Json,
  });
  return result.success && validateRoomGeometryStructure(result.data).valid
    ? result.data
    : null;
}

function formatMoney(currency: string, value: number) {
  return `${currency} ${value.toFixed(2)}`;
}

function Detail({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-2 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 py-8 first:border-t-0 first:pt-0">
      <h2 className="mb-6 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function ObjectList({
  objects,
  type,
  catalogByVariantId,
  alternativesByVariantId,
  replacementVariantIdByAlternative,
  projectId,
  designId,
}: {
  objects: DesignObject[];
  type: string;
  catalogByVariantId: Map<string, CatalogCandidate>;
  alternativesByVariantId: Map<string, RoomAIAlternative[]>;
  replacementVariantIdByAlternative: Map<RoomAIAlternative, string>;
  projectId: string;
  designId: string;
}) {
  const matchingObjects = objects.filter((object) => object.object_type === type);

  if (!matchingObjects.length) {
    return <p className="text-sm text-slate-500">None included</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {matchingObjects.map((object) => {
        const catalogCandidate = object.catalog_product_variant_id
          ? catalogByVariantId.get(object.catalog_product_variant_id)
          : undefined;
        if (!catalogCandidate) {
          return (
            <article key={object.id} className="border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-medium text-slate-950">{object.name ?? object.category ?? "Unnamed object"}</h3>
              {object.category && <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{object.category}</p>}
              {object.reasoning && <p className="mt-3 text-sm leading-6 text-slate-700">{object.reasoning}</p>}
            </article>
          );
        }
        const roomAIProduct = toRoomAIProduct(catalogCandidate);
        const alternatives = alternativesByVariantId.get(catalogCandidate.variantId) ?? [];
        const catalogDimensions = roomAIProduct.dimensions.widthCm !== null
          && roomAIProduct.dimensions.depthCm !== null
          && roomAIProduct.dimensions.heightCm !== null
          ? `${roomAIProduct.dimensions.widthCm} × ${roomAIProduct.dimensions.depthCm} × ${roomAIProduct.dimensions.heightCm} cm`
          : null;
        const catalogPrice = roomAIProduct.price.currency && roomAIProduct.price.amount !== null
          ? formatMoney(roomAIProduct.price.currency, roomAIProduct.price.amount)
          : null;
        const designObjectName = object.name ?? object.category ?? "Unnamed object";
        const imageAlt = roomAIProduct.name || designObjectName;

        return (
          <article key={object.id} className="overflow-hidden border border-slate-200 bg-slate-50">
            {roomAIProduct.imageUrl && (
              <div className="aspect-[4/3] w-full overflow-hidden bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={roomAIProduct.imageUrl}
                  alt={imageAlt}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">{roomAIProduct.name}</h3>
                </div>
                <Badge variant="outline">Catalog matched</Badge>
              </div>
              <div className="mt-3 border-l-2 border-slate-200 pl-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Design selection</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{designObjectName}</p>
                {object.category && <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{object.category}</p>}
              </div>
              {object.reasoning && <p className="mt-3 text-sm leading-6 text-slate-700">{object.reasoning}</p>}
              <dl className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
                <Detail label="RoomAI catalog price" value={catalogPrice} />
                <Detail label="Material" value={roomAIProduct.material} />
                <Detail label="Color" value={roomAIProduct.color} />
                <Detail label="Style" value={roomAIProduct.style} />
                <Detail label="Dimensions" value={catalogDimensions} />
                <Detail label="Availability" value={roomAIProduct.availability.status} />
                <Detail label="Delivery" value={roomAIProduct.availability.deliveryText} />
              </dl>
              {alternatives.length > 0 && (
                <section className="mt-5 border-t border-slate-200 pt-5">
                  <h4 className="text-sm font-semibold text-slate-950">RoomAI alternatives</h4>
                  <p className="mt-1 text-sm text-slate-600">Similar options selected for this design.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {alternatives.map((alternative, index) => {
                      const { product } = alternative;
                      const selectedCatalogVariantId = replacementVariantIdByAlternative.get(alternative);
                      const alternativePrice = product.price.currency && product.price.amount !== null
                        ? formatMoney(product.price.currency, product.price.amount)
                        : null;
                      const alternativeDimensions = product.dimensions.widthCm !== null
                        && product.dimensions.depthCm !== null
                        && product.dimensions.heightCm !== null
                        ? `${product.dimensions.widthCm} × ${product.dimensions.depthCm} × ${product.dimensions.heightCm} cm`
                        : null;

                      return (
                        <article key={`${product.name}-${index}`} className="overflow-hidden border border-slate-200 bg-white">
                          {product.imageUrl && (
                            <div className="aspect-[4/3] w-full overflow-hidden bg-slate-50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                            </div>
                          )}
                          <div className="p-3">
                            <h5 className="text-sm font-semibold text-slate-950">{product.name}</h5>
                            {alternativePrice && <p className="mt-1 text-sm font-medium text-emerald-700">{alternativePrice}</p>}
                            <dl className="mt-3 grid gap-3">
                              <Detail label="Material" value={product.material} />
                              <Detail label="Color" value={product.color} />
                              <Detail label="Style" value={product.style} />
                              <Detail label="Dimensions" value={alternativeDimensions} />
                            </dl>
                            {selectedCatalogVariantId && (
                              <form action={replaceFurnitureAction} className="mt-4">
                                <input type="hidden" name="projectId" value={projectId} />
                                <input type="hidden" name="designId" value={designId} />
                                <input type="hidden" name="designObjectId" value={object.id} />
                                <input type="hidden" name="selectedCatalogVariantId" value={selectedCatalogVariantId} />
                                <button type="submit" className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-950">
                                  Use this furniture
                                </button>
                              </form>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default async function DesignPage({
  params,
}: {
  params: Promise<{ id: string; designId: string }>;
}) {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { id: projectId, designId } = await params;
  const [designResult, objectsResult, geometryResult, openingsResult] = await Promise.all([
    supabase
      .from("designs")
      .select("id, project_id, version, status, design_name, summary, design_specification, model_provider, model_name, prompt_version, generation_started_at, generation_completed_at, created_at")
      .eq("id", designId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("design_objects")
      .select("id, design_id, object_type, category, name, x_cm, y_cm, z_cm, width_cm, depth_cm, height_cm, rotation_degrees, material, primary_color, product_id, catalog_product_id, catalog_product_variant_id, reasoning, created_at")
      .eq("design_id", designId)
      .order("created_at", { ascending: true }),
    supabase
      .from("room_geometries")
      .select("id, project_id, schema_version, shape_type, template_rotation_degrees, template_mirrored_horizontal, template_mirrored_vertical, vertices, wall_segments, ceiling_height_cm, created_at, updated_at")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("room_openings")
      .select("id, room_geometry_id, opening_type, wall_segment_id, offset_cm, width_cm, height_cm, sill_height_cm, hinge_side, swing_direction, created_at, updated_at")
      .order("created_at", { ascending: true }),
  ]);

  if (designResult.error || !designResult.data || objectsResult.error) {
    notFound();
  }

  const design = designResult.data as Design;
  const specificationResult = designSpecificationSchema.safeParse(design.design_specification);
  if (!specificationResult.success) {
    console.error("Stored RoomAI design specification failed validation", {
      designId,
      issues: specificationResult.error.issues,
    });
    notFound();
  }

  const specification = specificationResult.data;
  const objects = objectsResult.data as DesignObject[];
  const catalogVariantIds = [
    ...new Set(
      objects
        .map((object) => object.catalog_product_variant_id)
        .filter((variantId): variantId is string => variantId !== null),
    ),
  ];
  let catalogByVariantId = new Map<string, CatalogCandidate>();
  if (catalogVariantIds.length > 0) {
    try {
      const catalogCandidates = await findCatalogProductsByVariantIds(catalogVariantIds);
      catalogByVariantId = new Map(
        catalogCandidates.map((candidate) => [candidate.variantId, candidate]),
      );
    } catch (error) {
      console.error("RoomAI design catalog hydration failed", {
        designId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  const storedGeometry = !geometryResult.error && geometryResult.data
    ? parseGeometry(geometryResult.data as GeometryRow)
    : null;
  const relevantOpeningRows = storedGeometry && geometryResult.data && !openingsResult.error
    ? (openingsResult.data ?? []).filter((opening) => opening.room_geometry_id === geometryResult.data?.id)
    : [];
  const parsedOpenings = relevantOpeningRows.map((opening) => roomOpeningSchema.safeParse({
    id: opening.id,
    openingType: opening.opening_type,
    wallSegmentId: opening.wall_segment_id,
    offsetCm: opening.offset_cm,
    widthCm: opening.width_cm,
    heightCm: opening.height_cm,
    sillHeightCm: opening.sill_height_cm,
    hingeSide: opening.hinge_side,
    swingDirection: opening.swing_direction,
  }));
  const storedOpenings: RoomOpening[] = parsedOpenings.flatMap((result) => result.success ? [result.data] : []);
  const validOpenings = storedGeometry
    && parsedOpenings.every((result) => result.success)
    && validateRoomOpenings(storedGeometry, storedOpenings).valid
    ? storedOpenings
    : null;
  const suitabilityContextsByVariantId = new Map<string, AlternativeSuitabilityContext>();
  if (storedGeometry && validOpenings && !openingsResult.error) {
    for (const object of objects) {
      if (!object.catalog_product_variant_id) continue;
      suitabilityContextsByVariantId.set(object.catalog_product_variant_id, {
        currentObjectId: object.id,
        designObject: {
          x_cm: object.x_cm,
          y_cm: object.y_cm,
          rotation_degrees: object.rotation_degrees,
        },
        geometry: storedGeometry,
        openings: validOpenings,
        neighbors: objects,
      });
    }
  }
  let alternativesByVariantId = new Map<string, RoomAIAlternative[]>();
  const replacementVariantIdByAlternative = new Map<RoomAIAlternative, string>();
  if (catalogByVariantId.size > 0) {
    try {
      const currentCatalogCandidates = [...catalogByVariantId.values()];
      const candidatePool = await findCatalogProductsForAlternativeContexts(currentCatalogCandidates);
      alternativesByVariantId = buildCustomerAlternativeMap(
        currentCatalogCandidates,
        candidatePool,
        4,
        suitabilityContextsByVariantId,
        replacementVariantIdByAlternative,
      );
    } catch (error) {
      console.error("RoomAI design alternative hydration failed", {
        designId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  const estimatedCost = calculateEstimatedDesignCost(specification);

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f7f7f4]/95">
        <div className="mx-auto flex min-h-20 max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-8">
          <Link href="/dashboard" className="text-xl font-semibold tracking-tight">RoomAI</Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href={`/projects/${projectId}`} className="text-slate-600 transition-colors hover:text-slate-950">Back to Project</Link>
            <Link href="/dashboard" className="text-slate-600 transition-colors hover:text-slate-950">Dashboard</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-14">
        <div className="border-b border-slate-200 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">AI Design Generated</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{design.design_name ?? specification.designName}</h1>
            <Badge variant="outline">Version {design.version}</Badge>
            <Badge variant="outline">{design.status}</Badge>
          </div>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700">{design.summary ?? specification.summary}</p>
        </div>

        <div className="mt-8 border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-10">
          <Section title="Overview">
            <dl className="grid gap-6 sm:grid-cols-3">
              <Detail label="Estimated total" value={formatMoney(specification.budget.currency, estimatedCost)} />
              <Detail label="Furniture" value={specification.furniture.length} />
              <Detail label="Decorations" value={specification.decorations.length} />
            </dl>
          </Section>

          <Section title="Palette">
            <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <Detail label="Walls" value={specification.palette.walls} />
              <Detail label="Primary" value={specification.palette.primary} />
              <Detail label="Secondary" value={specification.palette.secondary} />
              <Detail label="Accent" value={specification.palette.accent} />
              <Detail label="Metal" value={specification.palette.metal} />
            </dl>
          </Section>

          <Section title="Furniture">
            <ObjectList
              objects={objects}
              type="furniture"
              catalogByVariantId={catalogByVariantId}
              alternativesByVariantId={alternativesByVariantId}
              replacementVariantIdByAlternative={replacementVariantIdByAlternative}
              projectId={projectId}
              designId={designId}
            />
          </Section>

          <Section title="Decorations">
            <ObjectList
              objects={objects}
              type="decoration"
              catalogByVariantId={catalogByVariantId}
              alternativesByVariantId={alternativesByVariantId}
              replacementVariantIdByAlternative={replacementVariantIdByAlternative}
              projectId={projectId}
              designId={designId}
            />
          </Section>

          {specification.warnings.length > 0 && (
            <Section title="Warnings">
              <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {specification.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Section>
          )}

          {specification.advice.length > 0 && (
            <Section title="Advice">
              <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {specification.advice.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Section>
          )}
        </div>

        <details className="mt-8 border border-slate-200 bg-white p-6 sm:p-8">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">View validated specification</summary>
          <pre className="mt-4 max-h-[32rem] overflow-auto bg-slate-50 p-4 text-xs leading-5 text-slate-700">{JSON.stringify(specification, null, 2)}</pre>
        </details>
      </div>
    </main>
  );
}