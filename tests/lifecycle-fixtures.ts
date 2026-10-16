import { base58 } from "@scure/base";
export const key = (n: number) => base58.encode(new Uint8Array(32).fill(n));
export const lifecycleOwner = key(9),
  lifecycleMint = key(8);
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  WSOL = "So11111111111111111111111111111111111111112",
  SYSTEM = "11111111111111111111111111111111";
export const tokenDeposit = 2333333n,
  temporaryFunding = 1777777n;
export type Ix = { programIdIndex: number; accounts: number[]; data: string };
export function createAccount(account: number, lamports: bigint): Ix {
  const b = new Uint8Array(52),
    v = new DataView(b.buffer);
  v.setUint32(0, 0, true);
  v.setBigUint64(4, lamports, true);
  v.setBigUint64(12, 165n, true);
  b.set(base58.decode(TOKEN), 20);
  return { programIdIndex: 5, accounts: [0, account], data: base58.encode(b) };
}
export function initialize(account: number, mint: number): Ix {
  const b = new Uint8Array(33);
  b[0] = 18;
  b.set(base58.decode(lifecycleOwner), 1);
  return {
    programIdIndex: 6,
    accounts: [account, mint],
    data: base58.encode(b),
  };
}
export function systemTransfer(from: number, to: number, n: bigint): Ix {
  const b = new Uint8Array(12),
    v = new DataView(b.buffer);
  v.setUint32(0, 2, true);
  v.setBigUint64(4, n, true);
  return { programIdIndex: 5, accounts: [from, to], data: base58.encode(b) };
}
export function tokenTransfer(from: number, to: number, n: bigint): Ix {
  const b = new Uint8Array(9);
  b[0] = 3;
  new DataView(b.buffer).setBigUint64(1, n, true);
  return { programIdIndex: 6, accounts: [from, to, 0], data: base58.encode(b) };
}
export const close = (account: number): Ix => ({
  programIdIndex: 6,
  accounts: [account, 0, 0],
  data: base58.encode(new Uint8Array([9])),
});
export function lifecycleTransaction(sell = false, partial = false) {
  const quantity = partial ? 50000000n : 100000000n,
    cash = sell ? (partial ? 600000000n : 1200000000n) : 1000000000n;
  const balance = (
    accountIndex: number,
    mint: string,
    owner: string,
    n: bigint,
    decimals: number,
  ) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount: n.toString(), decimals },
  });
  const ownerStart = sell
    ? 5000000000n - 1000000000n - tokenDeposit - 5000n
    : 5000000000n;
  const keys = [
    lifecycleOwner,
    key(2),
    key(3),
    key(4),
    lifecycleMint,
    SYSTEM,
    TOKEN,
    key(7),
    key(6),
    WSOL,
  ];
  const instructions: Ix[] = sell
    ? [
        createAccount(7, temporaryFunding),
        initialize(7, 9),
        tokenTransfer(2, 3, quantity),
        tokenTransfer(8, 7, cash),
        close(7),
        ...(!partial ? [close(2)] : []),
      ]
    : [
        createAccount(2, tokenDeposit),
        initialize(2, 4),
        createAccount(7, temporaryFunding),
        initialize(7, 9),
        systemTransfer(0, 7, cash),
        {
          programIdIndex: 6,
          accounts: [7],
          data: base58.encode(new Uint8Array([17])),
        },
        tokenTransfer(7, 8, cash),
        tokenTransfer(3, 2, 100000000n),
        close(7),
      ];
  const pre = [
    ownerStart,
    1n,
    sell ? tokenDeposit : 0n,
    tokenDeposit,
    1n,
    1n,
    1n,
    0n,
    10000000000n + temporaryFunding,
    1n,
  ];
  const post = [
    ownerStart +
      (sell ? cash + (!partial ? tokenDeposit : 0n) : -cash - tokenDeposit) -
      5000n,
    1n,
    sell && !partial ? 0n : tokenDeposit,
    tokenDeposit,
    1n,
    1n,
    1n,
    0n,
    10000000000n + temporaryFunding + (sell ? -cash : cash),
    1n,
  ];
  return {
    slot: sell ? 101 : 100,
    blockTime: 1792000000 + (sell ? 1 : 0),
    transaction: {
      signatures: [base58.encode(new Uint8Array(64).fill(sell ? 41 : 40))],
      message: { accountKeys: keys, instructions },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: pre.map(Number),
      postBalances: post.map(Number),
      preTokenBalances: [
        ...(sell
          ? [balance(2, lifecycleMint, lifecycleOwner, 100000000n, 6)]
          : []),
        balance(3, lifecycleMint, key(2), 1000000000n, 6),
        balance(8, WSOL, key(2), 10000000000n, 9),
      ],
      postTokenBalances: [
        ...(!sell || partial
          ? [
              balance(
                2,
                lifecycleMint,
                lifecycleOwner,
                sell ? 100000000n - quantity : 100000000n,
                6,
              ),
            ]
          : []),
        balance(
          3,
          lifecycleMint,
          key(2),
          1000000000n + (sell ? quantity : -100000000n),
          6,
        ),
        balance(8, WSOL, key(2), 10000000000n + (sell ? -cash : cash), 9),
      ],
      innerInstructions: [] as { index: number; instructions: Ix[] }[],
      loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
    },
  };
}
