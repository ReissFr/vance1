import type { Metadata, Viewport } from "next";
import "./globals.css";
import ClientActionRunner from "@/components/ClientActionRunner";
import GestureApprover from "@/components/GestureApprover";
import { CommandPalette } from "@/components/jarvis/CommandPalette";
import { GlobalShortcuts } from "@/components/jarvis/GlobalShortcuts";
import { GlobalTaskNotifier } from "@/components/jarvis/GlobalTaskNotifier";
import { QuickCapture } from "@/components/jarvis/QuickCapture";
import { ToastHost } from "@/components/jarvis/ToastHost";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";

export const metadata: Metadata = {
  title: "JARVIS",
  description: "An assistant that pays attention so you don't have to.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <AnalyticsProvider />
        <ClientActionRunner />
        <GestureApprover />
        <CommandPalette />
        <GlobalShortcuts />
        <ToastHost />
        <GlobalTaskNotifier />
        <QuickCapture />
      </body>
    </html>
  );
}
