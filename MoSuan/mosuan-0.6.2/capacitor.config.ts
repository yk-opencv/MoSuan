import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.mosuan.reader',
  appName: '墨算',
  webDir: 'dist',
  android: { allowMixedContent: true, backgroundColor: '#fffefa' },
  server: { androidScheme: 'https', hostname: 'localhost' },
};
export default config;
