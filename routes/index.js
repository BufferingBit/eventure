import express from "express";

export default function (db) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const searchQuery = req.query.q;
    const offset = parseInt(req.query.offset) || 0;
    try {
      let eventsQuery = `
        SELECT e.id, e.title, e.description, e.date, e.time, e.venue, e.role_tag, e.event_type,
               c.name AS club_name, col.name AS college_name
        FROM events e
        JOIN clubs c ON e.club_id = c.id
        JOIN colleges col ON c.college_id = col.id
      `;

      const values = [];

      if (searchQuery) {
        eventsQuery += `
          WHERE LOWER(e.title) LIKE LOWER($1) OR 
          LOWER(c.name) LIKE LOWER($1) OR 
          LOWER(col.name) LIKE LOWER($1) OR 
          LOWER(e.role_tag) LIKE LOWER($1) OR
          LOWER(e.event_type) LIKE LOWER($1)
        `;
        values.push(`%${searchQuery}%`);
      }

      eventsQuery += `
        ORDER BY e.date DESC, e.time DESC
         LIMIT 10 OFFSET $${values.length + 1}
      `;
      values.push(offset);

      const result = await db.query(eventsQuery, values);
      res.render("index", {
        events: result.rows,
        searchQuery,
        showLoadMore: result.rows.length === 10,
      });
    } catch (err) {
      console.error("Error fetching events:", err);
      res.status(500).send("Server error");
    }
  });

  return router;
}
