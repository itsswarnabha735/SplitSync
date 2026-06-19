"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteAccessibility() {
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      const main = document.getElementById("main-content");
      if (main) {
        main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
      }

      const heading = document.querySelector("h1")?.textContent?.trim();
      setAnnouncement(heading ? `Navigated to ${heading}` : "Page loaded");
    });

    return () => window.cancelAnimationFrame(handle);
  }, [pathname]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
