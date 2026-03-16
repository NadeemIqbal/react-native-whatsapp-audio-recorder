# Example App - react-native-whatsapp-audio-recorder

Example React Native 0.79 project demonstrating the WhatsApp-style audio recorder.

## Setup

```bash
npm install
```

### iOS (macOS only)

iOS builds require **macOS** with Xcode and CocoaPods installed:

```bash
cd ios && pod install && cd ..
```

## Run

```bash
# Start Metro
npm start

# Android (in another terminal)
npm run android

# iOS (macOS only - requires Xcode)
npm run ios
```

## Usage

- **Long press** the mic button to start recording
- **Slide left** (or right in RTL) to cancel
- **Slide up** to lock recording (hands-free mode)
- In locked mode: Delete, Pause, or Send

## Dependencies

This example uses RN 0.79 with:
- react-native-gesture-handler
- react-native-reanimated
- react-native-nitro-sound
- react-native-blob-util
- react-native-vector-icons
