import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, generateEncryptionKey, isValidEncryptionKey } from './encryption.js';

describe('encryption', () => {
  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'This is a secret message';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);

      expect(result.encrypted).toBeDefined();
      expect(result.iv).toBeDefined();
      expect(result.authTag).toBeDefined();

      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext with different keys', () => {
      const plaintext = 'Test message';
      const key1 = 'key-one-12345678';
      const key2 = 'key-two-12345678';

      const result1 = encrypt(plaintext, key1);
      const result2 = encrypt(plaintext, key2);

      expect(result1.encrypted).not.toBe(result2.encrypted);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'A'.repeat(10000);
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = 'Special chars: !@#$%^&*()_+-=[]{}|;\':",./<>?`~\n\t';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = 'Unicode: 你好世界 🌍 Привет мир';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle JSON objects', () => {
      const plaintext = JSON.stringify({ token: 'abc123', expires: 1234567890 });
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);

      expect(JSON.parse(decrypted)).toEqual(JSON.parse(plaintext));
    });

    it('should throw error for invalid key', () => {
      const plaintext = 'Test message';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);

      expect(() => decrypt(result.encrypted, result.iv, result.authTag, 'wrong-key')).toThrow();
    });

    it('should throw error for tampered ciphertext', () => {
      const plaintext = 'Test message';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);

      // Tamper with the encrypted data
      const tamperedEncrypted = Buffer.from(result.encrypted, 'base64');
      tamperedEncrypted[0] ^= 0xff;
      const tamperedBase64 = tamperedEncrypted.toString('base64');

      expect(() => decrypt(tamperedBase64, result.iv, result.authTag, key)).toThrow();
    });

    it('should throw error for tampered IV', () => {
      const plaintext = 'Test message';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);

      // Tamper with the IV
      const tamperedIv = Buffer.from(result.iv, 'base64');
      tamperedIv[0] ^= 0xff;
      const tamperedIvBase64 = tamperedIv.toString('base64');

      expect(() => decrypt(result.encrypted, tamperedIvBase64, result.authTag, key)).toThrow();
    });

    it('should throw error for tampered auth tag', () => {
      const plaintext = 'Test message';
      const key = 'my-secure-encryption-key';

      const result = encrypt(plaintext, key);

      // Tamper with the auth tag
      const tamperedTag = Buffer.from(result.authTag, 'base64');
      tamperedTag[0] ^= 0xff;
      const tamperedTagBase64 = tamperedTag.toString('base64');

      expect(() => decrypt(result.encrypted, result.iv, tamperedTagBase64, key)).toThrow();
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex string (32 bytes)', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[a-f0-9]+$/i.test(key)).toBe(true);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidEncryptionKey', () => {
    it('should return true for valid keys', () => {
      expect(isValidEncryptionKey('my-secure-key')).toBe(true);
      expect(isValidEncryptionKey('12345678')).toBe(true);
      expect(isValidEncryptionKey(generateEncryptionKey())).toBe(true);
    });

    it('should return false for invalid keys', () => {
      expect(isValidEncryptionKey('')).toBe(false);
      expect(isValidEncryptionKey('1234567')).toBe(false); // Less than 8 chars
      expect(isValidEncryptionKey('   ')).toBe(false);
    });
  });
});
