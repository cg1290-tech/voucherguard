# Contributing

Use Node.js 22+ and pnpm 10.32.1. Install with `pnpm install --frozen-lockfile`, run `pnpm fixtures`, then `pnpm check`. For UI changes also install the Playwright test browser and run `pnpm test:browser`.

Keep core free of Node-only imports and network calls. Protocol changes require pinned primary-source evidence and tests for boundary/failure behavior. Application policies must remain visibly distinct from protocol invariants. New checks must propagate through SDK, CLI and browser through the shared core, including reason codes, reports and documentation.

Use BigInt for amounts/timestamps and decimal strings at JSON boundaries. Do not add private-key collection, settlement, custody, telemetry, paid APIs or AI inference. Hosted Pro may use Wallet Standard connect/signMessage only for Worker holder sessions. Do not claim audits or broad x402 support without evidence.

Submit focused pull requests with the problem, resulting behavior, tests executed and protocol implications. Follow the security reporting process for vulnerabilities rather than opening public exploit issues. Contributions are MIT licensed.
