/**
 * Example app for react-native-whatsapp-audio-recorder
 * RN 0.79 - Long press to record, slide left to cancel, slide up to lock
 */
import React, { memo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text,
  I18nManager,
  StatusBar,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';

import {
  useWhatsAppAudioRecorder,
  AudioRecorderOverlay,
  formatDuration,
} from 'react-native-whatsapp-audio-recorder';

const RecorderDemo: React.FC = () => {
  const recorder = useWhatsAppAudioRecorder({
    recordingPath: 'example_audio_recording',
    onStopAndSend: async ({ filePath, durationMs, source }) => {
      const messages = {
        release: { text1: 'Recording sent', text2: `Released finger (${(durationMs / 1000).toFixed(1)}s)` },
        send: { text1: 'Recording sent', text2: `Sent (${(durationMs / 1000).toFixed(1)}s)` },
        stop: { text1: 'Recording stopped', text2: `Stopped (${(durationMs / 1000).toFixed(1)}s)` },
      };
      const msg = messages[source ?? 'release'];
      Toast.show({ type: 'success', ...msg });
      const RNBlobUtil = require('react-native-blob-util').default;
      RNBlobUtil.fs.unlink(filePath).catch(() => {});
    },
    onCancel: () => {
      Toast.show({
        type: 'info',
        text1: 'Recording cancelled',
      });
    },
    onRecordingStarted: () => {
      Toast.show({
        type: 'info',
        text1: 'Recording started',
      });
    },
    onRecordingLocked: () => {
      Toast.show({
        type: 'info',
        text1: 'Recording locked',
        text2: 'Release to send or cancel',
      });
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
    recordingState === 'locked' || isRecording ? (
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
          <Pressable
            style={[styles.micButton, isRecording && styles.micRecording]}
          >
            <MaterialIcons
              name="mic"
              size={24}
              color={isRecording ? '#FF3B30' : '#5F5E5F'}
            />
          </Pressable>
        </Animated.View>
      </View>
    );

  return (
    <View style={styles.container}>
      {recordingState === 'locked' ? (
        content
      ) : (
        <GestureDetector gesture={composedGesture}>
          <View style={styles.gestureWrapper}>{content}</View>
        </GestureDetector>
      )}
    </View>
  );
};

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
      <View style={styles.screen}>
        <Text style={styles.title}>WhatsApp Audio Recorder</Text>
        <Text style={styles.subtitle}>
          Long press to record • Slide left to cancel • Slide up to lock
        </Text>
        <RecorderDemo />
      </View>
      <Toast />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  screen: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 24,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  gestureWrapper: {
    minHeight: 52,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: '#8E8E93',
  },
  micButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  micRecording: {
    backgroundColor: 'rgba(255,59,48,0.1)',
  },
});

export default memo(App);
