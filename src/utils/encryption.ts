import logger from './logger';

const ENCRYPTION_KEY = 'dailyfix_encryption_key';
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;

async function getOrCreateKey() {
  try {
    let storedKey = localStorage.getItem(ENCRYPTION_KEY);
    
    if (!storedKey) {
      // Generate a new encryption key
      const key = await window.crypto.subtle.generateKey(
        {
          name: ALGORITHM,
          length: 256
        },
        true,
        ['encrypt', 'decrypt']
      );

      // Export the key
      const exportedKey = await window.crypto.subtle.exportKey('raw', key);
      const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
      localStorage.setItem(ENCRYPTION_KEY, keyBase64);
      return key;
    }

    // Import existing key
    const keyBuffer = Uint8Array.from(atob(storedKey), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
      'raw',
      keyBuffer,
      ALGORITHM,
      true,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    logger.info('[Encryption] Failed to get/create key:', error);
    throw error;
  }
}

export async function encrypt(data) {
  try {
    const key = await getOrCreateKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encodedData = new TextEncoder().encode(data);

    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv
      },
      key,
      encodedData
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    logger.info('[Encryption] Encryption failed:', error);
    throw error;
  }
}

export async function decrypt(encryptedData) {
  try {
    const key = await getOrCreateKey();
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    // Extract IV and data
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv
      },
      key,
      data
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    logger.info('[Encryption] Decryption failed:', error);
    throw error;
  }
}

export const generateEncryptionKey = () => {
  try {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const key = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(ENCRYPTION_KEY, key);
    return key;
  } catch (error) {
    logger.info('[Encryption] Failed to generate encryption key:', error);
    return null;
  }
};

export const getEncryptionKey = () => {
  try {
    return localStorage.getItem(ENCRYPTION_KEY);
  } catch (error) {
    logger.info('[Encryption] Failed to get encryption key:', error);
    return null;
  }
};

export const clearEncryptionKey = () => {
  try {
    localStorage.removeItem(ENCRYPTION_KEY);
  } catch (error) {
    logger.info('[Encryption] Failed to clear encryption key:', error);
  }
};

export default {
  generateEncryptionKey,
  getEncryptionKey,
  clearEncryptionKey
}; 