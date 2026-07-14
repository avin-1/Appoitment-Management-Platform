import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, Calendar } from 'lucide-react';
import { apiFetch } from '../../services/api';

export default function DoctorDashboard() {
  const { user, signOut } = useAuth();

  const handleConnectCalendar = async () => {
    try {
      const data = await apiFetch('/auth/google/url');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error(e);
      alert('Failed to initiate Google Calendar connection.');
    }
  };

  return (
    <div>
      <nav className="navbar">
        <div className="container flex-between">
          <div className="nav-brand">Doctor Portal</div>
          <button className="btn btn-outline" onClick={signOut}><LogOut size={16}/> Sign Out</button>
        </div>
      </nav>
      
      <div className="container mt-4">
        <div className="card flex-between">
          <div>
            <h2 className="mb-2">Dr. {user?.user_metadata?.full_name || 'Doctor'}</h2>
            <p className="text-muted">Manage your schedule and appointments</p>
          </div>
          <button className="btn btn-secondary" onClick={handleConnectCalendar}>
            <Calendar size={16}/> Connect Google Calendar
          </button>
        </div>
        
        <div className="grid-cols-2 mt-4">
          <div className="card">
            <h3>Today's Schedule</h3>
            <p className="text-muted mb-4 mt-2">No appointments scheduled for today.</p>
          </div>
          <div className="card">
            <h3>Pending Notes</h3>
            <p className="text-muted mb-4 mt-2">All post-visit notes are complete.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
