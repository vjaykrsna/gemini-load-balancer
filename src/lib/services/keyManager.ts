import { ApiKey } from '../models/ApiKey';
import { logKeyEvent, logError } from './logger';
// Import readSettings - Adjust path if necessary, might need a shared utility
// Assuming direct import works for now. If build issues arise, refactor needed.
import { readSettings } from '@/lib/settings';

// Helper function to check if two date objects represent the same day in the server's local timezone
function isSameLocalDay(date1: Date | null, date2: Date | null): boolean {
  if (!date1 || !date2) return false;
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}
class KeyManager {
  private currentKey: ApiKey | null = null;
  // rotationRequestCount removed, will be fetched dynamically
  private requestCounter: number = 0;

  constructor() {
    // Constructor no longer needs to set rotationRequestCount
  }

  async initialize() {
    if (!this.currentKey) {
      await this.rotateKey();
    }
  }

  async rotateKey(): Promise<string> {
    try {
      // Get a working key that's not in cooldown
      const now = new Date();
      const todayLocalString = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format for local date

      let availableKeys = await ApiKey.findAll({
        isActive: true, // Must be generally active
        isDisabledByRateLimit: false, // Must not be disabled by daily limit
        $or: [ // Must not be in global rate limit cooldown
          { rateLimitResetAt: null },
          { rateLimitResetAt: { $lte: now.toISOString() } }
        ]
      });

      // --- Daily Reset Logic ---
      let keysWereReset = false; // Flag to track if any key was updated
      const updatedKeysMap = new Map<string, ApiKey>(); // Store updated keys by ID

      for (const key of availableKeys) {
        const lastReset = key.lastResetDate ? new Date(key.lastResetDate) : null;
        let needsUpdate = false;

        // Check if last reset was before today (local time)
        if (!lastReset || !isSameLocalDay(lastReset, now)) {
           if (key.dailyRequestsUsed > 0 || key.isDisabledByRateLimit) { // Only reset if needed
              key.dailyRequestsUsed = 0;
              key.isDisabledByRateLimit = false; // Re-enable if it was disabled by rate limit
              key.lastResetDate = now.toISOString();
              needsUpdate = true;
              logKeyEvent('Daily Limit Reset', { keyId: key._id, date: todayLocalString });
           } else if (!key.lastResetDate) {
             // Set initial reset date if it's null
             key.lastResetDate = now.toISOString();
             needsUpdate = true;
           }
        }

        if (needsUpdate) {
            keysWereReset = true;
            updatedKeysMap.set(key._id, key); // Store the updated key instance
        }
      }
      // If any keys were reset, perform a single bulk write
      // If any keys were reset, perform a single bulk write using the new static method
      if (keysWereReset) {
          await ApiKey.bulkUpdate(updatedKeysMap);

          // Update the 'availableKeys' list in memory to reflect the changes
          // This avoids needing another full DB read right away
          availableKeys = availableKeys.map(key => updatedKeysMap.get(key._id) || key);
      }
      // --- End Daily Reset Logic ---

      if (availableKeys.length === 0) {
        const error = new Error('No available API keys (all active keys might be rate-limited or disabled)');
        logError(error, { context: 'Key rotation - post daily reset' });
        throw error;
      }

      // --- Hybrid LRU + New Key Priority Logic ---
      // 1. Prioritize unused keys
      let key = availableKeys.find(k => k.lastUsed === null);

      // 2. If no unused keys, fall back to LRU
      if (!key) {
        const sortedKeys = availableKeys.sort((a, b) => {
          // Should not happen based on find above, but defensive check
          if (!a.lastUsed) return -1;
          if (!b.lastUsed) return 1;
          return new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
        });
        key = sortedKeys[0]; // Select the least recently used
      }
      // --- End of Hybrid Logic ---

      if (!key) {
        // This should theoretically not be reached if availableKeys.length > 0 check passed
        const error = new Error('Failed to select a key after filtering and sorting');
        logError(error, { context: 'Key rotation - selection phase' });
        throw error;
      }

      this.currentKey = key;
      this.requestCounter = 0; // Reset counter on key rotation
      
      // Log key rotation
      logKeyEvent('Key Rotation', {
        keyId: key._id,
        lastUsed: key.lastUsed,
        failureCount: key.failureCount,
        rotationType: 'scheduled'
      });

      return key.key;
    } catch (error: any) {
      logError(error, { action: 'rotateKey' });
      throw error;
    }
  }

