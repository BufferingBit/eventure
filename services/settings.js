import db from '../db.js';

// Cache settings to avoid frequent database queries
let settingsCache = {};
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get all settings
export const getAllSettings = async () => {
  const now = Date.now();
  
  // Return cached settings if they're still valid
  if (Object.keys(settingsCache).length > 0 && now < cacheExpiry) {
    return settingsCache;
  }
  
  try {
    const result = await db.query('SELECT key, value FROM settings');
    
    // Convert rows to an object
    settingsCache = result.rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    
    // Set cache expiry
    cacheExpiry = now + CACHE_TTL;
    
    return settingsCache;
  } catch (error) {
    console.error('Error fetching settings:', error);
    return {};
  }
};

// Get a specific setting
export const getSetting = async (key, defaultValue = null) => {
  try {
    const settings = await getAllSettings();
    return settings[key] || defaultValue;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);
    return defaultValue;
  }
};

// Update a setting
export const updateSetting = async (key, value) => {
  try {
    await db.query(
      `INSERT INTO settings (key, value, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
    
    // Invalidate cache
    settingsCache = {};
    cacheExpiry = 0;
    
    return true;
  } catch (error) {
    console.error(`Error updating setting ${key}:`, error);
    return false;
  }
};

export default {
  getAllSettings,
  getSetting,
  updateSetting
};
