import React, { useState, useEffect, useRef, FormEvent, ReactNode, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from 'react-error-boundary';
import { 
  Sparkles, 
  Moon, 
  ChevronRight, 
  ArrowLeft, 
  LogOut, 
  Settings as SettingsIcon, 
  BookOpen, 
  History, 
  User, 
  Mail, 
  Lock, 
  Fingerprint, 
  Share2, 
  Download, 
  CheckCircle2, 
  X,
  Sun,
  PenTool,
  Quote,
  MapPin,
  Check,
  Eye,
  EyeOff,
  AlertCircle,
  HeartOff,
  RefreshCw,
  Edit3,
  CloudRain,
  Flame,
  Coffee,
  Waves,
  Bug,
  RotateCcw,
  VolumeX,
  AudioLines,
  Search,
  CalendarDays,
  ChevronLeft,
  ChevronDown,
  Gift,
  Copy,
  Share,
  ExternalLink,
  CreditCard
} from 'lucide-react';
import { generateInterpretation, generatePersonalizedPrompt } from './services/gemini';
import { Screen, UserProfile, JournalEntry, GiftCode } from './types';
import { generateGiftCode, redeemGiftCode, getUserGiftHistory } from './services/gifts';
import { auth, db } from './firebase';
import firebaseConfig from '../firebase-applet-config.json';
import { toPng } from 'html-to-image';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  signInWithPopup, 
  GoogleAuthProvider,
  OAuthProvider,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  getDocFromServer,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';

// --- Error Handling ---

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
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}


// --- Utils ---

const getLocalDateString = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const calculateStreak = (entries: JournalEntry[], userProfile: UserProfile | null) => {
  const entryDates = entries.map(e => getLocalDateString(new Date(e.timestamp)));
  const restoredDates = userProfile?.restoredDates || [];
  
  const uniqueDates = Array.from(new Set([...entryDates, ...restoredDates]))
    .sort((a, b) => b.localeCompare(a)); // Sort descending

  if (uniqueDates.length === 0) return 0;

  const today = getLocalDateString(new Date());
  const yesterday = getLocalDateString(new Date(Date.now() - 86400000));

  // If the most recent entry isn't today or yesterday, the streak is broken
  if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
    return 0;
  }

  let streak = 0;
  let expectedDate = uniqueDates[0];

  for (const date of uniqueDates) {
    if (date === expectedDate) {
      streak++;
      const current = new Date(date + 'T12:00:00');
      current.setDate(current.getDate() - 1);
      expectedDate = getLocalDateString(current);
    } else {
      break;
    }
  }
  
  return streak;
};

// --- Screens ---

function ErrorFallback({ error, resetErrorBoundary }: { error: any, resetErrorBoundary: () => void }) {
  let errorMessage = "An unexpected error occurred.";
  try {
    const parsed = JSON.parse(error.message);
    if (parsed.error) errorMessage = `Security Error: ${parsed.error}`;
  } catch (e) {
    errorMessage = error.message || errorMessage;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-6">
        <div className="inline-flex items-center justify-center p-4 rounded-full bg-error/10 text-error mb-4">
          <AlertCircle className="w-12 h-12" />
        </div>
        <h2 className="font-headline text-3xl text-on-surface">Something went wrong</h2>
        <p className="text-on-surface-variant font-body">{errorMessage}</p>
        <button 
          onClick={() => {
            resetErrorBoundary();
            window.location.reload();
          }}
          className="signature-gradient px-8 py-3 rounded-full text-on-primary font-label uppercase tracking-widest text-sm"
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  );
}

// ─── Premium helpers ──────────────────────────────────────────────────────────
const TRIAL_DAYS = 7;
const FREE_SOUNDS = ['rain']; // rain is free, rest are premium
const PREMIUM_SOUNDS = ['fireplace', 'cafe', 'crickets', 'ocean'];

function isPremiumUser(userProfile: UserProfile | null): boolean {
  if (!userProfile) return false;
  if (userProfile.isSubscribed) return true;
  if (!userProfile.createdAt) return true;
  const diffDays = (Date.now() - new Date(userProfile.createdAt).getTime()) / 86_400_000;
  return diffDays <= TRIAL_DAYS;
}

