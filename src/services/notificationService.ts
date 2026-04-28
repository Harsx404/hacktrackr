import { Platform } from 'react-native';
import Constants from 'expo-constants';

let Notifications: any = null;

// Expo Go removed remote push notifications in SDK 53, and importing the package
// throws a hard error. We dynamically import it only if we're in a development build.
if (Constants.appOwnership !== 'expo') {
  try {
    Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (e) {
    console.log('Failed to load expo-notifications', e);
  }
}

export interface HackathonForNotification {
  id: string;
  name: string;
  deadline: string;
}

/**
 * Request notification permissions from the user.
 * Returns true if granted.
 */
export async function registerForNotifications(): Promise<boolean> {
  if (!Notifications || Platform.OS === 'web') return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

/**
 * Schedule a local notification 24h before a hackathon deadline.
 * The notification identifier is the hackathon's ID so it can be cancelled/updated.
 */
export async function scheduleDeadlineReminder(hackathon: HackathonForNotification): Promise<void> {
  if (!Notifications) return;

  const deadline = new Date(hackathon.deadline);
  const reminderTime = new Date(deadline.getTime() - 24 * 60 * 60 * 1000); // 24h before

  // Don't schedule if the reminder time is in the past
  if (reminderTime <= new Date()) return;

  // Cancel any existing reminder for this hackathon first
  await cancelHackathonReminder(hackathon.id);

  await Notifications.scheduleNotificationAsync({
    identifier: hackathon.id,
    content: {
      title: '⏳ Deadline Tomorrow',
      body: `${hackathon.name} deadline is in 24 hours. Don't forget to submit!`,
      data: { hackathonId: hackathon.id },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderTime,
    },
  });
}

/**
 * Cancel a scheduled notification for a specific hackathon.
 */
export async function cancelHackathonReminder(hackathonId: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(hackathonId);
}

/**
 * Sync all reminders against the current list of hackathons.
 * - Cancels notifications for any hackathons not in the list.
 * - Ensures all upcoming hackathons have a reminder scheduled.
 */
export async function syncAllReminders(hackathons: HackathonForNotification[]): Promise<void> {
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync() as Array<{ identifier: string }>;
  const scheduledIds = new Set<string>(scheduled.map((n) => n.identifier));
  const currentIds = new Set(hackathons.map((h) => h.id));

  // Cancel stale reminders (hackathon was deleted or submitted)
  for (const id of scheduledIds) {
    if (!currentIds.has(id)) {
      await cancelHackathonReminder(id);
    }
  }

  // Schedule or refresh reminders for all upcoming hackathons
  for (const hackathon of hackathons) {
    const deadline = new Date(hackathon.deadline);
    if (deadline > new Date()) {
      await scheduleDeadlineReminder(hackathon);
    }
  }
}
