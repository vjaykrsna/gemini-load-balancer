import fs from "fs/promises";
import { join, dirname } from "path";
import { mkdir } from "fs/promises";

// Define the data directory path
const DATA_DIR = join(process.cwd(), "data");
const KEYS_FILE = join(DATA_DIR, "keys.json");

// Define the ApiKey interface
interface ApiKeyData {
  key: string;
  name?: string; // Add optional name field
  isActive: boolean;
  lastUsed: string | null;
  rateLimitResetAt: string | null; // Existing field, maybe for global rate limits? Keep for now.
  failureCount: number;
  requestCount: number; // Total requests
  _id: string;
  dailyRateLimit?: number | null; // Max daily requests (null or undefined means no limit)
  dailyRequestsUsed: number; // Requests used today
  lastResetDate: string | null; // ISO date string when dailyRequestsUsed was last reset
  isDisabledByRateLimit: boolean; // Flag if disabled due to daily limit
}

// Simple lock flag to prevent concurrent writes
let isWriting = false;
const MAX_WRITE_RETRIES = 5;
const WRITE_RETRY_DELAY_MS = 100;

export class ApiKey implements ApiKeyData {
  key: string;
  name?: string; // Add optional name field
  isActive: boolean;
  lastUsed: string | null;
  rateLimitResetAt: string | null; // Existing field
  failureCount: number;
  requestCount: number; // Total requests
  _id: string;
  dailyRateLimit?: number | null;
  dailyRequestsUsed: number;
  lastResetDate: string | null;
  isDisabledByRateLimit: boolean;

  constructor(data: Partial<ApiKeyData>) {
    this.key = data.key || "";
    this.name = data.name; // Initialize name
    this.isActive = data.isActive ?? true;
    this.lastUsed = data.lastUsed || null;
    this.rateLimitResetAt = data.rateLimitResetAt || null; // Existing field
    this.failureCount = data.failureCount ?? 0;
    this.requestCount = data.requestCount ?? 0; // Total requests
    this._id = data._id || Date.now().toString();
    this.dailyRateLimit = data.dailyRateLimit === undefined ? null : data.dailyRateLimit; // Default to null if not provided
    this.dailyRequestsUsed = data.dailyRequestsUsed ?? 0;
    this.lastResetDate = data.lastResetDate || null;
    this.isDisabledByRateLimit = data.isDisabledByRateLimit ?? false;
  }

  static async #ensureDataDir() {
    try {
      await mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
      // Directory already exists or other error
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  static #filterKey(key: ApiKeyData | null | undefined, query: any): boolean {
    // Basic safety check: Ensure key is a valid object before accessing properties
    if (!key || typeof key !== 'object') {
        console.error("Skipping invalid key data in #filterKey:", key);
        return false;
    }
    // --- Defensive checks for all accessed properties ---

    // Check isActive condition
    if (query.isActive !== undefined) {
        if (typeof key.isActive !== 'boolean' || key.isActive !== query.isActive) {
            // console.warn(`Skipping key due to isActive mismatch or type issue: ID=${key._id}, isActive=${key.isActive}`);
            return false;
        }
    }

    // Check _id condition
    if (query._id) {
        if (typeof key._id !== 'string' || key._id !== query._id) {
            // console.warn(`Skipping key due to _id mismatch or type issue: ID=${key._id}`);
            return false;
        }
    }

    // Check key condition
    if (query.key) {
         if (typeof key.key !== 'string' || key.key !== query.key) {
            // console.warn(`Skipping key due to key value mismatch or type issue: ID=${key._id}`);
            return false;
         }
    }

    // Check $or condition (rateLimitResetAt)
    if (query.$or) {
      const orConditionMet = query.$or.some((condition: any) => {
        // Check for rateLimitResetAt === null condition
        if (condition.rateLimitResetAt === null) {
          // Check if key.rateLimitResetAt exists and is null
          // Use hasOwnProperty for safer check on potentially incomplete objects
          return Object.prototype.hasOwnProperty.call(key, 'rateLimitResetAt') && key.rateLimitResetAt === null;
        }

        // Check for rateLimitResetAt <= date condition
        if (condition.rateLimitResetAt?.$lte) {
          // Use hasOwnProperty for safer check
          if (!Object.prototype.hasOwnProperty.call(key, 'rateLimitResetAt')) {
              return false; // Field doesn't exist, cannot satisfy <= condition
          }
          const resetAt = key.rateLimitResetAt;
          // If resetAt is explicitly null, it satisfies the condition (not rate limited)
          if (resetAt === null) return true;
          // If resetAt is a valid date string and is in the past or now
          if (typeof resetAt === 'string') {
            try {
              // Add extra check for empty string which results in invalid date
              if (resetAt.trim() === '') return false;
              return new Date(resetAt) <= new Date();
            } catch (e) {
               console.error(`Invalid date format for rateLimitResetAt: "${resetAt}" for key ID: ${key._id || 'UNKNOWN'}`, e);
               return false; // Treat invalid date as not meeting the condition
            }
          }
          // If resetAt is not null and not a string, it doesn't meet the $lte condition
          return false;
        }
        // If the condition in $or is not recognized, it's not met
        return false;
      });
      // If none of the $or conditions were met, filter out the key
      if (!orConditionMet) return false;
    }

    // If all checks passed, keep the key
    return true;
  }

