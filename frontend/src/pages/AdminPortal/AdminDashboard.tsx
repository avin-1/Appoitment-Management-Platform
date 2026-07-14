import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, UserPlus } from 'lucide-react';
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

          {/* Right Column: Create Doctor Form */}
          <div className="card">
            <h3 className="mb-4 flex-center" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
              <UserPlus size={20} className="text-primary" /> Create Doctor Account
            </h3>
            
            {formError && <div className="badge badge-danger mb-4" style={{ display: 'block', width: '100%' }}>{formError}</div>}
            {formSuccess && <div className="badge badge-success mb-4" style={{ display: 'block', width: '100%' }}>{formSuccess}</div>}

            <form onSubmit={handleCreateDoctor}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={fullName} 
                  onChange={e => setFullName(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Specialisation</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Cardiologist, General Physician"
                  value={specialisation} 
                  onChange={e => setSpecialisation(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number (Optional)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={phone} 
                  onChange={e => setPhone(e.target.value)} 
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Creating...' : 'Create Doctor Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
