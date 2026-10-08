# @voucherguard/core

Offline Solana Foundation payment-channel V1 voucher verification. ESM, Node.js 22+ and modern browsers. No RPC, payment execution or private keys. Not independently audited; not a complete x402 verifier.

```ts
import { verifyVoucher } from '@voucherguard/core';
const report = await verifyVoucher({
  message, signature, authorizedSigner,
  policy: { expectedChannelId, maxCumulativeAmount: 1000000n },
  trustedState,
  now: trustedUnixSeconds,
});
```

The expected signer/channel and state must be authenticated independently. `requireState` defaults true; missing context yields INDETERMINATE. FAIL takes precedence. PASS describes only the applicable checks using supplied inputs, not settlement or replay guarantees. Strict Ed25519 rejects noncanonical/small-order edge cases; exhaustive Solana precompile equivalence is not claimed.

Repository: https://github.com/cg1290-tech/voucherguard. See repository docs for schema, integration and security assumptions. MIT.
