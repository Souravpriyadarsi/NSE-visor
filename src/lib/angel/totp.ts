const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes an authenticator-app secret. Spaces, dashes, padding and lower case are allowed. */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const bytes = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 5) / 8)));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error('The TOTP secret has a character that isn’t valid base32.');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return bytes;
}

/** Time-based one-time password (RFC 6238, HMAC-SHA1): the 6-digit code an authenticator app shows. */
export async function totp(secret: string, nowMs = Date.now(), stepSeconds = 30, digits = 6): Promise<string> {
  const counter = Math.floor(nowMs / 1000 / stepSeconds);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
