import { useEffect, useRef, useState } from "react";
import type { ProConfig } from "./config";
import { validateConfig } from "./config";
import {
  type AccessResult,
  accountOnMainnet,
  checkEligibility,
  type OwnershipReader,
} from "./eligibility";
import type { WalletSnapshot } from "./wallet";

/** Identity-keyed state prevents stale RPC results from unlocking a switched/disconnected wallet. */
export function useAccess(
  config: ProConfig,
  wallet: WalletSnapshot,
  reader: OwnershipReader,
) {
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const [evaluation, setEvaluation] = useState<{
    key: string;
    result: AccessResult;
  }>();
  const key = JSON.stringify([
    config.mint,
    config.rpcUrl,
    config.threshold,
    config.network,
    wallet.revision,
    wallet.account?.address,
    refresh,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    if (!wallet.connecting) {
      void checkEligibility(
        config,
        wallet.account,
        reader,
        controller.signal,
      ).then((result) => {
        if (!controller.signal.aborted && request === generation.current)
          setEvaluation({ key, result });
      });
    }
    return () => controller.abort();
  }, [config, key, reader, wallet.account, wallet.connecting]);
  const setup = validateConfig(config);
  let result: AccessResult;
  if (setup.status !== "ready") result = setup;
  else if (wallet.connecting)
    result = { status: "checking", message: "Waiting for wallet connection." };
  else if (!wallet.account)
    result = {
      status: "disconnected",
      message: "Connect a Solana wallet to check token access.",
    };
  else if (!accountOnMainnet(wallet.account))
    result = {
      status: "unsupported-network",
      message: "Choose a wallet account authorized for Solana mainnet-beta.",
    };
  else if (evaluation?.key !== key)
    result = {
      status: "checking",
      message:
        "Checking mainnet token holdings. Access remains locked until verified.",
    };
  else result = evaluation.result;
  return { result, refresh: () => setRefresh((n) => n + 1) };
}
