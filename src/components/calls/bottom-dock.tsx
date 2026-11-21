"use client";

import { useEffect } from "react";
import { MiniPlayer } from "./mini-player";
import { useRecording } from "./recording-provider";

// The mini-player's dock: above the tab bar on phones, along the bottom of the content from 768 px. It shows
// after the first play whenever the player card is not on screen, until it is closed: on phones and on windows
// too short for the card to stick (under 640 px tall) once the card scrolls away, and at any size when a page
// error has replaced the card. Where the card sticks it never leaves the screen, so the dock stays away. It
// writes its height to --dock-h, which the content's bottom padding and the toasts add, so nothing hides
// behind it; back to 0 when it hides or the call page closes.

const DOCK_HEIGHT = 56;

export function BottomDock() {
  const { canPlay, started, inlineVisible, miniClosed } = useRecording();
  const show = canPlay && started && !inlineVisible && !miniClosed;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dock-h", show ? `${DOCK_HEIGHT}px` : "0px");
    return () => {
      root.style.setProperty("--dock-h", "0px");
    };
  }, [show]);

  if (!show) return null;
  return (
    <div className="fade-in fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] z-30 md:bottom-[env(safe-area-inset-bottom,0px)] md:left-16 xl:left-[240px]">
      <MiniPlayer />
    </div>
  );
}
