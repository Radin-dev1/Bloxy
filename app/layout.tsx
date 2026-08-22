import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Bloxy — AI Roblox Game Builder",
  description: "Pair Roblox Studio and build polished game systems through conversation.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
