import type { CapacitorConfig } from '@capacitor/cli'

// The shell loads the deployed web app, so web releases reach the iOS app
// without a new TestFlight build. Override with APP_URL when building.
const appUrl = process.env.APP_URL || 'https://whatsapp.myticketom.com'

const config: CapacitorConfig = {
  appId: process.env.IOS_BUNDLE_ID || 'com.myticketom.inbox',
  appName: 'Myticket Inbox',
  webDir: 'www',
  server: {
    url: appUrl,
    cleartext: false,
    allowNavigation: [new URL(appUrl).hostname, '*.supabase.co'],
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#ffffff',
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#ffffff' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
  },
}

export default config
