import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teammapping.fieldlink',
  appName: 'FieldLink',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;