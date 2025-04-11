import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import db from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

function verifyEnvVariables() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Please check your .env file');
    process.exit(1);
  }
}

verifyEnvVariables();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const existingUser = await db.query(
        'SELECT * FROM users WHERE google_id = $1',
        [profile.id]
      );

      if (existingUser.rows.length) {
        return done(null, existingUser.rows[0]);
      }

      const newUser = await db.query(
        'INSERT INTO users (name, email, photo, google_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [
          profile.displayName,
          profile.emails[0].value,
          profile.photos[0].value,
          profile.id
        ]
      );

      done(null, newUser.rows[0]);
    } catch (err) {
      done(err, null);
    }
  }
));

export default passport;


