import type { RoomDO } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  AUDIO: KVNamespace;
  /** Optional service that turns hard-to-extract pages (YouTube) into audio. */
  URL_RESOLVER?: string;
  URL_RESOLVER_KEY?: string;
}
