/**
 * WhatsApp-style audio recorder: slide to cancel, slide up to lock.
 *
 * Performance / threading model:
 * The entire per-frame gesture state machine runs inside the pan worklet on the
 * UI thread. During a continuous slide there are zero `runOnJS` hops and zero
 * React re-renders: the pan offset, lock icon, cancel/recording transitions, and
 * waveform are all driven on the UI thread. JS is touched only on discrete events
 * (hold-to-start, lock, cancel, release) via `useAnimatedReaction` + `runOnJS`.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Platform, Keyboard, I18nManager } from "react-native";
import { Sound } from "react-native-nitro-sound";
import RNBlobUtil from "react-native-blob-util";
import { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import {
  cancelAnimation,
  makeMutable,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type RecordingState = "idle" | "recording" | "cancelMode" | "locked";

// Numeric mirror of RecordingState used on the UI thread (worklets cannot hold
// the string union as cheaply, and numbers compare fast in useAnimatedReaction).
const ST_IDLE = 0;
const ST_RECORDING = 1;
const ST_CANCEL = 2;
const ST_LOCKED = 3;

// Behaviour the worklet has locked onto for the current slide.
const BH_NONE = 0;
const BH_CANCELING = 1;
const BH_LOCKING = 2;

const STATE_BY_CODE: RecordingState[] = [
  "idle",
  "recording",
  "cancelMode",
  "locked",
];

export const WAVEFORM_BAR_COUNT = 24;
const DIRECTION_DEAD_ZONE = 5;
const RESET_BEHAVIOUR_THRESHOLD = 25;
const SLIDE_CANCEL_THRESHOLD = 70;
const SLIDE_LOCK_THRESHOLD = 70;
const HOLD_TO_START_MS = 220;
const HOLD_MOVE_CANCEL_THRESHOLD = 35;
const LOCK_SPRING = { damping: 15, stiffness: 200 };

export interface UseWhatsAppAudioRecorderConfig {
  /** Recording file path (without file://). */
  recordingPath: string;
  /** Called when recording completes and should be sent. */
  onStopAndSend: (params: {
    filePath: string;
    durationMs: number;
    mimeType: string;
    fileName: string;
    /** How the recording was completed: release finger, send button, or stop button */
    source?: "release" | "send" | "stop";
  }) => Promise<void>;
  /** Called when recording is canceled. */
  onCancel?: () => void;
  /** Called before starting. Return false to abort. */
  onBeforeStart?: () => Promise<boolean>;
  /** Called when voice recording state changes (e.g. for Redux). */
  onVoiceRecordingChange?: (isRecording: boolean) => void;
  /** Called when recording has started. */
  onRecordingStarted?: () => void;
  /** Called when recording is locked (slide up). */
  onRecordingLocked?: () => void;
}

export interface UseWhatsAppAudioRecorderReturn {
  recordingState: RecordingState;
  recordingDuration: number;
  /** UI-thread duration (ms). Bind it to animated text for re-render-free ticking. */
  recordingDurationSV: SharedValue<number>;
  isRecording: boolean;
  composedGesture: ReturnType<typeof Gesture.Pan>;
  waveformAnims: SharedValue<number>[];
  panTranslationX: SharedValue<number>;
  panTranslationY: SharedValue<number>;
  lockIconScale: SharedValue<number>;
  micScale: SharedValue<number>;
  slideCancelThreshold: number;
  slideLockThreshold: number;
  handleLockedStop: () => void;
  handleLockedSend: () => void;
  handleLockedCancel: () => void;
  startRecording: () => Promise<void>;
  cancelRecording: () => void;
}

