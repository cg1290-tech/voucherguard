const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(value: string, length?: number): Uint8Array {
  if (typeof value !== "string" || !value)
    throw new Error("Invalid base58 value");
  const bytes = [0];
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("Invalid base58 character");
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  bytes.reverse();
  if (length !== undefined && bytes.length !== length)
    throw new Error("Unexpected base58 length");
  return Uint8Array.from(bytes);
}

export function encodeBase58(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leading = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading++;
  }
  return (
    "1".repeat(leading) +
    digits
      .reverse()
      .map((d) => ALPHABET[d])
      .join("")
  );
}
