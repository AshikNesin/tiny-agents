import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthStore } from "@groot/shell/store/auth";

export function useSignOut(): () => void {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  return () => {
    void logout().catch(reportSignOutFailure);
    toast.success("Signed out", { description: "You have been logged out safely." });
    navigate("/login");
  };
}

function reportSignOutFailure(): void {
  toast.error("Sign out failed", {
    description: "The session may still be active. Check your connection and try again.",
  });
}
