import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, UserPlus, CalendarOff } from 'lucide-react';
import { apiFetch } from '../../services/api';

export default function AdminDashboard() {
  const { signOut } = useAuth();
  const [doctors, setDoctors] = useState<any[]>([]);
  
  // Create Doctor Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [specialisation, setSpecialisation] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Leave Form State
  const [leaveDoctorId, setLeaveDoctorId] = useState('');
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [leaveSuccess, setLeaveSuccess] = useState('');
  const [leaveLoading, setLeaveLoading] = useState(false);

  useEffect(() => {
    fetchDoctors();
  }, []);

  const fetchDoctors = async () => {
    try {
      const { data } = await apiFetch('/admin/doctors');
      setDoctors(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprove = async (id: string, status: string) => {
    try {
      await apiFetch(`/admin/doctors/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      fetchDoctors();
    } catch (e) {
      console.error(e);
      alert('Failed to update doctor status');
    }
  };

  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');
    setFormSuccess('');

    try {
      await apiFetch('/admin/doctors', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          specialisation,
          phone
        })
      });

      setFormSuccess('Doctor account created and approved successfully!');
      setEmail('');
      setPassword('');
      setFullName('');
      setSpecialisation('');
      setPhone('');
      fetchDoctors();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create doctor profile');
    } finally {
      setLoading(false);
    }
  };

  const handleRecordLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveLoading(true);
    setLeaveError('');
    setLeaveSuccess('');

    try {
      await apiFetch('/admin/leaves', {
        method: 'POST',
        body: JSON.stringify({
          doctor_id: leaveDoctorId,
          leave_date: leaveDate,
          reason: leaveReason
        })
      });

      setLeaveSuccess('Leave recorded. Affected slots/appointments cancelled and patients notified.');
      setLeaveDoctorId('');
      setLeaveDate('');
      setLeaveReason('');
    } catch (err: any) {
      setLeaveError(err.message || 'Failed to record leave');
    } finally {
      setLeaveLoading(false);
    }
  };

  return (
    <div>
      <nav className="navbar">
        <div className="container flex-between">
          <div className="nav-brand">Admin Portal</div>
          <button className="btn btn-outline" onClick={signOut}><LogOut size={16}/> Sign Out</button>
        </div>
      </nav>
      
      <div className="container mt-4">
        <div className="card">
          <h2 className="mb-2">Administrator Dashboard</h2>
          <p className="text-muted">Manage doctors and system settings</p>
        </div>
        
        <div className="grid-cols-2 mt-4">
          {/* Left Column: Doctor Approvals and Listing */}
          <div className="card">
            <h3 className="mb-4">Doctor Profiles</h3>
            {doctors.length === 0 ? (
              <p className="text-muted">No doctors found.</p>
            ) : (
              <div style={{ display: 'grid', gap: '1rem', maxHeight: '600px', overflowY: 'auto' }}>
                {doctors.map(doc => (
                  <div key={doc.user_id} className="card flex-between" style={{ padding: '1rem' }}>
                    <div>
                      <h4 className="mb-1">{doc.full_name} <span className={`badge ${doc.approval_status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{doc.approval_status}</span></h4>
                      <p className="text-muted" style={{ fontSize: '0.875rem' }}>{doc.specialisation} | {doc.users?.email}</p>
                    </div>
                    {doc.approval_status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-success" onClick={() => handleApprove(doc.user_id, 'approved')}>Approve</button>
                        <button className="btn btn-danger" onClick={() => handleApprove(doc.user_id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Forms */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Create Doctor Form */}
            <div className="card">
              <h3 className="mb-4 flex-center" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
                <UserPlus size={20} className="text-primary" /> Create Doctor Account
              </h3>
              
              {formError && <div className="badge badge-danger mb-4" style={{ display: 'block', width: '100%' }}>{formError}</div>}
              {formSuccess && <div className="badge badge-success mb-4" style={{ display: 'block', width: '100%' }}>{formSuccess}</div>}

              <form onSubmit={handleCreateDoctor}>
                <div className="grid-cols-2" style={{ gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input type="text" className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
                  </div>
                </div>

                <div className="grid-cols-2" style={{ gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Specialisation</label>
                    <input type="text" className="form-input" placeholder="e.g. Cardiologist" value={specialisation} onChange={e => setSpecialisation(e.target.value)} required />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
                  {loading ? 'Creating...' : 'Create Doctor Account'}
                </button>
              </form>
            </div>

            {/* Record Leave Form */}
            <div className="card">
              <h3 className="mb-4 flex-center" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
                <CalendarOff size={20} className="text-danger" /> Record Doctor Leave
              </h3>
              <p className="text-muted mb-4" style={{ fontSize: '0.875rem' }}>
                Recording a leave will auto-cancel any existing slots and scheduled appointments for that date, and email affected patients.
              </p>
              
              {leaveError && <div className="badge badge-danger mb-4" style={{ display: 'block', width: '100%' }}>{leaveError}</div>}
              {leaveSuccess && <div className="badge badge-success mb-4" style={{ display: 'block', width: '100%' }}>{leaveSuccess}</div>}

              <form onSubmit={handleRecordLeave}>
                <div className="form-group">
                  <label className="form-label">Select Doctor</label>
                  <select className="form-input" value={leaveDoctorId} onChange={e => setLeaveDoctorId(e.target.value)} required>
                    <option value="">-- Choose a Doctor --</option>
                    {doctors.filter(d => d.approval_status === 'approved').map(d => (
                      <option key={d.user_id} value={d.user_id}>{d.full_name} ({d.specialisation})</option>
                    ))}
                  </select>
                </div>
                
                <div className="grid-cols-2" style={{ gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Leave Date</label>
                    <input type="date" className="form-input" min={new Date().toISOString().split('T')[0]} value={leaveDate} onChange={e => setLeaveDate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reason (Optional)</label>
                    <input type="text" className="form-input" value={leaveReason} onChange={e => setLeaveReason(e.target.value)} placeholder="e.g. Sick Leave, Vacation" />
                  </div>
                </div>

                <button type="submit" className="btn btn-danger" style={{ width: '100%', marginTop: '0.5rem' }} disabled={leaveLoading || !leaveDoctorId || !leaveDate}>
                  {leaveLoading ? 'Processing...' : 'Record Leave & Cancel Appointments'}
                </button>
              </form>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
