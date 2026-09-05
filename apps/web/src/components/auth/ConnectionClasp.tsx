import { useCallback, useLayoutEffect, useState } from "react";

import styles from "./ConnectionClasp.module.css";

type ConnectionClaspProps = {
  playJoiningMotion?: boolean;
  onMotionSettled?: () => void;
};

type ConnectionClaspMotionEnvironment = {
  visibilityState: DocumentVisibilityState;
  prefersReducedMotion: boolean;
  forcedColorsActive: boolean;
};

export function connectionClaspMotionAllowed({
  visibilityState,
  prefersReducedMotion,
  forcedColorsActive,
}: ConnectionClaspMotionEnvironment): boolean {
  return visibilityState === "visible" && !prefersReducedMotion && !forcedColorsActive;
}

function readMotionEnvironment(): ConnectionClaspMotionEnvironment | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  return {
    visibilityState: document.visibilityState,
    prefersReducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    forcedColorsActive: window.matchMedia?.("(forced-colors: active)").matches ?? false,
  };
}

export function ConnectionClasp({
  playJoiningMotion = false,
  onMotionSettled,
}: ConnectionClaspProps) {
  // Static markup is always settled. A fresh client-side success opts into motion
  // after mount, so hydration and already-connected snapshots never replay it.
  const [isJoining, setIsJoining] = useState(false);

  const settle = useCallback(() => {
    setIsJoining(false);
    onMotionSettled?.();
  }, [onMotionSettled]);

  useLayoutEffect(() => {
    if (!playJoiningMotion) {
      setIsJoining(false);
      return;
    }

    const environment = readMotionEnvironment();
    if (!environment || !connectionClaspMotionAllowed(environment)) {
      settle();
      return;
    }

    setIsJoining(true);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        settle();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [playJoiningMotion, settle]);

  return (
    <svg
      aria-hidden="true"
      className={`${styles.clasp} ${isJoining ? styles.joining : ""}`}
      data-connection-clasp=""
      data-motion={isJoining ? "joining" : "settled"}
      focusable="false"
      viewBox="0 0 72 24"
    >
      <line className={styles.bridge} x1="32" x2="40" y1="12" y2="12" onAnimationEnd={settle} />
      <circle className={`${styles.endpointRing} ${styles.leftRing}`} cx="29" cy="12" r="6" />
      <circle className={`${styles.endpoint} ${styles.leftEndpoint}`} cx="29" cy="12" r="3" />
      <circle className={`${styles.endpointRing} ${styles.rightRing}`} cx="43" cy="12" r="6" />
      <circle className={`${styles.endpoint} ${styles.rightEndpoint}`} cx="43" cy="12" r="3" />
    </svg>
  );
}
