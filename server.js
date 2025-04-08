import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";
import path from "path";
import pg from "pg";
import env from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
env.config();

const db = new pg.Client({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

db.connect();

const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Routes

app.get("/", async (req, res) => {
  try {
    const searchTerm = req.query.search || "";

    let query = `
        SELECT 
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

    // Add fuzzy search if query exists
    if (searchTerm) {
      query += ` 
          WHERE col.name ILIKE $1 
             OR c.name ILIKE $1
             OR col.name ILIKE $2
             OR c.name ILIKE $2
        `;
      // Add variations to increase match chances
      values.push(`%${searchTerm}%`);
      values.push(`%${searchTerm.split(" ").join("%")}%`);
    }

    const response = await db.query(query, values);
    const events = response.rows;

    const colleges = [
      ...new Set(events.map((event) => event.college_name || "")),
    ];

    res.render("index", { events, colleges, searchTerm });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
