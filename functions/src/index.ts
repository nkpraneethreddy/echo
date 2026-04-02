import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const fcm = admin.messaging();

/**
 * Triggered when a gift code is redeemed.
 * Sends a push notification to the gifter.
 */
export const onGiftCodeRedeemed = onDocumentUpdated('giftCodes/{code}', async (event) => {
  const newData = event.data?.after.data();
  const oldData = event.data?.before.data();

  if (!newData || !oldData) return;

  // Only trigger if redeemed status changed to true
  if (newData.redeemed && !oldData.redeemed) {
    const gifterUid = newData.createdBy;

    try {
      // Fetch gifter's FCM token (assuming stored in user profile)
      const gifterDoc = await db.collection('users').doc(gifterUid).get();
      const gifterData = gifterDoc.data();

      if (gifterData && gifterData.fcmToken) {
        const message = {
          notification: {
            title: 'Gift Redeemed! 🌙',
            body: `Your gift of ${newData.duration} has been redeemed. Thank you for sharing the Echo.`
          },
          token: gifterData.fcmToken
        };
        await fcm.send(message);
        console.log(`Notification sent to gifter: ${gifterUid}`);
      }
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }
});

/**
 * Scheduled function to clean up expired codes older than 90 days.
 * Runs daily.
 */
export const cleanupExpiredCodes = onSchedule('every 24 hours', async (event) => {
  const now = admin.firestore.Timestamp.now();
  const snapshot = await db.collection('giftCodes')
    .where('redeemed', '==', false)
    .where('expiresAt', '<', now)
    .get();

  if (snapshot.empty) {
    console.log('No expired codes to clean up.');
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`Deleted ${snapshot.size} expired gift codes.`);
});
