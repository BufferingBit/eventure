import express from "express";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import db from "./models/db.js";
import indexRoutes from "./routes/index.js";
import eventRoutes from "./routes/events.js";

dotenv.config();

const app = express();
const port = 3000;
const saltRounds = 10;

// View engine setup
app.set("view engine", "ejs");
app.set("views", "./views");

// Middlewares
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/", indexRoutes(db));
app.use("/events", eventRoutes(db));

app.get("/user/profile", (req, res) => {
  res.render("user/profile.ejs");
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
