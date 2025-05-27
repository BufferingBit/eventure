import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";
import path from "path";
import session from "express-session";
import passport from "./config/auth.js";
import authRoutes, { isAuthenticated } from "./routes/auth.js";
import fs from "fs";
import bcrypt from "bcrypt";
import dotenv from 'dotenv';
import { createUploader, getImageUrl, addImageHelpers } from './config/cloudinary.js';
import settingsService from './services/settings.js';
import supabase from './db.js';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    // Use Supabase to fetch the club_id for the user
    const { data, error } = await supabase
      .from('users')
      .select('club_id')
      .eq('id', req.user.id)
      .eq('role', 'club_admin')
      .single();

    if (error) {
      console.error("Error fetching club_id for user:", error);
      return res.status(500).send("Server error");
    }

    const clubId = data?.club_id;

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
    // Step 1: Check if column exists
    const { data: columnExists, error: checkError } = await supabase.rpc('check_column_exists', {
      table_name: 'events',
      column_name: 'banner'
    });

    if (checkError) throw checkError;

    // Step 2: If not, alter the table
    if (!columnExists) {
      console.log('Adding banner column to events table...');
      const { error: alterError } = await supabase.rpc('add_banner_column');
      if (alterError) throw alterError;
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
        // Fetch colleges and their admins
        let { data: colleges, error } = await supabase
          .from('colleges')
          .select('*, users!users_college_id_fkey(name, email)')
          .or(`name.ilike.%${searchTerm}%,location.ilike.%${searchTerm}%`)
          .order('name');
        if (error) throw error;
        // Flatten admin info for rendering
        colleges = (colleges || []).map(col => ({
          ...col,
          admin_name: (col.users || []).find(u => u.role === 'college_admin')?.name || '',
          admin_email: (col.users || []).find(u => u.role === 'college_admin')?.email || ''
        }));
        res.render('pages/super-admin', {
          user: req.user,
          colleges,
          error: null,
          searchTerm
        });
    } catch (error) {
        console.error('Error loading super admin dashboard:', error);
        res.status(500).send('Server error');
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
  try {
    const { name, location, admin_name, admin_email, admin_password } = req.body;
    const logo = req.file ? processImagePath(req.file, 'college_logos') : '/images/college_logos/default-college-logo.png';
    // Insert college
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .insert([{ name, location, logo }])
      .select('id')
      .single();
    if (collegeError) throw collegeError;
    const collegeId = college.id;
    // Create admin if details provided
    if (admin_email && admin_name && admin_password) {
      const hashedPassword = await bcrypt.hash(admin_password, 10);
      const { error: userError } = await supabase
        .from('users')
        .insert([{ name: admin_name, email: admin_email, password_hash: hashedPassword, role: 'college_admin', college_id: collegeId }]);
      if (userError) throw userError;
    }
    res.redirect('/super-admin');
  } catch (error) {
    console.error('Error creating college:', error);
    res.render('pages/college-form', {
      user: req.user,
      college: req.body,
      admin: { name: req.body.admin_name, email: req.body.admin_email },
      mode: 'create',
      error: 'Failed to create college: ' + error.message,
      searchTerm: ''
    });
  }
});

