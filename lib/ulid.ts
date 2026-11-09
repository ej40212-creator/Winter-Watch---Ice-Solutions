const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-character ULID. The value is minted once and stored; it is not derived from row order. */
export function ulid(ms = Date.now(), randomBytes?: Uint8Array): string {
  const rand = randomBytes && randomBytes.length === 10 ? randomBytes : crypto.getRandomValues(new Uint8Array(10));
  let time = Math.max(0, Math.floor(ms));
  const timeChars = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = CROCKFORD[time % 32]!;
    time = Math.floor(time / 32);
  }
  let bits = 0;
  let value = 0;
  let random = "";
  for (const byte of rand) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      random += CROCKFORD[(value >>> bits) & 31];
    }
  }
  return timeChars.join("") + random;
}
