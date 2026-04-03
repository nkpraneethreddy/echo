export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  profilePhoto?: string;
  age: string;
  identity: string;
  windDownTime?: string;
  journalingReason?: string;
  createdAt: string;
  restorationCredits?: number;
  lastFreeCreditDate?: string;
  restoredDates?: string[];
  isSubscribed?: boolean;
}

export interface JournalEntry {
  id: string;
  uid: string;
  date: string;
  timestamp: string;
  content: string;
  mood: string;
  location: string;
  interpretation?: {
    poem?: string;
    quote?: string;
  };
}

export interface GiftCode {
  id: string;
  createdBy: string;
  duration: '1month' | '3months' | 'lifetime';
  redeemed: boolean;
  redeemedBy: string | null;
  createdAt: any;
  expiresAt: any;
  revenueCatPurchaseId: string;
}

export type Screen = 'auth' | 'welcome' | 'reflect' | 'reveal' | 'journey' | 'settings' | 'paywall' | 'restoration' | 'missed-entry';