  static async findOne(query: any): Promise<ApiKey | null> {
    const keys = await this.#readKeys();
    const foundKey = keys.find((key) => this.#filterKey(key, query));
    return foundKey ? new ApiKey(foundKey) : null;
  }

  static async findAll(query: any = {}): Promise<ApiKey[]> {
    // Read keys only once
    const rawKeys = await this.#readKeys();
    const validKeys: ApiKey[] = [];

    rawKeys
      .filter((keyData) => this.#filterKey(keyData, query))
      .forEach((keyData) => {
        try {
          // Attempt to instantiate the ApiKey
          const apiKeyInstance = new ApiKey(keyData);
          validKeys.push(apiKeyInstance);
        } catch (instantiationError: any) {
          // Log the error and the problematic data, then skip this key
          console.error(`Error instantiating ApiKey with data: ${JSON.stringify(keyData)}`, instantiationError);
          // Optionally use logError if available and configured for server-side logging
          // logError(instantiationError, { context: 'ApiKey.findAll instantiation', problematicData: keyData });
        }
      });

    return validKeys;
  }

  static async create(data: Partial<ApiKeyData>): Promise<ApiKey> {
    const keys = await this.#readKeys();
    const newKey = new ApiKey(data);
    keys.push(newKey);
    await this.#writeKeys(keys);
    return newKey;
  }

  async save(): Promise<ApiKey> {
    const keys = await ApiKey.#readKeys();
    const index = keys.findIndex((k) => k._id === this._id);

    if (index !== -1) {
      keys[index] = this;
    } else {
      keys.push(this);
    }

    await ApiKey.#writeKeys(keys);
    return this;
  }

  async delete(): Promise<void> {
    const keys = await ApiKey.#readKeys();
    const filteredKeys = keys.filter((k) => k._id !== this._id);
    await ApiKey.#writeKeys(filteredKeys);
  }

  static async deleteById(id: string): Promise<boolean> {
    const keys = await this.#readKeys();
    const initialLength = keys.length;
    const filteredKeys = keys.filter((k) => k._id !== id);

    if (filteredKeys.length === initialLength) {
      return false; // No key was deleted
    }

    await this.#writeKeys(filteredKeys);
    return true;
  }

  static async bulkUpdate(updatedKeysMap: Map<string, ApiKey>): Promise<void> {
    if (updatedKeysMap.size === 0) {
      return; // Nothing to update
    }

    const allKeysData = await this.#readKeys();

    // Merge the updates into the full list
    const updatedAllKeysData = allKeysData.map((keyData) => {
      const updatedKeyInstance = updatedKeysMap.get(keyData._id);
      // If an updated instance exists in the map, use its data representation
      // Otherwise, use the original data
      return updatedKeyInstance ? { ...updatedKeyInstance } : keyData;
    });

    // Write the entire updated list back
    await this.#writeKeys(updatedAllKeysData);
  }

  static async #readKeys(): Promise<ApiKeyData[]> {
    try {
      await this.#ensureDataDir();
      const data = await fs.readFile(KEYS_FILE, "utf8");
      try {
        return JSON.parse(data);
      } catch (parseError: any) {
        console.error(`Error parsing JSON data in ${KEYS_FILE}:`, parseError);
        console.error("Raw data:", data); // Log raw data for inspection
        // Throw a more specific error or return empty array to prevent further issues
        throw new Error(`Failed to parse keys data from ${KEYS_FILE}. Check file for corruption.`);
        // Alternatively: return [];
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, create it with empty array
        await this.#writeKeys([]);
        return [];
      }
      throw error;
    }
  }

  static async #writeKeys(keys: ApiKeyData[], retryCount = 0): Promise<void> {
    if (isWriting) {
      if (retryCount >= MAX_WRITE_RETRIES) {
        throw new Error(`Failed to acquire write lock for ${KEYS_FILE} after ${MAX_WRITE_RETRIES} retries.`);
      }
      console.warn(`#writeKeys: Write lock active, retrying in ${WRITE_RETRY_DELAY_MS}ms (Attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, WRITE_RETRY_DELAY_MS));
      return this.#writeKeys(keys, retryCount + 1); // Retry the write
    }

    isWriting = true;
    let tempFilePath: string | null = null; // Keep track of temp file path

    try {
      await this.#ensureDataDir();
      const dataToWrite = JSON.stringify(keys, null, 2);
      // Use a temporary file and rename for atomicity (safer write)
      tempFilePath = `${KEYS_FILE}.${Date.now()}.tmp`;
      await fs.writeFile(tempFilePath, dataToWrite);
      await fs.rename(tempFilePath, KEYS_FILE); // Atomic rename operation
      // console.log(`#writeKeys: Successfully wrote ${KEYS_FILE}`); // Optional success log
      tempFilePath = null; // Reset temp path on success
    } catch (error) {
       console.error(`Error during #writeKeys for ${KEYS_FILE}:`, error);
       // Attempt to clean up temp file if it exists and wasn't successfully renamed
       if (tempFilePath) {
         try {
           await fs.unlink(tempFilePath);
           console.log(`Cleaned up temporary file: ${tempFilePath}`);
         } catch (cleanupError) {
            console.error(`Error cleaning up temporary file ${tempFilePath}:`, cleanupError);
           // Ignore cleanup error or log differently
         }
       }
       throw error; // Re-throw the original error
    } finally {
      isWriting = false; // Release the lock
    }
  }
}
