import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { LoadingSpinner } from "@groot/ui/loading-spinner";
import { selectAuthStatus, useAuthStore } from "@groot/shell/store/auth";

interface ProtectedRouteProps {
  children: ReactNode;

  adminOnly?: boolean;

  fallback?: string;
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  fallback = "/",
}: ProtectedRouteProps) {
  const status = useAuthStore((state) => selectAuthStatus(state).status);
  const isAdmin = useAuthStore((state) => state.user?.isAdmin === true);
  const location = useLocation();

  if (status === "unknown") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-muted/40">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (status === "signedOut") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
