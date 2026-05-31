# react-native-whatsapp-audio-recorder

WhatsApp-style audio recorder for React Native with **slide to cancel** and **slide up to lock** gestures.

[![npm version](https://img.shields.io/npm/v/react-native-whatsapp-audio-recorder.svg)](https://www.npmjs.com/package/react-native-whatsapp-audio-recorder)
[![GitHub](https://img.shields.io/badge/GitHub-NadeemIqbal%2Freact--native--whatsapp--audio--recorder-blue)](https://github.com/NadeemIqbal/react-native-whatsapp-audio-recorder)

## Demo

<p align="center">
  <img src="https://raw.githubusercontent.com/NadeemIqbal/react-native-whatsapp-audio-recorder/main/demo.gif" alt="WhatsApp-style audio recorder demo" width="320" />
</p>

## Features

- **Hold to record** (reliable touch handling)
- **Slide left/right** (RTL-aware) to cancel
- **Slide up** to lock recording (hands-free mode)
- Locked mode: Delete, Stop, or Send
- Animated waveform
- Fully customizable overlay

## Requirements

This library runs its gesture, waveform, hint, and timer animations entirely on
the UI thread via Reanimated worklets, so it targets the React Native **New
Architecture (Fabric)**.

- **React Native New Architecture (Fabric)** enabled
- **react-native-reanimated v4** (v4 is New-Architecture only). v3 is the minimum
  supported floor if you are still on the old architecture, but v4 is recommended.
- **react-native-gesture-handler v2+**
- **React 18+**, **React Native 0.72+**

## Installation

```bash
npm install react-native-whatsapp-audio-recorder
```

### Peer Dependencies

Install these in your project:

```bash
npm install react-native-gesture-handler react-native-reanimated react-native-nitro-sound react-native-blob-util react-native-vector-icons
```

### Setup

1. Wrap your app with `GestureHandlerRootView` (from `react-native-gesture-handler`)
2. Ensure Reanimated is configured in `babel.config.js`
3. **Android**: Add to `android/app/build.gradle` (before other plugins):
   ```gradle
   apply from: file("../../node_modules/react-native-vector-icons/fonts.gradle")
   ```
4. **iOS**: Run `pod install` in the `ios` folder. Vector icons are bundled via CocoaPods. If icons don't show, add `UIAppFonts` to `Info.plist` with the font names (e.g. `MaterialIcons.ttf`).

## Usage

```tsx
import {
  useWhatsAppAudioRecorder,
  AudioRecorderOverlay,
  formatDuration,
} from "react-native-whatsapp-audio-recorder";
import { GestureDetector } from "react-native-gesture-handler";

function ChatInput() {
  const recorder = useWhatsAppAudioRecorder({
    recordingPath: "voice_message",
    onStopAndSend: async ({ filePath, durationMs, mimeType, fileName }) => {
      await sendVoiceMessage({ filePath, durationMs, mimeType, fileName });
    },
    onBeforeStart: async () => {
      const granted = await requestMicrophonePermission();
      return granted;
    },
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

  return (
    <GestureDetector gesture={composedGesture}>
      <View>
        {isRecording || recordingState === "locked" ? (
          <AudioRecorderOverlay
            recordingState={recordingState}
            recordingDuration={recordingDuration}
            waveformAnims={waveformAnims}
            panTranslationX={panTranslationX}
            panTranslationY={panTranslationY}
            slideCancelThreshold={slideCancelThreshold}
            slideLockThreshold={slideLockThreshold}
            isRTL={I18nManager.isRTL}
            formatDuration={formatDuration}
            onLockedCancel={handleLockedCancel}
            onLockedStop={handleLockedStop}
            onLockedSend={handleLockedSend}
            variant="chat"
          />
        ) : (
          <Pressable>
            <MicIcon />
          </Pressable>
        )}
      </View>
    </GestureDetector>
  );
}
```

## API

### `useWhatsAppAudioRecorder(config)`

| Config | Type | Description |
|--------|------|-------------|
| `recordingPath` | string | Base filename (without extension) |
| `onStopAndSend` | (params) => Promise<void> | Called when user sends. Params include `source`: `"release"` \| `"send"` \| `"stop"` |
| `onCancel` | () => void | Called when user cancels |
| `onBeforeStart` | () => Promise<boolean> | Return false to abort |
| `onVoiceRecordingChange` | (boolean) => void | Optional state callback |
| `onRecordingStarted` | () => void | Optional. Called when recording starts |
| `onRecordingLocked` | () => void | Optional. Called when user slides up to lock |

### `AudioRecorderOverlay`

| Prop | Type | Description |
|------|------|-------------|
| `variant` | "chat" \| "standalone" | Layout style |
| `colors` | object | Theme overrides |
| `formatDuration` | (ms) => string | Duration formatter |

## Performance / threading model

All per-frame animation work runs on the UI thread, so the recorder stays glued
to the finger at native refresh rate even when the JS thread is busy:

- **Gesture state machine** lives inside the pan worklet. Direction detection,
  cancel/lock thresholds, and the offset/lock-icon visuals are computed and
  written on the UI thread every frame. There are zero `runOnJS` hops during a
  continuous slide.
- **State sync to React** happens only on discrete transitions (start, lock,
  cancel, release) via a single `useAnimatedReaction`, so a slide does not
  trigger per-frame re-renders.
- **Waveform** is a self-scheduling UI-thread loop (each bar re-arms its own
  `withTiming` in the completion callback). There is no JS `setInterval` driving
  it, so a jammed JS thread cannot stutter it.
- **Cancel hint** ("Slide up to lock" / "Release to Cancel") crossfades via
  `useAnimatedStyle` opacity, so crossing the threshold costs no React render.
- **Timer** is driven by a shared value rendered through an animated `TextInput`,
  so the MM:SS ticks on the UI thread with no overlay re-render. The public
  `recordingDuration` state still updates, but only once per whole second.

Because every spring now runs on the UI thread, the single tuning point for feel
is the lock/cancel spring (`damping: 15`, `stiffness: 200`).

## Development

```bash
# Run example app
npm run example          # Start Metro
npm run example:android  # Run on Android
npm run example:ios      # Run on iOS
```


## License

MIT
