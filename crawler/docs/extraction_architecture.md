# Extraction Architecture

## Responsibility Boundary

- **Vendor adapter:** Where does this vendor put the fact?
- **Generic extraction/normalization:** What source fact was supplied, and how is it represented consistently?
- **AI enrichment:** What semantic facts may be inferred when explicit vendor facts are absent?

Crawler source facts, normalization, catalog resolution, and design intelligence remain separate.

## Extensibility Categories

**Generic:** JSON-LD traversal, recursive JSON path inspection, image URL deduplication, explicit unit conversion, availability normalization, price parsing, and labeled source-attribute representation.

**Vendor configuration:** recognized embedded script IDs, known product-data roots, gallery roots, and attribute-label aliases. Prefer declarative mappings here.

**Vendor-specific code:** only behavior unique to a vendor that cannot be expressed through generic utilities and configuration.

## Deterministic Multi-Source Evidence

Evidence priority is: official API/feed; explicit JSON-LD or structured product JSON; explicit labeled HTML attributes; vendor URL semantics; product/variant names; description prose; deterministic normalization; future AI semantic enrichment; future AI vision enrichment. Lower-priority evidence must never silently overwrite a higher-priority explicit fact.

`crawler/core/html_attributes.py` represents explicit table and definition-list label/value facts generically. Vendor configuration maps recognized labels to concepts. `crawler/core/url_semantics.py` tokenizes a source URL and returns only vendor-configured, deterministic candidates with provenance. URL-derived evidence remains separate from explicit source fields.

## Promotion Rule

First vendor: prove behavior locally. Second vendor: promote a repeated concept to a generic reusable component. Third and later vendors: reuse that component. Do not prematurely generalize every first-vendor behavior or copy generic parsing into every adapter.

Article currently exercises URL semantic evidence through a small configured vocabulary. The second vendor should exercise labeled HTML extraction where it exposes stable labels. If two vendors require the same mechanism, evaluate promotion into `crawler/core`; avoid accumulating Article-specific parsing rules.

## AI Boundary

AI must not determine SKU, price, currency, availability, explicit dimensions, unit conversion, vendor URLs, or explicitly structured source attributes. It may later enrich missing semantic data such as material described only in prose, style, subtype, semantic color, room suitability, or accessibility characteristics. Preserve enrichment provenance separately, for example `ai_material`, confidence, and evidence source.

AI enrichment should be event/change driven. Future source hashes should trigger it only for new records, relevant source changes, or stale/missing enrichment. Nightly price and availability refreshes remain deterministic.

## Article Review

`article.py` currently owns Article URL/page-ID handling, recognized product-state scripts, Article label aliases, and minimal HTML fallback. JSON-LD traversal, image deduplication, unit normalization, and diagnostic JSON walking are generic candidates. Promote only after a second vendor validates the same pattern.

The Article stop rule applies when richer data exists only in unstable presentation markup, requires JavaScript execution, depends on private internals, or would require accumulating brittle one-off rules. A final Article enhancement is justified only by a stable, explicit, repeatable structured source in manually saved HTML.

## Second-vendor Findings

**Already generic/reusable:** local script inventory, JSON-LD traversal, embedded JSON path diagnostics, labeled table/definition-list attributes, URL tokenization, and provenance reporting.

**Newly promoted generic logic:** `crawler/core/html_diagnostics.py` combines these local-only diagnostics without vendor extraction rules. IKEA uses it as a thin diagnostic consumer.

**IKEA-specific configuration:** only the diagnostic keyword set and explicit `IKEA` / `US` context. No IKEA DOM selectors, URL vocabulary, or product extraction mapping exists yet.

**Not implemented yet:** JavaScript execution, private APIs, unstable generated selectors, an IKEA production adapter, semantic URL interpretation, persistence, normalization changes, or AI enrichment. If saved IKEA HTML offers only these unstable sources, record the limitation and stop rather than adding brittle parsing.

## Article vs IKEA Adapter Comparison

IKEA validates three reusable concepts: JSON-LD `ImageObject` metadata, mixed-number source measurements, and explicit labeled construction attributes. These are implemented in `crawler/core/product_media.py`, `crawler/core/measurements.py`, and `crawler/core/html_attributes.py`. The IKEA adapter remains thin: it supplies only vendor/market identity and maps explicit JSON-LD/labeled facts into the existing product contract.

Article retains its own page-ID and configured URL-semantic evidence because that behavior has not yet repeated across a second vendor. IKEA URL tokens are preserved as lower-priority provenance only; no IKEA URL vocabulary or semantic inference is implemented. Future production adapters should reuse the promoted generic helpers rather than duplicate them.
