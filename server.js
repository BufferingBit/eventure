import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";
import path from "path";
import db from "./db.js";
import session from "express-session";
import passport from "./config/auth.js";
import authRoutes, { isAuthenticated } from "./routes/auth.js";
import fs from "fs";
import bcrypt from "bcrypt";
import dotenv from 'dotenv';
import { createUploader, getImageUrl, addImageHelpers } from './config/cloudinary.js';
import settingsService from './services/settings.js';
import supabase from './db.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;


// Create uploaders for different types of images
const profileUploader = createUploader('profile_photos');
const collegeLogoUploader = createUploader('college_logos');
const clubLogoUploader = createUploader('club_logos');
const eventImageUploader = createUploader('event_logos');
const siteImageUploader = createUploader('site');

// Admin middleware
const isCollegeAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === "college_admin") {
    return next();
  }
  res.redirect("/login");
};

const isClubAdmin = async (req, res, next) => {
  if (!req.isAuthenticated() || req.user.role !== "club_admin") {
    return res.redirect("/login");
  }

  try {
    const result = await db.query(
      "SELECT club_id FROM users WHERE id = $1 AND role = $2",
      [req.user.id, "club_admin"]
    );

    const clubId = result.rows[0]?.club_id;

    // Ensure clubId is present and is an integer
    if (!clubId || isNaN(clubId)) {
      console.error("Invalid or missing club_id for user:", req.user.id);
      return res.redirect("/login");
    }

    req.user.club_id = Number(clubId);
    return next();
  } catch (error) {
    console.error("Error in club admin middleware:", error);
    return res.status(500).send("Server error");
  }
};

// Super Admin middleware
const isSuperAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'super_admin') {
      return next();
  }
  res.redirect('/login');
};




// Helper function to process image path based on environment
const processImagePath = (file, folder) => {
  if (!file) return null;

  try {
    if (process.env.NODE_ENV === 'production' && file.path && file.path.startsWith('http')) {
      // In production, Cloudinary returns the full URL
      return file.path;
    } else {
      // In development or if Cloudinary failed, we need to construct the path
      if (file.filename) {
        return `/images/${folder}/${file.filename}`;
      } else {
        // Try to find an appropriate default image
        const extensions = ['.jpg', '.jpeg', '.png', '.gif'];
        for (const ext of extensions) {
          const defaultPath = `/images/${folder}/default-${folder.slice(0, -1)}${ext}`;
          try {
            if (fs.existsSync(path.join(__dirname, 'public', defaultPath))) {
              return defaultPath;
            }
          } catch (err) {}
        }
        // If no default image found, return a generic one
        return `/images/${folder}/default-${folder.slice(0, -1)}.jpg`;
      }
    }
  } catch (error) {
    console.error('Error processing image path:', error);
    // Return a default image path if there's an error
    return `/images/${folder}/default-${folder.slice(0, -1)}.jpg`;
  }
};

