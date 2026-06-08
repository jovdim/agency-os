import type { Metadata } from "next";
import LandingPage from "@/components/landing/landing-page";

// Public marketing landing page. The proxy lets logged-OUT visitors reach "/"
// (logged-in users are redirected to their role dashboard before they get here).
export const metadata: Metadata = {
  title: "Websites for small businesses & entrepreneurs",
  description:
    "We design, build, and launch a fast, modern website for your business, on your own domain, editable by you. One service, done properly. Get a free proposal, no obligation.",
};

export default function HomePage() {
  return <LandingPage />;
}
