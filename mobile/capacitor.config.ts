import type { CapacitorConfig } from '@capacitor/cli'

// The app is a native shell around the live inbox, so every website update reaches the app without a store release.
const config: CapacitorConfig = {
  appId: 'com.myticketom.inbox',
  appName: 'Myticket Inbox',
  webDir: 'www',
  // Lets the website recognise the app (e.g. to skip the browser notification prompt).
  appendUserAgent: 'MyticketInboxApp',
  server: {
    url: 'https://whatsapp.myticketom.com',
    cleartext: false,
    errorPath: 'index.html',
  },
  ios: { contentInset: 'never', scrollEnabled: true, limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: true, backgroundColor: '#ffffff', showSpinner: false },
  },
}

export default config
