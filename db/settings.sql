-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES 
  ('hero_image', '/images/site/default-hero.jpg'),
  ('site_title', 'Eventure'),
  ('site_description', 'Find exciting events happening across colleges and join the community')
ON CONFLICT (key) DO NOTHING;
