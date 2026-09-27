"""Read-only CLI for persisted catalog quality auditing."""

import asyncio
import json

from crawler.core.catalog_quality_audit import load_catalog_quality_audit


def main() -> None:
    report = asyncio.run(load_catalog_quality_audit())
    print(json.dumps(report.as_dict(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
