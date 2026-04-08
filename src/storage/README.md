# Storage Layer

Canonical persistence for Beacon-native entities.

Each canonical type gets its own store file that handles read/write
to the local `.data/` JSON persistence layer.

Storage files import from `@/lib/persistence/json-store` and expose:
- A module-level array (the in-memory cache)
- A `persist*` function for writing back to disk

Storage is always server-only.
