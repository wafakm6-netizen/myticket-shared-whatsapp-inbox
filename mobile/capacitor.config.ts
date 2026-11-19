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
    // The web view fills the whole screen (under the status bar and home indicator); the inbox pads those areas
    // itself in its own colours, so no white bands show above or below it.
    contentInset: 'never',
    backgroundColor: '#ffffff',
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 1800, launchFadeOutDuration: 250, backgroundColor: '#ffffff', showSpinner: false },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    // The inbox moves the composer itself when the keyboard starts opening (see NativeBridge), instead of iOS
    // resizing the whole web view after the keyboard has finished animating.
    Keyboard: { resize: 'none', resizeOnFullScreen: true },
  },
}

export default config
