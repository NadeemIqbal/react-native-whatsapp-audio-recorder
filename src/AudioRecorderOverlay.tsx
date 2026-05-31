/**
 * Shared recording overlay UI for WhatsApp-style audio recorder.
 *
 * Everything that moves during a gesture is driven on the UI thread: the
 * waveform heights, the cancel-color, the slide offset, the "slide up to lock" /
 * "release to cancel" hint crossfade, and the recording timer (bound to a shared
 * value via animated text). Recording therefore causes no per-frame React render.
 */
import React, { memo, useMemo } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  TextInput,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import type { RecordingState } from "./useWhatsAppAudioRecorder";
import { formatDuration, formatDurationWorklet } from "./formatDuration";

export interface AudioRecorderOverlayProps {
  recordingState: RecordingState;
  /** Coarse (1 Hz) duration in ms, for non-animated consumers. */
  recordingDuration: number;
  /** UI-thread duration (ms) used to drive the timer without re-renders. */
  recordingDurationSV: SharedValue<number>;
  waveformAnims: SharedValue<number>[];
  panTranslationX: SharedValue<number>;
  panTranslationY: SharedValue<number>;
  slideCancelThreshold: number;
  slideLockThreshold: number;
  isRTL: boolean;
  formatDuration: (ms: number) => string;
  onLockedCancel: () => void;
  onLockedStop: () => void;
  onLockedSend: () => void;
  /** Layout variant: "chat" (pill style) or "standalone" */
  variant?: "chat" | "standalone";
  /** Optional theme colors */
  colors?: {
    primary?: string;
    cancel?: string;
    background?: string;
    text?: string;
    textMuted?: string;
  };
  /** Optional style overrides */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const DEFAULT_COLORS = {
  primary: "#34C759",
  cancel: "#FF3B30",
  background: "#FFFFFF",
  text: "#000000",
  textMuted: "#8E8E93",
};

/** Style prop type accepted by reanimated's Animated.View (allows animated styles). */
type AnimatedViewStyle = React.ComponentProps<typeof Animated.View>["style"];

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Static reset so the animated TextInput lays out like a Text node. */
const durationInputStyles = StyleSheet.create({
  reset: {
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
});

interface DurationTextProps {
  sv: SharedValue<number>;
  style: StyleProp<TextStyle>;
}

/**
 * Recording timer rendered as an (uneditable) animated TextInput so its text is
 * updated on the UI thread from `recordingDurationSV`, with zero React re-render.
 */
const DurationText: React.FC<DurationTextProps> = memo(({ sv, style }) => {
  const animatedProps = useAnimatedProps(
    () => ({ text: formatDurationWorklet(sv.value) }) as Partial<{ text: string }>,
  );
  return (
    <AnimatedTextInput
      editable={false}
      pointerEvents="none"
      underlineColorAndroid="transparent"
      defaultValue={formatDuration(0)}
      // @ts-expect-error `text` is a valid native TextInput prop driven by reanimated.
      animatedProps={animatedProps}
      style={[durationInputStyles.reset, style]}
    />
  );
});

interface WaveformBarProps {
  anim: SharedValue<number>;
  barStyle: StyleProp<ViewStyle>;
  fillStyle: AnimatedViewStyle;
}

/**
 * A single waveform bar. The height tween runs entirely on the UI thread via
 * reanimated (the amplitude shared value is driven from the hook), so the
 * waveform never blocks the JS thread during gesture handling.
 */
const WaveformBar: React.FC<WaveformBarProps> = memo(
  ({ anim, barStyle, fillStyle }) => {
    const heightStyle = useAnimatedStyle(() => ({
      height: interpolate(anim.value, [0, 1], [4, 24]),
    }));
    return (
      <Animated.View style={[barStyle, heightStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, fillStyle]} />
      </Animated.View>
    );
  },
);

const AudioRecorderOverlay: React.FC<AudioRecorderOverlayProps> = ({
  recordingState,
  recordingDurationSV,
  waveformAnims,
  panTranslationX,
  slideCancelThreshold,
  isRTL,
  onLockedCancel,
  onLockedStop,
  onLockedSend,
  variant = "chat",
  colors: colorsProp,
  style,
  textStyle,
}) => {
  // Memoize so `colors` keeps a stable identity and the StyleSheet is not
  // rebuilt every render.
  const colors = useMemo(
    () => ({ ...DEFAULT_COLORS, ...colorsProp }),
    [
      colorsProp?.primary,
      colorsProp?.cancel,
      colorsProp?.background,
      colorsProp?.text,
      colorsProp?.textMuted,
    ],
  );
  const styles = useMemo(
    () => createStyles(colors, variant),
    [colors, variant],
  );

  // Cancel progress (0 = recording, 1 = past cancel threshold), UI thread.
  const waveformColorStyle = useAnimatedStyle(() => {
    const cancelProgress = isRTL
      ? interpolate(panTranslationX.value, [0, slideCancelThreshold], [0, 1])
      : interpolate(panTranslationX.value, [-slideCancelThreshold, 0], [1, 0]);
    return {
      backgroundColor: cancelProgress > 0.5 ? colors.cancel! : colors.primary!,
    };
  }, [slideCancelThreshold, isRTL, colors.cancel, colors.primary]);

  const slideIndicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: isRTL
            ? panTranslationX.value > 0
              ? panTranslationX.value
              : 0
            : panTranslationX.value < 0
              ? panTranslationX.value
              : 0,
        },
      ],
    }),
    [isRTL],
  );

  // Crossfade the two hints on the UI thread so crossing the cancel threshold
  // never depends on a React render.
  const hintLockStyle = useAnimatedStyle(() => {
    const p = isRTL
      ? interpolate(
          panTranslationX.value,
          [0, slideCancelThreshold],
          [0, 1],
          Extrapolation.CLAMP,
        )
      : interpolate(
          panTranslationX.value,
          [-slideCancelThreshold, 0],
          [1, 0],
          Extrapolation.CLAMP,
        );
    return { opacity: 1 - p };
  }, [slideCancelThreshold, isRTL]);

  const hintCancelStyle = useAnimatedStyle(() => {
    const p = isRTL
      ? interpolate(
          panTranslationX.value,
          [0, slideCancelThreshold],
          [0, 1],
          Extrapolation.CLAMP,
        )
      : interpolate(
          panTranslationX.value,
          [-slideCancelThreshold, 0],
          [1, 0],
          Extrapolation.CLAMP,
        );
    return { opacity: p };
  }, [slideCancelThreshold, isRTL]);

  const inLocked = recordingState === "locked";

  if (inLocked) {
    return (
      <View style={[styles.lockedOuter, style]}>
        <View style={styles.lockedWhiteBox}>
          <View style={styles.lockedTopRow}>
            <DurationText
              sv={recordingDurationSV}
              style={[styles.timerText, { color: colors.cancel }, textStyle]}
            />
            <View style={styles.lockedWaveformContainer}>
              {waveformAnims.map((anim, i) => (
                <WaveformBar
                  key={i}
                  anim={anim}
                  barStyle={styles.waveformBar}
                  fillStyle={[
                    styles.waveformBarFill,
                    { backgroundColor: colors.textMuted },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.lockedBottomRow}>
            <Pressable onPress={onLockedCancel} hitSlop={8} style={styles.lockedSideButton}>
              <MaterialIcons
                name="delete-outline"
                size={24}
                color={colors.textMuted}
              />
            </Pressable>

            <Pressable onPress={onLockedStop} hitSlop={8} style={styles.lockedPauseButton}>
              <MaterialIcons name="pause" size={28} color={colors.cancel} />
            </Pressable>

            <Pressable
              onPress={onLockedSend}
              hitSlop={8}
              style={[styles.lockedSendCircle, { backgroundColor: colors.primary }]}
            >
              <MaterialIcons name="send" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.recordingOverlay, style]}>
      <View style={styles.recordingIndicator}>
        <View style={[styles.recordingDot, { backgroundColor: colors.cancel }]} />
        <DurationText
          sv={recordingDurationSV}
          style={[styles.timerText, { color: colors.cancel }, textStyle]}
        />
      </View>

      <Animated.View style={[styles.waveformContainer, slideIndicatorStyle]}>
        {waveformAnims.map((anim, i) => (
          <WaveformBar
            key={i}
            anim={anim}
            barStyle={styles.waveformBar}
            fillStyle={[styles.waveformBarFill, waveformColorStyle]}
          />
        ))}
      </Animated.View>

      <View style={styles.hintContainer}>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.slideHint,
            styles.hintSizer,
            { color: colors.cancel, fontWeight: "600" },
            textStyle,
            hintCancelStyle,
          ]}
        >
          Release to Cancel
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.slideHint,
            styles.hintAbsolute,
            { color: colors.textMuted },
            textStyle,
            hintLockStyle,
          ]}
        >
          Slide up to lock
        </Animated.Text>
      </View>
    </View>
  );
};

