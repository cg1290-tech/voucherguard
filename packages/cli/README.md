# @voucherguard/cli

Local verification of Solana Foundation payment-channel V1 signed documents using the VoucherGuard core. No RPC, wallet, transactions or private keys. Not independently audited; not a complete x402 verifier.

```sh
voucherguard verify voucher.json --json
voucherguard decode voucher.json
voucherguard inspect voucher.json
voucherguard --help
```

Expected keys and channel/state must be independently authenticated; values in the document are assertions only. Exit codes: 0 PASS/decode success, 1 FAIL, 2 INDETERMINATE, 3 invalid input/usage. Flags can override signer/channel/policy/state/time. PASS is conditional on supplied inputs, not settlement or replay guarantees.

Repository: https://github.com/cg1290-tech/voucherguard. Node.js 22+, ESM, MIT. See repository docs for the JSON schema and security model.
