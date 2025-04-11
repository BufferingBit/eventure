import express from 'express';
import passport from '../config/auth.js';

const router = express.Router();

// Authentication middleware
export const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Login routes
router.get('/login', (req, res) => {
  res.render('pages/login', { error: null });
});

router.get('/signup', (req, res) => {
  res.render('pages/signup', { error: null });
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

// Make sure to export both the router as default and isAuthenticated as a named export
export { router as default, isAuthenticated };
