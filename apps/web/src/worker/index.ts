import { createRpcRelay } from "../rpc-worker";
import { enforceApiRateLimit } from "./rate-limit";
import {
  guardRobinhoodProAssets,
  handleRobinhoodProApi,
} from "./robinhood-session";
import { guardProAssets, handleProApi } from "./session";
import type { WorkerEnv } from "./shared";

const relay = createRpcRelay();

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const limited = await enforceApiRateLimit(request, env.API_RATE_LIMITER);
      if (limited) return limited;
    }
    const robinhood = env.VG_ACCESS_CHAIN === "robinhood";
    if (robinhood && url.pathname.startsWith("/api/pro"))
      return handleRobinhoodProApi(request, env, fetch);
    if (url.pathname.startsWith("/api/pro"))
      return handleProApi(request, env, fetch);
    const blocked = robinhood
      ? await guardRobinhoodProAssets(request, env, fetch)
      : await guardProAssets(request, env, fetch);
    if (blocked) return blocked;
    if (url.pathname === "/api/solana-rpc") return relay.fetch(request, env);
    return env.ASSETS.fetch(request);
  },
};