// Function to check and create the banner column in events table if it doesn't exist
const ensureEventBannerColumn = async () => {
  try {
    // Check if banner column exists
    const columnCheck = await db.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'events'
        AND column_name = 'banner'
      )`
    );

    // If column doesn't exist, create it
    if (!columnCheck.rows[0].exists) {
      console.log('Adding banner column to events table...');
      await db.query('ALTER TABLE events ADD COLUMN banner VARCHAR(255)');
      console.log('Banner column added successfully');
    }
  } catch (error) {
    console.error('Error checking/creating banner column:', error);
  }
};


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Add image helper to all templates
addImageHelpers(app);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  if (req.isAuthenticated()) {
    const durations = {
      user: 7 * 24 * 60 * 60 * 1000,
      club_admin: 3 * 24 * 60 * 60 * 1000,
      college_admin: 1 * 24 * 60 * 60 * 1000,
    };

    const role = req.user.role || "user";
    const duration = durations[role] || durations.user;

    req.session.cookie.maxAge = duration;
  }
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

app.use("/", authRoutes);

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (e) {
    return dateStr;
  }
}

function formatTime(timeStr) {
  try {
    const [hours, minutes] = timeStr.split(":");
    const date = new Date();
    date.setHours(hours, minutes);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return timeStr;
  }
}

app.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    const filter = req.query.filter || 'all';

    // Get site settings (assuming settingsService is already refactored)
    const settings = await settingsService.getAllSettings();

    // Fetch colleges
    let { data: colleges, error: collegesError } = await supabase
      .from('colleges')
      .select('id, name, location, logo')
      .ilike('name', `%${searchTerm}%`)
      .order('name');
    if (collegesError) throw collegesError;

    // Build events query
    let eventsQuery = supabase
      .from('events')
      .select('id, title, description, date, location:venue, banner, club_id, clubs(name, college_id), colleges(name)')
      .gte('date', new Date().toISOString().split('T')[0]);

    if (filter === 'this-week') {
      const today = new Date();
      const weekEnd = new Date();
      weekEnd.setDate(today.getDate() + 7);
      eventsQuery = eventsQuery.gte('date', today.toISOString().split('T')[0]).lte('date', weekEnd.toISOString().split('T')[0]);
    }

    if (searchTerm) {
      eventsQuery = eventsQuery.ilike('title', `%${searchTerm}%`);
    }

    eventsQuery = eventsQuery.order('date', { ascending: true });

    const { data: eventsData, error: eventsError } = await eventsQuery;
    if (eventsError) throw eventsError;

    // Format dates and times
    const events = (eventsData || []).map(event => ({
      ...event,
      formattedDate: formatDate(event.date),
      formattedTime: event.time ? formatTime(event.time) : '',
    }));

    res.render('index', {
      colleges: colleges || [],
      events: events,
      searchTerm: searchTerm,
      filter: filter,
      user: req.user,
      settings: settings,
      heroImage: settings.hero_image || '/images/site/default-hero.jpg',
      siteTitle: settings.site_title || 'Eventure',
      siteDescription: settings.site_description || 'Find exciting events happening across colleges and join the community'
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).render('error', {
      message: 'Failed to load homepage',
      error: error
    });
  }
});

// Site settings route - only accessible by super admin
app.get('/site-settings', isSuperAdmin, async (req, res) => {
  try {
    const settings = await settingsService.getAllSettings();

    res.render('pages/site-settings', {
      user: req.user,
      settings: settings,
      error: null,
      success: req.query.success === 'true'
    });
  } catch (error) {
    console.error('Error loading site settings:', error);
    res.status(500).send('Server error');
  }
});

// Update site settings
app.post('/site-settings', isSuperAdmin, siteImageUploader.single('hero_image'), async (req, res) => {
  try {
    const { site_title, site_description } = req.body;

    // Update text settings
    await settingsService.updateSetting('site_title', site_title);
    await settingsService.updateSetting('site_description', site_description);

    // Update hero image if provided
    if (req.file) {
      const heroImagePath = processImagePath(req.file, 'site');
      await settingsService.updateSetting('hero_image', heroImagePath);
    }

    res.redirect('/site-settings?success=true');
  } catch (error) {
    console.error('Error updating site settings:', error);
    res.status(500).send('Server error');
  }
});


// Super Admin Routes
app.get('/super-admin', isSuperAdmin, async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const searchQuery = `%${searchTerm}%`;

        const collegesResult = await db.query(
            `SELECT c.*, u.name as admin_name, u.email as admin_email
             FROM colleges c
             LEFT JOIN users u ON u.college_id = c.id AND u.role = 'college_admin'
             WHERE LOWER(c.name) LIKE LOWER($1) OR LOWER(c.location) LIKE LOWER($1)
             ORDER BY c.name ASC`,
            [searchQuery]
        );

        res.render('pages/super-admin', {
            user: req.user,
            colleges: collegesResult.rows,
            error: null,
            searchTerm
        });
    } catch (error) {
        console.error('Error loading super admin dashboard:', error);
        res.status(500).send("Server error");
    }
});

app.get('/college/new', isSuperAdmin, (req, res) => {
  res.render('pages/college-form', {
      user: req.user,
      college: {},
      admin: null,
      mode: 'create',
      error: null,
      searchTerm: ''
  });
});

app.post('/college/new', isSuperAdmin, collegeLogoUploader.single('logo'), async (req, res) => {
  const client = await db.pool.connect();
  try {
      await client.query('BEGIN');

      const { name, location, admin_name, admin_email, admin_password } = req.body;

      const collegeResult = await client.query(
          `INSERT INTO colleges (name, location, logo)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [
              name,
              location,
              req.file ? processImagePath(req.file, 'college_logos') : '/images/college_logos/default-college-logo.png'
          ]
      );

      const collegeId = collegeResult.rows[0].id;

      // Create admin if details provided
      if (admin_email && admin_name && admin_password) {
          const hashedPassword = await bcrypt.hash(admin_password, 10);
          await client.query(
              `INSERT INTO users (name, email, password_hash, role, college_id)
               VALUES ($1, $2, $3, $4, $5)`,
              [admin_name, admin_email, hashedPassword, 'college_admin', collegeId]
          );
      }

      await client.query('COMMIT');
      res.redirect('/super-admin');
  } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating college:', error);
      res.render('pages/college-form', {
          user: req.user,
          college: req.body,
          admin: {
              name: req.body.admin_name,
              email: req.body.admin_email
          },
          mode: 'create',
          error: 'Failed to create college: ' + error.message,
          searchTerm: ''
      });
  } finally {
      client.release();
  }
});

app.get('/college-admin/new', isSuperAdmin, async (req, res) => {
  try {
      const collegesResult = await db.query(
          'SELECT * FROM colleges ORDER BY name'
      );

      res.render('pages/college-admin-form', {
          user: req.user,
          colleges: collegesResult.rows,
          error: null,
          mode: 'create',
          searchTerm: req.query.search || ''
      });
  } catch (error) {
      console.error('Error loading college admin form:', error);
      res.status(500).send('Server error');
  }
});

