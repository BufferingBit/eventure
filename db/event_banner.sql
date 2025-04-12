-- Add banner field to events table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'banner'
    ) THEN
        ALTER TABLE events ADD COLUMN banner VARCHAR(255);
    END IF;
END
$$;
