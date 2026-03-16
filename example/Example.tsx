/**
 * Example usage of react-native-whatsapp-audio-recorder
 *
 * Usage in your app:
 * 1. Install: npm install react-native-whatsapp-audio-recorder
 * 2. Ensure peer deps: react-native-gesture-handler, react-native-reanimated,
 *    react-native-nitro-sound, react-native-blob-util, react-native-vector-icons
 * 3. Wrap your app with GestureHandlerRootView
 * 4. Use the hook and overlay as shown below
 */
import React, { memo } from "react";
import { View, Pressable, StyleSheet, Text, I18nManager } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

import {
  useWhatsAppAudioRecorder,
  AudioRecorderOverlay,
  formatDuration,
} from "../src";

const Example: React.FC = () => {
  const recorder = useWhatsAppAudioRecorder({
    recordingPath: "example_audio_recording",
    onStopAndSend: async ({ filePath, durationMs }) => {
      console.log("Recording saved:", filePath, "Duration:", durationMs);
      const RNBlobUtil = require("react-native-blob-util").default;
      RNBlobUtil.fs.unlink(filePath).catch(() => {});
    },
    onBeforeStart: async () => true,
  });

  const {
    recordingState,
    recordingDuration,
    isRecording,
    composedGesture,
    waveformAnims,
    panTranslationX,
    panTranslationY,
    micScale,
    slideCancelThreshold,
    slideLockThreshold,
    handleLockedStop,
    handleLockedSend,
    handleLockedCancel,
  } = recorder;

  const isRTL = I18nManager.isRTL;
  const micButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micScale.value }],
  }));

  const content =
    recordingState === "locked" || isRecording ? (
      <AudioRecorderOverlay
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        waveformAnims={waveformAnims}
        panTranslationX={panTranslationX}
        panTranslationY={panTranslationY}
        slideCancelThreshold={slideCancelThreshold}
        slideLockThreshold={slideLockThreshold}
        isRTL={isRTL}
        formatDuration={formatDuration}
        onLockedCancel={handleLockedCancel}
        onLockedStop={handleLockedStop}
        onLockedSend={handleLockedSend}
        variant="standalone"
      />
    ) : (
      <View style={styles.micRow}>
        <Text style={styles.label}>Hold to record</Text>
        <Animated.View style={micButtonAnimatedStyle}>
          <Pressable style={[styles.micButton, isRecording && styles.micRecording]}>
            <MaterialIcons
              name="mic"
              size={24}
              color={isRecording ? "#FF3B30" : "#5F5E5F"}
            />
          </Pressable>
        </Animated.View>
      </View>
    );

  return (
    <View style={styles.container}>
      {recordingState === "locked" ? (
        content
      ) : (
        <GestureDetector gesture={composedGesture}>
          <View style={styles.gestureWrapper}>{content}</View>
        </GestureDetector>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  gestureWrapper: {
    minHeight: 44,
  },
  micRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: "#8E8E93",
  },
  micButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  micRecording: {
    backgroundColor: "rgba(255,59,48,0.1)",
  },
});

export default memo(Example);
