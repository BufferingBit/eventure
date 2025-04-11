import express from 'express';
import passport from '../config/auth.js';
import db from '../db.js';
import bcrypt from 'bcrypt';

const router = express.Router();

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Login routes
router.get('/login', (req, res) => {
  res.render('pages/login', { error: null });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.render('pages/login', {
        error: 'Please provide both email and password'
      });
    }

    // Find user with matching email
    const userResult = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    const user = userResult.rows[0];

    // Check if user exists
    if (!user) {
      return res.render('pages/login', {
        error: 'Invalid email or password'
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.render('pages/login', {
        error: 'Invalid email or password'
      });
    }

    // Log the user in
    req.login(user, (err) => {
      if (err) {
        console.error('Login error:', err);
        return res.render('pages/login', {
          error: 'An error occurred during login'
        });
      }

      // Redirect based on role
      if (user.role === 'super_admin') {
        return res.redirect('/super-admin');
      } else if (user.role === 'college_admin') {
        return res.redirect('/college-admin');
      } else if (user.role === 'club_admin') {
        return res.redirect('/club-admin');
      } else {
        return res.redirect('/');
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('pages/login', {
      error: 'An error occurred. Please try again.'
    });
  }
});

router.get('/signup', (req, res) => {
  res.render('pages/signup', { error: null });
});

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.render('pages/signup', {
        error: 'Please fill in all required fields'
      });
    }

    // Check if email already exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.render('pages/signup', {
        error: 'Email already exists. Please use a different email or login.'
      });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hashedPassword, 'user']
    );

    const newUser = result.rows[0];

    // Log the user in
    req.login(newUser, (err) => {
      if (err) {
        console.error('Login error after signup:', err);
        return res.render('pages/signup', {
          error: 'Account created but could not log in automatically. Please log in.'
        });
      }

      res.redirect('/');
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.render('pages/signup', {
      error: 'An error occurred during signup. Please try again.'
    });
  }
});

// Google OAuth routes
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    successRedirect: '/'
  })
);

// Logout route
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// Export both the router as default and isAuthenticated as a named export
export { router as default, isAuthenticated };
