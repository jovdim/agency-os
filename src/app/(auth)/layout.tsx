export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-backdrop relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {children}
    </div>
  );
}
