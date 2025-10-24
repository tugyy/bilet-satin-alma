import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

export default function RequireAuth({ children, allowedRoles }: { children: React.ReactElement; allowedRoles?: string[] }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    // Not logged in -> redirect to login, preserve intended location
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const role = String(((user as unknown) as { role?: string }).role ?? '');
    if (!allowedRoles.includes(role)) {
      // Logged in but not authorized -> redirect to home
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
