import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'space.eatit.app',
  appName: 'Homie',
  webDir: 'dist/eat_it_ng/browser',
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      updateUrl: '',
      channelUrl: '',
      appReadyTimeout: 30000,
      responseTimeout: 20,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
    },
  },
};

export default config;
