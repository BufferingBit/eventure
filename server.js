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
  port: 5433,
});

db.connect();

const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


app.use(express.static(path.join(__dirname, "public")));

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
  const collegeId = req.params.id;

  try {
    const collegeResult = await db.query(
      "SELECT id, name, location, logo FROM colleges WHERE id = $1", [collegeId]
    );
    const college = collegeResult.rows[0];

    if (!college) {
      return res.status(404).send("College not found");
    }

    const clubsResult = await db.query(
      "SELECT id, name, type FROM clubs WHERE college_id = $1",
      [collegeId]
    );
    const clubs = clubsResult.rows;

    const query = `
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
      WHERE col.id = $1
    `;

    const values = [collegeId];

    const response = await db.query(query, values);
    const events = response.rows.map((event) => ({
      ...event,
      formattedDate: formatDate(event.date),
      formattedTime: formatTime(event.time),
    }));

    res.render("pages/college.ejs", {
      searchTerm: "",
      college,
      clubs,
      events,
      clubCount: clubs.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
