/**
 * WhatsApp-style audio recorder: slide to cancel, slide up to lock.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Platform, Keyboard, I18nManager } from "react-native";
import { Sound } from "react-native-nitro-sound";
import RNBlobUtil from "react-native-blob-util";
import { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { runOnJS, useSharedValue, withSpring } from "react-native-reanimated";
import { Animated as RNAnimated } from "react-native";

export type RecordingState = "idle" | "recording" | "cancelMode" | "locked";

export const WAVEFORM_BAR_COUNT = 24;
const DIRECTION_DEAD_ZONE = 5;
const RESET_BEHAVIOUR_THRESHOLD = 25;
const SLIDE_CANCEL_THRESHOLD = 70;
const SLIDE_LOCK_THRESHOLD = 70;
const HOLD_TO_START_MS = 220;
const HOLD_MOVE_CANCEL_THRESHOLD = 35;

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
  isRecording: boolean;
  composedGesture: ReturnType<typeof Gesture.Pan>;
  waveformAnims: RNAnimated.Value[];
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
  const waveformAnims = useRef(
    Array.from({ length: WAVEFORM_BAR_COUNT }, () => new RNAnimated.Value(0.3)),
  ).current;

  const panTranslationX = useSharedValue(0);
  const panTranslationY = useSharedValue(0);
  const lockIconScale = useSharedValue(0);
  const micScale = useSharedValue(1);
  const recordingStateRef = useRef<RecordingState>("idle");
  const userBehaviourRef = useRef<"none" | "canceling" | "locking">("none");
  const releaseHandledRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const recordingReadyRef = useRef(false);
  const isSendingAudioRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartTimeRef = useRef(0);

  const isRTL = I18nManager.isRTL;
  const slideCancelThreshold = SLIDE_CANCEL_THRESHOLD;
  const slideLockThreshold = SLIDE_LOCK_THRESHOLD;

  const isRecording =
    recordingState === "recording" ||
    recordingState === "cancelMode" ||
    recordingState === "locked";

  const startWaveformAnimation = useCallback(() => {
    const animate = () => {
      waveformAnims.forEach((anim) => {
        RNAnimated.timing(anim, {
          toValue: 0.2 + Math.random() * 0.8,
          duration: 150 + Math.random() * 100,
          useNativeDriver: false,
        }).start();
      });
    };
    animate();
    return setInterval(animate, 200);
  }, [waveformAnims]);

  const resetUIState = useCallback(() => {
    onVoiceRecordingChange?.(false);
    recordingStateRef.current = "idle";
    userBehaviourRef.current = "none";
    setRecordingState("idle");
    setRecordingDuration(0);
    waveformAnims.forEach((anim) => anim.setValue(0.3));
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

    Keyboard.dismiss();
    recordingReadyRef.current = false;
    releaseHandledRef.current = false;
    userBehaviourRef.current = "none";
    onVoiceRecordingChange?.(true);
    recordingStateRef.current = "recording";
    setRecordingState("recording");
    setRecordingDuration(0);
    panTranslationX.value = 0;
    panTranslationY.value = 0;
    lockIconScale.value = 0;
    micScale.value = withSpring(1.15, { damping: 15, stiffness: 300 });

    recordingDurationRef.current = 0;
    recordingTimerRef.current = setInterval(() => {
      recordingDurationRef.current += 100;
      setRecordingDuration(recordingDurationRef.current);
    }, 100);

    const waveformInterval = startWaveformAnimation();
    (recordingTimerRef as any)._waveformInterval = waveformInterval;

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
        clearInterval((recordingTimerRef as any)._waveformInterval);
        recordingTimerRef.current = null;
      }
    }
  }, [
    recordingState,
    startWaveformAnimation,
    panTranslationX,
    panTranslationY,
    lockIconScale,
    micScale,
    recordingPath,
    onBeforeStart,
    onVoiceRecordingChange,
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
        clearInterval((recordingTimerRef as any)._waveformInterval);
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
      clearInterval((recordingTimerRef as any)._waveformInterval);
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

  const handlePanUpdate = useCallback(
    (dx: number, dy: number) => {
      const state = recordingStateRef.current;
      if (state === "idle" || state === "locked") return;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const behaviour = userBehaviourRef.current;

      let direction: "none" | "canceling" | "locking" = "none";
      if (absDx > DIRECTION_DEAD_ZONE || absDy > DIRECTION_DEAD_ZONE) {
        const horizontalCancelDir = isRTL ? dx > 0 : dx < 0;
        const verticalUp = dy < 0;
        if (absDx > absDy && horizontalCancelDir) {
          direction = "canceling";
        } else if (absDy > absDx && verticalUp) {
          direction = "locking";
        }
      }

      if (behaviour === "canceling" && absDx < RESET_BEHAVIOUR_THRESHOLD) {
        userBehaviourRef.current = "none";
      } else if (behaviour === "locking" && dy > -RESET_BEHAVIOUR_THRESHOLD) {
        userBehaviourRef.current = "none";
      } else if (direction !== "none" && (behaviour === "none" || behaviour === direction)) {
        userBehaviourRef.current = direction;
      }

      const lockedBehaviour = userBehaviourRef.current;

      if (lockedBehaviour === "locking") {
        panTranslationX.value = 0;
        panTranslationY.value = dy;
        if (dy < -slideLockThreshold) {
          recordingStateRef.current = "locked";
          setRecordingState("locked");
          lockIconScale.value = withSpring(1, { damping: 15, stiffness: 200 });
          panTranslationX.value = withSpring(0);
          panTranslationY.value = withSpring(0);
          onRecordingLocked?.();
        } else {
          panTranslationX.value = 0;
          panTranslationY.value = dy;
          recordingStateRef.current = "recording";
          setRecordingState("recording");
          lockIconScale.value = withSpring(0, { damping: 15, stiffness: 200 });
        }
      } else if (lockedBehaviour === "canceling") {
        panTranslationX.value = dx;
        panTranslationY.value = 0;
        const pastCancelThreshold = isRTL
          ? dx > slideCancelThreshold
          : dx < -slideCancelThreshold;
        if (pastCancelThreshold) {
          recordingStateRef.current = "cancelMode";
          setRecordingState("cancelMode");
        } else {
          recordingStateRef.current = "recording";
          setRecordingState("recording");
          lockIconScale.value = withSpring(0, { damping: 15, stiffness: 200 });
        }
      } else {
        panTranslationX.value = dx;
        panTranslationY.value = dy;
        recordingStateRef.current = "recording";
        setRecordingState("recording");
        lockIconScale.value = withSpring(0, { damping: 15, stiffness: 200 });
      }
    },
    [
      panTranslationX,
      panTranslationY,
      lockIconScale,
      slideCancelThreshold,
      slideLockThreshold,
      onRecordingLocked,
    ],
  );

  const handleGestureRelease = useCallback(
    (finalDx?: number, finalDy?: number) => {
      if (releaseHandledRef.current) return;
      let state = recordingStateRef.current;
      if (state === "idle") return;

      if (
        state === "recording" &&
        typeof finalDx === "number" &&
        typeof finalDy === "number"
      ) {
        const behaviour = userBehaviourRef.current;
        const pastCancel = isRTL
          ? finalDx > slideCancelThreshold
          : finalDx < -slideCancelThreshold;
        const pastLock = finalDy < -slideLockThreshold;
        if (behaviour === "canceling" && pastCancel) state = "cancelMode";
        else if (behaviour === "locking" && pastLock) state = "locked";
      }

      releaseHandledRef.current = true;
      userBehaviourRef.current = "none";

      if (state === "locked") {
        recordingStateRef.current = "locked";
        setRecordingState("locked");
        panTranslationX.value = withSpring(0);
        panTranslationY.value = withSpring(0);
        releaseHandledRef.current = false;
        onRecordingLocked?.();
        return;
      }

      if (state === "cancelMode") {
        cancelRecording();
        releaseHandledRef.current = false;
        return;
      }

      stopRecordingAndSend("release");
    },
    [
      cancelRecording,
      stopRecordingAndSend,
      panTranslationX,
      panTranslationY,
      slideCancelThreshold,
      slideLockThreshold,
      isRTL,
      onRecordingLocked,
    ],
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

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        clearInterval((recordingTimerRef as any)._waveformInterval);
      }
    };
  }, []);

  const checkPermissionRef = useRef(checkPermissionAndStartRecording);
  const handlePanUpdateRef = useRef(handlePanUpdate);
  const handleGestureReleaseRef = useRef(handleGestureRelease);

  useEffect(() => {
    checkPermissionRef.current = checkPermissionAndStartRecording;
  }, [checkPermissionAndStartRecording]);
  useEffect(() => {
    handlePanUpdateRef.current = handlePanUpdate;
  }, [handlePanUpdate]);
  useEffect(() => {
    handleGestureReleaseRef.current = handleGestureRelease;
  }, [handleGestureRelease]);

  const dispatchCheckPermission = useCallback(() => {
    checkPermissionRef.current();
  }, []);
  const dispatchPanUpdate = useCallback((dx: number, dy: number) => {
    handlePanUpdateRef.current(dx, dy);
  }, []);
  const dispatchGestureRelease = useCallback((dx?: number, dy?: number) => {
    handleGestureReleaseRef.current(dx, dy);
  }, []);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const dispatchPanStart = useCallback(() => {
    touchStartTimeRef.current = Date.now();
    cancelHoldTimer();
    if (recordingStateRef.current !== "idle") return;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      checkPermissionRef.current();
    }, HOLD_TO_START_MS);
  }, [cancelHoldTimer]);

  const dispatchPanUpdateWithTranslation = useCallback(
    (dx: number, dy: number) => {
      if (recordingStateRef.current === "idle" && holdTimerRef.current) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > HOLD_MOVE_CANCEL_THRESHOLD) {
          cancelHoldTimer();
        }
      } else {
        handlePanUpdateRef.current(dx, dy);
      }
    },
    [cancelHoldTimer],
  );

  const dispatchPanEnd = useCallback(
    (dx?: number, dy?: number) => {
      cancelHoldTimer();
      if (recordingStateRef.current === "idle") return;
      handleGestureReleaseRef.current(dx, dy);
    },
    [cancelHoldTimer],
  );

  useEffect(() => {
    return () => cancelHoldTimer();
  }, [cancelHoldTimer]);

  const composedGesture = useMemo(() => {
    return Gesture.Pan()
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        "worklet";
        runOnJS(dispatchPanStart)();
      })
      .onUpdate((e) => {
        "worklet";
        runOnJS(dispatchPanUpdateWithTranslation)(e.translationX, e.translationY);
      })
      .onEnd((e) => {
        "worklet";
        runOnJS(dispatchPanEnd)(e.translationX, e.translationY);
      });
  }, [dispatchPanStart, dispatchPanUpdateWithTranslation, dispatchPanEnd]);

  return {
    recordingState,
    recordingDuration,
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
