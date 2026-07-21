/**
 * CONNECTOR_CAPABILITY — the plain-English "what does each connection
 * automate vs what do you do?" copy, keyed by connector provider.
 *
 * DERIVED from the ONE canonical connector registry
 * (src/lib/connectors/registry.ts) so the in-product clarity blocks rendered by
 * <ConnectorCapability /> (connector-capability.tsx) on the connectors page (and
 * the Today data-sources strip) read the SAME words the rest of the app uses for
 * each source. The copy itself, and its honesty rules (the read-only sources say
 * Beacon changes nothing; Wix keeps "you approve each change" front and centre;
 * no vendor name on the white-label surface), live on the registry.
 */

import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import type { ConnectorCapabilityCopy } from "./connector-capability";

export const CONNECTOR_CAPABILITY: Record<string, ConnectorCapabilityCopy> =
  Object.fromEntries(CONNECTOR_REGISTRY.map((c) => [c.id, c.capabilityCopy]));
