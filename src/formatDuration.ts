/**
 * Format milliseconds to MM:SS display.
 */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Worklet variant of {@link formatDuration} for use inside reanimated
 * `useAnimatedProps`, so the recording timer can tick on the UI thread without
 * causing React re-renders. `padStart` is avoided since it is not guaranteed in
 * every worklet runtime.
 */
export function formatDurationWorklet(milliseconds: number): string {
  "worklet";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const secsStr = secs < 10 ? `0${secs}` : `${secs}`;
  return `${mins}:${secsStr}`;
}
