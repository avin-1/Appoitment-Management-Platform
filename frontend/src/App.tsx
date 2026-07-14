import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import PatientDashboard from './pages/PatientPortal/PatientDashboard';
import DoctorDashboard from './pages/DoctorPortal/DoctorDashboard';
import AdminDashboard from './pages/AdminPortal/AdminDashboard';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { session, role, loading } = useAuth();

  if (loading) return <div className="flex-center" style={{ minHeight: '100vh' }}>Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={`/${role}`} replace />;
  }

  return <>{children}</>;
};

function AppRoutes() {
  const { session, role, loading } = useAuth();

  if (loading) return <div className="flex-center" style={{ minHeight: '100vh' }}>Loading...</div>;

  return (
    <Routes>
      <Route path="/" element={
        session ? <Navigate to={`/${role}`} replace /> : <Navigate to="/login" replace />
      } />
      
      <Route path="/login" element={session ? <Navigate to={`/${role}`} replace /> : <Login />} />
      <Route path="/register" element={session ? <Navigate to={`/${role}`} replace /> : <Register />} />
      
      <Route path="/patient/*" element={
        <ProtectedRoute allowedRoles={['patient']}>
          <PatientDashboard />
        </ProtectedRoute>
      } />
      
      <Route path="/doctor/*" element={
        <ProtectedRoute allowedRoles={['doctor']}>
          <DoctorDashboard />
        </ProtectedRoute>
      } />
      
      <Route path="/admin/*" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <AdminDashboard />
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
