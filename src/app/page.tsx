import { redirect } from "next/navigation";

// Root page — middleware handles redirect based on auth state
export default function RootPage() {
  redirect("/login");
}
