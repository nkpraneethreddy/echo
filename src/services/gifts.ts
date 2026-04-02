import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  query, 
  where, 
  getDocs, 
  Timestamp, 
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { GiftCode } from '../types';

const GIFT_CODES_COLLECTION = 'giftCodes';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Generates a unique 12-character gift code (e.g. ECHO-X7K2-M9PQ)
 */
function generateCodeString(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 for clarity
  const part1 = Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  const part2 = Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  return `ECHO-${part1}-${part2}`;
}

/**
 * Creates a gift code document in Firestore after a successful purchase.
 */
export async function generateGiftCode(uid: string, duration: '1month' | '3months' | 'lifetime', purchaseId: string): Promise<string> {
  const code = generateCodeString();
  const createdAt = serverTimestamp();
  const expiresAt = Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  const giftData = {
    createdBy: uid,
    duration,
    redeemed: false,
    redeemedBy: null,
    createdAt,
    expiresAt,
    revenueCatPurchaseId: purchaseId
  };

  try {
    await setDoc(doc(db, GIFT_CODES_COLLECTION, code), giftData);
    return code;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${GIFT_CODES_COLLECTION}/${code}`);
    return ''; // Unreachable
  }
}

/**
 * Redeems a gift code for the current user.
 */
export async function redeemGiftCode(uid: string, code: string): Promise<{ success: boolean; error?: string }> {
  const path = `${GIFT_CODES_COLLECTION}/${code}`;
  try {
    const codeRef = doc(db, GIFT_CODES_COLLECTION, code);
    const codeSnap = await getDoc(codeRef);

    if (!codeSnap.exists()) {
      return { success: false, error: 'Invalid gift code.' };
    }

    const data = codeSnap.data();
    if (data.redeemed) {
      return { success: false, error: 'This code has already been redeemed.' };
    }

    const now = Timestamp.now();
    if (data.expiresAt && data.expiresAt.toMillis() < now.toMillis()) {
      return { success: false, error: 'This code has expired.' };
    }

    // Mark as redeemed
    await updateDoc(codeRef, {
      redeemed: true,
      redeemedBy: uid,
      redeemedAt: serverTimestamp()
    });

    // Upgrade user
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      isSubscribed: true,
      subscriptionType: data.duration,
      subscriptionSource: 'gift',
      giftRedeemedAt: serverTimestamp()
    });

    return { success: true };
  } catch (error: any) {
    if (error.message && error.message.includes('permission')) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    console.error('Error redeeming gift code:', error);
    return { success: false, error: error.message || 'Failed to redeem code.' };
  }
}

/**
 * Returns the list of gift codes purchased by the user.
 */
export async function getUserGiftHistory(uid: string): Promise<GiftCode[]> {
  try {
    const q = query(collection(db, GIFT_CODES_COLLECTION), where('createdBy', '==', uid));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as GiftCode));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, GIFT_CODES_COLLECTION);
    return [];
  }
}
