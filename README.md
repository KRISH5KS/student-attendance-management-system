# AttendEase — Student Attendance Management System

A full-stack attendance manager built with React, JavaScript, Node.js, Express.js, and PostgreSQL.

## Features

- Dashboard with student/class counts and overall/current-month attendance percentages.
- Student directory, search, and add-student form.
- Class- and subject-wise attendance marking for a date.
- Attendance records filtered by class, subject, and date.
- Monthly reports with per-student/per-subject attendance percentages.
- CSV report export.
- PostgreSQL foreign keys, `CHECK` constraints, unique roll numbers, and a unique attendance constraint.
- Bulk attendance saves run in a database transaction. Re-submitting a session updates existing records instead of creating duplicates.
- Parameterized SQL queries to avoid SQL injection.

## Requirements

- Node.js 18 or later
- PostgreSQL 14 or later
- npm

## 1. Create the database

Start PostgreSQL, then create a database named `attendance_db`.

Using `psql`:
```sql
CREATE DATABASE attendance_db;
```

Or create it using pgAdmin.

## 2. Configure the backend

From the project root:

```bash
cd server
```

Copy `.env.example` to `.env`, then update the PostgreSQL username/password in `DATABASE_URL`.

Example:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/attendance_db
CLIENT_ORIGIN=http://localhost:5173
DATABASE_SSL=false
```

Do not commit `.env` to Git.

Initialize tables and insert sample data:

```bash
npm install
npm run db:init
npm run db:seed
```

The seed script creates two sample classes, three subjects per class, and sample students. It can safely be run again.

## 3. Install and run

Open a terminal at the project root:

```bash
npm install
npm run install:all
npm run dev
```

Open the Vite URL printed in the terminal, normally:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:5000/api/health

If you prefer separate terminals:
```bash
cd server
npm run dev
```
and:
```bash
cd client
npm run dev
```

## REST API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check API and database |
| GET | `/api/dashboard` | Dashboard statistics |
| GET | `/api/classes` | List classes |
| GET | `/api/subjects?classId=1` | List subjects |
| GET | `/api/students?classId=1&search=aarav` | List/search students |
| POST | `/api/students` | Add a student |
| GET | `/api/attendance?classId=1&subjectId=1&date=2026-10-11` | Filter attendance records |
| POST | `/api/attendance/bulk` | Save one class/subject/date register |
| GET | `/api/reports/monthly?month=2026-10&classId=1` | Monthly per-subject report |

### Add student request
```json
{
  "roll_number": "10A-005",
  "full_name": "Ishita Sharma",
  "class_id": 1
}
```

### Save attendance request
```json
{
  "class_id": 1,
  "subject_id": 1,
  "attendance_date": "2026-10-11",
  "records": [
    { "student_id": 1, "status": "present" },
    { "student_id": 2, "status": "absent" }
  ]
}
```

### Attendance percentage
`present attendance records / all recorded attendance records × 100`

A student with no attendance records for a subject/month has 0% for that report. Unmarked students are saved as absent when the attendance form is submitted.

## Database relationships

- `classrooms` 1 → many `students`
- `classrooms` 1 → many `subjects`
- `students` 1 → many `attendance` rows
- `subjects` 1 → many `attendance` rows

The unique constraint on `(student_id, subject_id, attendance_date)` ensures a student cannot have duplicate attendance for the same subject on the same date. `ON CONFLICT` updates the saved status if the register is submitted again.

## Troubleshooting

- **Cannot reach backend / failed to fetch:** ensure the server is running on port 5000 and the browser frontend is on port 5173.
- **Database connection error:** verify PostgreSQL is running, the database exists, and `DATABASE_URL` credentials are correct.
- **CORS error:** set `CLIENT_ORIGIN` to the exact frontend origin shown by Vite.
- **No subjects available:** run `npm run db:seed` from `server` to insert sample classes and subjects.
- **Port already in use:** change `PORT` in `server/.env`, and set `VITE_API_URL` in `client/.env` to `http://localhost:YOUR_PORT/api`.

## Before using with real student data

This is an educational portfolio project, not a production-ready school system. Add authentication and role-based authorization, audit logs, backups, stricter date validation, pagination, and appropriate privacy controls before storing real student records. Configure HTTPS and database access controls for deployment.