app.get('/college-admin/new', isSuperAdmin, async (req, res) => {
  try {
    const { data: colleges, error } = await supabase
      .from('colleges')
      .select('*')
      .order('name');
    if (error) throw error;
    res.render('pages/college-admin-form', {
      user: req.user,
      colleges,
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
  try {
    const { name, email, password, college_id } = req.body;
    if (!name || !email || !password || !college_id) {
      const { data: colleges } = await supabase.from('colleges').select('*').order('name');
      return res.render('pages/college-admin-form', {
        user: req.user,
        colleges,
        error: 'Please fill in all required fields',
        mode: 'create',
        searchTerm: ''
      });
    }
    // Check if email already exists
    const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (existingUser) {
      const { data: colleges } = await supabase.from('colleges').select('*').order('name');
      return res.render('pages/college-admin-form', {
        user: req.user,
        colleges,
        error: 'Email already exists',
        mode: 'create',
        searchTerm: ''
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const { error: insertError } = await supabase
      .from('users')
      .insert([{ name, email, password_hash: hashedPassword, role: 'college_admin', college_id }]);
    if (insertError) throw insertError;
    res.redirect('/super-admin');
  } catch (error) {
    console.error('Error creating college admin:', error);
    res.redirect('/college-admin/new?error=Failed to create college admin');
  }
});

app.get("/college/:id", async (req, res) => {
  try {
    const collegeId = req.params.id;
    const userId = req.user?.id;

    let isFollowing = false;

    // Step 1: Check if the user is following the college
    if (userId) {
      const { data: followData, error: followError } = await supabase
        .from("college_followers")
        .select("id")
        .eq("user_id", userId)
        .eq("college_id", collegeId)
        .maybeSingle();

      if (followError) throw followError;
      isFollowing = !!followData;
    }

    // Step 2: Get the college info
    const { data: college, error: collegeError } = await supabase
      .from("colleges")
      .select("id, name, location, logo")
      .eq("id", collegeId)
      .maybeSingle();

    if (collegeError) throw collegeError;
    if (!college) return res.status(404).send("College not found");

    // Step 3: Count followers
    const { count: followersCount, error: countError } = await supabase
      .from("college_followers")
      .select("*", { count: "exact", head: true })
      .eq("college_id", collegeId);

    if (countError) throw countError;

    // Step 4: Get clubs by college
    const { data: clubsData, error: clubsError } = await supabase
      .from("clubs")
      .select("id, name, type, description, logo")
      .eq("college_id", collegeId);

    if (clubsError) throw clubsError;

    // Normalize and group clubs
    const normalizeType = (type) => type?.toString().toUpperCase().trim();
    const clubs = {
      CLUB: clubsData.filter((c) => normalizeType(c.type) === "CLUB"),
      SOCIETY: clubsData.filter((c) => normalizeType(c.type) === "SOCIETY"),
      FEST: clubsData.filter((c) => normalizeType(c.type) === "FEST"),
    };

    // Step 5: Fetch upcoming events
    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select(`
        id, title, description, date, time, venue, role_tag, event_type, banner,
        clubs ( name, type, colleges ( name ) )
      `)
      .gte("date", new Date().toISOString().split("T")[0])
      .order("date", { ascending: true });

    if (eventsError) throw eventsError;

    // Filter events by college ID
    const events = eventsData
      .filter((event) => event.clubs?.colleges?.id === collegeId)
      .map((event) => ({
        ...event,
        club_name: event.clubs?.name,
        club_type: event.clubs?.type,
        college_name: event.clubs?.colleges?.name,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time),
      }));

    res.render("pages/college.ejs", {
      searchTerm: "",
      college,
      clubs,
      events,
      clubCount: clubsData.length,
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

    // 1. Get user info with college name
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*, colleges(name)")
      .eq("id", userId)
      .maybeSingle();

    if (userError) throw userError;

    // 2. Get followed colleges
    const { data: followedColleges, error: followCollegesError } = await supabase
      .from("college_followers")
      .select("colleges(id, name, logo, location)")
      .eq("user_id", userId)
      .order("colleges.name", { ascending: true });

    if (followCollegesError) throw followCollegesError;

    // Extract only the college details
    const followedCollegesList = followedColleges
      .map((fc) => fc.colleges)
      .filter(Boolean);

    // 3. Get participated events with club and college info
    const { data: events, error: eventsError } = await supabase
      .from("event_registrations")
      .select(`
        events (
          *,
          clubs (
            name,
            colleges ( name )
          )
        )
      `)
      .eq("user_id", userId)
      .order("events.date", { ascending: false });

    if (eventsError) throw eventsError;

    const participatedEvents = events.map(({ events: e }) => ({
      ...e,
      club_name: e.clubs?.name,
      college_name: e.clubs?.colleges?.name,
      formattedDate: formatDate(e.date),
      formattedTime: formatTime(e.time),
    }));

    // 4. Get followed clubs
    const { data: followedClubs, error: followClubsError } = await supabase
      .from("club_followers")
      .select("clubs(id, name, logo)")
      .eq("user_id", userId);

    if (followClubsError) throw followClubsError;

    const followingClubs = followedClubs
      .map((fc) => fc.clubs)
      .filter(Boolean);

    // Final merged user object
    const userData = {
      ...user,
      college_name: user.colleges?.name || null,
      followed_colleges: followedCollegesList,
      participated_events: participatedEvents,
      following_clubs: followingClubs,
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
      const { error } = await supabase
        .from("college_followers")
        .insert({ user_id: userId, college_id: collegeId }, { upsert: true, onConflict: ['user_id', 'college_id'] });

      if (error) throw error;
    } else if (action === "unfollow") {
      const { error } = await supabase
        .from("college_followers")
        .delete()
        .eq("user_id", userId)
        .eq("college_id", collegeId);

      if (error) throw error;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Follow/Unfollow error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});


app.get("/profile/edit", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user info with college name
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*, colleges(name)")
      .eq("id", userId)
      .maybeSingle();

    if (userError) throw userError;

    // Get list of colleges
    const { data: colleges, error: collegesError } = await supabase
      .from("colleges")
      .select("id, name")
      .order("name", { ascending: true });

    if (collegesError) throw collegesError;

    const userData = {
      ...user,
      college_name: user.colleges?.name || null,
      skills: typeof user.skills === "string" ? JSON.parse(user.skills) : (user.skills || []),
    };

    res.render("pages/edit-profile", {
      user: userData,
      colleges,
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


app.post('/profile/update', isAuthenticated, profileUploader.single('photo'), async (req, res) => {
  let currentClubId, currentCollegeId, userRole, skillsArray;

  try {
    const { name, bio, college_id } = req.body;
    const skills = req.body['skills[]'] || [];
    skillsArray = Array.isArray(skills) ? skills : [skills];
    const userId = req.user.id;

    // Get current user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, club_id, college_id')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    userRole = userData.role;
    currentClubId = userData.club_id;
    currentCollegeId = userData.college_id;

    // Determine the final club_id and college_id based on role
    let finalClubId, finalCollegeId;

    if (userRole === 'club_admin') {
      finalClubId = currentClubId;
    } else {
      finalClubId = null;
    }

    if (userRole === 'college_admin') {
      finalCollegeId = currentCollegeId;
    } else {
      finalCollegeId = null;
    }

    let photoPath = req.user.photo;
    if (req.file) {
      photoPath = processImagePath(req.file, 'profile_photos');
    }

    // Update user data
    const { error: updateError } = await supabase
      .from('users')
      .update({
        name,
        bio: bio || null,
        college_id: finalCollegeId,
        club_id: finalClubId,
        skills: skillsArray,
        photo: photoPath,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) throw updateError;

    res.redirect('/profile');
  } catch (error) {
    console.error('Profile update error:', error);

    // Re-render form with error
    try {
      const { data: colleges, error: collegesError } = await supabase
        .from('colleges')
        .select('id, name')
        .order('name', { ascending: true });

      if (collegesError) throw collegesError;

      res.render('pages/edit-profile', {
        user: {
          ...req.user,
          ...req.body,
          club_id: currentClubId,
          college_id: currentCollegeId,
          skills: skillsArray
        },
        colleges,
        error: 'Failed to update profile. Please try again.',
        searchTerm: ''
      });
    } catch (renderError) {
      console.error('Error rendering profile edit page:', renderError);
      res.status(500).send('An error occurred while updating your profile');
    }
  }
});


// Create new club route
// Create new club route
app.get('/club/new', isCollegeAdmin, async (req, res) => {
  try {
    // Get college details for the admin
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', req.user.college_id)
      .single();

    if (collegeError) throw collegeError;

    res.render('pages/club-form', {
      user: req.user,
      college,
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
  try {
    const {
      name, description, type,
      adminName, adminEmail, adminPassword, adminPhone
    } = req.body;

    // Normalize the type field
    const normalizedType = type?.toString().toUpperCase().trim();

    // Validate type
    if (!['CLUB', 'SOCIETY', 'FEST'].includes(normalizedType)) {
      throw new Error(`Invalid club type: ${normalizedType}`);
    }

    // Basic validation
    if (!name || !type || !adminName || !adminEmail || !adminPassword) {
      const { data: college, error: collegeError } = await supabase
        .from('colleges')
        .select('*')
        .eq('id', req.user.college_id)
        .single();

      if (collegeError) throw collegeError;

      return res.render('pages/club-form', {
        user: req.user,
        college,
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
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .insert([{ 
        name, 
        description, 
        type: normalizedType, 
        logo: logoPath, 
        college_id: req.user.college_id 
      }])
      .select('id')
      .single();
    
    if (clubError) throw clubError;

    const clubId = club.id;

    // Create club admin user
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const { error: userError } = await supabase
      .from('users')
      .insert([{ 
        name: adminName, 
        email: adminEmail, 
        password_hash: hashedPassword, 
        role: 'club_admin', 
        club_id: clubId, 
        phone: adminPhone 
      }]);
    
    if (userError) throw userError;

    res.redirect('/college-admin');
  } catch (error) {
    console.error('Error creating club:', error);

    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', req.user.college_id)
      .single();

    if (collegeError) throw collegeError;

    return res.render('pages/club-form', {
      user: req.user,
      college,
      club: req.body,
      mode: 'create',
      error: 'Error creating club. Please try again.',
      searchTerm: ''
    });
  }
});

// Edit club routes
app.get('/club/:id/edit', isCollegeAdmin, async (req, res) => {
  try {
    const clubId = parseInt(req.params.id);

    // Verify the club belongs to the admin's college
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('*')
      .eq('id', clubId)
      .eq('college_id', req.user.college_id)
      .single();

    if (!club || clubError) {
      return res.status(404).send("Club not found or unauthorized");
    }

    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', req.user.college_id)
      .single();

    if (collegeError) throw collegeError;

    res.render('pages/club-form', {
      user: req.user,
      college,
      club,
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
    const { data: club, error: checkError } = await supabase
      .from('clubs')
      .select('id')
      .eq('id', clubId)
      .eq('college_id', req.user.college_id)
      .single();

    if (!club || checkError) {
      return res.status(404).send("Club not found or unauthorized");
    }

    // Basic validation
    if (!name || !type) {
      const { data: college, error: collegeError } = await supabase
        .from('colleges')
        .select('*')
        .eq('id', req.user.college_id)
        .single();

      if (collegeError) throw collegeError;

      return res.render('pages/club-form', {
        user: req.user,
        college,
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
    const updateData = {
      name,
      description,
      type,
      updated_at: new Date().toISOString()
    };

    if (logoPath) {
      updateData.logo = logoPath;
    }

    const { error: updateError } = await supabase
      .from('clubs')
      .update(updateData)
      .eq('id', clubId)
      .eq('college_id', req.user.college_id);

    if (updateError) throw updateError;

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
    const searchTerm = req.query.search || "";

    // Get club details
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, name, description, logo, college_id')
      .eq('id', clubId)
      .single();

    if (!club || clubError) {
      return res.status(404).send("Club not found");
    }

    // Get follow status if user is logged in
    let isFollowing = false;
    if (userId) {
      const { data: follow, error: followError } = await supabase
        .from('club_followers')
        .select('*')
        .eq('user_id', userId)
        .eq('club_id', clubId)
        .maybeSingle();

      if (!followError) {
        isFollowing = !!follow;
      }
    }

    // Get followers count
    const { count: followersCount, error: countError } = await supabase
      .from('club_followers')
      .select('*', { count: 'exact', head: true })
      .eq('club_id', clubId);

    // Get upcoming events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('club_id', clubId)
      .gte('date', new Date().toISOString())
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    res.render("pages/club.ejs", {
      club,
      events: events || [],
      eventsCount: events?.length || 0,
      isFollowing,
      followersCount: followersCount || 0,
      user: req.user,
      searchTerm,
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
      const { error } = await supabase
        .from('club_followers')
        .upsert({ user_id: userId, club_id: clubId }, { onConflict: ['user_id', 'club_id'] });
      
      if (error) throw error;
    } else if (action === "unfollow") {
      const { error } = await supabase
        .from('club_followers')
        .delete()
        .eq('user_id', userId)
        .eq('club_id', clubId);
      
      if (error) throw error;
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
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', req.user.college_id)
      .single();

    if (collegeError) throw collegeError;

    // Fetch clubs in the college
    const { data: clubs, error: clubsError } = await supabase
      .from('clubs')
      .select('*')
      .eq('college_id', req.user.college_id);

    if (clubsError) throw clubsError;

    // Fetch events in the college
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*, clubs!inner(name)')
      .eq('clubs.college_id', req.user.college_id)
      .order('date', { ascending: false });

    if (eventsError) throw eventsError;

    res.render("pages/college-admin", {
      user: req.user,
      college,
      clubs,
      events: events.map((event) => ({
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
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('*, colleges!inner(name)')
      .eq('id', req.user.club_id)
      .single();

    if (clubError) throw clubError;

    // Fetch events for the club
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*, event_registrations(count)')
      .eq('club_id', req.user.club_id)
      .order('date', { ascending: false });

    if (eventsError) throw eventsError;

    // Fetch club followers count
    const { count: followersCount, error: followersError } = await supabase
      .from('club_followers')
      .select('*', { count: 'exact', head: true })
      .eq('club_id', req.user.club_id);

    if (followersError) throw followersError;

    res.render("pages/club-admin", {
      user: req.user,
      club,
      events: events.map((event) => ({
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time),
        registration_count: event.event_registrations[0].count
      })),
      followersCount: followersCount || 0,
      searchTerm: "",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

// IMPORTANT: Place specific routes BEFORE dynamic routes
// Create New Event - This should come FIRST
// Create New Event
app.get("/event/new", isClubAdmin, async (req, res) => {
  try {
    const searchTerm = req.query.search || "";
    const clubId = Number(req.user.club_id);
    if (!Number.isInteger(clubId)) {
      return res.status(400).send("Invalid club ID");
    }

    // Get club details for the admin
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('*, colleges!inner(name)')
      .eq('id', req.user.club_id)
      .single();

    if (!club || clubError) {
      return res.status(404).send("Club not found");
    }

    // Get college details
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', club.college_id)
      .single();

    if (collegeError) throw collegeError;

    res.render("pages/event-form.ejs", {
      user: req.user,
      club,
      college,
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
      const { data: club, error: clubError } = await supabase
        .from('clubs')
        .select('*, colleges!inner(name)')
        .eq('id', req.user.club_id)
        .single();

      if (clubError) throw clubError;

      return res.render("pages/event-form.ejs", {
        user: req.user,
        club,
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

    const { data: event, error: insertError } = await supabase
      .from('events')
      .insert([{
        title,
        description,
        date,
        time,
        venue,
        role_tag: role_tag || null,
        event_type,
        club_id: req.user.club_id,
        first_prize: first_prize || null,
        second_prize: second_prize || null,
        third_prize: third_prize || null,
        faqs: faqs ? JSON.stringify(faqs.split('\n').filter(line => line.trim()).map(line => ({ question: line, answer: '' }))) : null,
        banner: bannerPath
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    res.redirect("/club-admin");
  } catch (error) {
    console.error("Error saving new event:", error);
    res.status(500).send("Server error");
  }
});

// Event registration
app.post("/event/register", isAuthenticated, async (req, res) => {
  try {
    const eventId = req.body.eventId;
    const userId = req.user.id;

    // Validate eventId
    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }

    const { error } = await supabase
      .from('event_registrations')
      .insert({ user_id: userId, event_id: eventId });

    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.json({ success: false, message: "Already registered" });
      }
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
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

    const { error } = await supabase
      .from('event_registrations')
      .insert({ user_id: userId, event_id: eventId });

    if (error) {
      if (error.code === '23505') {
        return res.json({ success: false, message: "Already registered" });
      }
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// Download registrations as CSV
app.get("/event/:id/registrations/download", isClubAdmin, async (req, res) => {
  try {
    // Verify event ownership
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', req.params.id)
      .eq('club_id', req.user.club_id)
      .single();

    if (!event || eventError) {
      return res.status(404).send("Event not found or unauthorized");
    }

    // Get registrations
    const { data: registrations, error: regError } = await supabase
      .from('event_registrations')
      .select(`
        created_at,
        users!inner(name, email, phone, college)
      `)
      .eq('event_id', req.params.id)
      .order('created_at', { ascending: false });

    if (regError) throw regError;

    // Create CSV content
    const csvHeader = "Name,Email,Phone,College,Registration Date\n";
    const csvRows = registrations
      .map(reg => 
        `${reg.users.name},${reg.users.email},${reg.users.phone || ""},${reg.users.college || ""},${reg.created_at}`
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
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        clubs!inner(name, college_id)
      `)
      .eq('id', eventId)
      .eq('club_id', req.user.club_id)
      .single();

    if (!event || eventError) {
      return res.status(404).send("Event not found or unauthorized");
    }

    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', event.clubs.college_id)
      .single();

    if (collegeError) throw collegeError;

    const { data: registrations, error: regError } = await supabase
      .from('event_registrations')
      .select(`
        id,
        created_at,
        users!inner(id, name, email, phone, colleges!left(name))
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (regError) throw regError;

    const { count: registrationCount, error: countError } = await supabase
      .from('event_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);

    res.render("pages/event-registrations.ejs", {
      user: req.user,
      event: {
        ...event,
        formattedDate: formatDate(event.date),
        formattedTime: formatTime(event.time)
      },
      college,
      registrations: registrations.map(reg => ({
        registration_id: reg.id,
        registration_date: reg.created_at,
        user_id: reg.users.id,
        user_name: reg.users.name,
        user_email: reg.users.email,
        user_phone: reg.users.phone || '-',
        user_college: reg.users.colleges?.name || '-',
        formatted_registration_date: formatDateTime(reg.created_at)
      })),
      registrationCount: registrationCount || 0,
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
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .eq('club_id', req.user.club_id)
      .single();

    if (!event || eventError) {
      return res.status(404).send("Event not found or unauthorized");
    }

    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('*, colleges!inner(name)')
      .eq('id', req.user.club_id)
      .single();

    if (clubError) throw clubError;

    res.render("pages/event-form", {
      user: req.user,
      club,
      event,
      mode: "edit",
      searchTerm: "",
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
    const { data: event, error: checkError } = await supabase
      .from('events')
      .select('id')
      .eq('id', req.params.id)
      .eq('club_id', req.user.club_id)
      .single();

    if (!event || checkError) {
      return res.status(404).send("Event not found or unauthorized");
    }

    // Process banner image if uploaded
    let bannerPath = undefined;
    if (req.file) {
      bannerPath = processImagePath(req.file, 'event_logos');
    }

    // Prepare the update data
    const updateData = {
      title,
      description,
      date,
      time,
      venue,
      role_tag: role_tag || null,
      event_type,
      first_prize: first_prize || null,
      second_prize: second_prize || null,
      third_prize: third_prize || null,
      faqs: faqs ? JSON.stringify(faqs.split('\n').filter(line => line.trim()).map(line => ({ question: line, answer: '' }))) : null,
      updated_at: new Date().toISOString()
    };

    if (bannerPath) {
      updateData.banner = bannerPath;
    }

    const { error: updateError } = await supabase
      .from('events')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('club_id', req.user.club_id);

    if (updateError) throw updateError;

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
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        clubs!inner(name, colleges!inner(name))
      `)
      .eq('id', eventId)
      .single();

    let isRegistered = false;
    if (req.user) {
      const { data: registration, error: regError } = await supabase
        .from('event_registrations')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('event_id', eventId)
        .maybeSingle();

      if (!regError) {
        isRegistered = !!registration;
      }
    }

    if (!event || eventError) {
      return res.status(404).send("Event not found");
    }

    const formattedEvent = {
      ...event,
      name: event.title,
      formattedDate: formatDate(event.date),
      formattedTime: formatTime(event.time),
      club_name: event.clubs.name,
      college_name: event.clubs.colleges.name
    };

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
// Delete college route
app.delete('/college/:id', isSuperAdmin, async (req, res) => {
  try {
    const collegeId = req.params.id;

    // Delete related records first
    await supabase
      .from('college_followers')
      .delete()
      .eq('college_id', collegeId);

    // Get all clubs in this college
    const { data: clubs, error: clubsError } = await supabase
      .from('clubs')
      .select('id')
      .eq('college_id', collegeId);

    if (!clubsError && clubs.length > 0) {
      const clubIds = clubs.map(c => c.id);

      // Delete event registrations for events in these clubs
      await supabase
        .from('event_registrations')
        .delete()
        .in('event_id', 
          (await supabase
            .from('events')
            .select('id')
            .in('club_id', clubIds)
          ).data.map(e => e.id)
        );

      // Delete events in these clubs
      await supabase
        .from('events')
        .delete()
        .in('club_id', clubIds);

      // Delete club followers for these clubs
      await supabase
        .from('club_followers')
        .delete()
        .in('club_id', clubIds);

      // Delete users associated with these clubs or the college
      await supabase
        .from('users')
        .delete()
        .or(`college_id.eq.${collegeId},club_id.in.(${clubIds.join(',')})`);

      // Delete the clubs
      await supabase
        .from('clubs')
        .delete()
        .eq('college_id', collegeId);
    }

    // Finally delete the college
    const { error: deleteError } = await supabase
      .from('colleges')
      .delete()
      .eq('id', collegeId);

    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting college:', error);
    res.status(500).json({ success: false, error: 'Failed to delete college' });
  }
});

// Edit college route
app.get('/college/:id/edit', isSuperAdmin, async (req, res) => {
  try {
    const collegeId = req.params.id;
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', collegeId)
      .single();

    if (!college || collegeError) {
      return res.status(404).send('College not found');
    }

    const { data: admin, error: adminError } = await supabase
      .from('users')
      .select('*')
      .eq('college_id', collegeId)
      .eq('role', 'college_admin')
      .maybeSingle();

    res.render('pages/college-form', {
      user: req.user,
      college,
      admin: admin || null,
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
  try {
    const collegeId = req.params.id;
    const { name, location, admin_name, admin_email, admin_password } = req.body;

    // Update college details
    const updateData = {
      name,
      location,
      updated_at: new Date().toISOString()
    };

    if (req.file) {
      updateData.logo = processImagePath(req.file, 'college_logos');
    }

    const { error: updateError } = await supabase
      .from('colleges')
      .update(updateData)
      .eq('id', collegeId);

    if (updateError) throw updateError;

    // Handle admin updates
    if (admin_email) {
      const { data: existingAdmin, error: adminError } = await supabase
        .from('users')
        .select('*')
        .eq('college_id', collegeId)
        .eq('role', 'college_admin')
        .maybeSingle();

      if (existingAdmin && !adminError) {
        // Update existing admin
        const adminUpdateData = {
          name: admin_name,
          email: admin_email
        };

        if (admin_password) {
          adminUpdateData.password_hash = await bcrypt.hash(admin_password, 10);
        }

        const { error: updateAdminError } = await supabase
          .from('users')
          .update(adminUpdateData)
          .eq('id', existingAdmin.id);

        if (updateAdminError) throw updateAdminError;
      } else {
        // Create new admin if email is provided
        const hashedPassword = await bcrypt.hash(admin_password || 'defaultPassword123', 10);
        const { error: createError } = await supabase
          .from('users')
          .insert([{
            name: admin_name,
            email: admin_email,
            password_hash: hashedPassword,
            role: 'college_admin',
            college_id: collegeId
          }]);

        if (createError) throw createError;
      }
    }

    res.redirect('/super-admin');
  } catch (error) {
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
  }
});

app.get('/colleges', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';

    const { data: colleges, error } = await supabase
      .from('colleges')
      .select('id, name, location')
      .or(`name.ilike.%${searchTerm}%,location.ilike.%${searchTerm}%`)
      .order('name', { ascending: true });

    if (error) throw error;

    res.render('pages/colleges', {
      colleges,
      searchTerm,
      user: req.user
    });
  } catch (error) {
    console.error('Error fetching colleges:', error);
    res.status(500).render('error', {
      message: 'Failed to load colleges page',
      error
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