app.post('/college-admin/new', isSuperAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
      await client.query('BEGIN');

      const { name, email, password, college_id } = req.body;

      // Basic validation
      if (!name || !email || !password || !college_id) {
          const collegesResult = await db.query('SELECT * FROM colleges ORDER BY name');
          return res.render('pages/college-admin-form', {
              user: req.user,
              colleges: collegesResult.rows,
              error: 'Please fill in all required fields',
              mode: 'create',
              searchTerm: ''
          });
      }

      // Check if email already exists
      const existingUser = await client.query(
          'SELECT * FROM users WHERE email = $1',
          [email]
      );

      if (existingUser.rows[0]) {
          const collegesResult = await db.query('SELECT * FROM colleges ORDER BY name');
          return res.render('pages/college-admin-form', {
              user: req.user,
              colleges: collegesResult.rows,
              error: 'Email already exists',
              mode: 'create',
              searchTerm: ''
          });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await client.query(
          `INSERT INTO users (name, email, password_hash, role, college_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [name, email, hashedPassword, 'college_admin', college_id]
      );

      await client.query('COMMIT');
      res.redirect('/super-admin');
  } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating college admin:', error);
      res.redirect('/college-admin/new?error=Failed to create college admin');
  } finally {
      client.release();
  }
});

app.get("/college/:id", async (req, res) => {
  try {
    const collegeId = req.params.id;
    const userId = req.user?.id;

    // Get follow status if user is logged in
    let isFollowing = false;
    if (userId) {
      const followResult = await db.query(
        "SELECT EXISTS(SELECT 1 FROM college_followers WHERE user_id = $1 AND college_id = $2)",
        [userId, collegeId]
      );
      isFollowing = followResult.rows[0].exists;
    }

    const collegeResult = await db.query(
      "SELECT id, name, location, logo FROM colleges WHERE id = $1",
      [collegeId]
    );
    const college = collegeResult.rows[0];

    if (!college) {
      return res.status(404).send("College not found");
    }

    // Get followers count
    const followersCountResult = await db.query(
      "SELECT COUNT(*) FROM college_followers WHERE college_id = $1",
      [collegeId]
    );
    const followersCount = parseInt(followersCountResult.rows[0].count);
    console.log("followersCount:", followersCount);

    const clubsResult = await db.query(
      `SELECT id, name, type, description, logo
       FROM clubs
       WHERE college_id = $1`,
      [collegeId]
    );

    // Log the raw results for debugging
    console.log("Raw clubs data:", clubsResult.rows);

    // Normalize the type field and group clubs
    const clubs = {
      CLUB: clubsResult.rows.filter(
        (club) => club.type?.toString().toUpperCase().trim() === "CLUB"
      ),
      SOCIETY: clubsResult.rows.filter(
        (club) => club.type?.toString().toUpperCase().trim() === "SOCIETY"
      ),
      FEST: clubsResult.rows.filter(
        (club) => club.type?.toString().toUpperCase().trim() === "FEST"
      ),
    };

    // Log the grouped results for debugging
    console.log("Grouped clubs:", clubs);

    // Fetch upcoming events
    const eventsResult = await db.query(
      `
      SELECT
        e.id,
        e.title,
        e.description,
        e.date,
        e.time,
        e.venue,
        e.role_tag,
        e.event_type,
        e.banner,
        c.name AS club_name,
        c.type AS club_type,
        col.name AS college_name
      FROM events e
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
      WHERE col.id = $1 AND e.date >= CURRENT_DATE
      ORDER BY e.date ASC
    `,
      [collegeId]
    );

    const events = eventsResult.rows.map((event) => ({
      ...event,
      formattedDate: formatDate(event.date),
      formattedTime: formatTime(event.time),
    }));

    res.render("pages/college.ejs", {
      searchTerm: "",
      college,
      clubs,
      events,
      clubCount: clubsResult.rows.length,
      followersCount,
      isFollowing,
      activeTab: "events",
      user: req.user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.get("/profile", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const userResult = await db.query(
      `
      SELECT
        u.*,
        c.name as college_name
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.id = $1
    `,
      [userId]
    );

    // Get followed colleges
    const followedCollegesResult = await db.query(
      `
      SELECT c.*
      FROM colleges c
      JOIN college_followers cf ON c.id = cf.college_id
      WHERE cf.user_id = $1
      ORDER BY c.name
    `,
      [userId]
    );

    const participatedEventsResult = await db.query(
      `
      SELECT
        e.*,
        c.name AS club_name,
        col.name AS college_name
      FROM events e
      JOIN event_registrations er ON e.id = er.event_id
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
      WHERE er.user_id = $1
      ORDER BY e.date DESC
    `,
      [userId]
    );

    const userWithFollowing = await db.query(
      `SELECT u.*,
              ARRAY_AGG(DISTINCT c.id) as followed_club_ids,
              json_agg(DISTINCT jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'logo', c.logo
              )) FILTER (WHERE c.id IS NOT NULL) as following_clubs
       FROM users u
       LEFT JOIN club_followers cf ON u.id = cf.user_id
       LEFT JOIN clubs c ON cf.club_id = c.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId]
    );

    const userData = {
      ...userResult.rows[0],
      followed_colleges: followedCollegesResult.rows,
      participated_events: participatedEventsResult.rows.map((event) => ({
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time),
      })),
      following_clubs: userWithFollowing.rows[0].following_clubs,
    };

    res.render("pages/profile", {
      user: userData,
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


app.post("/college/:id/follow", isAuthenticated, async (req, res) => {
  const collegeId = req.params.id;
  const userId = req.user.id;
  const action = req.body.action;

  try {
    if (action === "follow") {
      await db.query(
        "INSERT INTO college_followers (user_id, college_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, collegeId]
      );
    } else if (action === "unfollow") {
      await db.query(
        "DELETE FROM college_followers WHERE user_id = $1 AND college_id = $2",
        [userId, collegeId]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Follow/Unfollow error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/profile/edit", isAuthenticated, async (req, res) => {
  try {
    const userResult = await db.query(
      `
      SELECT
        u.*,
        c.name as college_name
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.id = $1
    `,
      [req.user.id]
    );

    const collegesResult = await db.query(
      "SELECT id, name FROM colleges ORDER BY name"
    );

    const userData = {
      ...userResult.rows[0],
      skills: userResult.rows[0].skills
        ? typeof userResult.rows[0].skills === "string"
          ? JSON.parse(userResult.rows[0].skills)
          : userResult.rows[0].skills
        : [],
    };

    res.render("pages/edit-profile", {
      user: userData,
      colleges: collegesResult.rows,
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

app.post('/profile/update', isAuthenticated, profileUploader.single('photo'), async (req, res) => {
  const client = await db.pool.connect();
  let currentClubId, currentCollegeId, userRole, skillsArray;

  try {
    await client.query('BEGIN');

    const { name, bio, college_id } = req.body;
    const skills = req.body['skills[]'] || [];
    skillsArray = Array.isArray(skills) ? skills : [skills];
    const userId = req.user.id;

    // Get current user data
    const userResult = await client.query(
      'SELECT role, club_id, college_id FROM users WHERE id = $1',
      [userId]
    );

    userRole = userResult.rows[0].role;
    currentClubId = userResult.rows[0].club_id;
    currentCollegeId = userResult.rows[0].college_id;

    // Determine the final club_id and college_id based on role
    let finalClubId, finalCollegeId;

    // Handle club_id
    if (userRole === 'club_admin') {
      finalClubId = currentClubId;
    } else {
      finalClubId = null;
    }

    // Handle college_id
    if (userRole === 'college_admin') {
      finalCollegeId = currentCollegeId; // Preserve existing college_id for college admins
    } else {
      finalCollegeId = null; // Ensure null for non-college admins
    }

    let photoPath = req.user.photo;
    if (req.file) {
      photoPath = processImagePath(req.file, 'profile_photos');
    }

    // Update user data
    await client.query(
      `UPDATE users
       SET name = $1,
           bio = $2,
           college_id = $3,
           club_id = $4,
           skills = $5::jsonb,
           photo = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [
        name,
        bio || null,
        finalCollegeId,
        finalClubId,
        JSON.stringify(skillsArray),
        photoPath,
        userId
      ]
    );

    await client.query('COMMIT');
    res.redirect('/profile');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Profile update error:', error);

    // Re-render form with error
    try {
      const collegesResult = await db.query(
        "SELECT id, name FROM colleges ORDER BY name"
      );

      res.render('pages/edit-profile', {
        user: {
          ...req.user,
          ...req.body,
          club_id: currentClubId,
          college_id: currentCollegeId,
          skills: skillsArray
        },
        colleges: collegesResult.rows,
        error: 'Failed to update profile. Please try again.',
        searchTerm: ''
      });
    } catch (renderError) {
      console.error('Error rendering profile edit page:', renderError);
      res.status(500).send('An error occurred while updating your profile');
    }
  } finally {
    client.release();
  }
});


// Create new club route
app.get('/club/new', isCollegeAdmin, async (req, res) => {
  try {
      // Get college details for the admin
      const collegeResult = await db.query(
          "SELECT * FROM colleges WHERE id = $1",
          [req.user.college_id]
      );

      res.render('pages/club-form', {
          user: req.user,
          college: collegeResult.rows[0],
          club: null,
          mode: 'create',
          error: null,
          searchTerm: ''
      });
  } catch (error) {
      console.error('Error loading club creation form:', error);
      res.status(500).send("Server error");
  }
});

app.post('/club/new', isCollegeAdmin, clubLogoUploader.single('logo'), async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const {
      name, description, type,
      adminName, adminEmail, adminPassword, adminPhone
    } = req.body;

    // Debug log
    console.log('Received club type:', type);
    console.log('Request body:', req.body);

    // Normalize the type field
    const normalizedType = type?.toString().toUpperCase().trim();
    console.log('Normalized type:', normalizedType);

    // Validate type
    if (!['CLUB', 'SOCIETY', 'FEST'].includes(normalizedType)) {
      throw new Error(`Invalid club type: ${normalizedType}`);
    }

    // Basic validation
    if (!name || !type || !adminName || !adminEmail || !adminPassword) {
      const collegeResult = await db.query(
        "SELECT * FROM colleges WHERE id = $1",
        [req.user.college_id]
      );

      return res.render('pages/club-form', {
        user: req.user,
        college: collegeResult.rows[0],
        club: req.body,
        mode: 'create',
        error: 'Please fill in all required fields',
        searchTerm: ''
      });
    }

    let logoPath = null;
    if (req.file) {
      logoPath = processImagePath(req.file, 'club_logos');
    }

    // Insert new club
    const clubResult = await client.query(
      `INSERT INTO clubs (name, description, type, logo, college_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, description, normalizedType, logoPath, req.user.college_id]
    );

    const clubId = clubResult.rows[0].id;

    // Create club admin user with password_hash instead of password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, club_id, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminName, adminEmail, hashedPassword, 'club_admin', clubId, adminPhone]
    );

    await client.query('COMMIT');
    res.redirect('/college-admin');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating club:', error);

    const collegeResult = await db.query(
      "SELECT * FROM colleges WHERE id = $1",
      [req.user.college_id]
    );

    return res.render('pages/club-form', {
      user: req.user,
      college: collegeResult.rows[0],
      club: req.body,
      mode: 'create',
      error: 'Error creating club. Please try again.',
      searchTerm: ''
    });
  } finally {
    client.release();
  }
});

// Edit club routes
app.get('/club/:id/edit', isCollegeAdmin, async (req, res) => {
  try {
      const clubId = parseInt(req.params.id);

      // Verify the club belongs to the admin's college
      const clubResult = await db.query(
          `SELECT c.*
           FROM clubs c
           WHERE c.id = $1 AND c.college_id = $2`,
          [clubId, req.user.college_id]
      );

      if (!clubResult.rows[0]) {
          return res.status(404).send("Club not found or unauthorized");
      }

      const collegeResult = await db.query(
          "SELECT * FROM colleges WHERE id = $1",
          [req.user.college_id]
      );

      res.render('pages/club-form', {
          user: req.user,
          college: collegeResult.rows[0],
          club: clubResult.rows[0],
          mode: 'edit',
          error: null,
          searchTerm: ''
      });
  } catch (error) {
      console.error('Error loading club edit form:', error);
      res.status(500).send("Server error");
  }
});

app.post('/club/:id/edit', isCollegeAdmin, clubLogoUploader.single('logo'), async (req, res) => {
  try {
      const clubId = parseInt(req.params.id);
      const { name, description, type } = req.body;

      // Verify the club belongs to the admin's college
      const checkClub = await db.query(
          "SELECT id FROM clubs WHERE id = $1 AND college_id = $2",
          [clubId, req.user.college_id]
      );

      if (!checkClub.rows[0]) {
          return res.status(404).send("Club not found or unauthorized");
      }

      // Basic validation
      if (!name || !type) {
          return res.render('pages/club-form', {
              user: req.user,
              college: (await db.query("SELECT * FROM colleges WHERE id = $1", [req.user.college_id])).rows[0],
              club: { id: clubId, ...req.body },
              mode: 'edit',
              error: 'Please fill in all required fields',
              searchTerm: ''
          });
      }

      let logoPath = undefined;
      if (req.file) {
          logoPath = processImagePath(req.file, 'club_logos');
      }

      // Update club
      const updateQuery = `
          UPDATE clubs
          SET name = $1,
              description = $2,
              type = $3
              ${logoPath ? ', logo = $4' : ''},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $${logoPath ? '5' : '4'} AND college_id = $${logoPath ? '6' : '5'}
      `;

      const updateValues = logoPath
          ? [name, description, type, logoPath, clubId, req.user.college_id]
          : [name, description, type, clubId, req.user.college_id];

      await db.query(updateQuery, updateValues);

      res.redirect('/college-admin');
  } catch (error) {
      console.error('Error updating club:', error);
      res.status(500).send("Server error");
  }
});

app.get("/club/:id", async (req, res) => {
  try {
    const clubId = req.params.id;
    const userId = req.user?.id;
    const searchTerm = req.query.search || ""; // Add this line

    // Get club details
    const clubResult = await db.query(
      "SELECT id, name, description, logo, college_id FROM clubs WHERE id = $1",
      [clubId]
    );
    const club = clubResult.rows[0];

    if (!club) {
      return res.status(404).send("Club not found");
    }

    // Get follow status if user is logged in
    let isFollowing = false;
    if (userId) {
      const followResult = await db.query(
        "SELECT EXISTS(SELECT 1 FROM club_followers WHERE user_id = $1 AND club_id = $2)",
        [userId, clubId]
      );
      isFollowing = followResult.rows[0].exists;
    }

    // Get followers count
    const followersResult = await db.query(
      "SELECT COUNT(*) FROM club_followers WHERE club_id = $1",
      [clubId]
    );
    const followersCount = parseInt(followersResult.rows[0].count);

    // Get upcoming events
    const eventsResult = await db.query(
      `SELECT e.*,
              TO_CHAR(e.date, 'Mon DD, YYYY') as "formattedDate",
              TO_CHAR(e.time, 'HH24:MI') as "formattedTime"
       FROM events e
       WHERE e.club_id = $1
       AND e.date >= CURRENT_DATE
       ORDER BY e.date, e.time`,
      [clubId]
    );

    res.render("pages/club.ejs", {
      club,
      events: eventsResult.rows,
      eventsCount: eventsResult.rows.length,
      isFollowing,
      followersCount,
      user: req.user,
      searchTerm, // Add this line
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.post("/club/:id/follow", isAuthenticated, async (req, res) => {
  const clubId = req.params.id;
  const userId = req.user.id;
  const action = req.body.action;

  try {
    if (action === "follow") {
      await db.query(
        "INSERT INTO club_followers (user_id, club_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, clubId]
      );
    } else if (action === "unfollow") {
      await db.query(
        "DELETE FROM club_followers WHERE user_id = $1 AND club_id = $2",
        [userId, clubId]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Follow/Unfollow error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Admin Login Routes
app.get("/admin-login", (req, res) => {
  res.render("pages/admin-login", { error: null });
});

app.post("/admin-login", async (req, res) => {
  try {
    const { email, password, admin_type } = req.body;

    // Validate input
    if (!email || !password || !admin_type) {
      return res.render("pages/admin-login", {
        error: "Please provide email, password, and admin type"
      });
    }

    // Find user with matching email and role
    const userResult = await db.query(
      "SELECT * FROM users WHERE email = $1 AND role = $2",
      [email, admin_type]
    );

    const user = userResult.rows[0];

    // Check if user exists
    if (!user) {
      return res.render("pages/admin-login", {
        error: "Invalid email or admin type"
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.render("pages/admin-login", {
        error: "Invalid password"
      });
    }

    // Log the user in
    req.login(user, (err) => {
      if (err) {
        console.error("Login error:", err);
        return res.render("pages/admin-login", {
          error: "An error occurred during login"
        });
      }

      // Redirect based on admin type
      if (admin_type === "super_admin") {
        return res.redirect("/super-admin");
      } else if (admin_type === "college_admin") {
        return res.redirect("/college-admin");
      } else if (admin_type === "club_admin") {
        return res.redirect("/club-admin");
      } else {
        return res.redirect("/");
      }
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.render("pages/admin-login", {
      error: "An error occurred. Please try again."
    });
  }
});



// College Admin Routes
app.get("/college-admin", isCollegeAdmin, async (req, res) => {
  try {
    // Fetch college data for the admin
    const collegeResult = await db.query(
      "SELECT * FROM colleges WHERE id = $1",
      [req.user.college_id]
    );

    // Fetch clubs in the college
    const clubsResult = await db.query(
      "SELECT * FROM clubs WHERE college_id = $1",
      [req.user.college_id]
    );

    // Fetch events in the college
    const eventsResult = await db.query(
      `
            SELECT e.*, c.name as club_name
            FROM events e
            JOIN clubs c ON e.club_id = c.id
            WHERE c.college_id = $1
            ORDER BY e.date DESC`,
      [req.user.college_id]
    );

    res.render("pages/college-admin", {
      user: req.user,
      college: collegeResult.rows[0],
      clubs: clubsResult.rows,
      events: eventsResult.rows.map((event) => ({
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time),
      })),
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

// Club Admin Routes
app.get("/club-admin", isClubAdmin, async (req, res) => {
  try {
    // Fetch club data for the admin
    const clubResult = await db.query(
      "SELECT c.*, col.name as college_name FROM clubs c JOIN colleges col ON c.college_id = col.id WHERE c.id = $1",
      [req.user.club_id]
    );

    // Fetch events for the club
    const eventsResult = await db.query(
      `
            SELECT e.*,
                   COUNT(er.user_id) as registration_count
            FROM events e
            LEFT JOIN event_registrations er ON e.id = er.event_id
            WHERE e.club_id = $1
            GROUP BY e.id
            ORDER BY e.date DESC`,
      [req.user.club_id]
    );

    // Fetch club followers count
    const followersResult = await db.query(
      "SELECT COUNT(*) FROM club_followers WHERE club_id = $1",
      [req.user.club_id]
    );

    res.render("pages/club-admin", {
      user: req.user,
      club: clubResult.rows[0],
      events: eventsResult.rows.map((event) => ({
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time),
      })),
      followersCount: followersResult.rows[0].count,
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

// IMPORTANT: Place specific routes BEFORE dynamic routes
// Create New Event - This should come FIRST
app.get("/event/new", isClubAdmin, async (req, res) => {
  try {
    const searchTerm = req.query.search || "";
    const clubId = Number(req.user.club_id);
    if (!Number.isInteger(clubId)) {
      return res.status(400).send("Invalid club ID");
    }
    console.log("Club ID from user:", req.user.club_id);

    // Get club details for the admin
    const clubResult = await db.query(
      "SELECT c.*, col.name as college_name FROM clubs c JOIN colleges col ON c.college_id = col.id WHERE c.id = $1",
      [req.user.club_id]
    );

    if (!clubResult.rows[0]) {
      return res.status(404).send("Club not found");
    }

    // Get college details
    const collegeResult = await db.query(
      "SELECT * FROM colleges WHERE id = $1",
      [clubResult.rows[0].college_id]
    );

    res.render("pages/event-form.ejs", {
      user: req.user,
      club: clubResult.rows[0],
      college: collegeResult.rows[0],
      event: null,
      mode: "create",
      method: "POST",
      searchTerm: searchTerm,
      error: null,
      title: "Create New Event",
    });
  } catch (error) {
    console.error("Error creating new event:", error);
    res.status(500).send("Server error");
  }
});

app.post("/event/new", isClubAdmin, eventImageUploader.single('banner'), async (req, res) => {
  try {
    const {
      title,
      description,
      date,
      time,
      venue,
      role_tag,
      event_type,
      first_prize,
      second_prize,
      third_prize,
      faqs,
    } = req.body;

    // Basic validation
    if (!title || !description || !date || !time || !venue || !event_type) {
      return res.render("pages/event-form.ejs", {
        user: req.user,
        club: (
          await db.query(
            "SELECT c.*, col.name as college_name FROM clubs c JOIN colleges col ON c.college_id = col.id WHERE c.id = $1",
            [req.user.club_id]
          )
        ).rows[0],
        event: req.body,
        mode: "create",
        searchTerm: "",
        error: "Please fill in all required fields",
      });
    }

    // Process banner image if uploaded
    let bannerPath = null;
    if (req.file) {
      bannerPath = processImagePath(req.file, 'event_logos');
    }

    const result = await db.query(
      `INSERT INTO events (
                title, description, date, time, venue,
                role_tag, event_type, club_id,
                first_prize, second_prize, third_prize, faqs,
                banner, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id`,
      [
        title,
        description,
        date,
        time,
        venue,
        role_tag || null,
        event_type,
        req.user.club_id,
        first_prize || null,
        second_prize || null,
        third_prize || null,
        faqs ? JSON.stringify(faqs.split('\n').filter(line => line.trim()).map(line => ({ question: line, answer: '' }))) : null,
        bannerPath
      ]
    );

    res.redirect("/club-admin");
  } catch (error) {
    console.error("Error saving new event:", error);
    res.status(500).send("Server error");
  }
});

// 1. FIRST: Place specific routes
app.get('/event/new', isClubAdmin, async (req, res) => {
    // ... existing new event route code ...
});

app.post('/event/new', isClubAdmin, async (req, res) => {
    // ... existing new event post handler code ...
});

// 2. THEN: Place registration routes
app.post('/event/register', isAuthenticated, async (req, res) => {
    try {
        const eventId = req.body.eventId; // Get eventId from request body instead of params
        const userId = req.user.id;

        // Validate eventId
        if (!eventId || isNaN(eventId)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }

        await db.query(
            'INSERT INTO event_registrations (user_id, event_id) VALUES ($1, $2)',
            [userId, eventId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error(error);

        // PostgreSQL error code for unique violation: 23505
        if (error.code === '23505') {
            return res.json({ success: false, message: "Already registered" });
        }

        res.status(500).json({ success: false, message: "Registration failed" });
    }
});

app.post("/event/:id/register", isAuthenticated, async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = req.user.id;

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }

    await db.query(
      "INSERT INTO event_registrations (user_id, event_id) VALUES ($1, $2)",
      [userId, eventId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);

    // PostgreSQL error code for unique violation: 23505
    if (error.code === "23505") {
      return res.json({ success: false, message: "Already registered" });
    }

    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// Download registrations as CSV
app.get("/event/:id/registrations/download", isClubAdmin, async (req, res) => {
  try {
    // Verify event ownership
    const eventCheck = await db.query(
      "SELECT id, title FROM events WHERE id = $1 AND club_id = $2",
      [req.params.id, req.user.club_id]
    );

    if (!eventCheck.rows[0]) {
      return res.status(404).send("Event not found or unauthorized");
    }

    // Get registrations
    const registrations = await db.query(
      `SELECT
                u.name, u.email, u.phone, u.college,
                er.created_at as registration_date
            FROM event_registrations er
            JOIN users u ON er.user_id = u.id
            WHERE er.event_id = $1
            ORDER BY er.created_at DESC`,
      [req.params.id]
    );

    // Create CSV content
    const csvHeader = "Name,Email,Phone,College,Registration Date\n";
    const csvRows = registrations.rows
      .map(
        (reg) =>
          `${reg.name},${reg.email},${reg.phone || ""},${reg.college || ""},${
            reg.registration_date
          }`
      )
      .join("\n");
    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=registrations-${req.params.id}.csv`
    );

    res.send(csvContent);
  } catch (error) {
    console.error("Error downloading registrations:", error);
    res.status(500).send("Server error");
  }
});


app.get("/event/:id/registrations", isClubAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) {
    return res.status(404).send("Invalid event ID");
  }

  try {
    const searchTerm = req.query.search || "";

    // Get event and verify it belongs to the admin's club
    const eventResult = await db.query(
      `SELECT e.*, c.name as club_name, c.college_id,
              TO_CHAR(e.date, 'Mon DD, YYYY') as formatted_date,
              TO_CHAR(e.time, 'HH24:MI') as formatted_time
       FROM events e
       JOIN clubs c ON e.club_id = c.id
       WHERE e.id = $1 AND e.club_id = $2`,
      [eventId, req.user.club_id]
    );

    if (!eventResult.rows[0]) {
      return res.status(404).send("Event not found or unauthorized");
    }

    const collegeResult = await db.query(
      "SELECT * FROM colleges WHERE id = $1",
      [eventResult.rows[0].college_id]
    );

    const registrationsResult = await db.query(
      `SELECT
         er.id as registration_id,
         er.created_at as registration_date,
         u.id as user_id,
         u.name as user_name,
         u.email as user_email,
         COALESCE(u.phone, '-') as user_phone,
         COALESCE(col.name, '-') as user_college,
         TO_CHAR(er.created_at, 'Mon DD, YYYY HH24:MI') as formatted_registration_date
       FROM event_registrations er
       JOIN users u ON er.user_id = u.id
       LEFT JOIN colleges col ON u.college_id = col.id
       WHERE er.event_id = $1
       ORDER BY er.created_at DESC`,
      [eventId]
    );

    const countResult = await db.query(
      "SELECT COUNT(*) FROM event_registrations WHERE event_id = $1",
      [eventId]
    );

    res.render("pages/event-registrations.ejs", {
      user: req.user,
      event: eventResult.rows[0],
      college: collegeResult.rows[0],
      registrations: registrationsResult.rows,
      registrationCount: parseInt(countResult.rows[0].count),
      method: "GET",
      mode: "view",
      searchTerm: searchTerm,
      error: null,
      title: "Event Registrations",
    });
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).send("Server error");
  }
});



app.get("/event/:id/edit", isClubAdmin, async (req, res) => {
  if (isNaN(req.params.id)) {
    return res.status(404).send("Invalid event ID");
  }

  try {
    const eventId = parseInt(req.params.id);
    // Verify the event belongs to the admin's club
    const eventResult = await db.query(
      `SELECT * FROM events
            WHERE id = $1 AND club_id = $2`,
      [eventId, req.user.club_id]
    );

    if (!eventResult.rows[0]) {
      return res.status(404).send("Event not found or unauthorized");
    }

    const clubResult = await db.query(
      "SELECT c.*, col.name as college_name FROM clubs c JOIN colleges col ON c.college_id = col.id WHERE c.id = $1",
      [req.user.club_id]
    );

    res.render("pages/event-form", {
      user: req.user,
      club: clubResult.rows[0],
      event: eventResult.rows[0],
      mode: "edit",
      searchTerm: "", // Add this line
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

app.post("/event/:id/edit", isClubAdmin, eventImageUploader.single('banner'), async (req, res) => {
  try {
    const {
      title,
      description,
      date,
      time,
      venue,
      role_tag,
      event_type,
      first_prize,
      second_prize,
      third_prize,
      faqs,
    } = req.body;

    // First verify if the event exists and belongs to the admin's club
    const checkEvent = await db.query(
      "SELECT id FROM events WHERE id = $1 AND club_id = $2",
      [req.params.id, req.user.club_id]
    );

    if (!checkEvent.rows[0]) {
      return res.status(404).send("Event not found or unauthorized");
    }

    // Process banner image if uploaded
    let bannerPath = undefined;
    if (req.file) {
      bannerPath = processImagePath(req.file, 'event_logos');
    }

    // Prepare the update query
    let updateQuery, updateValues;

    if (bannerPath) {
      updateQuery = `
        UPDATE events
        SET title = $1,
            description = $2,
            date = $3,
            time = $4,
            venue = $5,
            role_tag = $6,
            event_type = $7,
            first_prize = $8,
            second_prize = $9,
            third_prize = $10,
            faqs = $11,
            banner = $12
        WHERE id = $13 AND club_id = $14`;

      updateValues = [
        title,
        description,
        date,
        time,
        venue,
        role_tag || null,
        event_type,
        first_prize || null,
        second_prize || null,
        third_prize || null,
        faqs ? JSON.stringify(faqs.split('\n').filter(line => line.trim()).map(line => ({ question: line, answer: '' }))) : null,
        bannerPath,
        req.params.id,
        req.user.club_id,
      ];
    } else {
      updateQuery = `
        UPDATE events
        SET title = $1,
            description = $2,
            date = $3,
            time = $4,
            venue = $5,
            role_tag = $6,
            event_type = $7,
            first_prize = $8,
            second_prize = $9,
            third_prize = $10,
            faqs = $11
        WHERE id = $12 AND club_id = $13`;

      updateValues = [
        title,
        description,
        date,
        time,
        venue,
        role_tag || null,
        event_type,
        first_prize || null,
        second_prize || null,
        third_prize || null,
        faqs ? JSON.stringify(faqs.split('\n').filter(line => line.trim()).map(line => ({ question: line, answer: '' }))) : null,
        req.params.id,
        req.user.club_id,
      ];
    }

    // Update the event
    const result = await db.query(updateQuery, updateValues
    );

    res.redirect("/club-admin");
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).send(`Server error: ${error.message}`);
  }
});

app.get("/event/:id", async (req, res) => {
  const eventId = req.params.id;
  const searchTerm = req.query.search || "";

  // Check if the ID is numeric
  if (isNaN(req.params.id)) {
    return res.status(404).send("Invalid event ID");
  }

  try {
    const eventResult = await db.query(
      `SELECT
        e.id,
        e.title,
        e.description,
        e.date,
        e.time,
        e.venue,
        e.banner,
        e.role_tag,
        e.event_type,
        e.first_prize,
        e.second_prize,
        e.third_prize,
        e.faqs,
        c.name AS club_name,
        col.name AS college_name
      FROM events e
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
      WHERE e.id = $1`,
      [eventId]
    );

    let isRegistered = false;
    if (req.user) {
      const registrationResult = await db.query(
        "SELECT 1 FROM event_registrations WHERE user_id = $1 AND event_id = $2",
        [req.user.id, eventId]
      );
      isRegistered = registrationResult.rows.length > 0;
    }

    if (!eventResult.rows[0]) {
      return res.status(404).send("Event not found");
    }

    const event = eventResult.rows[0];
    const formattedEvent = {
      ...event,
      name: event.title,
      formattedDate: formatDate(event.date),
      formattedTime: formatTime(event.time),
    };
    // Debugging log removed
    // console.log(formattedEvent);
    res.render("pages/event.ejs", {
      event: formattedEvent,
      searchTerm,
      isRegistered,
      user: req.user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});



// Delete college route
app.delete('/college/:id', isSuperAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const collegeId = req.params.id;

        // Delete related records first
        await client.query('DELETE FROM college_followers WHERE college_id = $1', [collegeId]);
        await client.query('DELETE FROM event_registrations WHERE event_id IN (SELECT e.id FROM events e JOIN clubs c ON e.club_id = c.id WHERE c.college_id = $1)', [collegeId]);
        await client.query('DELETE FROM events WHERE club_id IN (SELECT id FROM clubs WHERE college_id = $1)', [collegeId]);
        await client.query('DELETE FROM club_followers WHERE club_id IN (SELECT id FROM clubs WHERE college_id = $1)', [collegeId]);
        await client.query('DELETE FROM users WHERE college_id = $1 OR club_id IN (SELECT id FROM clubs WHERE college_id = $1)', [collegeId]);
        await client.query('DELETE FROM clubs WHERE college_id = $1', [collegeId]);
        await client.query('DELETE FROM colleges WHERE id = $1', [collegeId]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting college:', error);
        res.status(500).json({ success: false, error: 'Failed to delete college' });
    } finally {
        client.release();
    }
});

// Edit college route
app.get('/college/:id/edit', isSuperAdmin, async (req, res) => {
    try {
        const collegeId = req.params.id;
        const collegeResult = await db.query(
            'SELECT * FROM colleges WHERE id = $1',
            [collegeId]
        );

        const adminResult = await db.query(
            `SELECT * FROM users
             WHERE college_id = $1 AND role = 'college_admin'`,
            [collegeId]
        );

        if (!collegeResult.rows[0]) {
            return res.status(404).send('College not found');
        }

        res.render('pages/college-form', {
            user: req.user,
            college: collegeResult.rows[0],
            admin: adminResult.rows[0] || null,
            mode: 'edit',
            error: null,
            searchTerm: ''
        });
    } catch (error) {
        console.error('Error loading college edit form:', error);
        res.status(500).send('Server error');
    }
});

app.post('/college/:id/edit', isSuperAdmin, collegeLogoUploader.single('logo'), async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const collegeId = req.params.id;
        const { name, location, admin_name, admin_email, admin_password } = req.body;

        // Update college details
        let updateQuery, updateValues;

        if (req.file) {
            updateQuery = `
                UPDATE colleges
                SET name = $1,
                    location = $2,
                    logo = $3
                WHERE id = $4
                RETURNING *
            `;
            updateValues = [name, location, processImagePath(req.file, 'college_logos'), collegeId];
        } else {
            updateQuery = `
                UPDATE colleges
                SET name = $1,
                    location = $2
                WHERE id = $3
                RETURNING *
            `;
            updateValues = [name, location, collegeId];
        }

        await client.query(updateQuery, updateValues);

        // Handle admin updates
        if (admin_email) {
            const existingAdmin = await client.query(
                'SELECT * FROM users WHERE college_id = $1 AND role = 'college_admin'',
                [collegeId]
            );

            if (existingAdmin.rows[0]) {
                // Update existing admin
                let updateAdminQuery, updateAdminValues;

                if (admin_password) {
                    updateAdminQuery = `
                        UPDATE users
                        SET name = $1,
                            email = $2,
                            password_hash = $3
                        WHERE college_id = $4 AND role = 'college_admin'
                    `;
                    updateAdminValues = [admin_name, admin_email, await bcrypt.hash(admin_password, 10), collegeId];
                } else {
                    updateAdminQuery = `
                        UPDATE users
                        SET name = $1,
                            email = $2
                        WHERE college_id = $3 AND role = 'college_admin'
                    `;
                    updateAdminValues = [admin_name, admin_email, collegeId];
                }

                await client.query(updateAdminQuery, updateAdminValues);
            } else {
                // Create new admin if email is provided
                const hashedPassword = await bcrypt.hash(admin_password || 'defaultPassword123', 10);
                await client.query(
                    `INSERT INTO users (name, email, password_hash, role, college_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [admin_name, admin_email, hashedPassword, 'college_admin', collegeId]
                );
            }
        }

        await client.query('COMMIT');
        res.redirect('/super-admin');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating college:', error);
        res.render('pages/college-form', {
            user: req.user,
            college: req.body,
            admin: {
                name: req.body.admin_name,
                email: req.body.admin_email
            },
            mode: 'edit',
            error: 'Failed to update college: ' + error.message,
            searchTerm: ''
        });
    } finally {
        client.release();
    }
});

app.get('/colleges', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';

    const query = `
      SELECT
        id,
        name,
        location
      FROM colleges
      WHERE LOWER(name) LIKE LOWER($1)
        OR LOWER(location) LIKE LOWER($1)
      ORDER BY name ASC
    `;

    const result = await db.query(query, [`%${searchTerm}%`]);

    res.render('pages/colleges', {
      colleges: result.rows,
      searchTerm: searchTerm,
      user: req.user
    });
  } catch (error) {
    console.error('Error fetching colleges:', error);
    res.status(500).render('error', {
      message: 'Failed to load colleges page',
      error: error
    });
  }
});

// Initialize database schema
const initializeDatabase = async () => {
  try {
    // Ensure events table has banner column
    await ensureEventBannerColumn();
    console.log('Database schema initialization complete');
  } catch (error) {
    console.error('Error initializing database schema:', error);
  }
};

// Start the server
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);

  // Initialize database schema
  await initializeDatabase();
});
