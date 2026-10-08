# Integration examples

These runnable examples use real test signatures and the public fixtures. They are demonstrations, not live payment integrations. Build first with `pnpm build`. None requires keys, wallets, RPC or transactions.

## Node application boundary

```sh
node examples/node-integration.mjs
```

The example imports the compiled public API, loads the valid fixture, replaces self-asserted context with separately defined simulation context, and rejects any result other than PASS. Your real application must get this context from an authenticated channel-state source and its own configuration.

## Browser integration

```sh
pnpm dev
```

`apps/web/src/main.tsx` uses exactly `parseVoucherDocument` and `verifyVoucher` from `@voucherguard/core`. It does not implement a parallel verifier. The built-in signed scenarios are shared with CLI fixtures. For your own browser application, bundle the ESM core and supply byte arrays; it needs no Node Buffer, filesystem APIs, WebCrypto shim or network.

```ts
import { decodeBytes, verifyVoucher } from '@voucherguard/core';
const report = await verifyVoucher({
  message: decodeBytes(messageBase64, 'base64', 50),
  signature: decodeBytes(signatureBase64, 'base64', 64),
  authorizedSigner: trustedSignerBytes,
  policy: { expectedChannelId: trustedChannelBytes, requireState: false },
  now: trustedTime,
});
// Explicit reduced scope: no state/deposit/replay assessment.
```

## Terminal policy gate

```sh
node packages/cli/dist/index.js verify examples/valid.json \
  --policy examples/policy.json \
  --state examples/trusted-state.json \
  --json
```

`examples/policy.json` and `examples/trusted-state.json` are public simulation inputs, separate from the submitted voucher. Exit codes let callers refuse FAIL/INDETERMINATE/error. A PASS from a public fixture does not authorize a real payment.

## Atomic replay handling

The engine is a pure checker. In an agent system, use an existing application's authenticated state and an atomic compare-and-reserve operation. Two parallel verifications against watermark 100 can both accept cumulative 500; simply checking the result and updating later is not replay prevention. Do not treat this library as a replay database or settlement service.
