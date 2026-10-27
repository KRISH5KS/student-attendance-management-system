import { pool } from "./db.js";

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const classes = ["Class 10-A", "Class 10-B"];
    for (const name of classes) {
      await client.query(
        "INSERT INTO classrooms(name) VALUES($1) ON CONFLICT(name) DO NOTHING",
        [name]
      );
    }

    const classRows = (await client.query(
      "SELECT id, name FROM classrooms WHERE name = ANY($1::varchar[])",
      [classes]
    )).rows;
    const classA = classRows.find((c) => c.name === "Class 10-A");
    const classB = classRows.find((c) => c.name === "Class 10-B");

    for (const [classId, subjectNames] of [
      [classA.id, ["Mathematics", "Science", "English"]],
      [classB.id, ["Mathematics", "Science", "English"]]
    ]) {
      for (const name of subjectNames) {
        await client.query(
          "INSERT INTO subjects(name, class_id) VALUES($1, $2) ON CONFLICT(name, class_id) DO NOTHING",
          [name, classId]
        );
      }
    }

    const students = [
      ["10A-001", "Aarav Sharma", classA.id],
      ["10A-002", "Ananya Verma", classA.id],
      ["10A-003", "Rohan Singh", classA.id],
      ["10A-004", "Priya Gupta", classA.id],
      ["10B-001", "Kabir Mishra", classB.id],
      ["10B-002", "Meera Patel", classB.id]
    ];
    for (const student of students) {
      await client.query(
        "INSERT INTO students(roll_number, full_name, class_id) VALUES($1, $2, $3) ON CONFLICT(roll_number) DO NOTHING",
        student
      );
    }
    await client.query("COMMIT");
    console.log("Sample classes, subjects, and students inserted.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
