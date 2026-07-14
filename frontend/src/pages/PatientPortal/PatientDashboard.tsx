import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, Search, Calendar, Clock, User, ChevronRight, X } from 'lucide-react';
import { apiFetch } from '../../services/api';

type Doctor = {
  user_id: string;
  full_name: string;
  specialisation: string;
  phone: string;
  slot_duration_mins: number;
};

type Slot = {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  status: string;
};

type Appointment = {
  id: string;
  status: string;
  symptoms: string;
  doctors: { full_name: string; specialisation: string };
  slots: { slot_date: string; start_time: string; end_time: string };
};

type View = 'dashboard' | 'search' | 'slots' | 'appointments';

export default function PatientDashboard() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>('dashboard');

  // Doctor Search State
  const [specialisation, setSpecialisation] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Slot Selection State
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [slotDate, setSlotDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingError, setBookingError] = useState('');

  // Appointments State
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptLoading, setApptLoading] = useState(false);

  const searchDoctors = async () => {
    setSearchLoading(true);
    setSearchError('');
    try {
      const endpoint = specialisation
        ? `/patient/doctors?specialisation=${encodeURIComponent(specialisation)}`
        : '/patient/doctors';
      const { data } = await apiFetch(endpoint);
      setDoctors(data || []);
      if ((data || []).length === 0) setSearchError('No approved doctors found.');
    } catch (e: any) {
      setSearchError(e.message || 'Failed to fetch doctors');
    } finally {
      setSearchLoading(false);
    }
  };

  const fetchSlots = async () => {
    if (!selectedDoctor || !slotDate) return;
    setSlotsLoading(true);
    setBookingMessage('');
    setBookingError('');
    try {
      const { data } = await apiFetch(`/patient/doctors/${selectedDoctor.user_id}/slots?date=${slotDate}`);
      setSlots(data || []);
    } catch (e: any) {
      setBookingError(e.message || 'Failed to fetch slots');
    } finally {
      setSlotsLoading(false);
    }
  };

  const bookSlot = async (slot: Slot) => {
    setBookingMessage('');
    setBookingError('');
    try {
      await apiFetch('/patient/appointments/book', {
        method: 'POST',
        body: JSON.stringify({ slot_id: slot.id, doctor_id: selectedDoctor?.user_id }),
      });
      setBookingMessage('✅ Appointment booked successfully! Check your email for confirmation.');
      fetchSlots();
    } catch (e: any) {
      setBookingError(e.message || 'Failed to book appointment');
    }
  };

  const fetchAppointments = async () => {
    setApptLoading(true);
    try {
      const { data } = await apiFetch('/patient/appointments');
      setAppointments(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setApptLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'appointments') fetchAppointments();
  }, [view]);

  const formatTime = (t: string) => t?.slice(0, 5);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div>
      <nav className="navbar">
        <div className="container flex-between">
          <div className="nav-brand">Healthcare Portal</div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className={`btn ${view === 'appointments' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem' }}
              onClick={() => setView('appointments')}
            >
              <Calendar size={14} /> My Appointments
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
              <h2 className="mb-2">Welcome, {user?.user_metadata?.full_name || 'Patient'}</h2>
              <p className="text-muted">Your health dashboard</p>
            </div>
            <div className="grid-cols-2">
              <div className="card">
                <h3>Find a Doctor</h3>
                <p className="text-muted mb-4 mt-2">Search our network of specialists and book an appointment.</p>
                <button className="btn btn-primary" onClick={() => setView('search')}>
                  <Search size={16} /> Search Doctors
                </button>
              </div>
              <div className="card">
                <h3>Upcoming Appointments</h3>
                <p className="text-muted mb-4 mt-2">View and manage your scheduled visits.</p>
                <button className="btn btn-secondary" onClick={() => setView('appointments')}>
                  <Calendar size={16} /> View Appointments
                </button>
              </div>
            </div>
          </>
        )}

        {/* DOCTOR SEARCH VIEW */}
        {view === 'search' && (
          <div className="card">
            <div className="flex-between mb-4">
              <h2>Find a Doctor</h2>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}><X size={16} /> Back</button>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Filter by specialisation (e.g. Cardiologist)..."
                value={specialisation}
                onChange={e => setSpecialisation(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchDoctors()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={searchDoctors} disabled={searchLoading}>
                {searchLoading ? 'Searching...' : <><Search size={16} /> Search</>}
              </button>
            </div>

            {searchError && <p className="text-muted">{searchError}</p>}

            {doctors.map(doc => (
              <div key={doc.user_id} className="card flex-between mb-4" style={{ padding: '1rem' }}>
                <div>
                  <h4 className="mb-1"><User size={16} style={{ display: 'inline', marginRight: '0.4rem' }} />{doc.full_name}</h4>
                  <p className="text-muted" style={{ fontSize: '0.875rem' }}>{doc.specialisation} · {doc.slot_duration_mins}-min slots</p>
                  {doc.phone && <p className="text-muted" style={{ fontSize: '0.875rem' }}>📞 {doc.phone}</p>}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => { setSelectedDoctor(doc); setView('slots'); }}
                >
                  Book <ChevronRight size={16} />
                </button>
              </div>
            ))}

            {doctors.length === 0 && !searchLoading && !searchError && (
              <p className="text-muted">Click Search to browse available doctors.</p>
            )}
          </div>
        )}

        {/* SLOT BOOKING VIEW */}
        {view === 'slots' && selectedDoctor && (
          <div className="card">
            <div className="flex-between mb-4">
              <div>
                <h2>{selectedDoctor.full_name}</h2>
                <p className="text-muted">{selectedDoctor.specialisation}</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setView('search')}><X size={16} /> Back</button>
            </div>

            {bookingMessage && (
              <div className="badge badge-success mb-4" style={{ display: 'block' }}>{bookingMessage}</div>
            )}
            {bookingError && (
              <div className="badge badge-danger mb-4" style={{ display: 'block' }}>{bookingError}</div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label className="form-label">Select Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={slotDate}
                  min={today}
                  onChange={e => setSlotDate(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" onClick={fetchSlots} disabled={!slotDate || slotsLoading}>
                {slotsLoading ? 'Loading...' : <><Clock size={16} /> Show Slots</>}
              </button>
            </div>

            {slots.length === 0 && !slotsLoading && slotDate && (
              <p className="text-muted">No available slots for this date. Try another date.</p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
              {slots.map(slot => (
                <button
                  key={slot.id}
                  className="btn btn-secondary"
                  style={{ padding: '0.75rem', textAlign: 'center' }}
                  onClick={() => bookSlot(slot)}
                >
                  <div style={{ fontWeight: 600 }}>{formatTime(slot.start_time)}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>to {formatTime(slot.end_time)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* MY APPOINTMENTS VIEW */}
        {view === 'appointments' && (
          <div className="card">
            <div className="flex-between mb-4">
              <h2>My Appointments</h2>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}><X size={16} /> Back</button>
            </div>

            {apptLoading && <p className="text-muted">Loading appointments...</p>}

            {!apptLoading && appointments.length === 0 && (
              <p className="text-muted">You have no appointments yet. <button className="btn btn-primary" style={{ marginLeft: '1rem' }} onClick={() => setView('search')}>Book Now</button></p>
            )}

            {appointments.map(appt => (
              <div key={appt.id} className="card mb-4" style={{ padding: '1rem' }}>
                <div className="flex-between">
                  <div>
                    <h4 className="mb-1">
                      Dr. {appt.doctors?.full_name}
                      <span className={`badge ${appt.status === 'scheduled' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: '0.5rem' }}>
                        {appt.status}
                      </span>
                    </h4>
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>{appt.doctors?.specialisation}</p>
                    {appt.slots && (
                      <p className="text-muted" style={{ fontSize: '0.875rem' }}>
                        📅 {appt.slots.slot_date} · {formatTime(appt.slots.start_time)} – {formatTime(appt.slots.end_time)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