  async markKeySuccess() {
    if (this.currentKey) {
      try {
        const now = new Date().toISOString();
        this.currentKey.lastUsed = now;
        this.currentKey.requestCount += 1; // Increment total request count
        this.currentKey.dailyRequestsUsed += 1; // Increment daily request count
        await this.currentKey.save();
        
        logKeyEvent('Key Success', {
          keyId: this.currentKey._id,
          lastUsed: this.currentKey.lastUsed,
          requestCount: this.currentKey.requestCount,
          dailyRequestsUsed: this.currentKey.dailyRequestsUsed,
          dailyRateLimit: this.currentKey.dailyRateLimit
        });
      } catch (error: any) {
        logError(error, { action: 'markKeySuccess' });
      }
    }
  }

  async markKeyError(error: any): Promise<boolean> {
    if (!this.currentKey) return false;

    try {
      // Check if it's a rate limit error
      if (error.response?.status === 429) {
        const resetTime = error.response.headers['x-ratelimit-reset'];
        // Fetch settings to get the configured cooldown
        const settings = await readSettings();
        const fallbackCooldownMs = settings.rateLimitCooldown * 1000; // Convert seconds to ms

        this.currentKey.rateLimitResetAt = resetTime
          ? new Date(resetTime * 1000).toISOString() // Use API provided reset time if available
          : new Date(Date.now() + fallbackCooldownMs).toISOString(); // Use configured fallback
        
        logKeyEvent('Rate Limit Hit', {
          keyId: this.currentKey._id,
          resetTime: this.currentKey.rateLimitResetAt
        });

        await this.currentKey.save();

        // --- Add delay before clearing currentKey to force rotation ---
        const delaySeconds = settings.keyRotationDelaySeconds || 0;
        if (delaySeconds > 0) {
          logKeyEvent('Rate Limit Delay Start', {
             keyId: this.currentKey._id,
             delaySeconds: delaySeconds,
             reason: 'Global Rate Limit (429)'
          });
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
          logKeyEvent('Rate Limit Delay End', { keyId: this.currentKey._id });
        }
        // --- End Delay ---

        // Clear current key to force rotation
        this.currentKey = null;
        return true; // Indicate it was a rate limit error
      }

      this.currentKey.failureCount += 1;
      
      // Fetch current settings to get the threshold
      const settings = await readSettings();
      const maxFailures = settings.maxFailureCount;

      // If too many failures, deactivate the key
      if (this.currentKey.failureCount >= maxFailures) {
        const keyToDeactivate = this.currentKey; // Store reference before clearing
        keyToDeactivate.isActive = false;
        
        logKeyEvent('Key Deactivated', {
          keyId: keyToDeactivate._id,
          reason: `Failure count reached threshold (${maxFailures})`,
          failureCount: keyToDeactivate.failureCount
        });

        // Save the deactivated state *before* clearing the current key
        await keyToDeactivate.save();
        
        // Clear current key to force rotation
        this.currentKey = null;
      } else {
        // If not deactivated, save the incremented failure count
        await this.currentKey.save();
      }
      
      return false; // Indicate it was not a rate limit error
    } catch (error: any) {
      logError(error, { 
        action: 'markKeyError',
        keyId: this.currentKey?._id
      });
      return false;
    }
  }

