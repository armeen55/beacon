import "server-only";

/** evidence/observations/poll-health - WHETHER THE NATIVE POLL ACTUALLY RAN. The canonical platform name is
 *  pure and client-safe, so it lives in poll-platform-canonical and is re-exported here for the server callers
 *  that already import it from this path. */

import {
  canonicalizePollPlatform as canonicalizePollPlatformPure,
  type PollPlatform as PollPlatformPure,
} from "./poll-platform-canonical";

export type PollPlatform = PollPlatformPure;
export const canonicalizePollPlatform = canonicalizePollPlatformPure;
