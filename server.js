import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import db from './db.js';
import session from 'express-session';
import passport from './config/auth.js';
import authRoutes, { isAuthenticated } from './routes/auth.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'public/images/profile_photos');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.join(__dirname, 'public/images/profile_photos'))
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  if (req.isAuthenticated()) {
    const durations = {
      user: 7 * 24 * 60 * 60 * 1000,         
      club_admin: 3 * 24 * 60 * 60 * 1000,   
      college_admin: 1 * 24 * 60 * 60 * 1000 
    };

    const role = req.user.role || 'user'; 
    const duration = durations[role] || durations.user;

    req.session.cookie.maxAge = duration;
  }
  next();
});


app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

app.use('/', authRoutes);

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

app.get("/", async (req, res) => {
  try {
    const searchTerm = req.query.search || "";

    let query = `
      SELECT 
        e.id, 
        e.title, 
        e.description, 
        e.date, 
        e.time, 
        e.venue, 
        e.role_tag, 
        e.event_type,
        c.name AS club_name, 
        col.name AS college_name
      FROM events e
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
    `;

    let values = [];

    if (searchTerm) {
      query += `
        WHERE col.name ILIKE $1 
           OR c.name ILIKE $1
           OR col.name ILIKE $2
           OR c.name ILIKE $2
      `;
      values.push(`%${searchTerm}%`);
      values.push(`%${searchTerm.split(" ").join("%")}%`);
    }

    const response = await db.query(query, values);
    const events = response.rows.map((event) => ({
      ...event,
      formattedDate: formatDate(event.date),
      formattedTime: formatTime(event.time),
    }));

    const collegeRes = await db.query("SELECT id, name FROM colleges");
    const colleges = collegeRes.rows;

    res.render("index", { events, colleges, searchTerm });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
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
        'SELECT EXISTS(SELECT 1 FROM college_followers WHERE user_id = $1 AND college_id = $2)',
        [userId, collegeId]
      );
      isFollowing = followResult.rows[0].exists;
    }

    const collegeResult = await db.query(
      "SELECT id, name, location, logo FROM colleges WHERE id = $1", [collegeId]
    );
    const college = collegeResult.rows[0];

    if (!college) {
      return res.status(404).send("College not found");
    }

    // Get followers count
    const followersCountResult = await db.query(
      'SELECT COUNT(*) FROM college_followers WHERE college_id = $1',
      [collegeId]
    );
    const followersCount = parseInt(followersCountResult.rows[0].count);
    console.log("followersCount:", followersCount);

    // Fetch clubs grouped by type
    const clubsResult = await db.query(
      `SELECT id, name, type, description, logo 
       FROM clubs 
       WHERE college_id = $1`,
      [collegeId]
    );

    // Group clubs by type
    const clubs = {
      CLUB: clubsResult.rows.filter(club => club.type.toUpperCase() === 'CLUB'),
      SOCIETY: clubsResult.rows.filter(club => club.type.toUpperCase() === 'SOCIETY'),
      FEST: clubsResult.rows.filter(club => club.type.toUpperCase() === 'FEST')
    };

    // Fetch upcoming events
    const eventsResult = await db.query(`
      SELECT 
        e.id, 
        e.title, 
        e.description, 
        e.date, 
        e.time, 
        e.venue, 
        e.role_tag, 
        e.event_type,
        c.name AS club_name,
        c.type AS club_type,
        col.name AS college_name
      FROM events e
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
      WHERE col.id = $1 AND e.date >= CURRENT_DATE
      ORDER BY e.date ASC
    `, [collegeId]);

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
      activeTab: 'events',
      user: req.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.get("/event/:id", async (req, res) => {
  const eventId = req.params.id;
  const searchTerm = req.query.search || '';

  try {
    const eventResult = await db.query(
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
        e.first_prize,
        e.second_prize,
        e.third_prize,
        e.faqs,
        c.name AS club_name, 
        col.name AS college_name
      FROM events e
      JOIN clubs c ON e.club_id = c.id
      JOIN colleges col ON c.college_id = col.id
      WHERE e.id = $1
    `,
      [eventId]
    );

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
      searchTerm 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.post('/event/:id/register', isAuthenticated, async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = req.user.id;

    await db.query(
      'INSERT INTO event_registrations (user_id, event_id) VALUES ($1, $2)',
      [userId, eventId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);

    // PostgreSQL error code for unique violation: 23505
    if (error.code === '23505') {
      return res.json({ success: false, message: 'Already registered' });
    }

    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});


app.get("/profile", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const userResult = await db.query(`
      SELECT 
        u.*,
        c.name as college_name
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.id = $1
    `, [userId]);

    // Get followed colleges
    const followedCollegesResult = await db.query(`
      SELECT c.*
      FROM colleges c
      JOIN college_followers cf ON c.id = cf.college_id
      WHERE cf.user_id = $1
      ORDER BY c.name
    `, [userId]);

    // Fix the query to include club_name and college_name
    const participatedEventsResult = await db.query(`
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
    `, [userId]);

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
      participated_events: participatedEventsResult.rows.map(event => ({
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time)
      })),
      following_clubs: userWithFollowing.rows[0].following_clubs
    };

    res.render("pages/profile", { 
      user: userData,
      searchTerm: ""
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


// Consolidated '/college/:id/follow' route
app.post("/college/:id/follow", isAuthenticated, async (req, res) => {
  const collegeId = req.params.id;
  const userId = req.user.id;
  const action = req.body.action;

  try {
    if (action === 'follow') {
      await db.query(
        'INSERT INTO college_followers (user_id, college_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, collegeId]
      );
    } else if (action === 'unfollow') {
      await db.query(
        'DELETE FROM college_followers WHERE user_id = $1 AND college_id = $2',
        [userId, collegeId]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Follow/Unfollow error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


app.get("/profile/edit", isAuthenticated, async (req, res) => {
  try {
    const userResult = await db.query(`
      SELECT 
        u.*,
        c.name as college_name
      FROM users u
      LEFT JOIN colleges c ON u.college_id = c.id
      WHERE u.id = $1
    `, [req.user.id]);

    const collegesResult = await db.query('SELECT id, name FROM colleges ORDER BY name');
    
    // Handle skills from JSONB
    const userData = {
      ...userResult.rows[0],
      skills: userResult.rows[0].skills ? 
              (typeof userResult.rows[0].skills === 'string' ? 
                  JSON.parse(userResult.rows[0].skills) : 
                  userResult.rows[0].skills) : 
              []
    };

    res.render("pages/edit-profile", {
      user: userData,
      colleges: collegesResult.rows,
      searchTerm: ""
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


app.post("/profile/update", isAuthenticated, upload.single('photo'), async (req, res) => {
  try {
    const { name, bio, college_id } = req.body;
    // Handle skills array
    const skills = req.body['skills[]'] || [];
    const skillsArray = Array.isArray(skills) ? skills : [skills];
    
    const userId = req.user.id;
    
    let photoPath = req.user.photo;
    if (req.file) {
      photoPath = `/images/profile_photos/${req.file.filename}`;
    }

    // Store skills as JSONB
    await db.query(`
      UPDATE users 
      SET name = $1, 
          bio = $2, 
          college_id = $3, 
          skills = $4::jsonb,
          photo = $5,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `, [
      name, 
      bio || null, 
      college_id, 
      JSON.stringify(skillsArray), // Convert array to JSON string
      photoPath,
      userId
    ]);

    res.redirect('/profile');
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


// Removed duplicate '/college/:id/follow' route


app.get("/club/:id", async (req, res) => {
  try {
    const clubId = req.params.id;
    const userId = req.user?.id;
    const searchTerm = req.query.search || ''; // Add this line

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
        'SELECT EXISTS(SELECT 1 FROM club_followers WHERE user_id = $1 AND club_id = $2)',
        [userId, clubId]
      );
      isFollowing = followResult.rows[0].exists;
    }

    // Get followers count
    const followersResult = await db.query(
      'SELECT COUNT(*) FROM club_followers WHERE club_id = $1',
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
      searchTerm // Add this line
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.post('/club/:id/follow', isAuthenticated, async (req, res) => {
  const clubId = req.params.id;
  const userId = req.user.id;
  const action = req.body.action;

  try {
    if (action === 'follow') {
      await db.query(
        'INSERT INTO club_followers (user_id, club_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, clubId]
      );
    } else if (action === 'unfollow') {
      await db.query(
        'DELETE FROM club_followers WHERE user_id = $1 AND club_id = $2',
        [userId, clubId]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Follow/Unfollow error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
