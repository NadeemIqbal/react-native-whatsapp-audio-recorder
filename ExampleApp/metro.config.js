const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The library is consumed via `file:..`, so Metro watches the repo root to pick
 * up live edits to `src`. The repo root also contains a stray
 * `node_modules/react-native` (a newer version) from earlier tooling; we block
 * it and force every bare import to resolve from THIS app's node_modules so the
 * single React Native / React / Reanimated copies are used.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: exclusionList([
      new RegExp(`${path.resolve(root, 'node_modules')}/.*`),
    ]),
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: new Proxy(
      {'react-native-whatsapp-audio-recorder': root},
      {
        get: (target, name) =>
          name in target
            ? target[name]
            : path.join(__dirname, 'node_modules', name),
      },
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