function trialDaysLeft(userProfile: UserProfile | null): number {
  if (!userProfile?.createdAt) return TRIAL_DAYS;
  const diffDays = (Date.now() - new Date(userProfile.createdAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(TRIAL_DAYS - diffDays));
}

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('auth');
  const navigate = setCurrentScreen;
  const navigateToPaywall = (returnTo: Screen = currentScreen as Screen, trigger: 'poem' | 'library' | 'sound' | 'trial' | 'general' = 'general') => {
    setPaywallReturnScreen(returnTo);
    setPaywallTrigger(trigger);
    setCurrentScreen('paywall');
  };
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [currentEntry, setCurrentEntry] = useState<string>('');
  const [lastInterpretation, setLastInterpretation] = useState<JournalEntry | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isDataReady, setIsDataReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [activeSound, setActiveSound] = useState<string | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [restoringDate, setRestoringDate] = useState<string | null>(null);
  const [paywallReturnScreen, setPaywallReturnScreen] = useState<Screen>('reflect');
  const [paywallTrigger, setPaywallTrigger] = useState<'poem' | 'library' | 'sound' | 'trial' | 'general'>('general');
  const [showTrialWelcome, setShowTrialWelcome] = useState(false);
  // True while firebase user exists but profile hasn't loaded yet.
  // During this window we treat user as premium so no gates flash.
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [missedEntryMode, setMissedEntryMode] = useState<{ date: string; creditType: 'free' | 'paid' } | null>(null);
  const [justRestored, setJustRestored] = useState(false);


  // ── Milestone Celebration ─────────────────────────────────────────────────
  const [milestoneCelebration, setMilestoneCelebration] = useState<{ streak: number } | null>(null);

  // ── App Lock ──────────────────────────────────────────────────────────────
  const [isLocked, setIsLocked] = useState(false);
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount, check if lock is enabled and lock immediately
  useEffect(() => {
    const lockEnabled = localStorage.getItem('ne_lock_enabled') === 'true';
    const lockMethod = localStorage.getItem('ne_lock_method'); // 'biometric' | 'pin'
    if (lockEnabled && lockMethod && firebaseUser) {
      setIsLocked(true);
    }
  }, [firebaseUser]);

  // Lock after 1 min in background
  useEffect(() => {
    const handleVisibilityChange = () => {
      const lockEnabled = localStorage.getItem('ne_lock_enabled') === 'true';
      const lockMethod = localStorage.getItem('ne_lock_method');
      if (!lockEnabled || !lockMethod || !firebaseUser) return;

      if (document.hidden) {
        backgroundTimerRef.current = setTimeout(() => {
          setIsLocked(true);
        }, 60_000);
      } else {
        if (backgroundTimerRef.current) {
          clearTimeout(backgroundTimerRef.current);
          backgroundTimerRef.current = null;
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (backgroundTimerRef.current) clearTimeout(backgroundTimerRef.current);
    };
  }, [firebaseUser]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<{ source: any, interval?: number }[]>([]);

  // Ensure AudioContext exists and is resumed — MUST be called from a user gesture
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Audio Playback Logic using Web Audio API (Synthesized Sounds)
  useEffect(() => {
    const stopCurrentSounds = () => {
      audioNodesRef.current.forEach(node => {
        try {
          if (node.source && node.source.stop) node.source.stop();
          if (node.interval) clearInterval(node.interval);
        } catch (e) {}
      });
      audioNodesRef.current = [];
    };

    // If activeSound changes, stop current sounds
    stopCurrentSounds();

    if (!activeSound) return;

    // Use existing AudioContext (already resumed by user gesture)
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;

    // Resume just in case (will only work if triggered from gesture chain)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const createNoiseBuffer = () => {
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    };

    try {
      if (activeSound === 'rain') {
        const source = ctx.createBufferSource();
        source.buffer = createNoiseBuffer();
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        source.connect(filter);
        filter.connect(ctx.destination);
        source.start();
        audioNodesRef.current.push({ source });
      } else if (activeSound === 'fireplace') {
        const source = ctx.createBufferSource();
        source.buffer = createNoiseBuffer();
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 200;
        const gain = ctx.createGain();
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        
        const interval = window.setInterval(() => {
          if (ctx.state === 'running') {
            gain.gain.linearRampToValueAtTime(Math.random() * 0.7 + 0.3, ctx.currentTime + 0.1);
          }
        }, 200);
        
        audioNodesRef.current.push({ source, interval });
      } else if (activeSound === 'ocean') {
        const source = ctx.createBufferSource();
        source.buffer = createNoiseBuffer();
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        const gain = ctx.createGain();
        gain.gain.value = 0.1;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        
        const oscillate = () => {
          if (ctx.state === 'running') {
            const now = ctx.currentTime;
            gain.gain.exponentialRampToValueAtTime(0.8, now + 4);
            gain.gain.exponentialRampToValueAtTime(0.1, now + 8);
          }
        };
        oscillate();
        const interval = window.setInterval(oscillate, 8000);
        audioNodesRef.current.push({ source, interval });
      } else if (activeSound === 'crickets') {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 3000;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        
        const pulse = () => {
          if (ctx.state === 'running') {
            const now = ctx.currentTime;
            gain.gain.setValueAtTime(0.02, now);
            gain.gain.setValueAtTime(0, now + 0.2);
          }
        };
        pulse();
        const interval = window.setInterval(pulse, 400);
        audioNodesRef.current.push({ source: osc, interval });
      } else if (activeSound === 'cafe') {
        [180, 220, 260].forEach(freq => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.detune.value = Math.random() * 10 - 5;
          const gain = ctx.createGain();
          gain.gain.value = 0.02;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          audioNodesRef.current.push({ source: osc });
        });
      }

    } catch (e) {
      console.error("Web Audio API error:", e);
    }

    return () => {
      stopCurrentSounds();
    };
  }, [activeSound]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch (e) {}
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Check for broken streak and force restoration screen
  useEffect(() => {
    if (isAuthReady && isDataReady && userProfile && entries.length > 0 && currentScreen !== 'restoration' && currentScreen !== 'missed-entry' && !restoringDate && !justRestored) {
      const streak = calculateStreak(entries, userProfile);
      if (streak === 0) {
        // Double check if they already have an entry today (streak 0 might just mean they haven't written yet)
        const today = getLocalDateString(new Date());
        const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
        const hasToday = entries.some(e => getLocalDateString(new Date(e.timestamp)) === today);
        const hasYesterday = entries.some(e => getLocalDateString(new Date(e.timestamp)) === yesterday);
        const hasRestoredYesterday = userProfile.restoredDates?.includes(yesterday);

        if (!hasToday && !hasYesterday && !hasRestoredYesterday) {
          setCurrentScreen('restoration');
        }
      }
    }
  }, [isAuthReady, isDataReady, userProfile, entries, currentScreen, restoringDate]);

  // Auth & Profile Listener
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUserProfile(null);
        setIsProfileLoading(false);
        setIsDataReady(true);
        setIsAuthReady(true);
        navigate('auth');
        return;
      }
      // User is logged in but profile not yet loaded — gate nothing during this window
      setIsProfileLoading(true);

      // Profile Listener
      const profileRef = doc(db, 'users', user.uid);
      const unsubscribeProfile = onSnapshot(profileRef, async (docSnap) => {
        if (docSnap.exists()) {
          const profile = docSnap.data() as UserProfile;
          
          // Monthly Free Credit Logic
          const now = new Date();
          const lastCreditDate = profile.lastFreeCreditDate ? new Date(profile.lastFreeCreditDate) : null;
          const monthInMs = 30 * 24 * 60 * 60 * 1000;
          
          if (!lastCreditDate || (now.getTime() - lastCreditDate.getTime() > monthInMs)) {
            const premium = isPremiumUser(profile);
            const updates: Partial<UserProfile> = {
              restorationCredits: premium ? 3 : 1,
              lastFreeCreditDate: now.toISOString()
            };
            // Optimistically set the profile now so nothing flashes as locked
            // The snapshot will fire again with the Firestore-confirmed data
            setUserProfile({ ...profile, ...updates });
            setIsProfileLoading(false);
            await updateDoc(profileRef, updates as any);
            return;
          }

          setUserProfile(profile);
          setIsProfileLoading(false);
          // Only navigate if we are on auth/welcome
          setCurrentScreen(prev => {
            if (prev === 'auth' || prev === 'welcome') {
              // Show trial welcome for returning users who haven't seen it
              // (new users get it from handleStartReflecting instead)
              const seenKey = `ne_trial_seen_${user.uid}`;
              if (!localStorage.getItem(seenKey) && !profile.isSubscribed) {
                // Only show if profile already existed (returning user who missed it)
                // handleStartReflecting handles the brand-new-user case
                setTimeout(() => setShowTrialWelcome(true), 400);
              }
              return 'reflect';
            }
            return prev;
          });
        } else {
          navigate('welcome');
        }
        setIsDataReady(true);
        setIsAuthReady(true);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        setIsAuthReady(true);
      });

      return () => unsubscribeProfile();
    });

    // Connection Test
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("CRITICAL: Firestore is reporting offline mode.");
        }
      }
    };
    testConnection();

    return () => unsubscribeAuth();
  }, []);

  // Sync Entries
  useEffect(() => {
    if (!firebaseUser) {
      setEntries([]);
      return;
    }

    const q = query(
      collection(db, 'users', firebaseUser.uid, 'entries'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JournalEntry[];
      setEntries(fetchedEntries);
      setIsDataReady(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${firebaseUser.uid}/entries`);
    });

    return () => unsubscribe();
  }, [firebaseUser]);

  // Welcome Screen Logic
  const handleStartReflecting = async (profile: Omit<UserProfile, 'uid' | 'createdAt'>) => {
    if (!firebaseUser) return;

    const newProfile: UserProfile = {
      ...profile,
      uid: firebaseUser.uid,
      createdAt: new Date().toISOString(),
      isSubscribed: false
    };

    try {
      await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
      setUserProfile(newProfile);
      setIsProfileLoading(false);
      setShowTrialWelcome(true);
      navigate('reflect');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
    }
  };

  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    if (!firebaseUser || !userProfile) return;
    console.log("Updating profile with:", updates);
    try {
      const updatedProfile = { ...userProfile, ...updates };
      await updateDoc(doc(db, 'users', firebaseUser.uid), updates as any);
      setUserProfile(updatedProfile);
      console.log("Profile updated successfully");
    } catch (error) {
      console.error("Profile update failed:", error);
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
    }
  };

  // Reflect Screen Logic
  const handleFinishDay = async () => {
    if (!currentEntry.trim() || !firebaseUser || isSaving) return;
    setIsSaving(true);

    try {
      const targetDateId = restoringDate || new Date().toISOString().split('T')[0];
      const docRef = doc(db, 'users', firebaseUser.uid, 'entries', targetDateId);
      
      const targetDate = restoringDate ? new Date(restoringDate + 'T12:00:00') : new Date();
      
      const entryData: Omit<JournalEntry, 'id'> = {
        uid: firebaseUser.uid,
        date: targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        timestamp: targetDate.toISOString(),
        content: currentEntry,
        mood: selectedMood || 'Quiet',
        location: 'The Library',
      };

      await setDoc(docRef, entryData);
      
      if (restoringDate) {
        // If it was a restoration, update profile
        const currentRestored = userProfile?.restoredDates || [];
        const updates: any = {
          restoredDates: Array.from(new Set([...currentRestored, restoringDate])),
          restorationCredits: Math.max(0, (userProfile?.restorationCredits || 0) - 1)
        };
        await handleUpdateProfile(updates);
        setRestoringDate(null);
      }

      setLastInterpretation({ ...entryData, id: targetDateId });
      setIsNewEntry(true);
      setCurrentEntry('');
      setSelectedMood(null);
      navigate('reveal');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}/entries`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out error", error);
    }
  };

  const handleUpdateEntry = async (id: string, updates: Partial<JournalEntry>) => {
    if (!firebaseUser) return;
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid, 'entries', id), updates);
      if (lastInterpretation?.id === id) {
        setLastInterpretation(prev => prev ? { ...prev, ...updates } : null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}/entries/${id}`);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!firebaseUser) return;
    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'entries', id));
      if (lastInterpretation?.id === id) {
        setLastInterpretation(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${firebaseUser.uid}/entries/${id}`);
    }
  };

  const handleClearEntries = async () => {
    if (!firebaseUser || entries.length === 0) return;
    try {
      const batch = writeBatch(db);
      entries.forEach(entry => {
        const entryRef = doc(db, 'users', firebaseUser.uid, 'entries', entry.id);
        batch.delete(entryRef);
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${firebaseUser.uid}/entries`);
    }
  };

  const dateId = new Date().toISOString().split('T')[0];
  const todayEntry = entries.find(e => e.id === dateId);
  const hasReflectedToday = !!todayEntry;


  // ── Milestone Celebration Logic ───────────────────────────────────────────
  const MILESTONES = [1, 7, 14, 30, 100];
  useEffect(() => {
    if (!isNewEntry) return;

    const getLocalDateString = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const entryDates = entries.map(e => getLocalDateString(new Date(e.timestamp)));
    const restoredDates = userProfile?.restoredDates || [];
    const uniqueDates = Array.from(new Set([...entryDates, ...restoredDates]))
      .sort((a, b) => b.localeCompare(a));

    const today = getLocalDateString(new Date());
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
    
    if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) return;
    
    let realStreak = 0;
    let expected = uniqueDates[0];
    for (const d of uniqueDates) {
      if (d === expected) {
        realStreak++;
        const dt = new Date(d + 'T12:00:00');
        dt.setDate(dt.getDate() - 1);
        expected = getLocalDateString(dt);
      } else break;
    }
    if (!MILESTONES.includes(realStreak)) return;
    const prevCelebrated = parseInt(localStorage.getItem('ne_last_celebrated_streak') || '0', 10);
    if (prevCelebrated >= realStreak) return;
    localStorage.setItem('ne_last_celebrated_streak', String(realStreak));
    setMilestoneCelebration({ streak: realStreak });
  }, [isNewEntry, entries, userProfile]);

  // Initial navigation and redirect logic
  useEffect(() => {
    if (isDataReady && currentScreen === 'reflect' && hasReflectedToday && !currentEntry) {
      setLastInterpretation(todayEntry || null);
      setIsNewEntry(false);
      navigate('reveal');
    }
  }, [isDataReady, currentScreen, hasReflectedToday, currentEntry, todayEntry]);

  if (!isAuthReady || (firebaseUser && !isDataReady)) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center gap-6">
        <div className="w-24 h-24 flex items-center justify-center rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 shadow-[0_0_50px_rgba(255,186,56,0.15)]">
          <Moon className="text-on-tertiary w-12 h-12 fill-current animate-pulse" />
        </div>
        <h1 className="font-headline italic text-3xl text-primary tracking-widest animate-pulse">Nocturnal Echo</h1>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-on-surface font-body selection:bg-primary/30 selection:text-primary overflow-x-hidden">
      {/* ── App Lock Overlay ── */}
      <AnimatePresence>
        {isLocked && firebaseUser && (
          <LockScreen
            key="lockscreen"
            userEmail={firebaseUser.email || ''}
            onUnlock={() => setIsLocked(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Trial Welcome Overlay ── */}
      <AnimatePresence>
        {showTrialWelcome && (
          <TrialWelcomeOverlay
            key="trial-welcome"
            trialDays={TRIAL_DAYS}
            userId={firebaseUser?.uid || ''}
            onDismiss={() => setShowTrialWelcome(false)}
            onSubscribeNow={() => {
              setShowTrialWelcome(false);
              navigateToPaywall('reflect', 'general');
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {currentScreen === 'auth' && (
          <AuthScreen key="auth" />
        )}
        {currentScreen === 'welcome' && (
          <WelcomeScreen key="welcome" onStart={handleStartReflecting} initialEmail={firebaseUser?.email || ''} />
        )}
        {currentScreen === 'reflect' && (
          <ReflectScreen 
            key="reflect" 
            entry={currentEntry} 
            setEntry={setCurrentEntry} 
            onFinish={handleFinishDay}
            onNavigate={navigate}
            onPaywall={(t) => navigateToPaywall('reflect', t)}
            hasReflectedToday={hasReflectedToday}
            isFirstVisit={entries.length === 0}
            isSaving={isSaving}
            activeSound={activeSound}
            setActiveSound={setActiveSound}
            ensureAudioContext={ensureAudioContext}
            userProfile={userProfile}
            isProfileLoading={isProfileLoading}
            restoringDate={restoringDate}
          />
        )}
        {currentScreen === 'reveal' && (
          <RevealScreen 
            key="reveal" 
            entry={lastInterpretation} 
            onNavigate={navigate}
            onPaywall={(t) => navigateToPaywall('reveal', t)}
            onUpdateEntry={handleUpdateEntry}
            userProfile={userProfile}
            isProfileLoading={isProfileLoading}
            isNewEntry={isNewEntry}
            setCurrentEntry={setCurrentEntry}
          />
        )}
        {currentScreen === 'journey' && (
          <JourneyScreen 
            key="journey" 
            entries={entries} 
            onNavigate={navigate}
            onPaywall={(t) => navigateToPaywall('journey', t)}
            onDeleteEntry={handleDeleteEntry}
            setLastInterpretation={setLastInterpretation}
            setCurrentEntry={setCurrentEntry}
            setIsNewEntry={setIsNewEntry}
            userProfile={userProfile}
            isProfileLoading={isProfileLoading}
          />
        )}
        {currentScreen === 'settings' && (
          <SettingsScreen 
            key="settings" 
            user={userProfile} 
            onNavigate={navigate}
            onPaywall={(t) => navigateToPaywall('settings', t)}
            onSignOut={handleSignOut}
            onClearEntries={handleClearEntries}
          />
        )}
        {currentScreen === 'paywall' && (
          <PaywallScreen 
            key="paywall" 
            onClose={() => navigate(paywallReturnScreen)}
            onSubscribe={() => handleUpdateProfile({ isSubscribed: true })}
            trigger={paywallTrigger}
          />
        )}
        {currentScreen === 'restoration' && (
          <RestorationScreen 
            key="restoration" 
            user={userProfile!}
            onUpdateUser={handleUpdateProfile}
            onStartMissedEntry={(date, creditType) => {
              setMissedEntryMode({ date, creditType });
              navigate('missed-entry');
            }}
            entries={entries}
          />
        )}
        {currentScreen === 'missed-entry' && missedEntryMode && (
          <MissedDayEntryScreen
            key="missed-entry"
            missedDate={missedEntryMode.date}
            creditType={missedEntryMode.creditType}
            userProfile={userProfile}
            onBack={() => {
              setMissedEntryMode(null);
              navigate('restoration');
            }}
            onComplete={async (date, entryText, mood) => {
              if (!firebaseUser) return;
              setIsSaving(true);
              try {
                const targetDate = new Date(date + 'T12:00:00');
                const docRef = doc(db, 'users', firebaseUser.uid, 'entries', date);
                const entryData: Omit<JournalEntry, 'id'> = {
                  uid: firebaseUser.uid,
                  date: targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
                  timestamp: targetDate.toISOString(),
                  content: entryText,
                  mood: mood || 'Quiet',
                  location: 'The Library',
                };
                await setDoc(docRef, entryData);

                // Mark date as restored and deduct credit
                const currentRestored = userProfile?.restoredDates || [];
                const updates: any = {
                  restoredDates: Array.from(new Set([...currentRestored, date])),
                  restorationCredits: Math.max(0, (userProfile?.restorationCredits || 0) - 1),
                };

                // Optimistically update local userProfile so streak check sees correct data
                if (userProfile) {
                  setUserProfile({ ...userProfile, ...updates });
                }

                // Set flag to block streak check redirect during Firestore sync lag
                setJustRestored(true);
                setMissedEntryMode(null);
                navigate('journey');

                // Fire and forget Firestore profile update
                updateDoc(doc(db, 'users', firebaseUser.uid), updates).catch(console.error);

                // Clear flag after Firestore has had time to sync
                setTimeout(() => setJustRestored(false), 3000);

              } catch (error) {
                console.error('Missed entry save error:', error);
              } finally {
                setIsSaving(false);
              }
            }}
            isSaving={isSaving}
          />
        )}

      </AnimatePresence>

      {/* Global Bottom Nav for main screens */}
      {['reflect', 'journey', 'settings', 'reveal'].includes(currentScreen) && (
        <BottomNav 
          active={currentScreen} 
          onNavigate={navigate} 
          hasReflectedToday={hasReflectedToday}
          todayEntry={todayEntry}
          setLastInterpretation={setLastInterpretation}
        />
      )}


      {/* ── Milestone Celebration Overlay ────────────────────────────────── */}
      <AnimatePresence>
        {milestoneCelebration && (
          <MilestoneCelebration
            streak={milestoneCelebration.streak}
            onClose={() => setMilestoneCelebration(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── MilestoneCelebration ──────────────────────────────────────────────────

const MILESTONE_MESSAGES: Record<number, { title: string; subtitle: string; emoji: string; gold?: boolean }> = {
  1:   { title: "Your first echo.", subtitle: "The quiet begins.", emoji: "🌙" },
  7:   { title: "A week of nights.", subtitle: "You're building something real.", emoji: "✨" },
  14:  { title: "Two weeks.", subtitle: "This is becoming who you are.", emoji: "🌒" },
  30:  { title: "A month of reflection.", subtitle: "Most people never make it here.", emoji: "🌕" },
  100: { title: "100 nights.", subtitle: "You are extraordinary.", emoji: "⭐", gold: true },
};

function MilestoneCelebration({ streak, onClose }: { streak: number; onClose: () => void }) {
  const info = MILESTONE_MESSAGES[streak];
  if (!info) return null;
  const isGold = info.gold;

  const particles = Array.from({ length: isGold ? 60 : 30 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 1.5,
    duration: 2 + Math.random() * 2,
    size: isGold ? (6 + Math.random() * 10) : (4 + Math.random() * 6),
    color: isGold
      ? ['#FFD700','#FFC107','#FF8C00','#FFF8DC','#FFEC8B'][Math.floor(Math.random() * 5)]
      : ['#BCC2FF','#9AA0E8','#E8D5FF','#C5DFFF','#FFFFFF'][Math.floor(Math.random() * 5)],
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: isGold ? 'radial-gradient(ellipse at center, #1a1200 0%, #0a0800 100%)' : 'radial-gradient(ellipse at center, #0d0f1a 0%, #050508 100%)' }}
    >
      {/* Particle rain */}
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: `${p.x}%`, top: '-10px', width: p.size, height: p.size, background: p.color }}
          animate={{ y: ['0vh', '110vh'], opacity: [0, 1, 1, 0], rotate: [0, 360] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'linear' }}
        />
      ))}

      {/* Glow orb */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="w-96 h-96 rounded-full blur-[120px]" style={{ background: isGold ? 'rgba(255,215,0,0.12)' : 'rgba(188,194,255,0.08)' }} />
      </motion.div>

      {/* Content */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative z-10 text-center px-8 max-w-sm"
      >
        <motion.div
          animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="text-7xl mb-8"
        >
          {info.emoji}
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="font-label text-xs uppercase tracking-[0.35em] mb-4"
          style={{ color: isGold ? '#FFD700' : 'rgba(188,194,255,0.6)' }}
        >
          {streak} Night{streak !== 1 ? 's' : ''} Streak
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="font-headline italic leading-tight mb-3"
          style={{
            fontSize: isGold ? '3.5rem' : '2.8rem',
            color: isGold ? '#FFF8DC' : '#E8E9FF',
            textShadow: isGold ? '0 0 40px rgba(255,215,0,0.5)' : '0 0 30px rgba(188,194,255,0.3)',
          }}
        >
          {info.title}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="font-body text-lg leading-relaxed mb-12"
          style={{ color: isGold ? 'rgba(255,248,220,0.7)' : 'rgba(200,202,255,0.6)' }}
        >
          {info.subtitle}
        </motion.p>

        {/* Shareable milestone card button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="space-y-4"
        >
          <MilestoneShareCard streak={streak} info={info} />
          <button
            onClick={onClose}
            className="block w-full font-label text-xs uppercase tracking-[0.3em] transition-colors"
            style={{ color: isGold ? 'rgba(255,215,0,0.4)' : 'rgba(188,194,255,0.35)' }}
          >
            Continue
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function MilestoneShareCard({ streak, info }: { streak: number; info: { title: string; subtitle: string; emoji: string; gold?: boolean } }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const isGold = info.gold;

  const handleShare = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3 });
      const link = document.createElement('a');
      link.download = `nocturnal-echo-night-${streak}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error(e);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* The card itself */}
      <div
        ref={cardRef}
        className="rounded-[2rem] p-8 text-center relative overflow-hidden"
        style={{
          background: isGold
            ? 'linear-gradient(135deg, #1a1200 0%, #2d1f00 50%, #1a1200 100%)'
            : 'linear-gradient(135deg, #0d0f1a 0%, #141628 50%, #0d0f1a 100%)',
          border: isGold ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(188,194,255,0.15)',
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{
          background: isGold
            ? 'radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.15) 0%, transparent 70%)'
            : 'radial-gradient(ellipse at 50% 0%, rgba(188,194,255,0.08) 0%, transparent 70%)',
        }} />
        <div className="text-4xl mb-3">{info.emoji}</div>
        <p className="font-label text-xs uppercase tracking-[0.3em] mb-2" style={{ color: isGold ? 'rgba(255,215,0,0.6)' : 'rgba(188,194,255,0.5)' }}>
          Night {streak}
        </p>
        <h3 className="font-headline italic text-2xl mb-1" style={{ color: isGold ? '#FFF8DC' : '#E8E9FF' }}>{info.title}</h3>
        <p className="font-body text-sm" style={{ color: isGold ? 'rgba(255,248,220,0.6)' : 'rgba(200,202,255,0.5)' }}>{info.subtitle}</p>
        <p className="font-label text-[9px] uppercase tracking-[0.4em] mt-4" style={{ color: isGold ? 'rgba(255,215,0,0.25)' : 'rgba(188,194,255,0.2)' }}>
          Nocturnal Echo
        </p>
      </div>
      <button
        onClick={handleShare}
        disabled={sharing}
        className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full font-label text-xs uppercase tracking-widest transition-all active:scale-95"
        style={{
          background: isGold ? 'linear-gradient(135deg, #FFD700, #FFA500)' : 'rgba(188,194,255,0.15)',
          color: isGold ? '#1a1200' : 'rgba(188,194,255,0.8)',
          border: isGold ? 'none' : '1px solid rgba(188,194,255,0.2)',
        }}
      >
        <Share2 className="w-3.5 h-3.5" />
        {sharing ? 'Saving...' : 'Save Milestone Card'}
      </button>
    </div>
  );
}

// ─── TrialWelcomeOverlay ─────────────────────────────────────────────────────

function TrialWelcomeOverlay({ trialDays, userId, onDismiss, onSubscribeNow }: {
  trialDays: number;
  userId: string;
  onDismiss: () => void;
  onSubscribeNow: () => void;
  key?: string;
}) {
  const markSeen = () => {
    if (userId) localStorage.setItem(`ne_trial_seen_${userId}`, 'true');
  };
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + trialDays);
  const endDateStr = trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const features = [
    { icon: '✨', text: 'Unlimited AI poems & quotes every night' },
    { icon: '🎵', text: 'All ambient sounds — rain, fireplace, ocean & more' },
    { icon: '📖', text: 'Full journal archive, forever' },
    { icon: '🔥', text: 'Streak restoration credits' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[180] flex items-end justify-center bg-background/80 backdrop-blur-md px-4 pb-8"
      onClick={() => { markSeen(); onDismiss(); }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-surface-container-low rounded-[2.5rem] border border-white/10 overflow-hidden shadow-2xl"
      >
        {/* Gold top bar */}
        <div className="h-1 w-full bg-gradient-to-r from-tertiary/40 via-tertiary to-tertiary/40" />

        <div className="p-7 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-tertiary to-tertiary-container/50 flex items-center justify-center flex-shrink-0 shadow-[0_0_20px_rgba(255,186,56,0.25)]">
              <Moon className="w-6 h-6 text-on-tertiary fill-current" />
            </div>
            <div>
              <h2 className="font-headline italic text-2xl text-on-surface leading-tight">
                Your {trialDays}-day trial has begun.
              </h2>
              <p className="text-on-surface-variant/60 font-body text-sm mt-0.5">
                Full access until <span className="text-tertiary font-medium">{endDateStr}</span>. No charge until then.
              </p>
            </div>
          </div>

          {/* What's included */}
          <div className="space-y-2.5">
            <p className="text-[9px] font-label uppercase tracking-[0.25em] text-on-surface-variant/40">Everything included in your trial</p>
            <div className="space-y-2">
              {features.map((f, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-base w-6 text-center">{f.icon}</span>
                  <p className="text-on-surface/80 text-sm font-body">{f.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* What happens after */}
          <div className="rounded-2xl bg-surface-container border border-white/5 px-4 py-3 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
            <p className="text-on-surface-variant/50 text-xs font-body leading-relaxed">
              After {endDateStr}, continue for <span className="text-on-surface/70">$5.99/month</span> or <span className="text-on-surface/70">$49.99/year</span>. Cancel anytime — nothing is charged during your trial.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-1">
            <button
              onClick={() => { markSeen(); onDismiss(); }}
              className="w-full signature-gradient py-4 rounded-full text-on-primary font-label text-sm uppercase tracking-[0.2em] font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
            >
              Start Writing
            </button>
            <button
              onClick={() => { markSeen(); onSubscribeNow(); }}
              className="w-full text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant/30 hover:text-primary transition-colors py-1"
            >
              Skip trial — subscribe now
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── LockScreen ────────────────────────────────────────────────────────────

function PinDots({ filled, shake }: { filled: number; shake: boolean }) {
  return (
    <motion.div
      animate={shake ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : {}}
      transition={{ duration: 0.45 }}
      className="flex gap-5 justify-center my-8"
    >
      {[0, 1, 2, 3].map(i => (
        <motion.div
          key={i}
          animate={{ scale: i < filled ? 1.1 : 1 }}
          transition={{ type: 'spring', stiffness: 400 }}
          className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
            i < filled
              ? 'bg-primary border-primary shadow-[0_0_12px_rgba(188,194,255,0.5)]'
              : 'border-on-surface-variant/30 bg-transparent'
          }`}
        />
      ))}
    </motion.div>
  );
}

function NumPad({ onPress }: { onPress: (v: string) => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xs mx-auto">
      {keys.map((k, i) => (
        k === '' ? <div key={i} /> :
        <button
          key={i}
          onClick={() => onPress(k)}
          className={`aspect-square rounded-2xl font-headline text-2xl text-on-surface flex items-center justify-center transition-all active:scale-90 duration-100 ${
            k === '⌫'
              ? 'bg-transparent text-on-surface-variant/50 hover:text-primary text-xl'
              : 'bg-surface-container-low border border-white/5 hover:bg-surface-container-high hover:border-primary/20 shadow-md'
          }`}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function LockScreen({ userEmail, onUnlock }: { userEmail: string; onUnlock: () => void; key?: string }) {
  const lockMethod = localStorage.getItem('ne_lock_method') as 'biometric' | 'pin' | null;
  const storedPin = localStorage.getItem('ne_lock_pin');
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [bioError, setBioError] = useState('');

  const triggerBiometric = async () => {
    setBioError('');
    if (!window.PublicKeyCredential) {
      setBioError('Biometric not available on this device.');
      return;
    }
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'required',
          rpId: window.location.hostname,
          allowCredentials: [],
        }
      } as any);
      onUnlock();
    } catch {
      setBioError('Biometric failed. Enter your PIN below.');
    }
  };

  useEffect(() => {
    if (lockMethod === 'biometric') triggerBiometric();
  }, []);

  const handleNumPress = (k: string) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      if (next === storedPin) {
        setTimeout(onUnlock, 150);
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 500);
      }
    }
  };

  const handleForgotPin = () => {
    // In a real app this would trigger a Firebase email
    alert(`A PIN reset link has been sent to ${userEmail}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center px-8"
    >
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-primary/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-16 h-16 mb-6 flex items-center justify-center rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 shadow-[0_0_30px_rgba(255,186,56,0.2)]">
        <Moon className="text-on-tertiary w-8 h-8 fill-current" />
      </div>

      <h1 className="font-headline italic text-4xl text-primary mb-1 text-center">Nocturnal Echo</h1>
      <p className="font-body text-on-surface-variant/50 text-sm tracking-widest mb-10 text-center">Unlock your night.</p>

      {(lockMethod === 'pin' || bioError) && (
        <>
          {bioError && (
            <p className="text-on-surface-variant/50 text-xs font-body mb-2 text-center">{bioError}</p>
          )}
          <PinDots filled={pin.length} shake={shake} />
          <NumPad onPress={handleNumPress} />
          <button
            onClick={handleForgotPin}
            className="mt-8 text-[10px] font-label uppercase tracking-widest text-on-surface-variant/30 hover:text-primary transition-colors"
          >
            Forgot PIN?
          </button>
        </>
      )}

      {lockMethod === 'biometric' && !bioError && (
        <div className="flex flex-col items-center gap-6">
          <motion.div
            animate={{ scale: [1, 1.05, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"
          >
            <Fingerprint className="w-10 h-10 text-primary" />
          </motion.div>
          <p className="text-on-surface-variant/50 text-xs font-body tracking-wide">Touch or look to unlock</p>
          <button
            onClick={triggerBiometric}
            className="text-[10px] font-label uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── AppLockSetup ───────────────────────────────────────────────────────────

function AppLockSetup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<'choose' | 'pin-enter' | 'pin-confirm'>('choose');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [shake, setShake] = useState(false);

  const handleChooseBiometric = () => {
    localStorage.setItem('ne_lock_enabled', 'true');
    localStorage.setItem('ne_lock_method', 'biometric');
    onDone();
  };

  const handleNumPress = (k: string) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      if (step === 'pin-enter') {
        setTimeout(() => {
          setFirstPin(next);
          setPin('');
          setStep('pin-confirm');
        }, 200);
      } else {
        if (next === firstPin) {
          localStorage.setItem('ne_lock_enabled', 'true');
          localStorage.setItem('ne_lock_method', 'pin');
          localStorage.setItem('ne_lock_pin', next);
          setTimeout(onDone, 200);
        } else {
          setShake(true);
          setTimeout(() => { setShake(false); setPin(''); }, 500);
        }
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="fixed inset-0 z-[150] bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center px-8"
    >
      <button onClick={onCancel} className="absolute top-6 left-6 p-2 pt-safe text-on-surface-variant/50 hover:text-primary transition-colors">
        <X className="w-5 h-5" />
      </button>

      {step === 'choose' && (
        <div className="flex flex-col items-center gap-6 w-full max-w-xs">
          <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <h2 className="font-headline italic text-3xl text-primary text-center">Lock My Diary</h2>
          <p className="text-on-surface-variant/50 text-sm font-body text-center">Choose how you'd like to unlock your reflections.</p>

          <button
            onClick={handleChooseBiometric}
            className="w-full flex items-center gap-4 p-5 rounded-[1.5rem] bg-surface-container-low border border-white/5 hover:border-primary/20 hover:bg-surface-container transition-all group"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-on-surface font-medium text-sm">Face ID / Touch ID</p>
              <p className="text-on-surface-variant/50 text-xs">Use biometric authentication</p>
            </div>
            <ChevronRight className="ml-auto text-on-surface-variant/30 group-hover:text-primary transition-colors" />
          </button>

          <button
            onClick={() => setStep('pin-enter')}
            className="w-full flex items-center gap-4 p-5 rounded-[1.5rem] bg-surface-container-low border border-white/5 hover:border-primary/20 hover:bg-surface-container transition-all group"
          >
            <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary group-hover:bg-secondary/20 transition-colors">
              <Lock className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-on-surface font-medium text-sm">Set a PIN</p>
              <p className="text-on-surface-variant/50 text-xs">4-digit passcode</p>
            </div>
            <ChevronRight className="ml-auto text-on-surface-variant/30 group-hover:text-primary transition-colors" />
          </button>
        </div>
      )}

      {(step === 'pin-enter' || step === 'pin-confirm') && (
        <div className="flex flex-col items-center w-full max-w-xs">
          <div className="w-14 h-14 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center mb-6">
            <Lock className="w-7 h-7 text-secondary" />
          </div>
          <h2 className="font-headline italic text-2xl text-primary text-center mb-1">
            {step === 'pin-enter' ? 'Create your PIN' : 'Confirm your PIN'}
          </h2>
          <p className="text-on-surface-variant/40 text-xs font-body text-center mb-2">
            {step === 'pin-enter' ? 'Choose a 4-digit PIN to lock your diary.' : 'Enter the same PIN again to confirm.'}
          </p>
          <PinDots filled={pin.length} shake={shake} />
          <NumPad onPress={handleNumPress} />
          {step === 'pin-confirm' && (
            <button onClick={() => { setStep('pin-enter'); setPin(''); setFirstPin(''); }} className="mt-6 text-[10px] font-label uppercase tracking-widest text-on-surface-variant/30 hover:text-primary transition-colors">
              Start over
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────

function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!email) return setError('Please enter an email address first.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setIsOtpSent(true);
      setError('OTP sent! Please check your email inbox.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp) return setError('Please enter the 6-digit code.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');
      setIsOtpVerified(true);
      setError('Email verified! You can now set your password.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (isLogin) {
      setLoading(true);
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Sign Up Flow
    if (!isOtpSent) {
      await handleSendOtp();
    } else if (!isOtpVerified) {
      await handleVerifyOtp();
    } else {
      setLoading(true);
      try {
        await createUserWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAppleSignIn = async () => {
    const provider = new OAuthProvider('apple.com');
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[100dvh] flex items-center justify-center px-6 py-12 bg-celestial-gradient"
    >
      <div className="max-w-md w-full relative">
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-surface-container-low mb-2">
            <Sparkles className="text-primary w-8 h-8" />
          </div>
          <h1 className="font-headline italic text-4xl tracking-tighter text-primary">Nocturnal Echo</h1>
          <p className="font-body text-on-surface-variant font-light tracking-wide opacity-80">
            {isLogin ? 'Welcome back to the quiet.' : 'Join the nocturnal circle.'}
          </p>
        </header>

        <form className="space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="p-4 rounded-2xl bg-error/10 text-error text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="relative group">
              <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                <input 
                  type="email"
                  disabled={isOtpVerified || (isOtpSent && !isLogin)}
                  className="w-full bg-surface-container-low border border-outline-variant/10 py-4 pl-12 pr-4 text-on-surface font-body rounded-2xl focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none disabled:opacity-50" 
                  placeholder="reach@yoursoul.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                {!isLogin && isOtpSent && !isOtpVerified && (
                  <button 
                    type="button"
                    onClick={() => {
                      setIsOtpSent(false);
                      setOtp('');
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-label uppercase tracking-widest text-primary hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!isLogin && isOtpSent && !isOtpVerified && (
              <div className="relative group animate-in fade-in slide-in-from-top-2 duration-500">
                <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Enter 6-Digit Code</label>
                <div className="relative">
                  <input 
                    type="text"
                    maxLength={6}
                    className="w-full bg-surface-container-low border border-outline-variant/10 py-4 px-4 text-center text-2xl tracking-[0.5em] font-headline text-primary rounded-2xl focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none" 
                    placeholder="000000"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
                <p className="mt-2 text-[10px] text-center text-on-surface-variant/60">
                  Didn't receive it? <button type="button" onClick={handleSendOtp} className="text-primary hover:underline">Resend</button>
                </p>
              </div>
            )}

            {(isLogin || isOtpVerified) && (
              <div className="relative group animate-in fade-in slide-in-from-top-2 duration-500">
                <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/40" />
                  <input 
                    type={showPassword ? 'text' : 'password'}
                    className="w-full bg-surface-container-low border border-outline-variant/10 py-4 pl-12 pr-12 text-on-surface font-body rounded-2xl focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none" 
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-primary transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full signature-gradient text-on-primary font-label text-sm uppercase tracking-[0.25em] font-semibold py-5 rounded-full shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Processing...' : 
             isLogin ? 'Sign In' : 
             !isOtpSent ? 'Send OTP' : 
             !isOtpVerified ? 'Verify OTP' : 
             'Complete Sign Up'}
          </button>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-outline-variant/10"></div></div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest"><span className="bg-background px-4 text-on-surface-variant/40">Or continue with</span></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full bg-surface-container-low border border-outline-variant/10 text-on-surface font-label text-[10px] uppercase tracking-widest py-4 rounded-full flex items-center justify-center gap-3 hover:bg-surface-container transition-all"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-4 h-4" alt="Google" />
              Google
            </button>

            <button 
              type="button"
              onClick={handleAppleSignIn}
              className="w-full bg-surface-container-low border border-outline-variant/10 text-on-surface font-label text-[10px] uppercase tracking-widest py-4 rounded-full flex items-center justify-center gap-3 hover:bg-surface-container transition-all"
            >
              <svg viewBox="0 0 384 512" className="w-4 h-4 fill-current">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-31.4-57.3-114.3-8.6-114.3-1.3 0-2.1 0-3.1 0zM245.1 89.4c16-19.6 26.5-46.7 23.6-73.4-23.2 1-51.2 15.5-67.8 34.9-14.9 17.2-28 45.3-25.1 71.3 25.7 2 53.2-13.2 69.3-32.8z"/>
              </svg>
              Apple
            </button>
          </div>

          <p className="text-center text-xs font-body text-on-surface-variant/60 tracking-wide">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setIsOtpSent(false);
                setIsOtpVerified(false);
                setOtp('');
                setError('');
              }}
              className="ml-2 text-primary font-bold hover:underline"
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </form>
      </div>
    </motion.main>
  );
}

function WelcomeScreen({ onStart, initialEmail }: { onStart: (p: Omit<UserProfile, 'uid' | 'createdAt'>) => Promise<void> | void, initialEmail: string, key?: string }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    email: initialEmail,
    age: '',
    identity: '',
    windDownTime: '21:00',
    journalingReason: ''
  });

  const reasons = [
    { id: 'clear', label: 'Clear my head', icon: '🌬️' },
    { id: 'remember', label: 'Remember my days', icon: '📸' },
    { id: 'grow', label: 'Grow as a person', icon: '🌱' },
    { id: 'try', label: 'Just try it', icon: '✨' }
  ];

  const handleNext = (e: FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
    } else {
      onStart(formData);
    }
  };

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[100dvh] flex items-center justify-center px-4 py-8 bg-celestial-gradient overflow-y-auto"
    >
      <div className="max-w-md w-full relative py-8">
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-tertiary/5 rounded-full blur-[100px] pointer-events-none" />
        
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-surface-container-low mb-2">
            <Sparkles className="text-primary w-8 h-8" />
          </div>
          <h1 className="font-headline italic text-4xl md:text-5xl tracking-tighter text-primary">Nocturnal Echo</h1>
          <p className="font-body text-on-surface-variant font-light tracking-wide max-w-[280px] mx-auto opacity-80">
            {step === 1 ? 'A quiet space for your thoughts during the blue hours.' : 'Let\'s personalize your quiet space.'}
          </p>
        </header>

        <form className="space-y-6" onSubmit={handleNext}>
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div className="relative group">
                  <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Full Name</label>
                  <input 
                    className="w-full bg-surface-container-low border-none border-b border-outline-variant/10 py-4 px-1 text-lg font-headline placeholder:text-on-surface-variant/30 focus:ring-0 focus:border-tertiary/40 transition-all duration-500 rounded-none outline-none" 
                    placeholder="Who is reflecting tonight?"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>
                <div className="relative group">
                  <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Email Address</label>
                  <input 
                    type="email"
                    className="w-full bg-surface-container-low border-none border-b border-outline-variant/10 py-4 px-1 text-lg font-headline placeholder:text-on-surface-variant/30 focus:ring-0 focus:border-tertiary/40 transition-all duration-500 rounded-none outline-none" 
                    placeholder="reach@yoursoul.com"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    required
                  />
                </div>
                <div className="grid grid-cols-12 gap-8 items-end">
                  <div className="col-span-4 relative">
                    <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Age</label>
                    <input 
                      type="number"
                      className="w-full bg-surface-container-low border-none border-b border-outline-variant/10 py-4 px-1 text-lg font-headline placeholder:text-on-surface-variant/30 focus:ring-0 focus:border-tertiary/40 transition-all duration-500 rounded-none outline-none" 
                      placeholder="--"
                      value={formData.age}
                      onChange={e => setFormData({...formData, age: e.target.value})}
                      required
                    />
                  </div>
                  <div className="col-span-8 relative">
                    <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-2 ml-1 opacity-60">Identity</label>
                    <select 
                      className="w-full bg-surface-container-low border-none border-b border-outline-variant/10 py-4 px-1 text-lg font-headline text-on-surface-variant/60 focus:ring-0 focus:border-tertiary/40 transition-all duration-500 rounded-none appearance-none outline-none"
                      value={formData.identity}
                      onChange={e => setFormData({...formData, identity: e.target.value})}
                      required
                    >
                      <option value="" disabled>Select...</option>
                      <option value="non-binary">Non-binary</option>
                      <option value="woman">Woman</option>
                      <option value="man">Man</option>
                      <option value="prefer-not">Prefer not to say</option>
                    </select>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div className="relative group">
                  <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-4 ml-1 opacity-60">What time do you usually wind down?</label>
                  <div className="flex items-center gap-4 bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                    <Moon className="w-6 h-6 text-primary" />
                    <input 
                      type="time"
                      className="bg-transparent text-2xl font-headline text-on-surface outline-none w-full"
                      value={formData.windDownTime}
                      onChange={e => setFormData({...formData, windDownTime: e.target.value})}
                      required
                    />
                  </div>
                  <p className="mt-2 text-[10px] font-body text-on-surface-variant/40 italic ml-1">We'll send a gentle nudge around this time.</p>
                </div>

                <div className="relative group">
                  <label className="block text-xs font-label uppercase tracking-[0.2em] text-on-surface-variant mb-4 ml-1 opacity-60">Why do you want to keep a diary?</label>
                  <div className="grid grid-cols-2 gap-3">
                    {reasons.map(reason => (
                      <button
                        key={reason.id}
                        type="button"
                        onClick={() => setFormData({...formData, journalingReason: reason.label})}
                        className={`p-4 rounded-2xl border text-left transition-all duration-300 flex flex-col gap-2 ${
                          formData.journalingReason === reason.label 
                          ? 'bg-primary/10 border-primary shadow-[0_0_20px_rgba(188,194,255,0.1)]' 
                          : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/30'
                        }`}
                      >
                        <span className="text-xl">{reason.icon}</span>
                        <span className={`text-xs font-label uppercase tracking-wider ${
                          formData.journalingReason === reason.label ? 'text-primary' : 'text-on-surface-variant'
                        }`}>
                          {reason.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pt-8 flex flex-col items-center space-y-6">
            <div className="flex gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full transition-all duration-300 ${step === 1 ? 'bg-primary w-6' : 'bg-primary/20'}`} />
              <div className={`w-2 h-2 rounded-full transition-all duration-300 ${step === 2 ? 'bg-primary w-6' : 'bg-primary/20'}`} />
            </div>

            <button 
              type="submit"
              disabled={step === 2 && !formData.journalingReason}
              className="w-full signature-gradient text-on-primary font-label text-sm uppercase tracking-[0.25em] font-semibold py-5 rounded-full shadow-[0_8px_32px_rgba(188,194,255,0.15)] hover:shadow-[0_12px_48px_rgba(188,194,255,0.25)] transition-all duration-500 group relative overflow-hidden disabled:opacity-50"
            >
              <span className="relative z-10">{step === 1 ? 'Continue' : 'Start Reflecting'}</span>
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {step === 2 && (
              <button 
                type="button"
                onClick={() => setStep(1)}
                className="text-[10px] font-label text-on-surface-variant/40 uppercase tracking-widest hover:text-on-surface transition-colors"
              >
                Go Back
              </button>
            )}

            <p className="text-[10px] font-label text-on-surface-variant/40 tracking-widest text-center px-8 leading-relaxed">
              By entering, you agree to our 
              <span className="underline underline-offset-4 decoration-primary/20 hover:decoration-primary transition-colors cursor-pointer ml-1">Privacy Sanctum</span> 
              and 
              <span className="underline underline-offset-4 decoration-primary/20 hover:decoration-primary transition-colors cursor-pointer ml-1">Ethereal Terms</span>.
            </p>
          </div>
        </form>
      </div>
    </motion.main>
  );
}

function ReflectScreen({ entry, setEntry, onFinish, onNavigate, onPaywall, hasReflectedToday, isFirstVisit, isSaving, activeSound, setActiveSound, ensureAudioContext, userProfile, isProfileLoading, restoringDate }: { 
  entry: string, 
  setEntry: (s: string) => void, 
  onFinish: () => Promise<void> | void,
  onNavigate: (s: Screen) => void,
  onPaywall: (trigger?: 'poem' | 'library' | 'sound' | 'trial' | 'general') => void,
  hasReflectedToday: boolean,
  isFirstVisit: boolean,
  isSaving: boolean,
  activeSound: string | null,
  setActiveSound: (s: string | null) => void,
  ensureAudioContext: () => AudioContext,
  userProfile: UserProfile | null,
  isProfileLoading: boolean,
  restoringDate: string | null,
  key?: string
}) {
  const hour = new Date().getHours();
  const isNightTime = hour >= 20 || hour < 6;
  const [gateOverrideHour, setGateOverrideHour] = useState<string | null>(() => {
    try {
      return localStorage.getItem('ne_gate_override');
    } catch {
      return null;
    }
  });
  const hasGateOverride = gateOverrideHour === String(hour);

  const dateStr = restoringDate 
    ? new Date(restoringDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const [showSoundPopup, setShowSoundPopup] = useState(false);
  const [showWordToast, setShowWordToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!isNightTime && !restoringDate && !hasGateOverride) {
    const hoursUntilOpen = 20 - hour;

    if (isFirstVisit) {
      return (
        <motion.main 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="min-h-[100dvh] bg-background pt-safe pb-safe flex flex-col items-center justify-center px-6 text-center"
        >
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] bg-primary/10 rounded-full blur-[120px]" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mb-7"
          >
            <div className="w-24 h-24 rounded-full bg-surface-container-low flex items-center justify-center border border-primary/20 shadow-[0_0_40px_rgba(188,194,255,0.18)]">
              <Moon className="w-11 h-11 text-primary animate-pulse" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="space-y-3 max-w-md"
          >
            <h2 className="font-headline italic text-3xl text-on-surface tracking-tight">You found us early.</h2>
            <p className="text-on-surface-variant font-body text-sm leading-relaxed">
              Nocturnal Echo is a space for nighttime reflection - most people write between 8:00 PM and 3:00 AM. But if something is on your mind right now - we're listening.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-10 flex flex-col gap-3 w-full max-w-xs"
          >
            <button
              onClick={() => {
                const currentHour = new Date().getHours();
                localStorage.setItem('ne_gate_override', String(currentHour));
                setGateOverrideHour(String(currentHour));
              }}
              className="signature-gradient text-on-primary px-7 py-3.5 rounded-full font-label text-xs font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95"
            >
              Write Now
            </button>
            <button
              onClick={() => onNavigate('journey')}
              className="bg-surface-container-high text-on-surface px-7 py-3.5 rounded-full font-label text-xs font-bold uppercase tracking-widest hover:bg-surface-container-highest transition-all active:scale-95"
            >
              I'll Come Back Tonight
            </button>
          </motion.div>
        </motion.main>
      );
    }

    return (
      <motion.main 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="min-h-[100dvh] bg-background pt-safe pb-safe flex flex-col items-center justify-center px-6 text-center"
      >
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[120px]" />
        </div>
        
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-8 relative"
        >
          <div className="w-24 h-24 rounded-full bg-surface-container-low flex items-center justify-center border border-white/5 shadow-2xl">
            <Sun className="w-10 h-10 text-tertiary/40" />
          </div>
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -inset-2 border border-dashed border-tertiary/20 rounded-full"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="max-w-[280px]"
        >
          <h2 className="font-headline italic text-3xl tracking-tight text-on-surface mb-3">The sun is still high</h2>
          <p className="text-on-surface-variant font-body text-sm leading-relaxed mb-10">
            Your sanctuary opens in {hoursUntilOpen} hour{hoursUntilOpen === 1 ? '' : 's'}.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col items-center gap-4"
        >
          <button 
            onClick={() => onNavigate('journey')}
            className="bg-surface-container-high text-on-surface px-8 py-4 rounded-full font-label text-xs font-bold uppercase tracking-widest hover:bg-surface-container-highest transition-all active:scale-95 inline-flex items-center gap-2"
          >
            <BookOpen className="w-4 h-4" />
            View My Journey
          </button>

          <button
            onClick={() => {
              const currentHour = new Date().getHours();
              localStorage.setItem('ne_gate_override', String(currentHour));
              setGateOverrideHour(String(currentHour));
            }}
            className="text-primary/85 font-body text-sm hover:text-primary transition-colors"
          >
            Write anyway
          </button>
        </motion.div>
      </motion.main>
    );
  }

  const getNotificationMessage = (reason: string | undefined) => {
    switch (reason) {
      case 'Clear my head':
        return "Time to empty your mind. Let the words flow so you can sleep light.";
      case 'Remember my days':
        return "Don't let today fade into the shadows. Capture a piece of it now.";
      case 'Grow as a person':
        return "Your nightly evolution awaits. What did today teach you?";
      case 'Just try it':
        return "The moon is high and the page is blank. Ready for a quick echo?";
      default:
        return "The quiet hours are here. Time for your nightly reflection.";
    }
  };

  const MIN_WORDS = 10;
  const wordCount = entry.trim() === '' ? 0 : entry.trim().split(/\s+/).length;
  const meetsMinimum = wordCount >= MIN_WORDS;

  const handleFinishClick = () => {
    if (!meetsMinimum || isSaving) {
      if (!meetsMinimum) {
        setShowWordToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setShowWordToast(false), 2800);
      }
      return;
    }
    onFinish();
  };

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const sounds = [
    { id: 'rain', label: 'Rain', icon: <CloudRain className="w-4 h-4" />, emoji: '🌧️', premium: false },
    { id: 'fireplace', label: 'Fireplace', icon: <Flame className="w-4 h-4" />, emoji: '🔥', premium: true },
    { id: 'cafe', label: 'Café', icon: <Coffee className="w-4 h-4" />, emoji: '☕', premium: true },
    { id: 'crickets', label: 'Crickets', icon: <Bug className="w-4 h-4" />, emoji: '🌙', premium: true },
    { id: 'ocean', label: 'Ocean', icon: <Waves className="w-4 h-4" />, emoji: '🌊', premium: true },
  ];
  const premium = isProfileLoading || isPremiumUser(userProfile);
  const daysLeft = trialDaysLeft(userProfile);
  const showTrialBanner = !isProfileLoading && !userProfile?.isSubscribed && isPremiumUser(userProfile) && daysLeft <= 2;

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pt-20 pb-36 px-4 max-w-4xl mx-auto flex flex-col min-h-[100dvh] pt-safe pb-safe"
    >
      {showTrialBanner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-0 left-0 w-full z-40 flex items-center justify-between px-5 py-2.5 bg-tertiary/10 border-b border-tertiary/20 backdrop-blur-sm"
        >
          <p className="text-tertiary/90 text-xs font-body">
            {daysLeft === 0 ? 'Trial ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your trial`}
          </p>
          <button
            onClick={onPaywall}
            className="text-[9px] font-label uppercase tracking-widest text-tertiary bg-tertiary/15 border border-tertiary/30 px-3 py-1 rounded-full hover:bg-tertiary/25 transition-colors"
          >
            Subscribe →
          </button>
        </motion.div>
      )}

      <header className="mb-6 text-center md:text-left flex justify-between items-end flex-wrap gap-2">
        <div>
          <h2 className="font-headline text-3xl md:text-5xl text-on-surface font-light tracking-tight mb-1">
            {dateStr}
          </h2>
          <p className="font-headline italic text-on-surface-variant text-base md:text-xl opacity-70">
            The moon is waxing gibbous. {timeStr}
          </p>
          {entry.length === 0 && !hasReflectedToday && (
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-primary/60 text-sm font-body italic leading-relaxed pt-4 max-w-md"
            >
              "{getNotificationMessage(userProfile?.journalingReason)}"
            </motion.p>
          )}
        </div>
        {hasReflectedToday && (
          <div className="mb-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
            <span className="text-primary font-label text-[10px] uppercase tracking-widest font-bold">Editing Today's Reflection</span>
          </div>
        )}
      </header>

      <section className="relative flex-grow flex flex-col perspective-1000">
        <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-[400px] md:h-[400px] bg-tertiary/5 rounded-full blur-[80px] md:blur-[120px] pointer-events-none" />
        <motion.div 
          initial={{ rotateX: 10, opacity: 0, y: 20 }}
          animate={{ rotateX: 0, opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="group relative flex-grow flex flex-col bg-surface-container-low/40 backdrop-blur-sm rounded-[2rem] transition-all duration-700 ease-in-out border border-white/5 preserve-3d shadow-2xl"
        >
          <div className="h-2 w-full bg-gradient-to-r from-transparent via-primary/10 to-transparent rounded-t-[2rem]" />
          
          {/* Sound Control Button */}
          <div className="absolute top-6 right-6 z-50">
            <button 
              onClick={() => setShowSoundPopup(!showSoundPopup)}
              className={`p-2.5 rounded-full transition-all duration-500 flex items-center justify-center ${
                activeSound 
                  ? 'bg-primary/20 text-primary shadow-[0_0_15px_rgba(188,194,255,0.3)] animate-pulse' 
                  : 'bg-surface-container-high/40 text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              {activeSound ? (
                <AudioLines className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>

            {/* Sound Selection Popup */}
            <AnimatePresence>
              {showSoundPopup && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 10, x: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10, x: -10 }}
                  className="absolute top-full right-0 mt-4 w-48 bg-surface-container-high/95 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl p-3 z-50 space-y-1"
                >
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant/60">Ambient Sound</span>
                    <button 
                      onClick={() => {
                        setActiveSound(null);
                        setShowSoundPopup(false);
                      }}
                      className="p-1 rounded-full hover:bg-white/5 text-on-surface-variant/60 hover:text-error transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  
                  {sounds.map((sound) => (
                    <button
                      key={sound.id}
                      onClick={() => {
                        if (sound.premium && !premium) {
                          setShowSoundPopup(false);
                          onPaywall('sound');
                          return;
                        }
                        ensureAudioContext();
                        setActiveSound(sound.id);
                        setShowSoundPopup(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 group ${
                        activeSound === sound.id 
                          ? 'bg-primary/20 text-primary' 
                          : 'hover:bg-white/5 text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="text-lg">{sound.emoji}</span>
                      <span className="text-xs font-medium tracking-wide">{sound.label}</span>
                      {sound.premium && !premium && (
                        <span className="ml-auto text-[8px] font-label uppercase tracking-widest text-tertiary/60 border border-tertiary/20 px-1.5 py-0.5 rounded-full">Pro</span>
                      )}
                      {activeSound === sound.id && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex-grow flex flex-col">
            <textarea 
              className="w-full flex-grow bg-transparent border-none focus:ring-0 text-on-surface font-headline text-lg md:text-2xl leading-relaxed p-5 md:p-10 pb-10 resize-none no-scrollbar placeholder:text-on-surface-variant/30 outline-none" 
              placeholder="Let the ink flow..."
              value={entry}
              onChange={e => setEntry(e.target.value)}
              spellCheck={false}
            />
            {/* Word count indicator */}
            <div className="absolute bottom-4 right-6 pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.span
                  key={meetsMinimum ? 'progress' : 'minimum'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className={`font-label text-[10px] uppercase tracking-widest transition-colors ${
                    meetsMinimum ? 'text-tertiary' : 'text-on-surface-variant/30'
                  }`}
                >
                  {meetsMinimum ? `${wordCount} words` : `${wordCount} / ${MIN_WORDS} words minimum`}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Toast */}
      <AnimatePresence>
        {showWordToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-[8rem] left-1/2 -translate-x-1/2 z-50 bg-surface-container-highest border border-white/10 rounded-full px-5 py-3 shadow-xl whitespace-nowrap"
          >
            <p className="font-body text-sm text-on-surface-variant whitespace-nowrap">Keep going — your night deserves more.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-[5.5rem] left-0 w-full flex justify-center px-4 pointer-events-none z-40">
        <motion.button 
          onClick={handleFinishClick}
          animate={{ opacity: meetsMinimum ? 1 : 0.45 }}
          transition={{ duration: 0.3 }}
          className={`pointer-events-auto font-label font-bold uppercase tracking-[0.2em] md:tracking-[0.3em] px-6 py-3 md:px-10 md:py-5 text-xs md:text-sm rounded-full shadow-[0_8px_32px_rgba(188,194,255,0.15)] flex items-center gap-3 md:gap-4 transition-all duration-500 group ${
            meetsMinimum
              ? 'signature-gradient text-on-primary hover:scale-105 active:scale-95 cursor-pointer'
              : 'bg-surface-container-highest text-on-surface-variant/60 cursor-default'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isSaving ? 'Saving...' : (hasReflectedToday ? 'Update Reflection' : 'Finish Day')}
          {!isSaving && <Check className={`w-4 h-4 md:w-5 md:h-5 transition-transform duration-500 ${meetsMinimum ? 'group-hover:translate-x-1' : ''}`} />}
        </motion.button>
      </div>
    </motion.main>
  );
}

function RevealScreen({ entry, onNavigate, onPaywall, onUpdateEntry, userProfile, isProfileLoading, isNewEntry, setCurrentEntry }: { 
  entry: JournalEntry | null, 
  onNavigate: (s: Screen) => void,
  onPaywall: (trigger?: 'poem' | 'library' | 'sound' | 'trial' | 'general') => void,
  onUpdateEntry: (id: string, updates: Partial<JournalEntry>) => Promise<void>,
  userProfile: UserProfile | null,
  isProfileLoading: boolean,
  isNewEntry: boolean,
  setCurrentEntry: (s: string) => void,
  key?: string 
}) {
  const [interpretation, setInterpretation] = useState<{ poem?: string, quote?: string }>(entry?.interpretation || {});
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<'poem' | 'quote' | null>(
    entry?.interpretation?.quote ? 'quote' : entry?.interpretation?.poem ? 'poem' : null
  );
  const [isSharing, setIsSharing] = useState(false);
  const [shareAction, setShareAction] = useState<'share' | 'download' | null>(null);
  const [showAI, setShowAI] = useState(isNewEntry || !!entry?.interpretation);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // First poem moment — show once ever
  const [showFirstPoem, setShowFirstPoem] = useState(false);
  useEffect(() => {
    const hasShown = localStorage.getItem('ne_first_share_shown');
    if (!hasShown && isNewEntry && (interpretation.poem || interpretation.quote)) {
      setShowFirstPoem(true);
    }
  }, [interpretation.poem, interpretation.quote]);
  const dismissFirstPoem = () => {
    localStorage.setItem('ne_first_share_shown', 'true');
    setShowFirstPoem(false);
  };

  const buildPoemCanvas = async (background: 'nocturnal' | 'transparent'): Promise<Blob> => {
    const text = interpretation.poem || interpretation.quote || entry?.content || "";
    const isQuote = !!interpretation.quote;

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    await document.fonts.ready;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (background === 'nocturnal') {
      // Rich dark nocturnal gradient background
      const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bgGrad.addColorStop(0, '#0c0e17');
      bgGrad.addColorStop(0.4, '#11131c');
      bgGrad.addColorStop(1, '#142283');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Radial glow top-right (primary accent)
      const glowTR = ctx.createRadialGradient(canvas.width, 0, 0, canvas.width, 0, 900);
      glowTR.addColorStop(0, 'rgba(188,194,255,0.10)');
      glowTR.addColorStop(1, 'transparent');
      ctx.fillStyle = glowTR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Radial glow bottom-left (secondary accent)
      const glowBL = ctx.createRadialGradient(0, canvas.height, 0, 0, canvas.height, 900);
      glowBL.addColorStop(0, 'rgba(20,34,131,0.30)');
      glowBL.addColorStop(1, 'transparent');
      ctx.fillStyle = glowBL;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle star dots
      ctx.save();
      const starPositions = [
        [120,200],[350,90],[600,160],[900,80],[980,300],[80,500],
        [800,450],[1000,700],[50,900],[960,1100],[200,1300],[750,1750],
        [450,1650],[900,1500],[130,1700],[600,1850]
      ];
      starPositions.forEach(([sx, sy]) => {
        const r = Math.random() * 1.5 + 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(188,194,255,${Math.random() * 0.4 + 0.2})`;
        ctx.fill();
      });
      ctx.restore();

      // No text shadow needed on dark bg
      ctx.shadowColor = 'rgba(188,194,255,0.15)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#bcc2ff';
    } else {
      // Transparent — strong shadow for readability on any background
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = 'white';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ── Step 1: measure poem lines first so we can center everything together ──
    const padding = 80;
    const maxWidth = canvas.width - padding * 2;
    const fontSize = 56;
    const lineHeight = fontSize * 1.6;
    ctx.font = `italic ${fontSize}px Newsreader`;

    const rawLines = text.split('\n').filter(l => l.trim().length > 0);
    const wrappedLines: string[] = [];
    rawLines.forEach(line => {
      const words = line.trim().split(' ');
      let currentLine = words[0];
      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) { currentLine += ' ' + word; }
        else { wrappedLines.push(currentLine); currentLine = word; }
      }
      wrappedLines.push(currentLine);
    });

    const poemHeight = wrappedLines.length * lineHeight;
    const openQuoteH  = isQuote ? 160 : 0;   // open-quote glyph height
    const closeQuoteH = isQuote ? 120 : 0;

    // Heights of each section
    const wordmarkH = 32;          // font-size of wordmark
    const gapWordmarkPoem = 72;    // space between wordmark and poem
    const gapPoemDate = 52;        // space between poem and date
    const dateH = 26;              // font-size of date

    const blockH = wordmarkH + gapWordmarkPoem + openQuoteH + poemHeight + closeQuoteH + gapPoemDate + dateH;

    // ── Step 2: compute top-left Y so the whole block is vertically centred ──
    let cursor = canvas.height / 2 - blockH / 2;

    // ── Step 3: draw wordmark at cursor ──
    const wordmarkY = cursor + wordmarkH / 2;

    // Set fill/shadow for wordmark
    if (background === 'nocturnal') {
      ctx.shadowColor = 'rgba(188,194,255,0.15)';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#bcc2ff';
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = 'white';
    }

    ctx.font = 'bold 32px Manrope';
    ctx.fillText('NOCTURNAL ECHO', canvas.width / 2 + 25, wordmarkY);

    // Moon crescent — draw on offscreen canvas to avoid cutting through background
    {
      const moonR = 20, moonOffset = 12, moonSize = (moonR + 2) * 2;
      const moonCanvas = document.createElement('canvas');
      moonCanvas.width = moonSize;
      moonCanvas.height = moonSize;
      const moonCtx = moonCanvas.getContext('2d')!;
      moonCtx.fillStyle = ctx.fillStyle;
      moonCtx.beginPath();
      moonCtx.arc(moonR, moonR, moonR, 0, Math.PI * 2);
      moonCtx.fill();
      moonCtx.globalCompositeOperation = 'destination-out';
      moonCtx.beginPath();
      moonCtx.arc(moonR + moonOffset, moonR, moonR, 0, Math.PI * 2);
      moonCtx.fill();
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.drawImage(moonCanvas, canvas.width / 2 - 160 - moonR, wordmarkY - moonR);
      ctx.restore();
    }

    cursor += wordmarkH + gapWordmarkPoem;

    // ── Step 4: re-apply fill/shadow for poem text ──
    if (background === 'nocturnal') {
      ctx.shadowColor = 'rgba(188,194,255,0.15)';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#e1e1ef';
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = 'white';
    }

    // Open quote
    if (isQuote) {
      ctx.font = 'italic 160px Newsreader';
      ctx.fillText('\u201c', canvas.width / 2, cursor + openQuoteH / 2);
      cursor += openQuoteH;
      ctx.font = `italic ${fontSize}px Newsreader`;
    } else {
      ctx.font = `italic ${fontSize}px Newsreader`;
    }

    // Poem lines
    const poemStartY = cursor;
    wrappedLines.forEach((line, i) => {
      ctx.fillText(line.trim(), canvas.width / 2, poemStartY + lineHeight * 0.5 + i * lineHeight);
    });
    cursor += poemHeight;

    // Close quote
    if (isQuote) {
      cursor += 20;
      ctx.font = 'italic 160px Newsreader';
      ctx.fillText('\u201d', canvas.width / 2, cursor + closeQuoteH / 2);
      cursor += closeQuoteH;
    }

    cursor += gapPoemDate;

    // ── Step 5: date, dimmed, just below the poem ──
    if (background === 'nocturnal') {
      ctx.fillStyle = 'rgba(147,150,181,0.45)';
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.shadowBlur = 0;
    }
    ctx.font = '26px Manrope';
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    ctx.fillText(dateStr, canvas.width / 2, cursor + dateH / 2);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to generate image blob');
    return blob;
  };

  const handleShareWithBg = async (background: 'nocturnal' | 'transparent') => {
    if (isSharing) return;
    setIsSharing(true);
    setShareAction(null);
    try {
      const blob = await buildPoemCanvas(background);
      const file = new File([blob], 'nocturnal-echo.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Nocturnal Echo', text: 'Distilling my thoughts into art. #NocturnalEcho' });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'nocturnal-echo.png';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) { console.error('Error sharing:', error); }
    finally { setIsSharing(false); }
  };

  const handleDownloadWithBg = async (background: 'nocturnal' | 'transparent') => {
    if (isSharing) return;
    setIsSharing(true);
    setShareAction(null);
    try {
      const blob = await buildPoemCanvas(background);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `nocturnal-echo-${new Date().getTime()}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { console.error('Error downloading:', error); }
    finally { setIsSharing(false); }
  };

  // Legacy wrapper so existing first-poem share button still works
  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const blob = await buildPoemCanvas('transparent');
      const file = new File([blob], 'nocturnal-echo.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Nocturnal Echo', text: 'Distilling my thoughts into art. #NocturnalEcho' });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.download = 'nocturnal-echo.png'; link.href = url; link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) { console.error('Error sharing:', error); }
    finally { setIsSharing(false); }
  };

  const handleDownload = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const blob = await buildPoemCanvas('transparent');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `nocturnal-echo-${new Date().getTime()}.png`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (error) { console.error('Error downloading:', error); }
    finally { setIsSharing(false); }
  };

  const premium = isProfileLoading || isPremiumUser(userProfile);

  // Free users: 1 AI interpretation per week
  const canInterpret = (): boolean => {
    if (premium) return true;
    const last = localStorage.getItem('ne_last_interpret');
    if (!last) return true;
    return (Date.now() - new Date(last).getTime()) / 86_400_000 >= 7;
  };

  const markInterpreted = () => {
    if (!premium) localStorage.setItem('ne_last_interpret', new Date().toISOString());
  };

  const handleInterpret = async (type: 'poem' | 'quote') => {
    if (!entry || loading) return;

    if (!canInterpret()) {
      onPaywall('poem');
      return;
    }

    setSelectedType(type);
    setLoading(true);
    setError(null);
    
    try {
      let newInterpretation = { ...interpretation };
      
      const result = await generateInterpretation(entry.content, type, userProfile?.age, userProfile?.identity);
      
      if (result.includes("A quiet echo in the dark") || result.includes("The night remains silent")) {
        throw new Error("The AI was unable to generate an echo. Please try again.");
      }

      newInterpretation[type] = result;
      setInterpretation(newInterpretation);

      // Save to Firestore
      const interpretationToSave: any = {};
      if (newInterpretation.poem) interpretationToSave.poem = newInterpretation.poem;
      if (newInterpretation.quote) interpretationToSave.quote = newInterpretation.quote;

      await onUpdateEntry(entry.id, { 
        interpretation: interpretationToSave
      });
      markInterpreted();
      console.error("Interpretation error:", error);
      setError(error.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Sync state when entry changes (e.g., after an edit)
  useEffect(() => {
    if (entry?.interpretation) {
      setInterpretation(entry.interpretation);
      if (!selectedType) {
        setSelectedType(entry.interpretation.quote ? 'quote' : 'poem');
      }
    }
  }, [entry]);

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[100dvh] pt-20 pb-32 px-4 max-w-4xl mx-auto overflow-x-hidden pt-safe pb-safe"
    >
      {/* ── First poem moment — shown once ever ── */}
      <AnimatePresence>
        {showFirstPoem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="fixed inset-0 z-[150] bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center px-8 text-center"
          >
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-secondary/5 rounded-full blur-[80px] pointer-events-none" />
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="space-y-6 max-w-sm"
            >
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 shadow-[0_0_30px_rgba(255,186,56,0.2)] flex items-center justify-center mx-auto">
                <Moon className="w-7 h-7 text-on-tertiary fill-current" />
              </div>
              <h2 className="font-headline italic text-4xl text-primary">Your first echo.</h2>
              <p className="font-body text-on-surface-variant/60 text-base leading-relaxed">
                Some things are worth keeping.<br />Some are worth sharing.
              </p>
              <div className="flex flex-col gap-3 pt-2">
                <button
                  onClick={() => { dismissFirstPoem(); handleShare(); }}
                  className="signature-gradient text-on-primary font-label text-sm uppercase tracking-[0.2em] font-bold py-4 rounded-full shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share It
                </button>
                <button
                  onClick={dismissFirstPoem}
                  className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/30 hover:text-on-surface-variant transition-colors py-2"
                >
                  Keep It Private
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <section className="mb-6 text-center">
        <h2 className="font-headline text-2xl md:text-4xl font-light tracking-tight mb-3 text-glow italic">
          {isNewEntry ? "Thoughts distilled." : entry?.date}
        </h2>
        <div className="max-w-2xl mx-auto mb-8">
          <p className="font-headline text-base md:text-xl leading-relaxed italic text-on-surface opacity-80 line-clamp-3">
            "{entry?.content}"
          </p>
        </div>
        {isNewEntry && !showAI && (
          <button 
            onClick={() => setShowAI(true)}
            className="flex items-center gap-2 mx-auto px-8 py-4 rounded-full bg-primary/10 text-primary font-label text-sm uppercase tracking-[0.2em] hover:bg-primary/20 transition-all shadow-lg hover:shadow-primary/5 active:scale-95"
          >
            <Sparkles className="w-5 h-5" />
            Interpret this Reflection
          </button>
        )}
      </section>

      <AnimatePresence>
        {isNewEntry && showAI && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-2xl mx-auto transition-all duration-500 ${interpretation.poem || interpretation.quote ? 'scale-90 opacity-80' : 'scale-100 opacity-100'}`}
          >
            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleInterpret('poem')}
              disabled={loading}
              className={`group relative flex flex-col items-center justify-center p-8 rounded-[2rem] transition-all duration-500 overflow-hidden border shadow-lg 
                ${selectedType === 'poem' 
                  ? 'bg-surface-container-high border-secondary shadow-[0_0_25px_rgba(255,188,255,0.2)]' 
                  : 'bg-surface-container border-white/5'} 
                ${loading && selectedType !== 'poem' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <PenTool className={`w-10 h-10 text-secondary mb-3 ${loading && selectedType === 'poem' ? 'animate-pulse' : ''}`} />
              <span className="font-label text-[10px] uppercase tracking-[0.2em] text-secondary/60">Versify</span>
              <h3 className="font-headline text-xl mt-1">{interpretation.poem ? 'Regenerate Poem' : 'Compose Poem'}</h3>
            </motion.button>

            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleInterpret('quote')}
              disabled={loading}
              className={`group relative flex flex-col items-center justify-center p-8 rounded-[2rem] transition-all duration-500 overflow-hidden border shadow-lg 
                ${selectedType === 'quote' 
                  ? 'bg-surface-container-high border-tertiary shadow-[0_0_25px_rgba(255,230,188,0.2)]' 
                  : 'bg-surface-container border-white/5'} 
                ${loading && selectedType !== 'quote' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <Quote className={`w-10 h-10 text-tertiary mb-3 ${loading && selectedType === 'quote' ? 'animate-pulse' : ''}`} />
              <span className="font-label text-[10px] uppercase tracking-[0.2em] text-tertiary/60">Echo</span>
              <h3 className="font-headline text-xl mt-1">{interpretation.quote ? 'Regenerate Quote' : 'Find Quote'}</h3>
            </motion.button>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Free user — weekly limit nudge */}
      {isNewEntry && !premium && !canInterpret() && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md mx-auto mb-8 flex items-center gap-3 px-5 py-4 rounded-2xl bg-tertiary/5 border border-tertiary/15"
        >
          <Sparkles className="w-4 h-4 text-tertiary flex-shrink-0" />
          <p className="text-on-surface-variant/70 text-sm font-body">
            You've used your free interpretation this week.{' '}
            <button onClick={() => onPaywall('poem')} className="text-tertiary underline underline-offset-2 hover:text-tertiary/80">
              Unlock unlimited with Premium.
            </button>
          </p>
        </motion.div>
      )}

      {/* Trial countdown for free users still in trial */}
      {isNewEntry && !userProfile?.isSubscribed && isPremiumUser(userProfile) && trialDaysLeft(userProfile) <= 3 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md mx-auto mb-8 flex items-center gap-3 px-5 py-4 rounded-2xl bg-primary/5 border border-primary/15"
        >
          <Moon className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-on-surface-variant/70 text-sm font-body">
            {trialDaysLeft(userProfile) === 0
              ? 'Your trial ends today. '
              : `${trialDaysLeft(userProfile)} day${trialDaysLeft(userProfile) === 1 ? '' : 's'} left in your trial. `}
            <button onClick={() => onPaywall('poem')} className="text-primary underline underline-offset-2 hover:text-primary/80">
              Subscribe to keep the magic.
            </button>
          </p>
        </motion.div>
      )}

      {error && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          className="max-w-md mx-auto mb-8 p-4 rounded-2xl bg-error/10 border border-error/20 text-error text-center text-sm font-body"
        >
          {error}
        </motion.div>
      )}

      {(interpretation.poem || interpretation.quote) && (
        <section className="relative perspective-1000">
          {!isNewEntry && (
            <div className="text-center mb-6">
              <span className="font-headline text-sm italic text-on-surface/40 tracking-wider">Your Echo from this night</span>
            </div>
          )}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-48 md:w-80 md:h-80 bg-tertiary/5 rounded-full blur-[60px] pointer-events-none" />
        <motion.div 
          ref={cardRef}
          initial={{ rotateY: 15, rotateX: 5, opacity: 0 }}
          animate={{ rotateY: 0, rotateX: 0, opacity: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="relative rounded-[2.5rem] overflow-hidden bg-surface-container-low p-1 border border-white/5 preserve-3d"
        >
          <div className="rounded-[2rem] bg-surface-container-lowest p-5 md:p-10 overflow-hidden relative">
            <div className="flex flex-col items-center gap-5">
              <div className="w-full text-center px-4 md:px-12 lg:px-24 space-y-8">
                <div className="space-y-6">
                  {selectedType === 'quote' && (
                    <Quote className="w-10 h-10 md:w-16 md:h-16 text-tertiary/10 mx-auto mb-2" />
                  )}
                  <h4 className={`font-headline text-2xl md:text-4xl font-light italic leading-relaxed whitespace-pre-line transition-opacity duration-500 ${loading ? 'opacity-40' : 'opacity-100'}`}>
                    {loading 
                      ? (selectedType === 'poem' ? "Distilling your day into verse..." : "Finding the words that echo yours...")
                      : (selectedType === 'quote' 
                          ? (interpretation.quote?.replace(/^["']|["']$/g, '') || "Finding your echo...") 
                          : (interpretation.poem || interpretation.quote?.replace(/^["']|["']$/g, '') || "Reflecting on the night..."))}
                  </h4>
                  {selectedType === 'quote' && (
                    <Quote className="w-10 h-10 md:w-16 md:h-16 text-tertiary/10 mx-auto mt-2 rotate-180" />
                  )}
                </div>
              </div>
            </div>

            {/* Branding for sharing */}
            <div className="absolute bottom-4 right-8 flex items-center gap-2 opacity-20 group-hover:opacity-40 transition-opacity">
              <Moon className="w-3 h-3 text-primary fill-current" />
              <span className="font-label text-[8px] uppercase tracking-[0.3em] font-bold">Nocturnal Echo</span>
            </div>
          </div>
        </motion.div>
      </section>
      )}

        <div className="mt-8 flex flex-col items-center gap-4">
          <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 w-full px-2">
            {(interpretation.poem || interpretation.quote) && (
              <>
                <button 
                  onClick={() => setShareAction('share')}
                  disabled={isSharing}
                  className={`group relative w-full sm:w-auto px-6 py-4 rounded-full overflow-hidden transition-all duration-500 hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(188,194,255,0.1)] signature-gradient ${isSharing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="relative flex items-center gap-3 text-on-primary font-label text-sm font-bold uppercase tracking-widest">
                    <span>{isSharing ? 'Preparing...' : 'Share on Socials'}</span>
                    <Share2 className={`w-5 h-5 ${isSharing ? 'animate-spin' : ''}`} />
                  </div>
                </button>
                <button 
                  onClick={() => setShareAction('download')}
                  disabled={isSharing}
                  className="w-full sm:w-auto px-6 py-4 rounded-full bg-surface-container-high text-on-surface font-label text-sm font-bold uppercase tracking-widest hover:bg-surface-container-highest transition-all flex items-center justify-center gap-3"
                >
                  <span>Save to Camera Roll</span>
                  <Download className="w-5 h-5" />
                </button>

                {/* Background Picker Modal */}
                <AnimatePresence>
                  {shareAction && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
                      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
                      onClick={() => setShareAction(null)}
                    >
                      <motion.div
                        initial={{ y: 60, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 60, opacity: 0 }}
                        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                        className="w-full max-w-sm rounded-3xl overflow-hidden"
                        style={{ background: '#1d1f29', border: '1px solid rgba(188,194,255,0.12)' }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 pt-6 pb-4">
                          <div>
                            <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant">
                              {shareAction === 'share' ? 'Share on Socials' : 'Save to Camera Roll'}
                            </p>
                            <p className="font-headline text-lg text-on-surface mt-0.5">Choose a Background</p>
                          </div>
                          <button
                            onClick={() => setShareAction(null)}
                            className="p-2 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        {/* Options */}
                        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
                          {/* Nocturnal Option */}
                          <button
                            onClick={() => shareAction === 'share' ? handleShareWithBg('nocturnal') : handleDownloadWithBg('nocturnal')}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95"
                            style={{ background: 'linear-gradient(135deg, #0c0e17 0%, #11131c 50%, #142283 100%)', border: '1px solid rgba(188,194,255,0.2)', minHeight: '140px' }}
                          >
                            {/* Stars */}
                            {[{top:'12%',left:'15%'},{top:'25%',left:'75%'},{top:'45%',left:'30%'},{top:'60%',left:'80%'},{top:'80%',left:'20%'},{top:'35%',left:'55%'}].map((pos, i) => (
                              <div key={i} className="absolute w-0.5 h-0.5 rounded-full" style={{ top: pos.top, left: pos.left, backgroundColor: 'rgba(188,194,255,0.6)' }} />
                            ))}
                            {/* Glow */}
                            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 80% 20%, rgba(188,194,255,0.08) 0%, transparent 60%)' }} />
                            {/* Label */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                              <Moon className="w-5 h-5" style={{ color: '#bcc2ff' }} />
                              <span className="font-label text-xs font-bold uppercase tracking-widest" style={{ color: '#bcc2ff' }}>Nocturnal</span>
                              <span className="font-body text-[10px]" style={{ color: 'rgba(188,194,255,0.5)' }}>Dark background</span>
                            </div>
                          </button>

                          {/* Transparent Option */}
                          <button
                            onClick={() => shareAction === 'share' ? handleShareWithBg('transparent') : handleDownloadWithBg('transparent')}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95"
                            style={{ border: '1px solid rgba(188,194,255,0.15)', minHeight: '140px', background: 'repeating-conic-gradient(rgba(188,194,255,0.05) 0% 25%, transparent 0% 50%) 0 0/16px 16px' }}
                          >
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 rounded-2xl" style={{ backgroundColor: 'rgba(17,19,28,0.5)' }}>
                              <div className="w-5 h-5 rounded border-2 flex items-center justify-center" style={{ borderColor: 'rgba(188,194,255,0.4)' }}>
                                <div className="w-2 h-2 rounded-sm" style={{ background: 'repeating-conic-gradient(rgba(188,194,255,0.3) 0% 25%, transparent 0% 50%) 0 0/4px 4px' }} />
                              </div>
                              <span className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Transparent</span>
                              <span className="font-body text-[10px] text-on-surface-variant" style={{ opacity: 0.6 }}>No background</span>
                            </div>
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            
            {isNewEntry && (
              <button 
                onClick={() => {
                  if (entry) {
                    setCurrentEntry(entry.content);
                    onNavigate('reflect');
                  }
                }}
                className="px-8 py-4 rounded-full bg-surface-container-high text-on-surface font-label text-sm font-bold uppercase tracking-widest hover:bg-surface-container-highest transition-all"
              >
                Edit Entry
              </button>
            )}
          </div>
          <button 
            onClick={() => onNavigate('journey')}
            className="text-on-surface-variant hover:text-on-surface font-label text-xs uppercase tracking-[0.2em] transition-colors duration-300"
          >
            Back to Journey
          </button>
        </div>
      </motion.main>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} style={{ background: 'transparent', color: '#ffba38', fontWeight: 600 }}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function MonthPicker({ value, onChange, onClose }: { 
  value: { month: number; year: number } | null; 
  onChange: (v: { month: number; year: number } | null) => void; 
  onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(value?.year ?? now.getFullYear());

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -8 }}
      transition={{ duration: 0.18 }}
      className="absolute top-full right-0 mt-2 z-50 bg-surface-container border border-white/10 rounded-[1.5rem] p-5 shadow-2xl w-72"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setYear(y => y - 1)}
          className="p-1.5 rounded-full hover:bg-white/10 text-on-surface-variant transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-headline italic text-lg text-primary">{year}</span>
        <button
          onClick={() => setYear(y => Math.min(y + 1, now.getFullYear()))}
          className="p-1.5 rounded-full hover:bg-white/10 text-on-surface-variant transition-colors disabled:opacity-30"
          disabled={year >= now.getFullYear()}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MONTHS.map((m, i) => {
          const isSelected = value?.month === i && value?.year === year;
          const isFuture = year === now.getFullYear() && i > now.getMonth();
          return (
            <button
              key={m}
              disabled={isFuture}
              onClick={() => {
                if (isSelected) {
                  onChange(null);
                } else {
                  onChange({ month: i, year });
                }
                onClose();
              }}
              className={`py-2 px-1 rounded-xl text-xs font-label uppercase tracking-widest transition-all duration-200
                ${isSelected
                  ? 'bg-primary/20 text-primary border border-primary/40 shadow-[0_0_12px_rgba(188,194,255,0.2)]'
                  : isFuture
                    ? 'text-on-surface-variant/20 cursor-not-allowed'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
            >
              {m.slice(0, 3)}
            </button>
          );
        })}
      </div>
      {value && (
        <button
          onClick={() => { onChange(null); onClose(); }}
          className="mt-4 w-full text-[10px] font-label uppercase tracking-widest text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
        >
          Clear filter
        </button>
      )}
    </motion.div>
  );
}

function JourneyScreen({ entries, onNavigate, onPaywall, onDeleteEntry, setLastInterpretation, setCurrentEntry, setIsNewEntry, userProfile, isProfileLoading }: { 
  entries: JournalEntry[], 
  onNavigate: (s: Screen) => void,
  onPaywall: (trigger?: 'poem' | 'library' | 'sound' | 'trial' | 'general') => void,
  onDeleteEntry: (id: string) => Promise<void>,
  setLastInterpretation: (e: JournalEntry | null) => void,
  setCurrentEntry: (s: string) => void,
  setIsNewEntry: (b: boolean) => void,
  userProfile: UserProfile | null,
  isProfileLoading: boolean,
  key?: string 
}) {
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<{ month: number; year: number } | null>(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const premium = isProfileLoading || isPremiumUser(userProfile);
  const FREE_ENTRY_LIMIT = 7;
  // Free users see only the 7 most recent entries
  const visibleEntries = premium ? entries : entries.slice(0, FREE_ENTRY_LIMIT);
  const lockedCount = premium ? 0 : Math.max(0, entries.length - FREE_ENTRY_LIMIT);

  // Close picker when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowMonthPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isSearchActive = searchQuery.trim().length > 0 || dateFilter !== null;

  const getLocalDateString = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Filtered entries for search mode — searches only visible (gated) entries
  const filteredEntries = isSearchActive ? visibleEntries.filter(entry => {
    const matchesKeyword = searchQuery.trim()
      ? entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.date.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.mood.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesDate = dateFilter
      ? (() => {
          const d = new Date(entry.timestamp);
          return d.getMonth() === dateFilter.month && d.getFullYear() === dateFilter.year;
        })()
      : true;
    return matchesKeyword && matchesDate;
  }) : [];
  const calculateStreak = () => {
    const entryDates = entries.map(e => getLocalDateString(new Date(e.timestamp)));
    const restoredDates = userProfile?.restoredDates || [];
    
    const uniqueDates = Array.from(new Set([...entryDates, ...restoredDates]))
      .sort((a, b) => b.localeCompare(a)); // Sort descending

    console.log("Streak calculation - Unique Dates:", uniqueDates);

    if (uniqueDates.length === 0) return 0;

    const today = getLocalDateString(new Date());
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));

    console.log(`Streak calculation - Today: ${today}, Yesterday: ${yesterday}, Most Recent: ${uniqueDates[0]}`);

    // If the most recent entry isn't today or yesterday, the streak is broken
    if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
      console.log("Streak broken - most recent entry is too old");
      return 0;
    }

    let streak = 0;
    let expectedDate = uniqueDates[0];

    for (const date of uniqueDates) {
      if (date === expectedDate) {
        streak++;
        // Set expected date to the day before the current date in the loop
        const current = new Date(date + 'T12:00:00'); // Use noon to avoid DST issues
        current.setDate(current.getDate() - 1);
        expectedDate = getLocalDateString(current);
      } else {
        // Gap found
        break;
      }
    }
    
    return streak;
  };

  const groupEntriesByMonth = () => {
    const groups: { [key: string]: JournalEntry[] } = {};
    visibleEntries.forEach(entry => {
      const date = new Date(entry.timestamp);
      const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!groups[monthYear]) groups[monthYear] = [];
      groups[monthYear].push(entry);
    });
    return Object.entries(groups).sort((a, b) => {
      const dateA = new Date(a[1][0].timestamp);
      const dateB = new Date(b[1][0].timestamp);
      return dateB.getTime() - dateA.getTime();
    });
  };

  const streak = calculateStreak();
  const groupedEntries = groupEntriesByMonth();

  // ── Streak Share ─────────────────────────────────────────────────────────
  const [streakShareAction, setStreakShareAction] = useState<'share' | 'download' | null>(null);
  const [isSharingStreak, setIsSharingStreak] = useState(false);

  const buildStreakCanvas = async (background: 'nocturnal' | 'transparent'): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    await document.fonts.ready;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (background === 'nocturnal') {
      const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bgGrad.addColorStop(0, '#0c0e17');
      bgGrad.addColorStop(0.5, '#11131c');
      bgGrad.addColorStop(1, '#1a1f3c');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Gold glow in centre
      const glow = ctx.createRadialGradient(540, 540, 0, 540, 540, 600);
      glow.addColorStop(0, 'rgba(255,186,56,0.12)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Stars
      [[80,120],[300,60],[750,90],[980,200],[50,450],[1020,500],[120,900],[400,1010],[850,980],[1000,800],[500,40],[640,1000]].forEach(([sx,sy]) => {
        ctx.beginPath(); ctx.arc(sx,sy,Math.random()*1.5+0.4,0,Math.PI*2);
        ctx.fillStyle=`rgba(188,194,255,${Math.random()*0.4+0.15})`; ctx.fill();
      });
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 20;
    }

    // Moon wordmark top
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = background === 'nocturnal' ? '#bcc2ff' : 'white';
    ctx.shadowColor = background === 'nocturnal' ? 'rgba(188,194,255,0.2)' : 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 28px Manrope';
    ctx.fillText('NOCTURNAL ECHO', canvas.width / 2 + 22, 100);
    // Moon crescent — draw on offscreen canvas to avoid cutting through background
    {
      const moonR = 17, moonOffset = 10, moonSize = (moonR + 2) * 2;
      const moonCanvas = document.createElement('canvas');
      moonCanvas.width = moonSize;
      moonCanvas.height = moonSize;
      const moonCtx = moonCanvas.getContext('2d')!;
      moonCtx.fillStyle = ctx.fillStyle;
      moonCtx.beginPath();
      moonCtx.arc(moonR, moonR, moonR, 0, Math.PI * 2);
      moonCtx.fill();
      moonCtx.globalCompositeOperation = 'destination-out';
      moonCtx.beginPath();
      moonCtx.arc(moonR + moonOffset, moonR, moonR, 0, Math.PI * 2);
      moonCtx.fill();
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.drawImage(moonCanvas, canvas.width / 2 - 148 - moonR, 100 - moonR);
      ctx.restore();
    }

    // Centre: streak number
    ctx.shadowColor = background === 'nocturnal' ? 'rgba(255,186,56,0.4)' : 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = background === 'nocturnal' ? 60 : 20;
    ctx.fillStyle = background === 'nocturnal' ? '#ffba38' : 'white';
    ctx.font = `bold 260px Manrope`;
    ctx.fillText(String(streak), canvas.width / 2, canvas.height / 2 - 40);

    // Label below number
    ctx.shadowBlur = 0;
    ctx.fillStyle = background === 'nocturnal' ? 'rgba(255,186,56,0.55)' : 'rgba(255,255,255,0.7)';
    ctx.font = '42px Manrope';
    ctx.fillText('DAYS REFLECTING', canvas.width / 2, canvas.height / 2 + 130);

    // Tagline
    ctx.fillStyle = background === 'nocturnal' ? 'rgba(188,194,255,0.3)' : 'rgba(255,255,255,0.4)';
    ctx.font = 'italic 32px Newsreader';
    ctx.fillText('Distilling thoughts into art, one night at a time.', canvas.width / 2, canvas.height - 100);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to generate blob');
    return blob;
  };

  const handleStreakShare = async (background: 'nocturnal' | 'transparent') => {
    if (isSharingStreak) return;
    setIsSharingStreak(true);
    setStreakShareAction(null);
    try {
      const blob = await buildStreakCanvas(background);
      const file = new File([blob], 'nocturnal-echo-streak.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${streak} Days of Reflection`, text: `${streak} nights of distilling thoughts into art. #NocturnalEcho` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.download = `nocturnal-echo-streak-${streak}.png`; link.href = url; link.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { console.error('Error sharing streak:', e); }
    finally { setIsSharingStreak(false); }
  };


  const getJourneyDays = () => {
    const days = [];
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const joinDate = userProfile?.createdAt ? new Date(userProfile.createdAt) : new Date();
    
    // Calculate how many days since joining to determine the current 15-day cycle
    const diffTime = now.getTime() - joinDate.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    const currentCycle = Math.floor(diffDays / 15);
    
    const cycleStartDate = new Date(joinDate);
    cycleStartDate.setDate(joinDate.getDate() + (currentCycle * 15));
    
    for (let i = 0; i < 15; i++) {
      const date = new Date(cycleStartDate);
      date.setDate(cycleStartDate.getDate() + i);
      
      const y = date.getFullYear();
      const m = date.getMonth();
      const d = date.getDate();
      
      const dateStr = getLocalDateString(date);
      const isFuture = dateStr > todayStr;
      const isToday = dateStr === todayStr;

      const entry = entries.find(e => {
        const ed = new Date(e.timestamp);
        return ed.getFullYear() === y && ed.getMonth() === m && ed.getDate() === d;
      });
      
      const isRestored = userProfile?.restoredDates?.includes(dateStr);
      
      days.push({
        date: dateStr,
        hasEntry: !!entry || isRestored,
        isRestored,
        entry: entry || null,
        isToday,
        isFuture,
        dayOfMonth: d,
        journeyDay: (currentCycle * 15) + i + 1
      });
    }
    return { days, currentCycle };
  };

  const { days: journeyDays, currentCycle } = getJourneyDays();

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pt-20 px-4 max-w-2xl mx-auto pb-32"
    >
      {/* SEARCH BAR */}
      <div className="mb-8 relative" ref={pickerRef}>
        <div className={`flex items-center gap-2 rounded-[1.5rem] px-4 py-3 border transition-all duration-300 ${
          isSearchActive
            ? 'bg-surface-container border-primary/30 shadow-[0_0_18px_rgba(188,194,255,0.1)]'
            : 'bg-surface-container-low border-white/5'
        }`}>
          <Search className={`w-4 h-4 flex-shrink-0 transition-colors ${isSearchActive ? 'text-primary' : 'text-on-surface-variant/40'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search your echoes…"
            className="flex-1 bg-transparent outline-none font-body text-sm text-on-surface placeholder:text-on-surface-variant/30"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button
            onClick={() => setShowMonthPicker(p => !p)}
            className={`flex items-center gap-1.5 transition-all rounded-full px-3 py-1.5 text-[10px] font-label uppercase tracking-widest ${
              dateFilter
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="Filter by month"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {dateFilter ? `${MONTHS[dateFilter.month].slice(0,3)} ${dateFilter.year}` : ''}
            <ChevronDown className={`w-3 h-3 transition-transform ${showMonthPicker ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <AnimatePresence>
          {showMonthPicker && (
            <MonthPicker
              value={dateFilter}
              onChange={setDateFilter}
              onClose={() => setShowMonthPicker(false)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* SEARCH RESULTS */}
      <AnimatePresence mode="wait">
        {isSearchActive && (
          <motion.section
            key="search-results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
          >
            {filteredEntries.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-body text-sm italic text-on-surface-variant/40">No echoes found for this search.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[10px] font-label uppercase tracking-[0.2em] text-on-surface-variant/40 px-1 mb-4">
                  {filteredEntries.length} echo{filteredEntries.length !== 1 ? 's' : ''} found
                </p>
                {filteredEntries.map(entry => {
                  const previewLines = entry.content.split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
                  return (
                    <motion.article
                      key={entry.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => {
                        setLastInterpretation(entry);
                        setIsNewEntry(false);
                        onNavigate('reveal');
                      }}
                      className="bg-surface-container-lowest rounded-[1.75rem] p-6 border border-white/5 cursor-pointer hover:bg-surface-container-low transition-all hover:border-primary/10 hover:shadow-[0_0_20px_rgba(188,194,255,0.05)] group"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <time className="font-headline italic text-base text-primary">
                          <HighlightedText text={entry.date} query={searchQuery} />
                        </time>
                        <span className="bg-secondary-container/30 text-on-secondary-container px-3 py-1 rounded-lg text-[10px] tracking-wider uppercase font-semibold">
                          {entry.mood}
                        </span>
                      </div>
                      <p className="font-body text-on-surface/70 text-sm leading-relaxed italic line-clamp-2">
                        <HighlightedText text={previewLines} query={searchQuery} />
                      </p>
                      <div className="flex items-center gap-3 mt-3 text-on-surface-variant/40 group-hover:text-primary/50 transition-colors">
                        <History className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-label uppercase tracking-widest">Read Full Entry</span>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* NORMAL LIBRARY VIEW — hidden during search */}
      {!isSearchActive && (
        <>
      <section className="relative mb-8 flex flex-col items-center perspective-1000">
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-64 h-64 bg-tertiary/5 rounded-full blur-[80px] -z-10" />
        <motion.div 
          whileHover={{ rotateY: 5, rotateX: -5, scale: 1.02 }}
          className="bg-surface-container-low rounded-[2rem] p-7 w-full text-center border border-white/5 flex flex-col items-center shadow-xl preserve-3d"
        >
          <div className="w-16 h-16 mb-4 flex items-center justify-center rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 shadow-[0_0_20px_rgba(255,186,56,0.2)]">
            <Moon className="text-on-tertiary w-8 h-8 fill-current" />
          </div>
          <h2 className={`font-headline ${streak === 0 && entries.length === 0 ? 'text-lg italic opacity-60' : 'text-4xl'} font-light tracking-tight text-tertiary mb-2`}>
            {streak === 0 && entries.length === 0 ? "Your streak begins tonight" : `${streak} Days Reflecting`}
          </h2>
          <p className="font-body text-on-surface-variant text-sm tracking-widest uppercase mb-8">Current Streak</p>
          {streak === 0 && entries.length > 0 && (
            <button 
              onClick={() => onNavigate('restoration')}
              className="mb-6 flex items-center gap-2 text-tertiary font-label uppercase tracking-widest text-xs hover:underline"
            >
              <HeartOff className="w-4 h-4" />
              Restore Broken Streak
            </button>
          )}
          <button
            onClick={() => setStreakShareAction('share')}
            disabled={isSharingStreak}
            className={`signature-gradient text-on-primary px-8 py-4 rounded-full font-semibold flex items-center gap-3 transition-transform active:scale-95 shadow-lg shadow-primary/10 ${isSharingStreak ? 'opacity-50' : ''}`}
          >
            <Share2 className={`w-5 h-5 ${isSharingStreak ? 'animate-spin' : ''}`} />
            {isSharingStreak ? 'Preparing...' : 'Share My Streak'}
          </button>

          {/* Streak Background Picker Modal */}
          <AnimatePresence>
            {streakShareAction && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
                style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
                onClick={() => setStreakShareAction(null)}
              >
                <motion.div
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 60, opacity: 0 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                  className="w-full max-w-sm rounded-3xl overflow-hidden"
                  style={{ background: '#1d1f29', border: '1px solid rgba(188,194,255,0.12)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-6 pt-6 pb-4">
                    <div>
                      <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Share My Streak</p>
                      <p className="font-headline text-lg text-on-surface mt-0.5">Choose a Background</p>
                    </div>
                    <button onClick={() => setStreakShareAction(null)} className="p-2 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 px-6 pb-6">
                    {/* Nocturnal */}
                    <button
                      onClick={() => handleStreakShare('nocturnal')}
                      className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{ background: 'linear-gradient(135deg, #0c0e17 0%, #11131c 50%, #1a1f3c 100%)', border: '1px solid rgba(255,186,56,0.25)', minHeight: '140px' }}
                    >
                      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(255,186,56,0.1) 0%, transparent 70%)' }} />
                      {[{top:'15%',left:'20%'},{top:'30%',left:'70%'},{top:'65%',left:'40%'},{top:'80%',left:'75%'}].map((pos, i) => (
                        <div key={i} className="absolute w-0.5 h-0.5 rounded-full" style={{ top: pos.top, left: pos.left, backgroundColor: 'rgba(188,194,255,0.5)' }} />
                      ))}
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                        <Moon className="w-5 h-5" style={{ color: '#ffba38' }} />
                        <span className="font-label text-xs font-bold uppercase tracking-widest" style={{ color: '#ffba38' }}>Nocturnal</span>
                        <span className="font-body text-[10px]" style={{ color: 'rgba(255,186,56,0.45)' }}>Dark background</span>
                      </div>
                    </button>
                    {/* Transparent */}
                    <button
                      onClick={() => handleStreakShare('transparent')}
                      className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{ border: '1px solid rgba(188,194,255,0.15)', minHeight: '140px', background: 'repeating-conic-gradient(rgba(188,194,255,0.05) 0% 25%, transparent 0% 50%) 0 0/16px 16px' }}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 rounded-2xl" style={{ backgroundColor: 'rgba(17,19,28,0.5)' }}>
                        <div className="w-5 h-5 rounded border-2 flex items-center justify-center" style={{ borderColor: 'rgba(188,194,255,0.4)' }}>
                          <div className="w-2 h-2 rounded-sm" style={{ background: 'repeating-conic-gradient(rgba(188,194,255,0.3) 0% 25%, transparent 0% 50%) 0 0/4px 4px' }} />
                        </div>
                        <span className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Transparent</span>
                        <span className="font-body text-[10px] text-on-surface-variant" style={{ opacity: 0.6 }}>No background</span>
                      </div>
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </section>

      <section className="grid grid-cols-2 gap-3 mb-8 perspective-1000">
        <motion.div 
          whileHover={{ rotateY: 10, scale: 1.05 }}
          className="bg-surface-container-low p-5 rounded-[1.75rem] flex flex-col justify-between h-32 border border-white/5 preserve-3d"
        >
          <BookOpen className="text-secondary w-6 h-6" />
          <div>
            <div className={`font-headline ${entries.length === 0 ? 'text-xs opacity-60' : 'text-2xl'} text-on-surface`}>
              {entries.length === 0 ? "Your first night awaits" : entries.length}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Total Entries</div>
          </div>
        </motion.div>
        <motion.div 
          whileHover={{ rotateY: -10, scale: 1.05 }}
          className="bg-surface-container-low p-5 rounded-[1.75rem] flex flex-col justify-between h-32 border border-white/5 preserve-3d"
        >
          <Sparkles className="text-tertiary w-6 h-6 fill-current" />
          <div>
            <div className={`font-headline ${streak === 0 && entries.length === 0 ? 'text-xs opacity-60' : 'text-2xl'} text-on-surface`}>
              {streak === 0 && entries.length === 0 ? "No record yet — make one" : `${streak} Days`}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Longest Streak</div>
          </div>
        </motion.div>
      </section>

      <section className="mb-16">
        <h3 className="font-label text-[10px] uppercase tracking-[0.3em] text-on-surface-variant mb-6 px-2">
          Your Journey: Days {currentCycle * 15 + 1}–{currentCycle * 15 + 15}
        </h3>
        <div className="bg-surface-container-low p-6 pb-16 rounded-[2rem] border border-white/5 shadow-lg">
          <div className="flex justify-between items-center w-full gap-1 md:gap-2">
            {journeyDays.map((day, index) => (
              <div key={day.date} className="flex flex-col items-center flex-1 min-w-0 relative">
                <motion.div
                  whileHover={{ scale: 1.5 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    if (day.entry) {
                      setLastInterpretation(day.entry);
                      setIsNewEntry(false);
                      onNavigate('reveal');
                    }
                  }}
                  className={`
                    relative w-2 h-2 md:w-3 md:h-3 rounded-full transition-all duration-500
                    ${day.isToday 
                      ? (day.hasEntry 
                          ? 'bg-[#FFD700] shadow-[0_0_20px_6px_rgba(255,215,0,0.9)] z-10 scale-125' 
                          : 'bg-white shadow-[0_0_15px_4px_rgba(255,255,255,0.9)] z-10 scale-125')
                      : day.isRestored
                        ? 'bg-primary/40 shadow-[0_0_10px_rgba(188,194,255,0.3)]'
                        : day.hasEntry 
                          ? 'bg-[#F5A623] shadow-[0_0_15px_rgba(245,166,35,0.7)] cursor-pointer' 
                          : day.isFuture ? 'bg-white/5' : 'bg-white/10'}
                  `}
                >
                  {day.isToday && !day.hasEntry && (
                    <motion.div
                      animate={{ scale: [1, 4, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -inset-3 rounded-full bg-white/40 -z-10"
                    />
                  )}
                </motion.div>
                
                {(index % 7 === 0 || index === 14 || day.isToday) && (
                  <span className={`absolute top-6 left-1/2 -translate-x-1/2 text-[8px] md:text-[10px] font-label uppercase tracking-tighter whitespace-nowrap transition-opacity duration-500 ${day.isToday ? 'text-white font-bold opacity-100' : 'text-on-surface-variant opacity-50'}`}>
                    {day.isToday ? 'Today' : `Day ${day.journeyDay}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        {groupedEntries.map(([month, monthEntries]) => (
          <div key={month} className="mb-8">
            <div className="flex items-baseline justify-between mb-8 px-2">
              <h3 className="font-headline text-2xl font-light text-on-surface">Past Journeys</h3>
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant">{month}</span>
            </div>
            <div className="space-y-4 perspective-1000">
              {monthEntries.map(entry => {
                const isToday = entry.date === new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                return (
                  <motion.article 
                    key={entry.id} 
                    whileHover={{ scale: 1.02, rotateX: 2, rotateY: -2 }}
                    onClick={() => {
                      setLastInterpretation(entry);
                      setIsNewEntry(false);
                      onNavigate('reveal');
                    }}
                    className="group relative bg-surface-container-lowest rounded-[1.75rem] p-5 transition-all hover:bg-surface-container-low cursor-pointer border border-white/5 preserve-3d shadow-lg"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex flex-col">
                        <time className="font-headline text-lg text-primary mb-0.5">{entry.date}</time>
                        <span className="text-[10px] uppercase tracking-widest text-on-surface-variant">{entry.timestamp.split('T')[1].slice(0, 5)}</span>
                      </div>
                      <div className="flex gap-2 items-center">
                        {isToday && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentEntry(entry.content);
                              onNavigate('reflect');
                            }}
                            className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-lg text-[10px] tracking-wider uppercase font-bold hover:bg-primary/20 transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                        )}
                        <span className="bg-secondary-container/30 text-on-secondary-container px-3 py-1 rounded-lg text-[10px] tracking-wider uppercase font-semibold">
                          {entry.mood}
                        </span>
                        {isToday && (
                          <div className="flex gap-2 items-center">
                            {deletingEntryId === entry.id ? (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex gap-1 items-center bg-error/10 p-1 rounded-full border border-error/20"
                              >
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingEntryId(null);
                                  }}
                                  className="p-1.5 rounded-full hover:bg-white/10 text-on-surface-variant transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteEntry(entry.id);
                                    setDeletingEntryId(null);
                                  }}
                                  className="p-1.5 rounded-full bg-error text-on-error transition-colors shadow-lg"
                                  title="Confirm Delete"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              </motion.div>
                            ) : (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingEntryId(entry.id);
                                }}
                                className="p-2 rounded-full hover:bg-error/10 text-error/40 hover:text-error transition-colors"
                                title="Delete Reflection"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="font-body text-on-surface/80 line-clamp-2 text-sm leading-relaxed mb-3 italic font-light">
                      {entry.content}
                    </p>
                    <div className="flex items-center gap-4 text-on-surface-variant">
                      <History className="w-4 h-4" />
                      <span className="text-[11px] font-medium uppercase tracking-widest">
                        {isToday ? 'View Reflection' : 'Read Full Entry'}
                      </span>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Locked entries banner for free users */}
      {!premium && lockedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 relative rounded-[2rem] overflow-hidden border border-primary/20"
        >
          {/* Blurred preview rows */}
          <div className="p-6 space-y-3 pointer-events-none select-none" style={{ filter: 'blur(4px)', opacity: 0.4 }}>
            {[...Array(Math.min(lockedCount, 3))].map((_, i) => (
              <div key={i} className="bg-surface-container-lowest rounded-2xl p-5 border border-white/5">
                <div className="h-3 w-32 bg-primary/20 rounded-full mb-3" />
                <div className="h-2.5 w-full bg-on-surface/10 rounded-full mb-2" />
                <div className="h-2.5 w-3/4 bg-on-surface/10 rounded-full" />
              </div>
            ))}
          </div>
          {/* Overlay CTA */}
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-headline italic text-2xl text-primary mb-2">
              {lockedCount} more night{lockedCount !== 1 ? 's' : ''} in your archive
            </h3>
            <p className="text-on-surface-variant/60 text-sm font-body mb-5 max-w-xs">
              Unlock your full journal history with Premium.
            </p>
            <button
              onClick={() => onPaywall('library')}
              className="signature-gradient text-on-primary font-label text-xs uppercase tracking-[0.2em] font-bold px-8 py-3 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              Unlock Full Library
            </button>
          </div>
        </motion.div>
      )}
        </>
      )}
    </motion.main>
  );
}

// --- Gift Components ---

function GiftSuccessModal({ code, onClose }: { code: string, onClose: () => void }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'A Gift from Nocturnal Echo 🌙',
          text: `Here is your gift code for Nocturnal Echo Premium: ${code}`,
          url: window.location.origin
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-background/80 backdrop-blur-xl"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="glass-panel rounded-[2.5rem] border border-white/5 p-8 w-full max-w-sm text-center space-y-6 relative overflow-hidden"
      >
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/10 rounded-full blur-[40px]" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-tertiary/10 rounded-full blur-[40px]" />
        
        <div className="w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mx-auto text-tertiary shadow-xl">
          <Gift className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h2 className="font-headline italic text-3xl text-on-surface">Gift Prepared.</h2>
          <p className="text-on-surface-variant/60 font-body text-sm">Share this code with your recipient to grant them the quiet hours.</p>
        </div>

        <div className="bg-surface-container-highest/50 p-6 rounded-2xl border border-white/5 space-y-3">
          <p className="font-label text-[10px] uppercase tracking-[0.3em] text-on-surface-variant/40">Gift Code</p>
          <p className="font-mono text-2xl font-bold tracking-widest text-primary">{code}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center justify-center gap-2 bg-surface-container-high py-4 rounded-full text-on-surface font-label text-[10px] uppercase tracking-widest hover:bg-surface-container-highest transition-all"
          >
            <Copy className="w-4 h-4" />
            Copy
          </button>
          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 bg-surface-container-high py-4 rounded-full text-on-surface font-label text-[10px] uppercase tracking-widest hover:bg-surface-container-highest transition-all"
          >
            <Share className="w-4 h-4" />
            Share
          </button>
        </div>

        <button
          onClick={onClose}
          className="signature-gradient w-full py-4 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-lg"
        >
          Done
        </button>

        <div className="pt-4 flex items-center justify-center gap-2 opacity-20">
          <Moon className="w-3 h-3 fill-current" />
          <span className="font-label text-[8px] uppercase tracking-widest">Nocturnal Echo</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RedeemBottomSheet({ onClose, onRedeem, isRedeeming, error }: { 
  onClose: () => void, 
  onRedeem: (code: string) => void,
  isRedeeming: boolean,
  error: string | null
}) {
  const [code, setCode] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.startsWith('ECHO')) {
      val = val.slice(4);
    }
    let formatted = 'ECHO';
    if (val.length > 0) formatted += '-' + val.slice(0, 4);
    if (val.length > 4) formatted += '-' + val.slice(4, 8);
    setCode(formatted);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-background/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="glass-panel rounded-t-[2.5rem] border-t border-white/10 p-8 w-full max-w-lg space-y-8 bg-surface-container-low"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-1.5 bg-on-surface-variant/20 rounded-full mx-auto mb-2" />
        
        <div className="space-y-2 text-center">
          <h2 className="font-headline italic text-3xl text-on-surface">Redeem a Gift.</h2>
          <p className="text-on-surface-variant/60 font-body text-sm">Enter your unique 12-character code to unlock Premium.</p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={code}
              onChange={handleInputChange}
              className="w-full bg-surface-container-highest/50 border border-white/5 rounded-2xl p-6 font-mono text-xl tracking-widest text-center text-primary placeholder:text-on-surface-variant/20 outline-none focus:border-primary/30 transition-all"
              placeholder="ECHO-XXXX-XXXX"
              maxLength={14}
            />
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-error text-xs font-body text-center mt-3"
              >
                {error}
              </motion.p>
            )}
          </div>

          <button
            onClick={() => onRedeem(code)}
            disabled={isRedeeming || code.length < 14}
            className="signature-gradient w-full py-5 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-lg disabled:opacity-30 transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            {isRedeeming ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Redeem Code
              </>
            )}
          </button>
        </div>

        <div className="pb-safe" />
      </motion.div>
    </motion.div>
  );
}

function RedeemSuccessCelebration({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] bg-background flex flex-col items-center justify-center text-center px-8"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300 }}
        className="w-24 h-24 rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 flex items-center justify-center shadow-[0_0_50px_rgba(255,186,56,0.4)] mb-8"
      >
        <Gift className="w-12 h-12 text-on-tertiary" />
      </motion.div>
      
      <div className="space-y-4">
        <h2 className="font-headline italic text-4xl text-primary leading-tight">A gift, received.</h2>
        <p className="text-on-surface-variant/60 font-body text-lg max-w-xs mx-auto">Your nights just got richer. Welcome to Premium.</p>
      </div>

      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        onClick={onClose}
        className="mt-12 signature-gradient px-12 py-5 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-xl"
      >
        Enter the Echo
      </motion.button>
    </motion.div>
  );
}

function SettingsScreen({ user, onNavigate, onPaywall, onSignOut, onClearEntries }: { 
  user: UserProfile | null, 
  onNavigate: (s: Screen) => void,
  onPaywall: (trigger?: 'poem' | 'library' | 'sound' | 'trial' | 'general') => void,
  onSignOut: () => Promise<void> | void,
  onClearEntries: () => Promise<void>,
  key?: string 
}) {
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(() => localStorage.getItem('ne_lock_enabled') === 'true');
  const [lockMethod, setLockMethod] = useState<string | null>(() => localStorage.getItem('ne_lock_method'));
  const [showLockSetup, setShowLockSetup] = useState(false);

  // Gift States
  const [selectedDuration, setSelectedDuration] = useState<'1month' | '3months' | 'lifetime'>('1month');
  const [isPurchasingGift, setIsPurchasingGift] = useState(false);
  const [generatedGiftCode, setGeneratedGiftCode] = useState<string | null>(null);
  const [showRedeemSheet, setShowRedeemSheet] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showRedeemSuccess, setShowRedeemSuccess] = useState(false);

  const handlePurchaseGift = async () => {
    if (!user) return;
    setIsPurchasingGift(true);
    try {
      // Simulate RevenueCat purchase
      await new Promise(resolve => setTimeout(resolve, 2000));
      const purchaseId = `RC_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const code = await generateGiftCode(user.uid, selectedDuration, purchaseId);
      setGeneratedGiftCode(code);
    } catch (error) {
      console.error('Gift purchase failed:', error);
    } finally {
      setIsPurchasingGift(false);
    }
  };

  const handleRedeem = async (code: string) => {
    if (!user) return;
    setIsRedeeming(true);
    setRedeemError(null);
    try {
      const result = await redeemGiftCode(user.uid, code);
      if (result.success) {
        setShowRedeemSheet(false);
        setShowRedeemSuccess(true);
      } else {
        setRedeemError(result.error || 'Redemption failed.');
      }
    } catch (error: any) {
      setRedeemError(error.message || 'An unexpected error occurred.');
    } finally {
      setIsRedeeming(false);
    }
  };

  const formatTime = (timeStr: string | undefined) => {
    if (!timeStr) return '10:00 PM';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${minutes} ${ampm}`;
  };

  const getNotificationMessage = (reason: string | undefined) => {
    switch (reason) {
      case 'Clear my head':
        return "Time to empty your mind. Let the words flow so you can sleep light.";
      case 'Remember my days':
        return "Don't let today fade into the shadows. Capture a piece of it now.";
      case 'Grow as a person':
        return "Your nightly evolution awaits. What did today teach you?";
      case 'Just try it':
        return "The moon is high and the page is blank. Ready for a quick echo?";
      default:
        return "The quiet hours are here. Time for your nightly reflection.";
    }
  };

  const handleLockToggle = () => {
    if (lockEnabled) {
      // Disable lock
      localStorage.removeItem('ne_lock_enabled');
      localStorage.removeItem('ne_lock_method');
      localStorage.removeItem('ne_lock_pin');
      setLockEnabled(false);
      setLockMethod(null);
    } else {
      setShowLockSetup(true);
    }
  };

  const handleLockSetupDone = () => {
    setLockEnabled(true);
    setLockMethod(localStorage.getItem('ne_lock_method'));
    setShowLockSetup(false);
  };

  return (
    <>
    {showLockSetup && (
      <AppLockSetup
        onDone={handleLockSetupDone}
        onCancel={() => setShowLockSetup(false)}
      />
    )}
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pt-20 px-4 max-w-2xl mx-auto space-y-6 pb-32 pt-safe pb-safe"
    >
      <AnimatePresence>
        {generatedGiftCode && (
          <GiftSuccessModal 
            code={generatedGiftCode} 
            onClose={() => setGeneratedGiftCode(null)} 
          />
        )}
        {showRedeemSheet && (
          <RedeemBottomSheet 
            onClose={() => setShowRedeemSheet(false)} 
            onRedeem={handleRedeem}
            isRedeeming={isRedeeming}
            error={redeemError}
          />
        )}
        {showRedeemSuccess && (
          <RedeemSuccessCelebration 
            onClose={() => setShowRedeemSuccess(false)} 
          />
        )}
      </AnimatePresence>
      <header className="fixed top-0 left-0 w-full z-50 glass-panel flex items-center justify-between px-6 h-16 pt-safe shadow-2xl">
        <div className="flex items-center gap-4">
          <ArrowLeft className="text-primary cursor-pointer" onClick={() => onNavigate('reflect')} />
          <h1 className="font-headline tracking-wide text-2xl text-primary italic">Settings</h1>
        </div>
        <div className="w-10 h-10 rounded-full overflow-hidden border border-outline-variant/20">
          <img className="w-full h-full object-cover" src={`https://picsum.photos/seed/${user?.uid || 'user'}/100/100`} alt="Profile" referrerPolicy="no-referrer" />
        </div>
      </header>

      <section className="space-y-6">
        <h2 className="font-headline text-2xl text-primary/90 pl-1">Account</h2>
        <div className="bg-surface-container-low rounded-3xl p-6 space-y-4 border border-white/5">
          <div className="flex items-center justify-between group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-secondary">
                <User className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Profile Info</p>
                <p className="text-on-surface-variant text-sm">{user?.name || 'Elena Vance'}</p>
              </div>
            </div>
            <ChevronRight className="text-outline-variant group-hover:text-primary transition-colors" />
          </div>
          <div className="h-px bg-outline-variant/10 mx-2" />
          <div className="flex items-center justify-between group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-secondary">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Email Address</p>
                <p className="text-on-surface-variant text-sm">{user?.email || 'elena.v@nocturnal.io'}</p>
              </div>
            </div>
            <ChevronRight className="text-outline-variant group-hover:text-primary transition-colors" />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-baseline justify-between pl-1">
          <h2 className="font-headline text-2xl text-primary/90">Reminders</h2>
          <span className="text-xs font-body uppercase tracking-widest text-tertiary">Nightly Cycle</span>
        </div>
        <div className="bg-surface-container-low rounded-3xl p-6 space-y-6 border border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-tertiary">
                <Moon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Notification Time</p>
                <p className="text-on-surface-variant text-sm">Daily reflection prompt</p>
              </div>
            </div>
            <div className="bg-surface-container-highest px-4 py-2 rounded-xl text-tertiary font-headline text-xl">
              {formatTime(user?.windDownTime)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-surface-container border border-white/5 space-y-2">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60">Your Personalized Prompt</p>
            <p className="text-sm font-body italic text-on-surface/80 leading-relaxed">
              "{getNotificationMessage(user?.journalingReason)}"
            </p>
          </div>
          <div className="space-y-4 pt-2">
            <Toggle label="Daily Reminders" defaultChecked />
            <Toggle label="Weekend Schedule" />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="font-headline text-2xl text-primary/90 pl-1">Privacy & Security</h2>
        <div className="bg-surface-container-low rounded-3xl p-6 space-y-6 border border-white/5">
          {/* Lock My Diary Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center transition-colors ${lockEnabled ? 'text-primary' : 'text-secondary'}`}>
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Lock My Diary</p>
                <p className="text-on-surface-variant text-sm">
                  {lockEnabled
                    ? lockMethod === 'biometric' ? 'Face ID / Touch ID' : '4-digit PIN'
                    : 'Require passcode on entry'}
                </p>
              </div>
            </div>
            <button
              onClick={handleLockToggle}
              className={`w-12 h-6 rounded-full relative flex items-center px-1 transition-colors duration-300 ${lockEnabled ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
            >
              <motion.div
                animate={{ x: lockEnabled ? 24 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`w-4 h-4 rounded-full ${lockEnabled ? 'bg-primary' : 'bg-outline-variant'}`}
              />
            </button>
          </div>

          {/* Method badge shown when enabled */}
          <AnimatePresence>
            {lockEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-secondary">
                      {lockMethod === 'biometric' ? <Fingerprint className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    </div>
                    <p className="text-on-surface-variant text-sm">
                      {lockMethod === 'biometric' ? 'Biometric unlock active' : 'PIN unlock active'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowLockSetup(true)}
                    className="text-[10px] font-label uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
                  >
                    Change
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="font-headline text-2xl text-primary/90 pl-1">Gifting</h2>
        <div className="bg-surface-container-low rounded-3xl p-6 space-y-6 border border-white/5 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-tertiary/5 rounded-full blur-[40px] pointer-events-none" />
          
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-tertiary shadow-lg">
                <Gift className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Give the Gift of Nights 🌙</p>
                <p className="text-on-surface-variant text-sm">Share Premium with someone special</p>
              </div>
            </div>

            <div className="flex gap-2 p-1 bg-surface-container-highest/50 rounded-2xl">
              {[
                { id: '1month', label: '1 Month', price: '$4.99' },
                { id: '3months', label: '3 Months', price: '$12.99' },
                { id: 'lifetime', label: 'Lifetime', price: '$29.99' }
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedDuration(opt.id as any)}
                  className={`flex-1 py-3 px-2 rounded-xl text-center transition-all duration-300 ${
                    selectedDuration === opt.id
                      ? 'bg-primary text-on-primary shadow-lg'
                      : 'text-on-surface-variant hover:bg-white/5'
                  }`}
                >
                  <p className="font-label text-[9px] uppercase tracking-widest mb-0.5">{opt.label}</p>
                  <p className="font-headline text-sm italic">{opt.price}</p>
                </button>
              ))}
            </div>

            <button
              onClick={handlePurchaseGift}
              disabled={isPurchasingGift}
              className="signature-gradient w-full py-4 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              {isPurchasingGift ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  Purchase Gift
                </>
              )}
            </button>
          </div>

          <div className="h-px bg-outline-variant/10 mx-2" />

          <button 
            onClick={() => setShowRedeemSheet(true)}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-secondary">
                <ExternalLink className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Redeem a Gift Code</p>
                <p className="text-on-surface-variant text-sm">Enter a code to upgrade</p>
              </div>
            </div>
            <ChevronRight className="text-outline-variant group-hover:text-primary transition-colors" />
          </button>
        </div>
      </section>

      <section className="space-y-6">
        <div className="bg-surface-container-low rounded-3xl p-6 space-y-6 border border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-container flex items-center justify-center text-error">
                <HeartOff className="w-6 h-6" />
              </div>
              <div>
                <p className="text-on-surface font-medium">Clear Reflections</p>
                <p className="text-on-surface-variant text-sm">Permanently delete all entries</p>
              </div>
            </div>
            {!showConfirmClear ? (
              <button 
                onClick={() => setShowConfirmClear(true)}
                className="px-4 py-2 rounded-xl bg-error/10 text-error font-label text-[10px] uppercase tracking-widest hover:bg-error/20 transition-colors"
              >
                Clear All
              </button>
            ) : (
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowConfirmClear(false)}
                  className="px-3 py-2 rounded-xl bg-surface-container-highest text-on-surface-variant font-label text-[10px] uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    await onClearEntries();
                    setShowConfirmClear(false);
                  }}
                  className="px-3 py-2 rounded-xl bg-error text-on-error font-label text-[10px] uppercase tracking-widest shadow-lg"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="pt-8 pb-12 flex flex-col items-center gap-4">
        {!user?.isSubscribed ? (
          <div className="w-full rounded-[1.5rem] bg-surface-container-low border border-primary/15 p-5 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-primary mb-1">
              <Sparkles className="w-4 h-4" />
              <span className="font-label text-xs uppercase tracking-widest">Premium</span>
            </div>
            <p className="font-headline italic text-xl text-on-surface">Unlock your full diary.</p>
            <p className="text-on-surface-variant/50 text-xs font-body">
              Unlimited AI poems · Full archive · All sounds<br />and more — from $5.99/month.
            </p>
            <button
              onClick={() => onPaywall('general')}
              className="signature-gradient w-full py-4 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-lg hover:scale-[1.02] active:scale-95 transition-all mt-1"
            >
              Start 7-Day Free Trial
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-primary/60 text-xs font-label uppercase tracking-widest">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Premium Active
          </div>
        )}
        <button 
          onClick={onSignOut}
          className="flex items-center gap-3 px-8 py-4 rounded-full bg-surface-container-highest hover:bg-error-container/20 transition-all duration-300 group"
        >
          <LogOut className="text-error w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="font-body text-error font-medium tracking-wide">Sign Out</span>
        </button>
      </footer>
    </motion.main>
    </>
  );
}

function PaywallScreen({ onClose, onSubscribe, trigger }: { 
  onClose: () => void, 
  onSubscribe?: () => void,
  trigger?: 'poem' | 'library' | 'sound' | 'trial' | 'general',
  key?: string 
}) {
  const [selected, setSelected] = useState<'monthly' | 'annual'>('annual');
  const [isProcessing, setIsProcessing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = async () => {
    setIsProcessing(true);
    await new Promise(resolve => setTimeout(resolve, 1800));
    setSubscribed(true);
    if (onSubscribe) onSubscribe();
    setIsProcessing(false);
    setTimeout(onClose, 1200);
  };

  // Context-aware headline based on what triggered the paywall
  const context = {
    poem: {
      headline: 'Your poem is one tap away.',
      sub: 'Unlock unlimited AI interpretations — every night, forever.',
      icon: <Sparkles className="w-6 h-6 text-secondary" />,
    },
    library: {
      headline: 'Your full history is waiting.',
      sub: 'Every night you\'ve written deserves to be remembered.',
      icon: <BookOpen className="w-6 h-6 text-primary" />,
    },
    sound: {
      headline: 'Set the right mood for the night.',
      sub: 'Unlock all ambient sounds — fireplace, ocean, café, and more.',
      icon: <AudioLines className="w-6 h-6 text-tertiary" />,
    },
    trial: {
      headline: 'Keep the magic going.',
      sub: 'Your trial is ending. Subscribe to keep every feature active.',
      icon: <Moon className="w-6 h-6 text-primary" />,
    },
    general: {
      headline: 'Yours, every night.',
      sub: `Start your ${TRIAL_DAYS}-day free trial. Cancel anytime.`,
      icon: <Moon className="w-6 h-6 text-primary" />,
    },
  };

  const ctx = context[trigger || 'general'];

  const features = [
    { icon: <Sparkles className="w-4 h-4" />, text: 'Unlimited AI poems & quotes — every night', color: 'text-secondary', highlight: trigger === 'poem' },
    { icon: <BookOpen className="w-4 h-4" />, text: 'Full journal archive — every entry, forever', color: 'text-primary', highlight: trigger === 'library' },
    { icon: <AudioLines className="w-4 h-4" />, text: 'All ambient sounds — fireplace, ocean & more', color: 'text-tertiary', highlight: trigger === 'sound' },
    { icon: <HeartOff className="w-4 h-4" />, text: 'Streak restoration — never lose your progress', color: 'text-secondary', highlight: false },
    { icon: <Share2 className="w-4 h-4" />, text: 'Branded share cards for poems & streaks', color: 'text-tertiary', highlight: false },
    { icon: <Download className="w-4 h-4" />, text: 'Export your journal as PDF anytime', color: 'text-primary', highlight: false },
  ];

  if (subscribed) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 text-center px-8"
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300 }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-tertiary to-tertiary-container/40 flex items-center justify-center shadow-[0_0_40px_rgba(255,186,56,0.3)]"
        >
          <Check className="w-10 h-10 text-on-tertiary" />
        </motion.div>
        <div>
          <h2 className="font-headline italic text-4xl text-primary mb-2">Welcome to Premium.</h2>
          <p className="text-on-surface-variant/60 font-body text-sm">Every night is now yours.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.main 
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-[100] bg-background overflow-y-auto no-scrollbar"
    >
      {/* Header */}
      <nav className="w-full top-0 sticky flex items-center justify-between px-6 h-16 pt-safe bg-background/80 backdrop-blur-md z-50 border-b border-white/5">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 transition-colors">
          <X className="text-on-surface-variant w-5 h-5" />
        </button>
        <h1 className="font-headline italic text-xl tracking-wide text-primary">Nocturnal Echo</h1>
        <div className="w-9" />
      </nav>

      <div className="pb-24 pt-4 px-4 max-w-lg mx-auto">

        {/* Context-aware hero */}
        <div className="relative rounded-[2rem] overflow-hidden mb-6 bg-surface-container-lowest border border-white/5 p-6 text-center">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-secondary/30 to-transparent" />
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-secondary/5 rounded-full blur-[60px] pointer-events-none" />
          
          {/* Poem sample — always show, it's the best pitch */}
          <Moon className="w-7 h-7 text-tertiary/40 fill-current mx-auto mb-4" />
          <p className="font-headline italic text-xl md:text-3xl text-on-surface leading-relaxed mb-3">
            "The weight of the day<br />dissolved into the dark —<br />you wrote it into light."
          </p>
          <p className="text-on-surface-variant/30 text-xs font-label uppercase tracking-[0.2em]">Generated from a real reflection</p>
        </div>

        {/* Context headline */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center border border-white/5">
            {ctx.icon}
          </div>
          <div>
            <h2 className="font-headline text-2xl font-light text-on-surface">{ctx.headline}</h2>
            <p className="text-on-surface-variant/50 font-body text-sm">{ctx.sub}</p>
          </div>
        </div>

        {/* Plan selector */}
        <div className="grid grid-cols-2 gap-3 mt-5 mb-4">
          <button
            onClick={() => setSelected('annual')}
            className={`relative flex flex-col p-5 rounded-[1.5rem] border text-left transition-all duration-300 ${
              selected === 'annual'
                ? 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(188,194,255,0.12)]'
                : 'bg-surface-container-low border-white/5 hover:border-white/10'
            }`}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-tertiary text-on-tertiary text-[9px] font-label font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-lg whitespace-nowrap">
              Best Value
            </div>
            <div className={`w-4 h-4 rounded-full border-2 mb-4 transition-colors ${selected === 'annual' ? 'border-primary bg-primary shadow-[0_0_8px_rgba(188,194,255,0.5)]' : 'border-outline-variant'}`} />
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">Annual</span>
            <div className="font-headline text-2xl text-on-surface font-light">$49.99</div>
            <div className="text-on-surface-variant/50 text-xs mt-0.5">$4.17 / month</div>
            <div className="mt-2 text-[9px] font-label uppercase tracking-widest text-tertiary font-bold">Save 30%</div>
          </button>

          <button
            onClick={() => setSelected('monthly')}
            className={`flex flex-col p-5 rounded-[1.5rem] border text-left transition-all duration-300 ${
              selected === 'monthly'
                ? 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(188,194,255,0.12)]'
                : 'bg-surface-container-low border-white/5 hover:border-white/10'
            }`}
          >
            <div className={`w-4 h-4 rounded-full border-2 mb-4 transition-colors ${selected === 'monthly' ? 'border-primary bg-primary shadow-[0_0_8px_rgba(188,194,255,0.5)]' : 'border-outline-variant'}`} />
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">Monthly</span>
            <div className="font-headline text-2xl text-on-surface font-light">$5.99</div>
            <div className="text-on-surface-variant/50 text-xs mt-0.5">per month</div>
            <div className="mt-2 text-[9px] font-label uppercase tracking-widest text-on-surface-variant/30">Cancel anytime</div>
          </button>
        </div>

        {/* CTA — before feature list so user sees it without scrolling */}
        <button
          onClick={handleSubscribe}
          disabled={isProcessing}
          className="w-full signature-gradient py-5 rounded-full text-on-primary font-label font-bold text-sm uppercase tracking-[0.2em] shadow-[0_8px_40px_rgba(188,194,255,0.2)] hover:scale-[1.02] active:scale-95 transition-all duration-300 flex items-center justify-center gap-3 disabled:opacity-60 disabled:scale-100 mb-3"
        >
          {isProcessing ? (
            <><RefreshCw className="w-4 h-4 animate-spin" />Starting your trial…</>
          ) : (
            <><Sparkles className="w-4 h-4" />{`Start ${TRIAL_DAYS}-Day Free Trial`}</>
          )}
        </button>

        <p className="text-center text-on-surface-variant/30 text-[10px] font-body mb-8 leading-relaxed">
          {selected === 'annual' ? '$49.99 billed annually' : '$5.99 billed monthly'} after trial ends.{' '}
          Cancel anytime before and you won't be charged.
        </p>

        {/* Feature list — with highlight on the triggered feature */}
        <div className="bg-surface-container-low rounded-[1.5rem] border border-white/5 p-4 mb-4 space-y-2.5">
          {features.map((f, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${f.highlight ? 'bg-surface-container border border-white/5' : ''}`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center ${f.color}`}>
                {f.icon}
              </div>
              <p className={`text-sm font-body ${f.highlight ? 'text-on-surface font-medium' : 'text-on-surface/70'}`}>{f.text}</p>
              <Check className={`ml-auto flex-shrink-0 w-3.5 h-3.5 ${f.highlight ? 'text-primary' : 'text-primary/30'}`} />
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <button className="text-primary/40 text-xs hover:text-primary/70 transition-colors font-label uppercase tracking-widest">
            Restore Purchase
          </button>
          <div className="flex items-center gap-4 text-[10px] text-on-surface-variant/20 uppercase tracking-widest">
            <span className="hover:text-on-surface-variant/50 transition-colors cursor-pointer">Terms</span>
            <span className="w-1 h-1 rounded-full bg-outline-variant/20" />
            <span className="hover:text-on-surface-variant/50 transition-colors cursor-pointer">Privacy</span>
          </div>
        </div>
      </div>
    </motion.main>
  );
}

// --- Components ---

function RestorationScreen({ user, onStartMissedEntry, onUpdateUser, entries }: { user: UserProfile | null, onStartMissedEntry: (date: string, creditType: 'free' | 'paid') => void, onUpdateUser: (p: any) => Promise<void>, entries: JournalEntry[], key?: string }) {
  const credits = user?.restorationCredits ?? 0;
  const premium = isPremiumUser(user);
  const maxCredits = premium ? 3 : 1;

  const missedDateStr = getLocalDateString(new Date(Date.now() - 86400000));
  const displayDate = new Date(missedDateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const handleRestore = () => {
    if (!user || credits <= 0) return;
    onStartMissedEntry(missedDateStr, 'free');
  };

  const handleStartFresh = () => {
    if (window.confirm("Start fresh? Your streak will reset to 0.")) {
      onStartMissedEntry(null as any, 'free');
    }
  };

  return (
    <motion.main 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 relative"
    >
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      {/* Moon icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="mb-8"
      >
        <div className="w-24 h-24 rounded-full bg-surface-container-low flex items-center justify-center border border-white/5 shadow-2xl">
          <Moon className="w-12 h-12 text-tertiary/60 fill-current" />
        </div>
      </motion.div>

      {/* Message */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center space-y-3 mb-10 max-w-xs"
      >
        <h2 className="font-headline text-3xl font-light tracking-tight text-on-surface">You missed a night</h2>
        <p className="text-on-surface-variant font-body text-sm leading-relaxed">
          You didn't reflect on <span className="text-on-surface font-medium">{displayDate}</span>. Restore your streak by writing about that night.
        </p>
      </motion.div>

      {/* Restore button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="w-full max-w-xs space-y-3"
      >
        <button 
          onClick={handleRestore}
          disabled={credits <= 0}
          className="w-full signature-gradient py-4 rounded-full flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-95 shadow-xl disabled:opacity-40 disabled:scale-100"
        >
          <RotateCcw className="w-5 h-5 text-on-primary" />
          <span className="text-on-primary font-label font-bold uppercase tracking-[0.15em] text-sm">
            {credits > 0 ? 'Restore Now' : 'No Credits Left'}
          </span>
        </button>

        {/* Credits info */}
        <p className="text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant/50">
          {credits > 0 
            ? `${credits} of ${maxCredits} credit${maxCredits !== 1 ? 's' : ''} remaining this month`
            : premium ? 'Credits reset next month' : 'Upgrade to Pro for 3 credits/month'
          }
        </p>

        {/* Start fresh link */}
        <button
          onClick={handleStartFresh}
          className="w-full py-3 text-center transition-colors"
        >
          <span className="text-on-surface-variant/40 font-body text-xs hover:text-on-surface-variant transition-colors">
            or start fresh
          </span>
        </button>
      </motion.div>
    </motion.main>
  );
}

function MissedDayEntryScreen({ missedDate, creditType, userProfile, onBack, onComplete, isSaving }: {
  missedDate: string;
  creditType: 'free' | 'paid';
  userProfile: UserProfile | null;
  onBack: () => void;
  onComplete: (date: string, entryText: string, mood: string | null) => Promise<void>;
  isSaving: boolean;
  key?: string;
}) {
  const [entry, setEntry] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [showWordToast, setShowWordToast] = useState(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MIN_WORDS = 10;
  const wordCount = entry.trim() === '' ? 0 : entry.trim().split(/\s+/).length;
  const meetsMinimum = wordCount >= MIN_WORDS;

  const displayDate = new Date(missedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  const moods = [
    { id: 'okay', label: 'Okay', emoji: '🌤️' },
    { id: 'good', label: 'Good', emoji: '✨' },
    { id: 'heavy', label: 'Heavy', emoji: '🌧️' },
    { id: 'unsettled', label: 'Unsettled', emoji: '🌀' },
    { id: 'peaceful', label: 'Peaceful', emoji: '🕯️' },
  ];

  const handleComplete = () => {
    if (!meetsMinimum || isSaving) {
      if (!meetsMinimum) {
        setShowWordToast(true);
        if (toastRef.current) clearTimeout(toastRef.current);
        toastRef.current = setTimeout(() => setShowWordToast(false), 2800);
      }
      return;
    }
    onComplete(missedDate, entry, selectedMood);
  };

  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  return (
    <motion.main
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60 }}
      transition={{ duration: 0.35 }}
      className="min-h-[100dvh] flex flex-col pt-safe pb-safe"
    >
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 glass-panel flex items-center gap-4 px-6 h-16 pt-safe shadow-2xl">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-primary"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-headline italic text-xl text-primary tracking-wide">Missed Night</h1>
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-tertiary/10 border border-tertiary/20">
          <span className="text-[9px] font-label uppercase tracking-widest text-tertiary/80">
            1 Credit Used
          </span>
        </div>
      </header>

      <div className="pt-24 pb-40 px-6 max-w-2xl mx-auto w-full flex flex-col flex-grow">
        {/* Date & context */}
        <div className="mb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-low border border-white/5 mb-6">
              <Moon className="w-4 h-4 text-tertiary" />
              <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60">Restoring</span>
            </div>
            <h2 className="font-headline text-4xl font-light tracking-tight text-on-surface mb-3">
              {displayDate}
            </h2>
            <p className="text-on-surface-variant/50 font-body italic text-sm leading-relaxed max-w-xs mx-auto">
              Write what you remember from that day. Your streak will be restored once you finish.
            </p>
          </motion.div>
        </div>

        {/* Mood selector */}
        <div className="mb-6">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/40 mb-3 ml-1">How were you feeling?</p>
          <div className="flex flex-wrap gap-2">
            {moods.map(mood => (
              <button
                key={mood.id}
                onClick={() => setSelectedMood(selectedMood === mood.label ? null : mood.label)}
                className={`px-4 py-2 rounded-full text-xs font-body flex items-center gap-1.5 transition-all duration-300 border ${
                  selectedMood === mood.label
                    ? 'bg-primary/10 border-primary text-primary shadow-[0_0_12px_rgba(188,194,255,0.2)]'
                    : 'bg-surface-container-low border-white/5 text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span>{mood.emoji}</span>
                <span>{mood.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative flex-grow flex flex-col bg-surface-container-low/40 backdrop-blur-sm rounded-[2rem] border border-white/5 shadow-2xl overflow-hidden"
        >
          <div className="h-1.5 w-full bg-gradient-to-r from-transparent via-tertiary/20 to-transparent rounded-t-[2rem]" />
          <textarea
            className="w-full flex-grow bg-transparent border-none focus:ring-0 text-on-surface font-headline text-xl leading-relaxed p-8 resize-none no-scrollbar placeholder:text-on-surface-variant/25 outline-none"
            placeholder="What do you remember from that night..."
            value={entry}
            onChange={e => setEntry(e.target.value)}
            spellCheck={false}
            style={{ minHeight: '260px' }}
          />
          {/* Word count */}
          <div className="absolute bottom-4 right-6 pointer-events-none">
            <AnimatePresence mode="wait">
              <motion.span
                key={meetsMinimum ? 'ok' : 'min'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className={`font-label text-[10px] uppercase tracking-widest transition-colors ${
                  meetsMinimum ? 'text-tertiary' : 'text-on-surface-variant/30'
                }`}
              >
                {meetsMinimum ? `${wordCount} words` : `${wordCount} / ${MIN_WORDS} minimum`}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {showWordToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            className="fixed bottom-[8rem] left-1/2 -translate-x-1/2 z-50 bg-surface-container-highest border border-white/10 rounded-full px-5 py-3 shadow-xl whitespace-nowrap"
          >
            <p className="font-body text-sm text-on-surface-variant whitespace-nowrap">Keep going — this night deserves more.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Complete Entry button */}
      <div className="fixed bottom-[5.5rem] left-0 w-full flex justify-center px-4 pointer-events-none z-40">
        <motion.button
          onClick={handleComplete}
          animate={{ opacity: meetsMinimum ? 1 : 0.45 }}
          transition={{ duration: 0.3 }}
          className={`pointer-events-auto font-label font-bold uppercase tracking-[0.2em] px-8 py-4 text-sm rounded-full shadow-xl flex items-center gap-3 transition-all duration-500 group ${
            meetsMinimum
              ? 'signature-gradient text-on-primary hover:scale-105 active:scale-95 cursor-pointer'
              : 'bg-surface-container-highest text-on-surface-variant/60 cursor-default'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isSaving ? 'Restoring...' : 'Complete Entry'}
          {!isSaving && <Check className={`w-4 h-4 transition-transform duration-500 ${meetsMinimum ? 'group-hover:translate-x-1' : ''}`} />}
        </motion.button>
      </div>
    </motion.main>
  );
}


function BottomNav({ active, onNavigate, hasReflectedToday, todayEntry, setLastInterpretation }: { 
  active: Screen, 
  onNavigate: (s: Screen) => void,
  hasReflectedToday: boolean,
  todayEntry?: JournalEntry,
  setLastInterpretation: (e: JournalEntry | null) => void
}) {
  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 pb-safe pt-3 bg-surface-container-low/80 backdrop-blur-xl rounded-t-[1.5rem] shadow-[0_-8px_32px_rgba(188,194,255,0.06)] border-t border-white/5">
      <NavItem 
        icon={<Sparkles className="w-6 h-6" />} 
        label="Reflect" 
        active={active === 'reflect'} 
        onClick={() => {
          if (hasReflectedToday && todayEntry) {
            setLastInterpretation(todayEntry);
            onNavigate('reveal');
          } else {
            onNavigate('reflect');
          }
        }} 
      />
      <NavItem 
        icon={<BookOpen className="w-6 h-6" />} 
        label="Journey" 
        active={active === 'journey' || active === 'restoration'}
        onClick={() => onNavigate('journey')} 
      />

      <NavItem 
        icon={<SettingsIcon className="w-6 h-6" />} 
        label="Settings" 
        active={active === 'settings'} 
        onClick={() => onNavigate('settings')} 
      />
    </nav>
  );
}


function NavItem({ icon, label, active, onClick }: { icon: ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center transition-all duration-200 active:scale-90 px-4 py-2 rounded-2xl min-w-[4rem] ${active ? 'text-primary bg-primary-container/20' : 'text-on-surface/40'}`}
    >
      {icon}
      <span className="font-body text-[10px] uppercase tracking-widest mt-1">{label}</span>
    </button>
  );
}

function Toggle({ label, defaultChecked }: { label?: string, defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked || false);
  return (
    <div className="flex items-center justify-between w-full">
      {label && <span className="text-on-surface">{label}</span>}
      <button 
        onClick={() => setChecked(!checked)}
        className={`w-12 h-6 rounded-full relative flex items-center px-1 transition-colors ${checked ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
      >
        <motion.div 
          animate={{ x: checked ? 24 : 0 }}
          className={`w-4 h-4 rounded-full ${checked ? 'bg-primary' : 'bg-outline-variant'}`} 
        />
      </button>
    </div>
  );
}

function BenefitItem({ icon, text }: { icon: ReactNode, text: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border border-white/5">
        {icon}
      </div>
      <p className="text-on-surface font-medium">{text}</p>
    </div>
  );
}