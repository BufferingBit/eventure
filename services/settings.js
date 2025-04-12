import db from '../db.js';

// Cache settings to avoid frequent database queries
let settingsCache = {};
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Initialize settings table if it doesn't exist
const initSettingsTable = async () => {
  try {
    // Check if table exists
    const tableCheck = await db.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'settings'
      )`
    );

    // If table doesn't exist, create it
    if (!tableCheck.rows[0].exists) {
      console.log('Creating settings table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert default settings
      await db.query(`
        INSERT INTO settings (key, value) VALUES
          ('hero_image', '/images/site/default-hero.jpg'),
          ('site_title', 'Eventure'),
          ('site_description', 'Find exciting events happening across colleges and join the community')
        ON CONFLICT (key) DO NOTHING
      `);

      console.log('Settings table created with default values');
    }
  } catch (error) {
    console.error('Error initializing settings table:', error);
  }
};

// Initialize table when module is loaded
initSettingsTable();

// Get all settings
export const getAllSettings = async () => {
  const now = Date.now();

  // Return cached settings if they're still valid
  if (Object.keys(settingsCache).length > 0 && now < cacheExpiry) {
    return settingsCache;
  }

  try {
    // Try to initialize the table again in case it wasn't created yet
    await initSettingsTable();

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
    // Return default settings if there's an error
    return {
      hero_image: '/images/site/default-hero.jpg',
      site_title: 'Eventure',
      site_description: 'Find exciting events happening across colleges and join the community'
    };
  }
};

// Get a specific setting
export const getSetting = async (key, defaultValue = null) => {
  try {
    const settings = await getAllSettings();
    return settings[key] || defaultValue;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);

    // Return default values for known settings
    const defaults = {
      hero_image: '/images/site/default-hero.jpg',
      site_title: 'Eventure',
      site_description: 'Find exciting events happening across colleges and join the community'
    };

    return defaults[key] || defaultValue;
  }
};

// Update a setting
export const updateSetting = async (key, value) => {
  try {
    // Try to initialize the table again in case it wasn't created yet
    await initSettingsTable();

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