export function useWhatsAppAudioRecorder(
  config: UseWhatsAppAudioRecorderConfig,
): UseWhatsAppAudioRecorderReturn {
  const {
    recordingPath,
    onStopAndSend,
    onCancel,
    onBeforeStart,
    onVoiceRecordingChange,
    onRecordingStarted,
    onRecordingLocked,
  } = config;

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI-thread driven waveform amplitudes. Reanimated mutables created
  // imperatively (not via useSharedValue, so the count can be a constant loop)
  // keep the per-frame tween on the UI thread.
  const waveformAnims = useRef(
    Array.from({ length: WAVEFORM_BAR_COUNT }, () => makeMutable(0.3)),
  ).current;

  // Shared values: visual + the gesture state machine, all UI-thread owned.
  const panTranslationX = useSharedValue(0);
  const panTranslationY = useSharedValue(0);
  const lockIconScale = useSharedValue(0);
  const micScale = useSharedValue(1);
  const recordingDurationSV = useSharedValue(0);
  const recStateSV = useSharedValue(ST_IDLE);
  const behaviourSV = useSharedValue(BH_NONE);
  const holdPendingSV = useSharedValue(false);
  const lockIconShownSV = useSharedValue(false);
  const waveformRunningSV = useSharedValue(false);

  // JS-side mirrors used by the asynchronous start/stop logic.
  const recordingStateRef = useRef<RecordingState>("idle");
  const releaseHandledRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const recordingReadyRef = useRef(false);
  const isSendingAudioRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRTL = I18nManager.isRTL;
  const slideCancelThreshold = SLIDE_CANCEL_THRESHOLD;
  const slideLockThreshold = SLIDE_LOCK_THRESHOLD;

  const isRecording =
    recordingState === "recording" ||
    recordingState === "cancelMode" ||
    recordingState === "locked";

  // While locked, recording continues hands-free and the on-screen
  // stop/send/cancel buttons own the touches. Disable the pan so it neither
  // swallows those button taps nor needs the consumer to unmount the
  // GestureDetector (unmounting an active detector mid-lock is what previously
  // left the gesture stuck until an app restart). `isLocked` only flips on the
  // lock/unlock boundary, so the gesture object stays stable across the
  // recording<->cancel slide and is never rebuilt mid-gesture.
  const isLocked = recordingState === "locked";

  // Self-scheduling waveform driven entirely on the UI thread (no JS interval).
  // Each bar reschedules its next random target in its own withTiming callback,
  // gated by waveformRunningSV, so a busy JS thread cannot stutter it.
  const startWaveform = useCallback(() => {
    waveformRunningSV.value = true;
    waveformAnims.forEach((sv) => {
      runOnUI(() => {
        "worklet";
        function step() {
          if (!waveformRunningSV.value) return;
          sv.value = withTiming(
            0.2 + Math.random() * 0.8,
            { duration: 150 + Math.random() * 100 },
            (finished) => {
              if (finished && waveformRunningSV.value) step();
            },
          );
        }
        step();
      })();
    });
  }, [waveformAnims, waveformRunningSV]);

  const resetUIState = useCallback(() => {
    onVoiceRecordingChange?.(false);
    recordingStateRef.current = "idle";
    setRecordingState("idle");
    setRecordingDuration(0);
    recordingDurationRef.current = 0;

    recStateSV.value = ST_IDLE;
    behaviourSV.value = BH_NONE;
    holdPendingSV.value = false;
    lockIconShownSV.value = false;
    waveformRunningSV.value = false;
    recordingDurationSV.value = 0;

    waveformAnims.forEach((sv) => {
      cancelAnimation(sv);
      sv.value = withTiming(0.3, { duration: 150 });
    });
    panTranslationX.value = withSpring(0);
    panTranslationY.value = withSpring(0);
    lockIconScale.value = withSpring(0);
    micScale.value = withSpring(1);
  }, [
    waveformAnims,
    panTranslationX,
    panTranslationY,
    lockIconScale,
    micScale,
    recStateSV,
    behaviourSV,
    holdPendingSV,
    lockIconShownSV,
    waveformRunningSV,
    recordingDurationSV,
    onVoiceRecordingChange,
  ]);

  const startRecording = useCallback(async () => {
    if (recordingState !== "idle") return;
    if (onBeforeStart && !(await onBeforeStart())) return;

    try {
      await Sound.stopPlayer();
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
    } catch (_) {}

    recordingReadyRef.current = false;
    releaseHandledRef.current = false;
    onVoiceRecordingChange?.(true);

    recordingStateRef.current = "recording";
    setRecordingState("recording");
    setRecordingDuration(0);

    // Hand authority to the worklet and reset the slide state machine.
    recStateSV.value = ST_RECORDING;
    behaviourSV.value = BH_NONE;
    holdPendingSV.value = false;
    lockIconShownSV.value = false;
    panTranslationX.value = 0;
    panTranslationY.value = 0;
    lockIconScale.value = 0;
    micScale.value = withSpring(1.15, { damping: 15, stiffness: 300 });

    recordingDurationRef.current = 0;
    recordingDurationSV.value = 0;
    let lastWholeSec = 0;
    recordingTimerRef.current = setInterval(() => {
      recordingDurationRef.current += 100;
      // SV write = no React render; the overlay timer reads this on the UI thread.
      recordingDurationSV.value = recordingDurationRef.current;
      // Public state only changes once per second (MM:SS resolution), so the
      // consumer re-renders at 1 Hz instead of 10 Hz.
      const sec = Math.floor(recordingDurationRef.current / 1000);
      if (sec !== lastWholeSec) {
        lastWholeSec = sec;
        setRecordingDuration(recordingDurationRef.current);
      }
    }, 100);

    startWaveform();

    const path = Platform.OS === "ios"
      ? `${RNBlobUtil.fs.dirs.CacheDir}/${recordingPath}.m4a`
      : `${RNBlobUtil.fs.dirs.CacheDir}/${recordingPath}.aac`;

    try {
      await Sound.startRecorder(
        path,
        {
          AudioEncoderAndroid: 3,
          AudioSourceAndroid: 1,
          OutputFormatAndroid: 6,
        },
        true,
      );
      recordingReadyRef.current = true;
      onRecordingStarted?.();
    } catch (err) {
      console.error("Failed to start recording:", err);
      recordingReadyRef.current = false;
      resetUIState();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [
    recordingState,
    startWaveform,
    panTranslationX,
    panTranslationY,
    lockIconScale,
    micScale,
    recStateSV,
    behaviourSV,
    holdPendingSV,
    lockIconShownSV,
    recordingDurationSV,
    recordingPath,
    onBeforeStart,
    onVoiceRecordingChange,
    onRecordingStarted,
    resetUIState,
  ]);

  const stopRecordingAndSend = useCallback(
    async (source: "release" | "send" | "stop" = "release") => {
      if (recordingStateRef.current === "idle") return;
      if (isSendingAudioRef.current) return;
      isSendingAudioRef.current = true;

      const durationMs = recordingDurationRef.current;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      resetUIState();

      if (!recordingReadyRef.current) {
        isSendingAudioRef.current = false;
        releaseHandledRef.current = false;
        return;
      }
      recordingReadyRef.current = false;

      const mimeType = Platform.OS === "ios" ? "audio/m4a" : "audio/aac";
      const fileName =
        Platform.OS === "ios"
          ? `${recordingPath}.m4a`
          : `${recordingPath}.aac`;

      try {
        const filePath = await Sound.stopRecorder();
        Sound.removeRecordBackListener();
        await onStopAndSend({
          filePath,
          durationMs,
          mimeType,
          fileName,
          source,
        });
      } catch (err) {
        console.error("Failed to stop recording:", err);
      } finally {
        isSendingAudioRef.current = false;
        releaseHandledRef.current = false;
      }
    },
    [recordingPath, onStopAndSend, resetUIState],
  );

  const cancelRecording = useCallback(() => {
    if (recordingState === "idle") return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordingReadyRef.current) {
      recordingReadyRef.current = false;
      try {
        Sound.stopRecorder();
        Sound.removeRecordBackListener();
      } catch (_) {}
    } else {
      recordingReadyRef.current = false;
    }

    resetUIState();
    releaseHandledRef.current = false;

    const filePath = Platform.OS === "ios"
      ? `${RNBlobUtil.fs.dirs.CacheDir}/${recordingPath}.m4a`
      : `${RNBlobUtil.fs.dirs.CacheDir}/${recordingPath}.aac`;
    RNBlobUtil.fs.unlink(filePath).catch(() => {});
    onCancel?.();
  }, [recordingState, recordingPath, resetUIState, onCancel]);

  // Mirror the worklet's numeric state into React state, fired only on a real
  // transition by useAnimatedReaction. This replaces the old per-frame commitState.
  const syncReactState = useCallback(
    (code: number) => {
      const next = STATE_BY_CODE[code] ?? "idle";
      if (recordingStateRef.current !== next) {
        recordingStateRef.current = next;
        setRecordingState(next);
        if (code === ST_LOCKED) onRecordingLocked?.();
      }
    },
    [onRecordingLocked],
  );

  const handleGestureRelease = useCallback(
    (stateCode: number) => {
      if (releaseHandledRef.current) return;
      releaseHandledRef.current = true;

      if (stateCode === ST_LOCKED) {
        // Recording continues; state + onRecordingLocked already synced by the
        // reaction, and the worklet already sprang the pan offset back to 0.
        releaseHandledRef.current = false;
        return;
      }

      if (stateCode === ST_CANCEL) {
        cancelRecording();
        releaseHandledRef.current = false;
        return;
      }

      stopRecordingAndSend("release");
    },
    [cancelRecording, stopRecordingAndSend],
  );

  const handleLockedStop = useCallback(() => {
    if (recordingState !== "locked") return;
    stopRecordingAndSend("stop");
  }, [recordingState, stopRecordingAndSend]);

  const handleLockedSend = useCallback(() => {
    if (recordingState !== "locked") return;
    stopRecordingAndSend("send");
  }, [recordingState, stopRecordingAndSend]);

  const handleLockedCancel = useCallback(() => {
    if (recordingState !== "locked") return;
    cancelRecording();
  }, [recordingState, cancelRecording]);

  const checkPermissionAndStartRecording = useCallback(async () => {
    await startRecording();
  }, [startRecording]);

  // Stable dispatchers backed by refs, so the gesture worklet never rebuilds
  // just because a callback identity changed.
  const checkPermissionRef = useRef(checkPermissionAndStartRecording);
  const handleGestureReleaseRef = useRef(handleGestureRelease);
  const syncReactStateRef = useRef(syncReactState);

  useEffect(() => {
    checkPermissionRef.current = checkPermissionAndStartRecording;
  }, [checkPermissionAndStartRecording]);
  useEffect(() => {
    handleGestureReleaseRef.current = handleGestureRelease;
  }, [handleGestureRelease]);
  useEffect(() => {
    syncReactStateRef.current = syncReactState;
  }, [syncReactState]);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const dispatchPanStart = useCallback(() => {
    cancelHoldTimer();
    if (recordingStateRef.current !== "idle") return;
    // Dismiss the keyboard at touch-down (not mid-gesture inside startRecording).
    // Dismissing 220ms into an active pan triggers a relayout that cancels the
    // gesture and produces a visible flicker; doing it here settles first.
    Keyboard.dismiss();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      checkPermissionRef.current();
    }, HOLD_TO_START_MS);
  }, [cancelHoldTimer]);

  const dispatchPanEnd = useCallback(
    (stateCode: number) => {
      cancelHoldTimer();
      holdPendingSV.value = false;
      if (stateCode === ST_IDLE) return; // released before recording started
      handleGestureReleaseRef.current(stateCode);
    },
    [cancelHoldTimer, holdPendingSV],
  );

  const dispatchSyncState = useCallback((code: number) => {
    syncReactStateRef.current(code);
  }, []);

  // Single JS hop per real state transition.
  useAnimatedReaction(
    () => recStateSV.value,
    (next, prev) => {
      if (next !== prev) runOnJS(dispatchSyncState)(next);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      waveformRunningSV.value = false;
      cancelHoldTimer();
    };
  }, [cancelHoldTimer, waveformRunningSV]);

  const composedGesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(!isLocked)
      .minDistance(0)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        "worklet";
        if (recStateSV.value === ST_IDLE) {
          holdPendingSV.value = true;
          behaviourSV.value = BH_NONE;
        }
        runOnJS(dispatchPanStart)();
      })
      .onUpdate((e) => {
        "worklet";
        const dx = e.translationX;
        const dy = e.translationY;
        const s = recStateSV.value;

        // Idle: still in the 220ms hold window. Only job is to cancel the hold
        // if the finger wanders too far before recording begins.
        if (s === ST_IDLE) {
          if (holdPendingSV.value) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > HOLD_MOVE_CANCEL_THRESHOLD) {
              holdPendingSV.value = false;
              runOnJS(cancelHoldTimer)();
            }
          }
          return;
        }
        if (s === ST_LOCKED) return;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        let direction = BH_NONE;
        if (absDx > DIRECTION_DEAD_ZONE || absDy > DIRECTION_DEAD_ZONE) {
          const horizontalCancelDir = isRTL ? dx > 0 : dx < 0;
          const verticalUp = dy < 0;
          if (absDx > absDy && horizontalCancelDir) direction = BH_CANCELING;
          else if (absDy > absDx && verticalUp) direction = BH_LOCKING;
        }

        const behaviour = behaviourSV.value;
        if (behaviour === BH_CANCELING && absDx < RESET_BEHAVIOUR_THRESHOLD) {
          behaviourSV.value = BH_NONE;
        } else if (behaviour === BH_LOCKING && dy > -RESET_BEHAVIOUR_THRESHOLD) {
          behaviourSV.value = BH_NONE;
        } else if (
          direction !== BH_NONE &&
          (behaviour === BH_NONE || behaviour === direction)
        ) {
          behaviourSV.value = direction;
        }

        const lb = behaviourSV.value;
        if (lb === BH_LOCKING) {
          panTranslationX.value = 0;
          panTranslationY.value = dy;
          if (dy < -slideLockThreshold) {
            recStateSV.value = ST_LOCKED;
            if (!lockIconShownSV.value) {
              lockIconShownSV.value = true;
              lockIconScale.value = withSpring(1, LOCK_SPRING);
            }
            panTranslationX.value = withSpring(0);
            panTranslationY.value = withSpring(0);
          } else {
            recStateSV.value = ST_RECORDING;
            if (lockIconShownSV.value) {
              lockIconShownSV.value = false;
              lockIconScale.value = withSpring(0, LOCK_SPRING);
            }
          }
        } else if (lb === BH_CANCELING) {
          panTranslationX.value = dx;
          panTranslationY.value = 0;
          const past = isRTL
            ? dx > slideCancelThreshold
            : dx < -slideCancelThreshold;
          if (past) {
            recStateSV.value = ST_CANCEL;
          } else {
            recStateSV.value = ST_RECORDING;
            if (lockIconShownSV.value) {
              lockIconShownSV.value = false;
              lockIconScale.value = withSpring(0, LOCK_SPRING);
            }
          }
        } else {
          panTranslationX.value = dx;
          panTranslationY.value = dy;
          recStateSV.value = ST_RECORDING;
          if (lockIconShownSV.value) {
            lockIconShownSV.value = false;
            lockIconScale.value = withSpring(0, LOCK_SPRING);
          }
        }
      })
      .onEnd(() => {
        "worklet";
        runOnJS(dispatchPanEnd)(recStateSV.value);
      });
  }, [
    isLocked,
    isRTL,
    slideCancelThreshold,
    slideLockThreshold,
    dispatchPanStart,
    dispatchPanEnd,
    cancelHoldTimer,
    panTranslationX,
    panTranslationY,
    lockIconScale,
    recStateSV,
    behaviourSV,
    holdPendingSV,
    lockIconShownSV,
  ]);

  return {
    recordingState,
    recordingDuration,
    recordingDurationSV,
    isRecording,
    composedGesture,
    waveformAnims,
    panTranslationX,
    panTranslationY,
    lockIconScale,
    micScale,
    slideCancelThreshold,
    slideLockThreshold,
    handleLockedStop,
    handleLockedSend,
    handleLockedCancel,
    startRecording,
    cancelRecording,
  };
}
