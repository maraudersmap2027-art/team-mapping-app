import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { Position, PositionOptions } from '@capacitor/geolocation';

export async function getCurrentDevicePosition(options: PositionOptions = {}): Promise<Position> {
  const settings: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 25000,
    maximumAge: 0,
    ...options,
  };

  if (Capacitor.isNativePlatform()) {
    let permission = await Geolocation.checkPermissions();
    if (permission.location !== 'granted') {
      permission = await Geolocation.requestPermissions({ permissions: ['location'] });
    }
    if (permission.location !== 'granted') {
      throw new Error('FieldLink needs location permission. In Android Settings, open Apps → FieldLink → Permissions → Location and choose Allow only while using the app. Turn on Precise location.');
    }
    try {
      return await Geolocation.getCurrentPosition(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('0007') || message.toLowerCase().includes('location services')) {
        throw new Error('Android Location is turned off. Turn on Location in Quick Settings, then try again.');
      }
      if (message.includes('0018') || message.toLowerCase().includes('not declared')) {
        throw new Error('This FieldLink APK is missing Android location permissions. Install the newest APK build.');
      }
      throw new Error('Could not get GPS location: ' + message);
    }
  }

  if (!navigator.geolocation) throw new Error('Location is not supported on this device.');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        coords: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        },
        timestamp: position.timestamp,
      }),
      error => reject(new Error(error.message || 'Browser location permission was denied.')),
      settings,
    );
  });
}


export type DeviceCoordinates = { latitude: number; longitude: number; accuracy: number };

export async function watchDevicePosition(
  onPosition: (coordinates: DeviceCoordinates) => void,
  onError: (error: unknown) => void,
  options: PositionOptions = {},
): Promise<() => void> {
  const settings: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 25000,
    maximumAge: 5000,
    ...options,
  };

  if (Capacitor.isNativePlatform()) {
    let permission = await Geolocation.checkPermissions();
    if (permission.location !== 'granted') {
      permission = await Geolocation.requestPermissions({ permissions: ['location'] });
    }
    if (permission.location !== 'granted') {
      throw new Error('FieldLink needs location permission. In Android Settings, open Apps → FieldLink → Permissions → Location and choose Allow only while using the app.');
    }
    const watchId = await Geolocation.watchPosition(settings, (position, error) => {
      if (error) onError(error);
      else if (position) onPosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
    });
    return () => { void Geolocation.clearWatch({ id: watchId }); };
  }

  if (!navigator.geolocation) throw new Error('Location is not supported on this device.');
  const watchId = navigator.geolocation.watchPosition(
    position => onPosition({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    }),
    error => onError(new Error(error.message || 'Browser location permission was denied.')),
    settings,
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
