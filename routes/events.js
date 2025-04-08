import express from "express";

export default function (db) {
  const router = express.Router();

  // Get all events
  router.get("/", async (req, res) => {
    try {
      const result = await db.query(`
        SELECT e.id, e.title, e.description, e.date, e.time, e.venue, e.role_tag, e.event_type,
               c.name AS club_name, col.name AS college_name
        FROM events e
        JOIN clubs c ON e.club_id = c.id
        JOIN colleges col ON c.college_id = col.id
        ORDER BY e.date DESC, e.time DESC
        LIMIT 20
      `);

      res.render("events/index", { events: result.rows });
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).send("Server error");
    }
  });

  // Get a single event by ID
  router.get("/:id", async (req, res) => {
    try {
      const result = await db.query(
        `
        SELECT e.id, e.title, e.description, e.date, e.time, e.venue, e.role_tag, e.event_type,
               c.name AS club_name, col.name AS college_name
        FROM events e
        JOIN clubs c ON e.club_id = c.id
        JOIN colleges col ON c.college_id = col.id
        WHERE e.id = $1
      `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).send("Event not found");
      }

      res.render("events/show", { event: result.rows[0] });
    } catch (err) {
      console.error("Error fetching event:", err);
      res.status(500).send("Server error");
    }
  });

  return router;
}