const createStyles = (
  colors: typeof DEFAULT_COLORS,
  variant: "chat" | "standalone",
) =>
  StyleSheet.create({
    recordingOverlay: {
      flex: variant === "chat" ? 1 : undefined,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      ...(variant === "chat" && {
        backgroundColor: colors.background,
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: 44,
      }),
      ...(variant === "standalone" && {
        paddingVertical: 12,
        paddingHorizontal: 4,
        backgroundColor: colors.background,
        borderRadius: 12,
      }),
    },
    recordingIndicator: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    recordingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    timerText: {
      fontSize: 14,
      fontWeight: "500",
      minWidth: 40,
    },
    waveformContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      height: 28,
      minWidth: 60,
    },
    waveformBar: {
      width: 3,
      borderRadius: 1.5,
      overflow: "hidden",
    },
    waveformBarFill: {
      borderRadius: 1.5,
    },
    hintContainer: {
      marginLeft: 4,
      justifyContent: "center",
    },
    slideHint: {
      fontSize: 12,
    },
    hintSizer: {
      // In-flow element that sizes the hint area (the longer of the two texts).
    },
    hintAbsolute: {
      position: "absolute",
      left: 0,
      right: 0,
    },
    lockedOuter: {
      alignSelf: "stretch",
    },
    lockedWhiteBox: {
      flexDirection: "column",
      gap: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.background,
      borderRadius: 12,
      overflow: "hidden",
      minHeight: 120,
    },
    lockedTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 32,
    },
    lockedWaveformContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      height: 28,
      minWidth: 80,
    },
    lockedBottomRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingVertical: 4,
    },
    lockedSideButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    lockedPauseButton: {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    lockedSendCircle: {
      width: 52,
      height: 52,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
  });

export default memo(AudioRecorderOverlay);