  async getKey(): Promise<string> {
    try {
      const now = new Date();
      const todayLocalString = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format for local date

      // --- Check 1: Is there a current key? ---
      if (this.currentKey) {
        // --- Check 2: Does the current key need daily reset? ---
        const lastReset = this.currentKey.lastResetDate ? new Date(this.currentKey.lastResetDate) : null;
        if (!lastReset || !isSameLocalDay(lastReset, now)) {
          logKeyEvent('Daily Limit Reset (getKey)', { keyId: this.currentKey._id, date: todayLocalString });
          this.currentKey.dailyRequestsUsed = 0;
          this.currentKey.isDisabledByRateLimit = false; // Ensure re-enabled
          this.currentKey.lastResetDate = now.toISOString();
          await this.currentKey.save(); // Save the reset state
        }

        // --- Check 3: Is the current key globally rate-limited? ---
        const globalResetTime = this.currentKey.rateLimitResetAt ? new Date(this.currentKey.rateLimitResetAt) : null;
        if (globalResetTime && globalResetTime > now) {
          // Globally rate-limited, force rotation
          logKeyEvent('Global Rate Limit Active (getKey)', { keyId: this.currentKey._id, resetTime: this.currentKey.rateLimitResetAt });
          this.currentKey = null; // Clear the invalid key
          // Fall through to rotateKey below
        } else {
           // --- Check 4: Is the current key daily rate-limited? ---
           const limit = this.currentKey.dailyRateLimit;
           // Ensure limit is a positive number before checking usage
           if (typeof limit === 'number' && limit > 0 && this.currentKey.dailyRequestsUsed >= limit) {
             // Daily limit reached, disable and force rotation
             logKeyEvent('Daily Rate Limit Hit (getKey)', {
               keyId: this.currentKey._id,
               dailyRequestsUsed: this.currentKey.dailyRequestsUsed,
               dailyRateLimit: limit
             });
             // Fetch settings again for the delay value
             const settings = await readSettings();

             // --- Add delay before clearing currentKey to force rotation ---
             const delaySeconds = settings.keyRotationDelaySeconds || 0;
             if (delaySeconds > 0 && this.currentKey) { // Add null check for safety
               logKeyEvent('Rate Limit Delay Start', {
                  keyId: this.currentKey._id,
                  delaySeconds: delaySeconds,
                  reason: 'Daily Rate Limit'
               });
               await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
               logKeyEvent('Rate Limit Delay End', { keyId: this.currentKey._id });
             }
             // --- End Delay ---

             this.currentKey.isDisabledByRateLimit = true;
             await this.currentKey.save();
             this.currentKey = null; // Clear the invalid key
             // Fall through to rotateKey below
           } else {
              // --- Check 5: Is rotation by request count needed? ---
              // Fetch current settings dynamically
              const settings = await readSettings();
              const rotationThreshold = settings.keyRotationRequestCount; // Assuming this is the setting name

              if (rotationThreshold > 0 && this.requestCounter >= rotationThreshold) {
                logKeyEvent('Request Count Rotation Triggered (getKey)', {
                  keyId: this.currentKey._id,
                  requestCounter: this.requestCounter,
                  rotationThreshold: rotationThreshold
                });
                // Fall through to rotateKey below
              } else {
                 // --- Key is valid! ---
                 this.requestCounter++; // Increment request counter for rotation logic
                 return this.currentKey.key;
              }
           }
        }
      }

      // --- Rotation Needed ---
      // Either no current key, or one of the checks above failed/triggered rotation
      // Otherwise rotate to a new key
      return await this.rotateKey();
    } catch (error: any) {
      logError(error, { action: 'getKey' });
      throw error;
    }
  }

  async addKey(data: { key: string, name?: string }): Promise<ApiKey> {
    const { key, name } = data; // Destructure input
    try {
      const existingKey = await ApiKey.findOne({ key });
      
      if (existingKey) {
        existingKey.isActive = true;
        existingKey.failureCount = 0; // Reset failure count
        existingKey.rateLimitResetAt = null; // Clear global rate limit
        existingKey.dailyRequestsUsed = 0; // Reset daily usage
        existingKey.lastResetDate = null; // Clear last reset date
        existingKey.isDisabledByRateLimit = false; // Ensure not disabled by daily limit
        await existingKey.save();

        logKeyEvent('Key Reactivated', {
          keyId: existingKey._id
        });

        return existingKey;
      }

      const newKey = await ApiKey.create({ key, name }); // Pass name to create
      
      logKeyEvent('New Key Added', {
        keyId: newKey._id
      });

      return newKey;
    } catch (error: any) {
      logError(error, { action: 'addKey' });
      throw error;
    }
  }
}

// Export a singleton instance
const keyManager = new KeyManager();
export default keyManager;