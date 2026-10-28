// Crew location: docs/plans/phase-3-sos.md §3.6.
// - Standby (on duty, no job): a foreground-only watch, every 30 s / 50 m, so
//   dispatch can find the nearest crews. Nothing is sent from the background.
// - Active job: every ~4 s through a background task with an Android
//   foreground service (persistent notification) and the iOS blue indicator.
//   It stops as soon as the job is handed over, cancelled or reassigned.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { ApiClient, Schemas } from '@repo/api-client';

export const JOB_LOCATION_TASK = 'crew-job-location';

/**
 * The task posts through the app's API client (and its session). The service
 * is killed with the app (`killServiceOnDestroy`), so the task never runs
 * without the app's JS context; reopening the app restarts tracking.
 */
let taskApi: ApiClient | null = null;

type Point = Schemas['CrewLocation']['points'][number];

const toPoint = (l: Location.LocationObject): Point => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  ...(l.coords.accuracy != null ? { accuracyM: Math.min(Math.round(l.coords.accuracy), 10_000) } : {}),
  at: new Date(l.timestamp).toISOString(),
});

/** Sends fixes and drops failures: the next fix follows within seconds, and only the newest one matters. */
async function send(api: ApiClient, locations: Location.LocationObject[]) {
  if (locations.length === 0) return;
  await api.POST('/v1/crew/location', { body: { points: locations.slice(-50).map(toPoint) } }).catch(() => undefined);
}

// Must be defined at module top level, before any update arrives.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(JOB_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data || !taskApi) return;
  await send(taskApi, data.locations);
});

export async function hasLocationPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  return (await Location.requestForegroundPermissionsAsync()).granted;
}

/** A fresh fix can take long indoors (or never come); going on duty never waits longer than this. */
const FIX_TIMEOUT_MS = 8_000;

/** Best fix available now: last known if recent, else a fresh one. Null without permission, GPS or a fix in time. */
export async function currentPoint(): Promise<Schemas['GeoPoint'] | null> {
  try {
    if (!(await hasLocationPermission())) return null;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));
    const fix = (await Location.getLastKnownPositionAsync({ maxAge: 60_000 })) ?? (await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]));
    if (!fix) return null;
    const { at: _at, ...point } = toPoint(fix);
    return point;
  } catch {
    return null;
  }
}

/** Standby updates while the app is open. Returns a stop function. */
export async function watchStandby(api: ApiClient): Promise<() => void> {
  if (!(await hasLocationPermission())) return () => undefined;
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 30_000, distanceInterval: 50 }, (l) => void send(api, [l]));
  return () => sub.remove();
}

export interface TrackingNotice {
  title: string;
  body: string;
}

/** Starts job tracking (no-op if running). False when location permission is refused. */
export async function startJobTracking(api: ApiClient, notice: TrackingNotice): Promise<boolean> {
  taskApi = api;
  if (!(await hasLocationPermission())) return false;
  if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) return true;
  await Location.startLocationUpdatesAsync(JOB_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 4_000,
    distanceInterval: 0,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: notice.title, notificationBody: notice.body, killServiceOnDestroy: true },
  });
  return true;
}

export async function stopJobTracking() {
  if (await TaskManager.isTaskRegisteredAsync(JOB_LOCATION_TASK).catch(() => false)) {
    if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(JOB_LOCATION_TASK);
  }
}

export async function isTrackingJob(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK).catch(() => false);
}
