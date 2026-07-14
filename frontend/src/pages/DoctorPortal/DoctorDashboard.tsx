import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, Calendar, Clock, Plus, FileText, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { apiFetch } from '../../services/api';

type Appointment = {
  id: string;
  status: string;
  symptoms: string;
  patient_id: string;
  slots: { slot_date: string; start_time: string; end_time: string };
  patients: { full_name: string; phone?: string };
  pre_visit_summaries?: { urgency_level: string; chief_complaint: string; suggested_questions: string[] }[];
  post_visit_summaries?: { id: string }[];
};

type View = 'dashboard' | 'appointments' | 'slots' | 'profile';

export default function DoctorDashboard() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>('dashboard');

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptLoading, setApptLoading] = useState(false);
  const [expandedAppt, setExpandedAppt] = useState<string | null>(null);

  // Post-visit notes
  const [notesInput, setNotesInput] = useState<Record<string, string>>({});
  const [notesMessage, setNotesMessage] = useState<Record<string, string>>({});

  // Slot Generation
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [slotMessage, setSlotMessage] = useState('');
  const [slotError, setSlotError] = useState('');
  const [slotLoading, setSlotLoading] = useState(false);

  // Profile / Working Hours
  const [profileMessage, setProfileMessage] = useState('');
  const [slotDuration, setSlotDuration] = useState(15);
  const [workingHours, setWorkingHours] = useState({
    mon: '09:00-17:00', tue: '09:00-17:00', wed: '09:00-17:00',
    thu: '09:00-17:00', fri: '09:00-17:00', sat: '', sun: ''
  });

  const handleConnectCalendar = async () => {
    try {
      const data = await apiFetch('/auth/google/url');
      if (data.url) window.location.href = data.url;
    } catch (e) {
      alert('Failed to initiate Google Calendar connection.');
    }
  };

  const fetchAppointments = async () => {
    setApptLoading(true);
    try {
      const { data } = await apiFetch('/doctor/appointments');
      setAppointments(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setApptLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'appointments' || view === 'dashboard') fetchAppointments();
  }, [view]);

  const submitNotes = async (appointmentId: string) => {
    try {
      await apiFetch(`/doctor/appointments/${appointmentId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ notes: notesInput[appointmentId] }),
      });
      setNotesMessage(prev => ({ ...prev, [appointmentId]: '✅ Notes saved successfully!' }));
      fetchAppointments();
    } catch (e: any) {
      setNotesMessage(prev => ({ ...prev, [appointmentId]: `❌ ${e.message}` }));
    }
  };

  const generateSlots = async () => {
    if (!slotStart || !slotEnd) return;
    setSlotLoading(true);
    setSlotMessage('');
    setSlotError('');
    try {
      await apiFetch('/doctor/slots', {
        method: 'POST',
        body: JSON.stringify({ start_date: slotStart, end_date: slotEnd }),
      });
      setSlotMessage(`✅ Slots generated from ${slotStart} to ${slotEnd}!`);
    } catch (e: any) {
      setSlotError(e.message || 'Failed to generate slots');
    } finally {
      setSlotLoading(false);
    }
  };

  const saveProfile = async () => {
    setProfileMessage('');
    try {
      const parsedHours: Record<string, string[][]> = {};
      Object.entries(workingHours).forEach(([day, val]) => {
        if (val.trim()) {
          const [start, end] = val.split('-');
          parsedHours[day] = [[start.trim(), end.trim()]];
        }
      });
      await apiFetch('/doctor/profile', {
        method: 'PUT',
        body: JSON.stringify({ slot_duration_mins: slotDuration, working_hours: parsedHours }),
      });
      setProfileMessage('✅ Profile updated successfully!');
    } catch (e: any) {
      setProfileMessage(`❌ ${e.message}`);
    }
  };

  const formatTime = (t: string) => t?.slice(0, 5);
  const today = new Date().toISOString().split('T')[0];
  const todayAppts = appointments.filter(a => a.slots?.slot_date === today && a.status === 'scheduled');
  const pendingNotes = appointments.filter(a => a.status === 'scheduled' && (!a.post_visit_summaries || a.post_visit_summaries.length === 0));

  const urgencyColor = (level: string) => {
    if (level === 'High') return 'badge-danger';
    if (level === 'Medium') return 'badge-warning';
    return 'badge-success';
  };

  return (
    <div>
      <nav className="navbar">
        <div className="container flex-between">
          <div className="nav-brand">Doctor Portal</div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button className={`btn ${view === 'appointments' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.8rem' }} onClick={() => setView('appointments')}>
              <FileText size={14} /> Appointments
            </button>
            <button className={`btn ${view === 'slots' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.8rem' }} onClick={() => setView('slots')}>
              <Plus size={14} /> Manage Slots
            </button>
            <button className={`btn ${view === 'profile' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.8rem' }} onClick={() => setView('profile')}>
              <Clock size={14} /> Profile
            </button>
            <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleConnectCalendar}>
              <Calendar size={14} /> Google Calendar
            </button>
            <button className="btn btn-outline" onClick={signOut}><LogOut size={16} /> Sign Out</button>
          </div>
        </div>
      </nav>

      <div className="container mt-4">

        {/* DASHBOARD VIEW */}
        {view === 'dashboard' && (
          <>
            <div className="card mb-4">
              <h2 className="mb-2">Dr. {user?.user_metadata?.full_name || 'Doctor'}</h2>
              <p className="text-muted">Manage your schedule and appointments</p>
            </div>

            <div className="grid-cols-2">
              <div className="card">
                <h3 className="mb-3">Today's Schedule ({todayAppts.length})</h3>
                {apptLoading && <p className="text-muted">Loading...</p>}
                {!apptLoading && todayAppts.length === 0 && (
                  <p className="text-muted">No appointments scheduled for today.</p>
                )}
                {todayAppts.map(appt => (
                  <div key={appt.id} style={{ padding: '0.75rem', borderLeft: '3px solid var(--color-primary)', marginBottom: '0.75rem', background: 'var(--color-surface)' }}>
                    <p style={{ fontWeight: 600 }}>{appt.patients?.full_name}</p>
                    <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {formatTime(appt.slots?.start_time)} – {formatTime(appt.slots?.end_time)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 className="mb-3">Pending Notes ({pendingNotes.length})</h3>
                {pendingNotes.length === 0 && <p className="text-muted">All post-visit notes are complete. ✅</p>}
                {pendingNotes.slice(0, 3).map(appt => (
                  <div key={appt.id} style={{ padding: '0.75rem', borderLeft: '3px solid #f59e0b', marginBottom: '0.75rem', background: 'var(--color-surface)' }}>
                    <p style={{ fontWeight: 600 }}>{appt.patients?.full_name}</p>
                    <p className="text-muted" style={{ fontSize: '0.8rem' }}>{appt.slots?.slot_date}</p>
                  </div>
                ))}
                {pendingNotes.length > 0 && (
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={() => setView('appointments')}>
                    View All →
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* APPOINTMENTS VIEW */}
        {view === 'appointments' && (
          <div className="card">
            <div className="flex-between mb-4">
              <h2>All Appointments</h2>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}>← Back</button>
            </div>

            {apptLoading && <p className="text-muted">Loading...</p>}
            {!apptLoading && appointments.length === 0 && <p className="text-muted">No appointments found.</p>}

            {appointments.map(appt => {
              const pvs = appt.pre_visit_summaries?.[0];
              const isExpanded = expandedAppt === appt.id;
              return (
                <div key={appt.id} className="card mb-4" style={{ padding: '1rem' }}>
                  <div className="flex-between" style={{ cursor: 'pointer' }} onClick={() => setExpandedAppt(isExpanded ? null : appt.id)}>
                    <div>
                      <h4 className="mb-1">
                        {appt.patients?.full_name}
                        <span className={`badge ${appt.status === 'scheduled' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: '0.5rem' }}>
                          {appt.status}
                        </span>
                        {pvs && (
                          <span className={`badge ${urgencyColor(pvs.urgency_level)}`} style={{ marginLeft: '0.5rem' }}>
                            {pvs.urgency_level} Urgency
                          </span>
                        )}
                      </h4>
                      <p className="text-muted" style={{ fontSize: '0.875rem' }}>
                        📅 {appt.slots?.slot_date} · {formatTime(appt.slots?.start_time)} – {formatTime(appt.slots?.end_time)}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                      {appt.symptoms && (
                        <div style={{ marginBottom: '1rem' }}>
                          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Patient Symptoms:</p>
                          <p className="text-muted" style={{ fontSize: '0.875rem' }}>{appt.symptoms}</p>
                        </div>
                      )}

                      {pvs && (
                        <div style={{ background: 'var(--color-surface)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem' }}>
                          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>🤖 AI Pre-Visit Summary</p>
                          <p style={{ fontSize: '0.875rem' }}><strong>Chief Complaint:</strong> {pvs.chief_complaint}</p>
                          {pvs.suggested_questions?.length > 0 && (
                            <>
                              <p style={{ fontWeight: 600, marginTop: '0.5rem', fontSize: '0.875rem' }}>Suggested Questions:</p>
                              <ul style={{ margin: '0.25rem 0 0 1rem', fontSize: '0.875rem' }}>
                                {pvs.suggested_questions.map((q, i) => <li key={i}>{q}</li>)}
                              </ul>
                            </>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="form-label">Post-Visit Notes & Prescription</label>
                        <textarea
                          className="form-input"
                          rows={3}
                          placeholder="Enter diagnosis, prescription, follow-up instructions..."
                          value={notesInput[appt.id] || ''}
                          onChange={e => setNotesInput(prev => ({ ...prev, [appt.id]: e.target.value }))}
                          style={{ resize: 'vertical' }}
                        />
                        {notesMessage[appt.id] && (
                          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{notesMessage[appt.id]}</p>
                        )}
                        <button
                          className="btn btn-primary"
                          style={{ marginTop: '0.5rem' }}
                          onClick={() => submitNotes(appt.id)}
                          disabled={!notesInput[appt.id]}
                        >
                          <Save size={16} /> Save Notes
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* SLOT GENERATION VIEW */}
        {view === 'slots' && (
          <div className="card">
            <div className="flex-between mb-4">
              <h2>Generate Availability Slots</h2>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}>← Back</button>
            </div>
            <p className="text-muted mb-4">Slots will be auto-generated based on your working hours and slot duration set in your Profile.</p>

            {slotMessage && <div className="badge badge-success mb-4" style={{ display: 'block' }}>{slotMessage}</div>}
            {slotError && <div className="badge badge-danger mb-4" style={{ display: 'block' }}>{slotError}</div>}

            <div className="grid-cols-2" style={{ marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input type="date" className="form-input" value={slotStart} min={today} onChange={e => setSlotStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input type="date" className="form-input" value={slotEnd} min={slotStart || today} onChange={e => setSlotEnd(e.target.value)} />
              </div>
            </div>

            <button className="btn btn-primary" onClick={generateSlots} disabled={!slotStart || !slotEnd || slotLoading}>
              {slotLoading ? 'Generating...' : <><Plus size={16} /> Generate Slots</>}
            </button>
          </div>
        )}

        {/* PROFILE VIEW */}
        {view === 'profile' && (
          <div className="card">
            <div className="flex-between mb-4">
              <h2>Profile & Working Hours</h2>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}>← Back</button>
            </div>

            {profileMessage && <div className={`badge ${profileMessage.startsWith('✅') ? 'badge-success' : 'badge-danger'} mb-4`} style={{ display: 'block' }}>{profileMessage}</div>}

            <div className="form-group">
              <label className="form-label">Slot Duration (minutes)</label>
              <input type="number" className="form-input" value={slotDuration} min={5} max={60} step={5}
                onChange={e => setSlotDuration(Number(e.target.value))} style={{ maxWidth: '150px' }} />
            </div>

            <h4 className="mb-3 mt-4">Working Hours (format: HH:MM-HH:MM, leave blank for day off)</h4>
            {Object.entries(workingHours).map(([day, val]) => (
              <div key={day} className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label className="form-label" style={{ width: '50px', textTransform: 'capitalize', margin: 0 }}>{day}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="09:00-17:00"
                  value={val}
                  onChange={e => setWorkingHours(prev => ({ ...prev, [day]: e.target.value }))}
                  style={{ maxWidth: '200px' }}
                />
              </div>
            ))}

            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={saveProfile}>
              <Save size={16} /> Save Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
