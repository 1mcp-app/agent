/**
 * Encryption utilities for secure token storage at rest
 *
 * This module provides AES-256-GCM encryption for sensitive data
 * like OAuth tokens stored in file storage.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param plaintext - The data to encrypt
 * @param key - The encryption key (32 bytes for AES-256)
 * @returns Object containing encrypted data, IV, and auth tag
 * @throws Error if key length is invalid
 */
export function encrypt(plaintext: string, key: string): EncryptionResult {
  // Derive a proper 32-byte key using scrypt
  const derivedKey = scryptSync(key, '1mcp-salt', 32);

  // Generate a random IV (12 bytes for GCM)
  const iv = randomBytes(12);

  // Create cipher
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);

  // Encrypt the data
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get the auth tag for integrity verification
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt data using AES-256-GCM
 *
 * @param encryptedData - The encrypted data
 * @param iv - The initialization vector (base64 encoded)
 * @param authTag - The authentication tag (base64 encoded)
 * @param key - The encryption key
 * @returns The decrypted plaintext
 * @throws Error if decryption fails (invalid key or corrupted data)
 */
export function decrypt(encryptedData: string, iv: string, authTag: string, key: string): string {
  // Derive the same key
  const derivedKey = scryptSync(key, '1mcp-salt', 32);

  // Create decipher
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  // Decrypt the data
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a secure random encryption key
 *
 * @returns A random 32-byte key hex-encoded
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Validate that a key is suitable for encryption
 *
 * @param key - The key to validate
 * @returns True if the key is valid
 */
export function isValidEncryptionKey(key: string): boolean {
  try {
    // The key should be at least 8 characters
    if (!key || key.length < 8) {
      return false;
    }
    // Test that we can derive a key and encrypt/decrypt
    const result = encrypt('test', key);
    const decrypted = decrypt(result.encrypted, result.iv, result.authTag, key);
    return decrypted === 'test';
  } catch {
    return false;
  }
}
