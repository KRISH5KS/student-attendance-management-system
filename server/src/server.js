import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/classes", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, COUNT(s.id)::int AS student_count
      FROM classrooms c LEFT JOIN students s ON s.class_id = c.id
      GROUP BY c.id ORDER BY c.name
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/subjects", async (req, res, next) => {
  try {
    const values = [];
    let where = "";
    if (req.query.classId) {
      const classId = Number(req.query.classId);
      if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: "Invalid classId." });
      values.push(classId);
      where = "WHERE class_id = $1";
    }
    const { rows } = await pool.query(`SELECT id, name, class_id FROM subjects ${where} ORDER BY name`, values);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/students", async (req, res, next) => {
  try {
    const values = [];
    const conditions = [];
    if (req.query.classId) {
      const classId = Number(req.query.classId);
      if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: "Invalid classId." });
      values.push(classId);
      conditions.push(`s.class_id = $${values.length}`);
    }
    if (req.query.search) {
      values.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`(s.full_name ILIKE $${values.length} OR s.roll_number ILIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(`
      SELECT s.id, s.roll_number, s.full_name, s.class_id, c.name AS class_name
      FROM students s JOIN classrooms c ON c.id = s.class_id
      ${where}
      ORDER BY c.name, s.roll_number
    `, values);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/students", async (req, res, next) => {
  try {
    const roll = String(req.body.roll_number || "").trim();
    const name = String(req.body.full_name || "").trim();
    const classId = Number(req.body.class_id);
    if (!roll || !name || !Number.isInteger(classId) || classId < 1) {
      return res.status(400).json({ error: "roll_number, full_name, and a valid class_id are required." });
    }
    const { rows } = await pool.query(`
      INSERT INTO students(roll_number, full_name, class_id)
      VALUES($1, $2, $3)
      RETURNING id, roll_number, full_name, class_id
    `, [roll, name, classId]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That roll number already exists." });
    if (e.code === "23503") return res.status(400).json({ error: "Selected class does not exist." });
    next(e);
  }
});

app.get("/api/attendance", async (req, res, next) => {
  try {
    const values = [];
    const conditions = [];
    const add = (sql, value) => { values.push(value); conditions.push(sql.replace("?", `$${values.length}`)); };

    if (req.query.classId) {
      const id = Number(req.query.classId);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid classId." });
      add("a.class_id = ?", id);
    }
    if (req.query.subjectId) {
      const id = Number(req.query.subjectId);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid subjectId." });
      add("a.subject_id = ?", id);
    }
    if (req.query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date))) return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
      add("a.attendance_date = ?::date", req.query.date);
    }
    if (req.query.month) {
      if (!/^\\d{4}-\\d{2}$/.test(String(req.query.month))) return res.status(400).json({ error: "Month must be YYYY-MM." });
      add("to_char(a.attendance_date, 'YYYY-MM') = ?", req.query.month);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(`
      SELECT a.id, a.student_id, s.roll_number, s.full_name, a.class_id,
             c.name AS class_name, a.subject_id, sub.name AS subject_name,
             a.attendance_date, a.status
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      JOIN classrooms c ON c.id = a.class_id
      JOIN subjects sub ON sub.id = a.subject_id
      ${where}
      ORDER BY a.attendance_date DESC, c.name, sub.name, s.roll_number
      LIMIT 1000
    `, values);
    res.json(rows);
  } catch (e) { next(e); }
});

// One request records an entire class/subject/date session. Existing rows are updated,
// so re-submitting a register never creates duplicate attendance records.
app.post("/api/attendance/bulk", async (req, res, next) => {
  console.log("BULK ATTENDANCE BODY:", req.body);
  const { class_id, subject_id, attendance_date, records } = req.body || {};
  const classId = Number(class_id);
  const subjectId = Number(subject_id);
  console.log("VALIDATION CHECK:", {
  classId,
  subjectId,
  attendance_date,
  dateIsValid: /^\d{4}-\d{2}-\d{2}$/.test(String(attendance_date || "")),
  recordsIsArray: Array.isArray(records),
  recordsLength: Array.isArray(records) ? records.length : "not an array",
});
  if (!Number.isInteger(classId) || classId < 1 ||
      !Number.isInteger(subjectId) || subjectId < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(attendance_date || "")) ||
      !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: "class_id, subject_id, attendance_date, and non-empty records are required." });
  }
  const seen = new Set();
  for (const r of records) {
    const id = Number(r.student_id);
    if (!Number.isInteger(id) || id < 1 || !["present", "absent"].includes(r.status) || seen.has(id)) {
      return res.status(400).json({ error: "Each student must appear once with status present or absent." });
    }
    seen.add(id);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subject = await client.query(
      "SELECT id FROM subjects WHERE id = $1 AND class_id = $2",
      [subjectId, classId]
    );
    if (!subject.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Subject does not belong to the selected class." });
    }

    const studentIds = [...seen];
    const studentCheck = await client.query(
      "SELECT id FROM students WHERE class_id = $1 AND id = ANY($2::int[])",
      [classId, studentIds]
    );
    if (studentCheck.rowCount !== studentIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "One or more students do not belong to the selected class." });
    }

    for (const r of records) {
      await client.query(`
        INSERT INTO attendance(student_id, subject_id, class_id, attendance_date, status)
        VALUES($1, $2, $3, $4::date, $5)
        ON CONFLICT(student_id, subject_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status, class_id = EXCLUDED.class_id
      `, [Number(r.student_id), subjectId, classId, attendance_date, r.status]);
    }
    await client.query("COMMIT");
    res.json({ message: "Attendance saved successfully.", saved: records.length });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.get("/api/reports/monthly", async (req, res, next) => {
  try {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    if (!/^\\d{4}-\\d{2}$/.test(month)) return res.status(400).json({ error: "month must be YYYY-MM." });
    const values = [month];
    let classFilter = "";
    if (req.query.classId) {
      const classId = Number(req.query.classId);
      if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: "Invalid classId." });
      values.push(classId);
      classFilter = `AND s.class_id = $${values.length}`;
    }
    const { rows } = await pool.query(`
      SELECT s.id AS student_id, s.roll_number, s.full_name, c.name AS class_name,
             sub.name AS subject_name,
             COUNT(a.id)::int AS total_classes,
             COUNT(a.id) FILTER (WHERE a.status = 'present')::int AS present,
             COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
             CASE WHEN COUNT(a.id) = 0 THEN 0
                  ELSE ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.status = 'present') / COUNT(a.id), 2)
             END AS attendance_percentage
      FROM students s
      JOIN classrooms c ON c.id = s.class_id
      JOIN subjects sub ON sub.class_id = s.class_id
      LEFT JOIN attendance a
        ON a.student_id = s.id AND a.subject_id = sub.id
        AND to_char(a.attendance_date, 'YYYY-MM') = $1
      WHERE 1=1 ${classFilter}
      GROUP BY s.id, s.roll_number, s.full_name, c.name, sub.id, sub.name
      ORDER BY c.name, s.roll_number, sub.name
    `, values);
    res.json({ month, reports: rows });
  } catch (e) { next(e); }
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [students, classes, attendance, monthly] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM students"),
      pool.query("SELECT COUNT(*)::int AS count FROM classrooms"),
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'present')::int AS present
        FROM attendance
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'present')::int AS present
        FROM attendance
        WHERE date_trunc('month', attendance_date) = date_trunc('month', CURRENT_DATE)
      `)
    ]);
    const a = attendance.rows[0], m = monthly.rows[0];
    res.json({
      students: students.rows[0].count,
      classes: classes.rows[0].count,
      overallAttendance: a.total ? Number((100 * a.present / a.total).toFixed(2)) : 0,
      monthlyAttendance: m.total ? Number((100 * m.present / m.total).toFixed(2)) : 0,
      recordedSessions: a.total
    });
  } catch (e) { next(e); }
});

app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error. Check the backend terminal for details." });
});

app.listen(PORT, () => console.log(`Attendance API running at http://localhost:${PORT}`));
