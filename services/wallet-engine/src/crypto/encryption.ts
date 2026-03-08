import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

interface EncryptedPayload {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const KEY_BYTES = 32;

export const encryptText = (plainText: string, secret: string): string => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, KEY_BYTES);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };

  return JSON.stringify(payload);
};

export const decryptText = (encrypted: string, secret: string): string => {
  const payload = JSON.parse(encrypted) as EncryptedPayload;

  if (payload.v !== 1) {
    throw new Error(`Unsupported payload version: ${String(payload.v)}`);
  }

  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const key = scryptSync(secret, salt, KEY_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);

  return plain.toString('utf8');
};
