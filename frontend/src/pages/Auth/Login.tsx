import React, { useState } from 'react';
import { supabase } from '../../services/api';
import { useNavigate, Link } from 'react-router-dom';
import { Activity } from 'lucide-react';

type Role = 'patient' | 'doctor' | 'admin';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('patient');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }

    const userEmail = data.user.email;
    let actualRole = data.user.user_metadata?.role || 'patient';

    // Auto-override admin role for default email
    if (userEmail === 'avinash.bhurke23@vit.edu') {
      actualRole = 'admin';
    }

    // Role-based Access Control Guard
    if (actualRole !== selectedRole) {
      setError(`Access Denied: This account is not registered as a ${selectedRole}.`);
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (actualRole === 'doctor') navigate('/doctor');
    else if (actualRole === 'admin') navigate('/admin');
    else navigate('/patient');
  };

  return (
    <div className="flex-center" style={{ minHeight: '100vh', padding: '1.5rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <div className="text-center mb-4">
          <Activity size={40} className="text-primary" style={{ margin: '0 auto' }} />
          <h1 className="mt-2 text-primary" style={{ fontSize: '1.5rem' }}>Welcome Back</h1>
          <p className="text-muted">Sign in to your portal</p>
        </div>

        {/* Role Selector Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {(['patient', 'doctor', 'admin'] as Role[]).map((role) => (
            <button
              key={role}
              type="button"
              className={`btn ${selectedRole === role ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, textTransform: 'capitalize', fontSize: '0.8rem', padding: '0.4rem' }}
              onClick={() => setSelectedRole(role)}
            >
              {role}
            </button>
          ))}
        </div>

        {error && <div className="badge badge-danger mb-4" style={{ display: 'block', width: '100%', textAlign: 'center' }}>{error}</div>}

        <form onSubmit={handleLogin}>
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
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Signing in...' : `Sign In as ${selectedRole}`}
          </button>
        </form>

        {selectedRole === 'patient' && (
          <div className="text-center mt-4">
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>
              Don't have an account? <Link to="/register" className="text-primary" style={{ textDecoration: 'none' }}>Register</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
