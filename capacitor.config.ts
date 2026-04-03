import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.praneeth.nocturnalecho',
  appName: 'Nocturnal Echo',
  webDir: 'dist',
  server: {
    url: 'https://nocturnal-production.up.railway.app',
    cleartext: true
  }
};
export default config;
