import { useCallback, useEffect, useMemo, useState } from "react";
import React from 'react';

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const today = () => new Date().toLocaleDateString("en-CA");
const thisMonth = () => today().slice(0, 7);

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error(`Cannot reach the backend at ${API}. Check that the Express server is running.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function StatCard({ label, value, note, icon }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{note}</small></article>;
}

function App() {
  const [page, setPage] = useState("Overview");
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [reportMonth, setReportMonth] = useState(thisMonth());
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [statusMap, setStatusMap] = useState({});
  const [studentForm, setStudentForm] = useState({ roll_number: "", full_name: "", class_id: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: "", text: "" });

  const notify = (type, text) => setNotice({ type, text });
  const loadBasics = useCallback(async () => {
    try {
      const [c, s, d] = await Promise.all([
        request("/classes"), request("/students"), request("/dashboard")
      ]);
      setClasses(c); setStudents(s); setDashboard(d);
      if (!classId && c.length) setClassId(String(c[0].id));
    } catch (e) { notify("error", e.message); }
  }, [classId]);

  const loadSubjects = useCallback(async () => {
    try {
      const data = await request(`/subjects${classId ? `?classId=${classId}` : ""}`);
      setSubjects(data);
      if (!data.some((s) => String(s.id) === subjectId)) setSubjectId(data[0] ? String(data[0].id) : "");
    } catch (e) { notify("error", e.message); }
  }, [classId, subjectId]);

  const loadAttendance = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (classId) params.set("classId", classId);
      if (subjectId) params.set("subjectId", subjectId);
      if (attendanceDate) params.set("date", attendanceDate);
      const data = await request(`/attendance?${params}`);
      setAttendanceRows(data);
      const map = {};
      data.forEach((row) => { map[row.student_id] = row.status; });
      setStatusMap((old) => ({ ...old, ...map }));
    } catch (e) { notify("error", e.message); }
  }, [classId, subjectId, attendanceDate]);

  const loadReports = useCallback(async () => {
    try {
      const params = new URLSearchParams({ month: reportMonth });
      if (classId) params.set("classId", classId);
      const data = await request(`/reports/monthly?${params}`);
      setReports(data.reports);
    } catch (e) { notify("error", e.message); }
  }, [classId, reportMonth]);

  useEffect(() => { loadBasics(); }, []); // initial load
  useEffect(() => { loadSubjects(); }, [classId]);
  useEffect(() => { if (classId && subjectId) loadAttendance(); }, [classId, subjectId, attendanceDate]);
  useEffect(() => { if (page === "Reports") loadReports(); }, [page, reportMonth, classId]);

  const filteredStudents = useMemo(() => students.filter((s) =>
    (!classId || String(s.class_id) === classId) &&
    `${s.full_name} ${s.roll_number}`.toLowerCase().includes(search.toLowerCase())
  ), [students, classId, search]);

  const selectedSubject = subjects.find((s) => String(s.id) === subjectId);
  const markedCount = filteredStudents.filter((s) => statusMap[s.id] === "present" || statusMap[s.id] === "absent").length;
  const presentCount = filteredStudents.filter((s) => statusMap[s.id] === "present").length;

  async function addStudent(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/students", { method: "POST", body: JSON.stringify({ ...studentForm, class_id: Number(studentForm.class_id || classId) }) });
      setStudentForm({ roll_number: "", full_name: "", class_id: "" });
      notify("success", "Student added successfully.");
      await loadBasics();
    } catch (e) { notify("error", e.message); }
    finally { setBusy(false); }
  }

  async function saveAttendance() {
    if (!classId || !subjectId) return notify("error", "Select a class and subject first.");
    const records = filteredStudents.map((s) => ({ student_id: s.id, status: statusMap[s.id] || "absent" }));
    if (!records.length) return notify("error", "There are no students in this class.");
    setBusy(true);
    try {
      const result = await request("/attendance/bulk", {
        method: "POST",
        body: JSON.stringify({ class_id: Number(classId), subject_id: Number(subjectId), attendance_date: attendanceDate, records })
      });
      notify("success", `${result.message} (${result.saved} students)`);
      await Promise.all([loadAttendance(), loadBasics()]);
    } catch (e) { notify("error", e.message); }
    finally { setBusy(false); }
  }

  const navItems = [
    ["Overview", "▦"], ["Students", "♙"], ["Take Attendance", "✓"], ["Attendance Records", "☷"], ["Reports", "▤"]
  ];

  function exportCsv() {
    const header = ["Roll Number", "Student", "Class", "Subject", "Month", "Total Classes", "Present", "Absent", "Attendance %"];
    const rows = reports.map((r) => [r.roll_number, r.full_name, r.class_name, r.subject_name, reportMonth, r.total_classes, r.present, r.absent, r.attendance_percentage]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `attendance-report-${reportMonth}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">A</div><div><b>AttendEase</b><small>STUDENT MANAGEMENT</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{navItems.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => { setPage(label); setNotice({ type: "", text: "" }); }}><span className="nav-symbol">{icon}</span>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="avatar">AD</div><div><b>Administrator</b><small>Attendance manager</small></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div><div className="eyebrow">ACADEMIC WORKSPACE / 2026–27</div><h1>{page}</h1></div><div className="top-actions"><span className="live-dot"></span><span>System online</span><div className="top-avatar">AD</div></div></header>
      <section className="content">
        {notice.text && <div className={`notice ${notice.type}`} role="status">{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}

        <div className="filters">
          <label>Class<select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {page !== "Students" && page !== "Overview" && <label>Subject<select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Select subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <div className="filter-date"><span>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span></div>
        </div>

        {page === "Overview" && <div className="page-stack">
          <div className="welcome"><div><span className="welcome-kicker">YOUR CLASSROOM AT A GLANCE</span><h2>Good work starts with showing up.</h2><p>Track attendance, manage student records, and review class performance in one place.</p><button className="primary-btn" onClick={() => setPage("Take Attendance")}>＋ Take attendance <span>→</span></button></div><div className="welcome-art"><div className="art-circle">✓</div><div className="art-card"><b>Today's focus</b><span>Consistency matters</span><div className="mini-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div></div>
          <div className="section-heading"><div><h3>Attendance overview</h3><p>Summary across all recorded classes</p></div><span className="period-pill">ALL TIME</span></div>
          <div className="stats-grid">
            <StatCard label="Total students" value={dashboard?.students ?? "—"} note="Registered in the system" icon="♙"/>
            <StatCard label="Total classes" value={dashboard?.classes ?? "—"} note="Class groups configured" icon="▦"/>
            <StatCard label="Overall attendance" value={`${dashboard?.overallAttendance ?? 0}%`} note="Present / all recorded entries" icon="%"/>
            <StatCard label="This month's attendance" value={`${dashboard?.monthlyAttendance ?? 0}%`} note="Current month performance" icon="◷"/>
          </div>
          <div className="two-col"><div className="panel"><div className="panel-heading"><div><h3>Quick actions</h3><p>Common tasks to get you moving</p></div></div><div className="quick-list"><button onClick={() => setPage("Students")}><span className="quick-icon purple">♙</span><span><b>Manage students</b><small>Add students or look up a roll number</small></span><span className="chevron">→</span></button><button onClick={() => setPage("Take Attendance")}><span className="quick-icon green">✓</span><span><b>Mark attendance</b><small>Record a class session</small></span><span className="chevron">→</span></button><button onClick={() => setPage("Reports")}><span className="quick-icon orange">▤</span><span><b>Monthly reports</b><small>Review percentages and export CSV</small></span><span className="chevron">→</span></button></div></div>
            <div className="panel"><div className="panel-heading"><div><h3>How attendance is calculated</h3><p>Simple and transparent</p></div></div><div className="formula"><span>Attendance percentage</span><strong>Present classes ÷ Total classes × 100</strong><p>Each student is calculated separately for each subject, based only on saved attendance records.</p></div><div className="integrity-note"><span>✓</span><p><b>Data integrity enabled</b><br/>A database constraint prevents duplicate entries for the same student, subject, and date.</p></div></div></div>
        </div>}

        {page === "Students" && <div className="page-stack">
          <div className="section-heading"><div><h3>Student directory</h3><p>Manage student records and class assignments</p></div><span className="count-pill">{students.length} students</span></div>
          <div className="panel form-panel"><div className="panel-heading"><div><h3>Add a student</h3><p>Roll numbers must be unique</p></div></div><form className="student-form" onSubmit={addStudent}><label>Roll number<input required value={studentForm.roll_number} onChange={(e) => setStudentForm({ ...studentForm, roll_number: e.target.value })} placeholder="e.g. 10A-005"/></label><label>Full name<input required value={studentForm.full_name} onChange={(e) => setStudentForm({ ...studentForm, full_name: e.target.value })} placeholder="Student full name"/></label><label>Class<select required value={studentForm.class_id || classId} onChange={(e) => setStudentForm({ ...studentForm, class_id: e.target.value })}><option value="">Choose class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="primary-btn" disabled={busy}>＋ Add student</button></form></div>
          <div className="panel"><div className="table-toolbar"><div><h3>All students</h3><p>Search by student name or roll number</p></div><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="⌕  Search students..."/></div><div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>ROLL NUMBER</th><th>CLASS</th><th>STATUS</th></tr></thead><tbody>{filteredStudents.map((s, i) => <tr key={s.id}><td><div className="student-cell"><span className={`student-avatar avatar-${i % 4}`}>{s.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span><b>{s.full_name}</b></div></td><td>{s.roll_number}</td><td>{s.class_name}</td><td><span className="status-badge active-status">Registered</span></td></tr>)}{!filteredStudents.length && <tr><td colSpan="4" className="empty">No students found for these filters.</td></tr>}</tbody></table></div></div>
        </div>}

        {page === "Take Attendance" && <div className="page-stack">
          <div className="section-heading"><div><h3>Class register</h3><p>Choose a class, subject, and date, then mark each student</p></div><label className="inline-date">Session date<input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)}/></label></div>
          {!selectedSubject && <div className="notice info">Choose a class with at least one configured subject to take attendance.</div>}
          <div className="attendance-summary"><div><span>Students in class</span><strong>{filteredStudents.length}</strong></div><div><span>Marked present</span><strong className="green-text">{presentCount}</strong></div><div><span>Marked / total</span><strong>{markedCount} / {filteredStudents.length}</strong></div><div><span>Attendance rate</span><strong>{filteredStudents.length ? Math.round(100 * presentCount / filteredStudents.length) : 0}%</strong></div></div>
          <div className="panel"><div className="table-toolbar"><div><h3>Mark student status</h3><p>Unmarked students will be saved as absent when you submit.</p></div><div className="legend"><span><i className="legend-dot present-dot"></i>Present</span><span><i className="legend-dot absent-dot"></i>Absent</span></div></div><div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>ROLL NUMBER</th><th>ATTENDANCE STATUS</th></tr></thead><tbody>{filteredStudents.map((s, i) => <tr key={s.id}><td><div className="student-cell"><span className={`student-avatar avatar-${i % 4}`}>{s.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span><b>{s.full_name}</b></div></td><td>{s.roll_number}</td><td><div className="status-toggle"><button className={statusMap[s.id] === "present" ? "chosen present-choice" : ""} onClick={() => setStatusMap({ ...statusMap, [s.id]: "present" })}>✓ Present</button><button className={statusMap[s.id] === "absent" ? "chosen absent-choice" : ""} onClick={() => setStatusMap({ ...statusMap, [s.id]: "absent" })}>× Absent</button></div></td></tr>)}{!filteredStudents.length && <tr><td colSpan="3" className="empty">No students in this class yet. Add students first.</td></tr>}</tbody></table></div><div className="table-footer"><span>Saving again updates the existing session; it won't create duplicates.</span><button className="primary-btn" onClick={saveAttendance} disabled={busy || !selectedSubject || !filteredStudents.length}>{busy ? "Saving..." : "Save attendance →"}</button></div></div>
        </div>}

        {page === "Attendance Records" && <div className="page-stack"><div className="section-heading"><div><h3>Attendance records</h3><p>Saved attendance entries for the selected date and filters</p></div><label className="inline-date">Date<input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)}/></label></div><div className="panel"><div className="table-toolbar"><div><h3>Recorded entries</h3><p>{attendanceRows.length} entries returned (up to 1,000)</p></div><button className="secondary-btn" onClick={loadAttendance}>↻ Refresh</button></div><div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>CLASS</th><th>SUBJECT</th><th>DATE</th><th>STATUS</th></tr></thead><tbody>{attendanceRows.map((r) => <tr key={r.id}><td><div className="student-cell"><span className="student-avatar">{r.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span><b>{r.full_name}</b></div></td><td>{r.class_name}</td><td>{r.subject_name}</td><td>{String(r.attendance_date).slice(0, 10)}</td><td><span className={`status-badge ${r.status === "present" ? "present-badge" : "absent-badge"}`}>{r.status}</span></td></tr>)}{!attendanceRows.length && <tr><td colSpan="5" className="empty">No records match these filters yet.</td></tr>}</tbody></table></div></div></div>}

        {page === "Reports" && <div className="page-stack"><div className="section-heading"><div><h3>Monthly attendance report</h3><p>Attendance percentage for each student and subject</p></div><label className="inline-date">Report month<input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}/></label></div><div className="report-summary"><div><span>Student-subject records</span><strong>{reports.length}</strong></div><div><span>Average attendance</span><strong>{reports.length ? (reports.reduce((n, r) => n + Number(r.attendance_percentage), 0) / reports.length).toFixed(1) : "0.0"}%</strong></div><div><span>Below 75%</span><strong className="orange-text">{reports.filter((r) => r.total_classes > 0 && Number(r.attendance_percentage) < 75).length}</strong></div></div><div className="panel"><div className="table-toolbar"><div><h3>Monthly breakdown</h3><p>Only saved attendance records are counted</p></div><button className="primary-btn" onClick={exportCsv} disabled={!reports.length}>↓ Export CSV</button></div><div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>SUBJECT</th><th>CLASSES</th><th>PRESENT</th><th>ABSENT</th><th>ATTENDANCE</th></tr></thead><tbody>{reports.map((r) => <tr key={`${r.student_id}-${r.subject_name}`}><td><div className="student-cell"><span className="student-avatar">{r.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span><div><b>{r.full_name}</b><small className="subline">{r.roll_number} · {r.class_name}</small></div></div></td><td>{r.subject_name}</td><td>{r.total_classes}</td><td className="green-text">{r.present}</td><td className="orange-text">{r.absent}</td><td><div className="percent-cell"><div className="progress-track"><span style={{ width: `${Math.min(100, Number(r.attendance_percentage))}%` }}></span></div><b>{r.attendance_percentage}%</b></div></td></tr>)}{!reports.length && <tr><td colSpan="6" className="empty">No report data available for this month and class.</td></tr>}</tbody></table></div></div></div>}
        <footer className="footer">AttendEase <span>•</span> Student Attendance Management <span>•</span> Built with React, Express & PostgreSQL</footer>
      </section>
    </main>
  </div>;
}

export default App;
