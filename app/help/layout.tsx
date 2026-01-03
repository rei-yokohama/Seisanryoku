import type { Metadata } from "next";
import { HelpShell } from "./help-shell";

export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <HelpShell>{children}</HelpShell>;
}


