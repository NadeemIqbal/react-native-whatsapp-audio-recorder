/**
 * Shared recording overlay UI for WhatsApp-style audio recorder.
 */
import React, { memo, useMemo } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  Animated as RNAnimated,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
  type SharedValue,
} from "react-native-reanimated";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import type { RecordingState } from "./useWhatsAppAudioRecorder";

export interface AudioRecorderOverlayProps {
  recordingState: RecordingState;
  recordingDuration: number;
  waveformAnims: RNAnimated.Value[];
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

const AudioRecorderOverlay: React.FC<AudioRecorderOverlayProps> = ({
  recordingState,
  recordingDuration,
  waveformAnims,
  panTranslationX,
  panTranslationY,
  slideCancelThreshold,
  slideLockThreshold,
  isRTL,
  formatDuration,
  onLockedCancel,
  onLockedStop,
  onLockedSend,
  variant = "chat",
  colors: colorsProp,
  style,
  textStyle,
}) => {
  const colors = { ...DEFAULT_COLORS, ...colorsProp };
  const styles = useMemo(
    () => createStyles(colors, variant),
    [colors, variant],
  );

  const waveformColorStyle = useAnimatedStyle(() => {
    const cancelProgress = isRTL
      ? interpolate(
          panTranslationX.value,
          [0, slideCancelThreshold],
          [0, 1],
        )
      : interpolate(
          panTranslationX.value,
          [-slideCancelThreshold, 0],
          [1, 0],
        );
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

  const inCancelMode = recordingState === "cancelMode";
  const inLocked = recordingState === "locked";

  if (inLocked) {
    return (
      <View style={[styles.lockedOuter, style]}>
        <View style={styles.lockedWhiteBox}>
          <View style={styles.lockedTopRow}>
            <Text style={[styles.timerText, { color: colors.cancel }, textStyle]}>
              {formatDuration(recordingDuration)}
            </Text>
            <View style={styles.lockedWaveformContainer}>
              {waveformAnims.map((anim, i) => (
                <RNAnimated.View
                  key={i}
                  style={[
                    styles.waveformBar,
                    {
                      height: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 24],
                      }),
                    },
                  ]}
                >
                  <Animated.View
                    style={[
                      StyleSheet.absoluteFill,
                      styles.waveformBarFill,
                      { backgroundColor: colors.textMuted },
                    ]}
                  />
                </RNAnimated.View>
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
        <Text style={[styles.timerText, { color: colors.cancel }, textStyle]}>
          {formatDuration(recordingDuration)}
        </Text>
      </View>

      <Animated.View style={[styles.waveformContainer, slideIndicatorStyle]}>
        {waveformAnims.map((anim, i) => (
          <RNAnimated.View
            key={i}
            style={[
              styles.waveformBar,
              {
                height: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [4, 24],
                }),
              },
            ]}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.waveformBarFill,
                waveformColorStyle,
              ]}
            />
          </RNAnimated.View>
        ))}
      </Animated.View>

      {!inCancelMode && (
        <Text
          style={[styles.slideHint, { color: colors.textMuted }, textStyle]}
        >
          Slide up to lock
        </Text>
      )}

      {inCancelMode && (
        <Text
          style={[styles.slideHint, { color: colors.cancel, fontWeight: "600" }, textStyle]}
        >
          Release to Cancel
        </Text>
      )}
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
    slideHint: {
      marginLeft: 4,
      fontSize: 12,
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
