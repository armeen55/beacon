# Legacy Adapters

Temporary import adapters that map external source formats into Beacon canonical schemas.

These adapters exist to support historical data ingestion from:
- Ritz master workbook (`.xlsx`)
- Profound prompt intelligence exports

**These adapters are explicitly temporary.** They should be replaced by:
1. Beacon-native prompt tracking (nightly observation runs)
2. Direct API integration with visibility platforms
3. Operator-entered changes via the Beacon UI

## Rules

1. Adapters must output only canonical Beacon types
2. No product logic may depend on adapter internals
3. All adapter-specific field mappings stay inside the adapter
4. Adapters may emit warnings but must never fail silently
