import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut } from 'lucide-react';

export default function PatientDashboard() {
  const { user, signOut } = useAuth();

  return (
    <div>
      <nav className="navbar">
        <div className="container flex-between">
          <div className="nav-brand">Healthcare Portal</div>
          <button className="btn btn-outline" onClick={signOut}><LogOut size={16}/> Sign Out</button>
        </div>
      </nav>
      
      <div className="container mt-4">
        <div className="card">
          <h2 className="mb-2">Welcome, {user?.user_metadata?.full_name || 'Patient'}</h2>
          <p className="text-muted">Your health dashboard</p>
        </div>
        
        <div className="grid-cols-2 mt-4">
          <div className="card">
            <h3>Find a Doctor</h3>
            <p className="text-muted mb-4 mt-2">Search our network of specialists and book an appointment.</p>
            <button className="btn btn-primary">Search Doctors</button>
          </div>
          <div className="card">
            <h3>Upcoming Appointments</h3>
            <p className="text-muted mb-4 mt-2">You have no upcoming appointments.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
