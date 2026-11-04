/**
 * Dev endpoints. The iOS Simulator reaches services on the Mac via localhost.
 * On a real device, set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_POWERSYNC_URL to the Mac's LAN IP.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
export const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL ?? 'http://localhost:8080';
