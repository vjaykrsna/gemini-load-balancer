import fs from 'fs/promises';
import path from 'path';
import { logError } from '@/lib/services/logger'; // Keep logger import if needed for future expansion

// Define the Settings interface and export it
export interface Settings {
  keyRotationRequestCount: number;
  maxFailureCount: number;
  rateLimitCooldown: number; // Cooldown in seconds
  logRetentionDays: number;
}

// Define and export default settings
const DEFAULT_SETTINGS: Settings = {
  keyRotationRequestCount: 5,
  maxFailureCount: 5,
  rateLimitCooldown: 60, // Default 1 minute cooldown
  logRetentionDays: 14, // Default 14 days retention
};

// Path to settings file
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'settings.json');

// Function to write settings (keep internal for now, export if needed elsewhere)
async function writeSettings(settings: Settings): Promise<void> {
  // Ensure data directory exists
  const dataDir = path.dirname(SETTINGS_FILE);
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error: any) {
    // Ignore ENOENT (already exists) but log others
    if (error.code !== 'EEXIST') {
        logError(error, { context: 'writeSettings - mkdir' });
        // Decide if you want to throw or continue
    }
  }

  // Write settings to file
  try {
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
      logError(error, { context: 'writeSettings - writeFile' });
      throw error; // Re-throw write errors as they are critical
  }
}

// Function to read settings and export it
export async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    // Merge defaults with loaded settings to ensure all keys are present
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch (error: any) {
    // If file doesn't exist, create it with default settings
    if (error.code === 'ENOENT') {
      try {
        await writeSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      } catch (writeError) {
          logError(writeError, { context: 'readSettings - initial write' });
          // If initial write fails, return defaults but log the error
          return DEFAULT_SETTINGS;
      }
    }
    // Log other read errors but return defaults to avoid crashing
    logError(error, { context: 'readSettings - readFile' });
    return DEFAULT_SETTINGS; // Return defaults on other errors
  }
}

// Optional: Export writeSettings if needed by other modules directly
export { writeSettings };