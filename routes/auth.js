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
            'SELECT * FROM users WHERE email = $1',
            [email]
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
    const { name, email, password, isAdmin } = req.body;
    
    try {
        const existingUser = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.redirect('/signup?error=Email already exists');
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const result = await db.query(
            `INSERT INTO users (
                name, 
                email, 
                password_hash, 
                role
            ) VALUES ($1, $2, $3, $4) 
            RETURNING *`,
            [
                name, 
                email, 
                passwordHash, 
                isAdmin === 'on' ? 'admin' : 'user'
            ]
        );

        const newUser = result.rows[0];


        req.login(newUser, (err) => {
            if (err) {
                console.error('Auto-login error:', err);
                return res.redirect('/login?error=Please log in manually');
            }


            req.session.regenerate((err) => {
                if (err) {
                    console.error('Session regeneration error:', err);
                    return res.redirect('/login?error=Please log in manually');
                }


                req.session.user = {
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    role: newUser.role
                };

                req.session.save((err) => {
                    if (err) {
                        console.error('Session save error:', err);
                        return res.redirect('/login?error=Please log in manually');
                    }

                    res.redirect('/');
                });
            });
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.redirect('/signup?error=Signup failed. Please try again.');
    }
});

export const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

export default router;



