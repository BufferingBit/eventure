import express from 'express';
import passport from 'passport';
import db from '../db.js';
import bcrypt from 'bcrypt';

const router = express.Router();

router.get('/login', (req, res) => {
    res.render('pages/login');
});


router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [email, 'user']  // Only allow regular user logins through this route
        );

        const user = result.rows[0];

        if (!user) {
            return res.redirect('/login?error=Invalid email or password');
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.redirect('/login?error=Invalid email or password');
        }

        req.login(user, (err) => {
            if (err) {
                console.error(err);
                return res.redirect('/login?error=Login failed');
            }
            return res.redirect('/');
        });

    } catch (error) {
        console.error(error);
        res.redirect('/login?error=Login failed');
    }
});

router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
        res.redirect('/');
    }
);

router.get('/logout', (req, res) => {

    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }
        

        req.logout((err) => {
            if (err) {
                console.error('Passport logout error:', err);
            }
            
            res.clearCookie('connect.sid');
            

            res.redirect('/');
        });
    });
});


router.get('/signup', (req, res) => {
    const { error } = req.query;
    res.render('pages/signup', { error });
});


router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        // Check if user already exists
        const userExists = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (userExists.rows.length > 0) {
            return res.redirect('/signup?error=Email already registered');
        }

        // Create new user with 'user' role only
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
            [name, email, hashedPassword, 'user']
        );

        res.redirect('/login?message=Registration successful');
    } catch (error) {
        console.error(error);
        res.redirect('/signup?error=Registration failed');
    }
});

// Admin login page
router.get('/admin-login', (req, res) => {
    const { error } = req.query;
    res.render('pages/admin-login', { error });
});

// Admin login handler
router.post('/admin-login', async (req, res) => {
    try {
        const { email, password, admin_type } = req.body;

        // Verify that the user exists and has the correct role
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [email, admin_type]
        );

        const user = result.rows[0];

        if (!user) {
            return res.redirect('/admin-login?error=Invalid credentials');
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.redirect('/admin-login?error=Invalid credentials');
        }

        req.login(user, (err) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin-login?error=Login failed');
            }

            // Redirect based on admin role
            switch(user.role) {
                case 'super_admin':
                    return res.redirect('/super-admin');
                case 'college_admin':
                    return res.redirect('/college-admin');
                case 'club_admin':
                    return res.redirect('/club-admin');
                default:
                    return res.redirect('/');
            }
        });

    } catch (error) {
        console.error(error);
        res.redirect('/admin-login?error=Login failed');
    }
});

export const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

export default router;







