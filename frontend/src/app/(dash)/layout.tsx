import { Shell } from "@/components/shell/Shell";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </AuthProvider>
  );
}
