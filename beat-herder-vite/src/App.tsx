import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import addFriendImg from './assets/addFriend.png';
import inviteToSquadImg from './assets/inviteToSquad.png';
import welcomeWaveImg from './assets/welcomeWave.png';
import {
  FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaMap, FaUserFriends, FaUser, FaTimes, FaGhost, FaComments, FaClock
} from 'react-icons/fa';
import {
  GoogleAuthProvider, signInWithPopup
} from "firebase/auth";
import { useAuth, type UserData, type Tier, type Point } from './contexts/AuthContext';
import SupportSystem from './components/SupportSystem';
import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection,
  query, where, getDocs, addDoc, deleteDoc, type DocumentData, arrayRemove, limit, orderBy
} from "firebase/firestore";
import { auth, db, messaging } from './firebase';
import { getToken, onMessage } from "firebase/messaging";

// --- Type Definitions ---
import LocationPicker from './components/LocationPicker';
import DevStats from './components/DevStats';
import InstallModal from './components/modals/InstallModal';
import PaymentResultModal from './components/modals/PaymentResultModal';
import ChatTab from './components/ChatTab';
import WrappedModal from './components/modals/WrappedModal'; // Import WrappedModal
import ScheduleModal from './components/modals/ScheduleModal'; // Import ScheduleModal
import { increment } from 'firebase/firestore'; // Import increment


type Area = { id: string; name: string; polygon: Point[] };
type GPSBounds = {
  north: number; // Max Lat
  south: number; // Min Lat
  east: number;  // Max Lon
  west: number;  // Min Lon
};

type Vote = {
  id: string;
  creatorId: string;
  creatorName: string;
  targetAreaId: string;
  targetAreaName: string;
  createdAt: number;
  votes: { [uid: string]: 'yes' | 'no' };
  completedAt?: number;
};

// Wrapped Interfaces
interface DailyStats {
  date: string;
  topAreas: { name: string; timeMs: number }[];
  topFriends: { uid: string; timeMs: number }[];
  totalTimeActiveMs: number;
}



type ConfirmAction = {
  message: string;
  onConfirm: () => void;
};

const TIER_LIMITS = {
  free: 0,
  basic: 1,
  standard: 3,
  premium: 8,
  festival: 20,
  dev_tier_test: 3
};

const PLANS = [
  { id: 'basic', name: 'Just the 2 of us', price: '£2.99', limit: 1 },
  { id: 'standard', name: 'Squad of 4', price: '£4.99', limit: 3 },
  { id: 'premium', name: 'Full Squad', price: '£9.99', limit: 8 },
  { id: 'festival', name: 'Festival Group', price: '£15.99', limit: 20 },
  { id: 'dev_tier_test', name: 'Dev Test', price: '£0.50', limit: 3 } // Added for dev testing
];

// --- Helper Components ---
const FriendStatus = ({ friend, mySquadId }: { friend: UserData, mySquadId?: string }) => {
  const [statusText, setStatusText] = useState("Loading...");

  useEffect(() => {
    if (!friend.squadId) {
      setStatusText("Alone or Free");
      return;
    }
    if (friend.squadId === mySquadId) {
      setStatusText("In your squad");
      return;
    }

    // Subscribe to that squad to check member count
    const unsub = onSnapshot(doc(db, "squads", friend.squadId), (sDoc) => {
      if (sDoc.exists()) {
        const data = sDoc.data();
        if (data?.members && data.members.length > 1) {
          setStatusText("In another squad");
        } else {
          setStatusText("Alone or Free");
        }
      } else {
        setStatusText("Alone or Free");
      }
    });

    return () => unsub();
  }, [friend.squadId, mySquadId]);

  return <span>Status: {statusText}</span>;
};

// --- Utility & Helper Functions (Pure / Firestore) ---
const getPublicProfileCollection = () => collection(db, 'public/user_profiles/users');
const getUserDocRef = (uid: string) => doc(db, 'users', uid);

const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
  if (!polygon) return false;
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

const clusterUsers = (users: UserData[], threshold: number = 0.05) => {
  const clusters: { centroid: Point, users: UserData[] }[] = [];
  const processed = new Set<string>();

  users.forEach(user => {
    if (processed.has(user.uid) || !user.location) return;

    const clusterGroup = [user];
    processed.add(user.uid);

    users.forEach(other => {
      if (user.uid === other.uid || processed.has(other.uid) || !other.location) return;

      const dx = user.location!.x - other.location!.x;
      const dy = user.location!.y - other.location!.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold) {
        clusterGroup.push(other);
        processed.add(other.uid);
      }
    });

    // Calculate centroid
    let sumX = 0, sumY = 0;
    clusterGroup.forEach(u => { sumX += u.location!.x; sumY += u.location!.y; });

    clusters.push({
      centroid: { x: sumX / clusterGroup.length, y: sumY / clusterGroup.length },
      users: clusterGroup
    });
  });

  return clusters;
};

// --- Main Component ---
export default function App() {
  const navigate = useNavigate();
  // --- State Management ---
  const { currentUser, userData, loading: authLoading, signOut } = useAuth();
  const [squadData, setSquadData] = useState<DocumentData | null>(null);
  const [friendsData, setFriendsData] = useState<UserData[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);
  const [friendEmail, setFriendEmail] = useState('');
  const [areaName, setAreaName] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [showZones, setShowZones] = useState(false);
  const [renamingArea, setRenamingArea] = useState<Area | null>(null);
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaForCheckIn, setSelectedAreaForCheckIn] = useState<Area | null>(null);
  const [selectedMember, setSelectedMember] = useState<UserData | null>(null);
  const [selectedMemberContext, setSelectedMemberContext] = useState<'squad' | 'friend' | null>(null);
  const [incomingSquadInvites, setIncomingSquadInvites] = useState<DocumentData[]>([]);
  const [outgoingSquadInvites, setOutgoingSquadInvites] = useState<DocumentData[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<DocumentData[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<DocumentData[]>([]);
  const [currentStatusInput, setCurrentStatusInput] = useState('');
  const [publicProfileCache, setPublicProfileCache] = useState<{ [uid: string]: string }>({});
  const [useSandboxStripe, setUseSandboxStripe] = useState(() => localStorage.getItem('useSandboxStripe') === 'true');
  const [activeTab, setActiveTab] = useState<'map' | 'friends' | 'notifications' | 'profile' | 'chat'>('map');
  const [tempCalibration, setTempCalibration] = useState<GPSBounds>({ north: 0, south: 0, east: 0, west: 0 });
  const [pickingLocationFor, setPickingLocationFor] = useState<'NW' | 'SE' | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [gpsRefreshButtonText, setGpsRefreshButtonText] = useState<string | null>(null);
  const [gpsRefreshInterval, setGpsRefreshInterval] = useState(5); // Default 5 seconds
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsTimeoutCount, setGpsTimeoutCount] = useState(0);
  void gpsTimeoutCount; // Used via functional state update in GPS error handler
  const [showShareLink, setShowShareLink] = useState(false);
  const [gpsHasLocation, setGpsHasLocation] = useState(false);
  const [highlightedUids, setHighlightedUids] = useState<string[]>([]);

  // Wrapped Stats State
  const [showWrappedModal, setShowWrappedModal] = useState(false);
  const [selectedWrappedStats, setSelectedWrappedStats] = useState<DailyStats | null>(null);
  const [isFestivalWrapped, setIsFestivalWrapped] = useState(false);
  const [wrappedDays, setWrappedDays] = useState<string[]>([]);
  const [newWrappedAvailable, setNewWrappedAvailable] = useState<string | null>(null);
  const [festivalWrappedAvailable, setFestivalWrappedAvailable] = useState(false);

  // Chat Notifications
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [lastSeenChatTime, setLastSeenChatTime] = useState(() => Number(localStorage.getItem('lastSeenChatTime') || 0));

  // Schedule Modal State
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleViewingUser, setScheduleViewingUser] = useState<UserData | null>(null);


  const statsRef = useRef({
    lastUpdate: Date.now(),
    pendingAreas: {} as { [name: string]: number },
    pendingFriends: {} as { [uid: string]: number },
    totalTime: 0
  });



  // Dev Features
  const [devMapFilterDuration, setDevMapFilterDuration] = useState<'5m' | '30m' | '1h' | '24h' | null>(null);
  const [allUsersOnMap, setAllUsersOnMap] = useState<UserData[]>([]);
  const [showDevStats, setShowDevStats] = useState(false);
  const [upgradesEnabled, setUpgradesEnabled] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Scroll to top on tab change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('useSandboxStripe', useSandboxStripe.toString());
  }, [useSandboxStripe]);

  // Welcome Modal Logic
  useEffect(() => {
    if (userData && userData.hasSeenWelcome === false) {
      setActiveModal('welcome');
      // Update hasSeenWelcome to true immediately so it doesn't show again
      updateDoc(getUserDocRef(userData.uid), { hasSeenWelcome: true }).catch(console.error);
    }
  }, [userData]);

  // Fetch GPS refresh interval from Firestore config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "gps"), (doc) => {
      if (doc.exists() && doc.data().refreshInterval) {
        setGpsRefreshInterval(doc.data().refreshInterval);
      }
    });
    return () => unsub();
  }, []);

  // Fetch Payment/Upgrade config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "payments"), (doc) => {
      // If doc doesn't exist or field is missing, default to TRUE (allow upgrades)
      if (doc.exists() && doc.data().upgradesEnabled !== undefined) {
        setUpgradesEnabled(doc.data().upgradesEnabled);
      } else {
        setUpgradesEnabled(true);
      }
    });

    return () => unsub();
  }, []);

  // Dev Mode: Fetch all users for map overlay
  useEffect(() => {
    if (!devMapFilterDuration) {
      setAllUsersOnMap([]);
      return;
    }

    const fetchAllUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const now = Date.now();
        let durationMs = 0;
        switch (devMapFilterDuration) {
          case '5m': durationMs = 5 * 60 * 1000; break;
          case '30m': durationMs = 30 * 60 * 1000; break;
          case '1h': durationMs = 60 * 60 * 1000; break;
          case '24h': durationMs = 24 * 60 * 60 * 1000; break;
        }

        const active = snap.docs
          .map(d => d.data() as UserData)
          .filter(u => u.lastUpdate && (now - u.lastUpdate < durationMs));

        setAllUsersOnMap(active);
      } catch (e) { console.error("Dev Map Fetch Error:", e); }
    };

    fetchAllUsers();
  }, [devMapFilterDuration]);

  // --- WRAPPED LOGIC: Helpers & Effects ---
  const getFestivalDate = (timestamp: number = Date.now()): string => {
    // Shift 6 hours back
    const d = new Date(timestamp - 6 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  };

  // 1. Data Logging
  useEffect(() => {
    if (!userData || !gpsHasLocation) return;

    // Timer for every 10s to accumulate local stats
    const interval = setInterval(() => {
      const now = Date.now();
      const lastUpdate = statsRef.current.lastUpdate || now;
      if (now - lastUpdate > 600000) { statsRef.current.lastUpdate = now; return; } // Safety reset

      const delta = now - statsRef.current.lastUpdate;
      statsRef.current.lastUpdate = now;

      // Find Current Area
      let foundArea = 'The Wilds';
      if (userData.location) {
        for (const area of areas) {
          if (isPointInPolygon(userData.location, area.polygon)) {
            foundArea = area.name;
            break;
          }
        }
      }

      // Update Pending Stats
      statsRef.current.pendingAreas[foundArea] = (statsRef.current.pendingAreas[foundArea] || 0) + delta;
      statsRef.current.totalTime += delta;

      // Log Friends Proximity
      friendsData.forEach(friend => {
        if (friend.squadId === userData.squadId && friend.location && userData.location) {
          const dx = friend.location.x - userData.location.x;
          const dy = friend.location.y - userData.location.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.05) { // Roughly "close"
            statsRef.current.pendingFriends[friend.uid] = (statsRef.current.pendingFriends[friend.uid] || 0) + delta;
          }
        }
      });

      // Flush condition: > 60s
      if (statsRef.current.totalTime > 60000) {
        flushStats();
      }

    }, 10000);

    const flushStats = async () => {
      if (!userData) return;
      const dateStr = getFestivalDate();
      const statsDocRef = doc(db, 'users', userData.uid, 'dailyStats', dateStr);

      const batchUpdate: any = {
        totalTimeActiveMs: increment(statsRef.current.totalTime)
      };

      Object.entries(statsRef.current.pendingAreas).forEach(([baseKey, val]) => {
        const safeKey = baseKey.replace(/\./g, '_');
        batchUpdate[`areasVisited.${safeKey}`] = increment(val);
      });

      Object.entries(statsRef.current.pendingFriends).forEach(([uid, val]) => {
        batchUpdate[`friendsProximity.${uid}`] = increment(val);
      });

      try {
        await setDoc(statsDocRef, batchUpdate, { merge: true });
        statsRef.current.pendingAreas = {};
        statsRef.current.pendingFriends = {};
        statsRef.current.totalTime = 0;
      } catch (e) {
        console.error("Stats flush failed", e);
      }
    };

    return () => clearInterval(interval);
  }, [userData, gpsHasLocation, friendsData, areas]);

  // 2. Check Availability
  useEffect(() => {
    if (!userData) return;

    const checkWrappeds = async () => {
      const daysToCheck = [];
      for (let i = 1; i <= 4; i++) {
        // Days: Yesterday, DayBefore...
        const date = new Date(Date.now() - 6 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000);
        daysToCheck.push(date.toISOString().split('T')[0]);
      }

      const available: string[] = [];
      let latestAvailable = null;

      for (const day of daysToCheck) {
        const docRef = doc(db, 'users', userData.uid, 'dailyStats', day);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          available.push(day);
          if (!latestAvailable) latestAvailable = day;
        }
      }

      setWrappedDays(available);

      // Check Day of Week for Festival Wrapped (Mon=1, Tue=2, Wed=3)
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 3) {
        if (available.length > 0) setFestivalWrappedAvailable(true);
      } else {
        setFestivalWrappedAvailable(false);
      }

      // Popup Logic - Only show once per day
      if (latestAvailable) {
        const today = new Date().toISOString().split('T')[0];
        const lastShownKey = `wrappedPopupLastShown_${latestAvailable}`;
        const lastShownDate = localStorage.getItem(lastShownKey);

        // Show popup if it hasn't been shown today for this wrapped date
        if (lastShownDate !== today) {
          const lastSeen = userData.lastSeenWrapped || '1970-01-01';
          const lastSeenDate = new Date(lastSeen).toISOString().split('T')[0];
          if (latestAvailable > lastSeenDate) {
            setNewWrappedAvailable(latestAvailable);
          }
        }
      }
    };

    checkWrappeds();
  }, [userData?.uid]);




  const clearPendingPayment = async () => {

    if (!currentUser) return;
    try {
      await updateDoc(getUserDocRef(currentUser.uid), { isPaymentPending: false });
    } catch (e) {
      console.error("Manual cancel failed (probably permissions). Forcing local reload.", e);
      localStorage.removeItem('pendingPlan');
      window.location.reload();
    }
  };

  const [selectedAreaForVote, setSelectedAreaForVote] = useState<Area | null>(null);
  const [activeVote, setActiveVote] = useState<Vote | null>(null);
  const [tempDisableGhostBtn, setTempDisableGhostBtn] = useState(false);
  const [alertIsUpgrade, setAlertIsUpgrade] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'failed' | null>(null);

  // Check for payment return from Stripe
  // --- TASK A: TRAP PARAMS (Run ONCE on mount) ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntent = urlParams.get('payment_intent');
    const redirectStatus = urlParams.get('redirect_status');

    if (paymentIntent && redirectStatus) {
      console.log("Task A: TRAPPED Stripe Params from URL:", { paymentIntent, redirectStatus });
      localStorage.setItem('parkedStripeParams', JSON.stringify({
        paymentIntent,
        redirectStatus,
        timestamp: Date.now()
      }));

      // Clean URL to prevent re-triggering? Optional, but good practice.
      // window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      console.log("Task A: No Stripe params in URL to trap.");
    }
  }, []); // <--- EMPTY DEPENDENCY ARRAY IS CRITICAL

  // --- TASK B: PROCESS PARAMS (Run when User is Ready) ---
  useEffect(() => {
    if (!currentUser) return; // Wait for user

    console.log("Task B: User ready, checking for parked params...");
    const parked = localStorage.getItem('parkedStripeParams');

    if (parked) {
      try {
        const { paymentIntent, redirectStatus, timestamp } = JSON.parse(parked);

        // 60 minute expiry
        if (Date.now() - timestamp > 60 * 60 * 1000) {
          console.warn("Task B: Parked params EXPIRED.");
          localStorage.removeItem('parkedStripeParams');
          return;
        }

        console.log("Task B: PROCESSING Payment:", { paymentIntent, redirectStatus });

        if (redirectStatus === 'succeeded') {
          setPaymentStatus('success');
          setActiveModal('paymentResult');

          // Fallback Plan Update
          const pendingPlan = localStorage.getItem('pendingPlan') as Tier | null;
          if (pendingPlan) {
            console.log("Task B: Applying pending plan:", pendingPlan);
            updateDoc(doc(db, 'users', currentUser.uid), {
              tier: pendingPlan,
              subscriptionExpiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
              isPaymentPending: false
            }).then(() => {
              console.log("Task B: Plan updated successfully.");
            }).catch(e => console.error("Task B Update Error:", e));
          }

          localStorage.removeItem('pendingPlan');
          localStorage.removeItem('parkedStripeParams'); // Job Done
        } else {
          setPaymentStatus('failed');
          setActiveModal('paymentResult');
          localStorage.removeItem('parkedStripeParams');
        }

      } catch (e) {
        console.error("Task B Error parsing params:", e);
      }
    }
  }, [currentUser]);

  // --- Remote Payment Success Listener (Webhook Fail-safe) ---
  // Watches for the tier to change while we are "pending payment". 
  // This handles the case where the URL redirect parameters are missing/stripped,
  // but the Stripe Webhook successfully updated the database in the background.
  useEffect(() => {
    if (!userData || !userData.isPaymentPending) return;

    // We can check if the tier is no longer free (assuming upgrades are the only paid path)
    // Or strictly check against pendingPlan if available
    const pendingPlan = localStorage.getItem('pendingPlan');

    // If tier is updated
    if (userData.tier && userData.tier !== 'free') {
      // If we recall what we were trying to buy, check it matches (optional safety)
      if (pendingPlan && userData.tier !== pendingPlan) {
        // Rare edge case: bought basic, but system says premium? 
        // Accept it anyway, as it's a paid tier.
      }

      console.log("Remote Payment Confirmed via Firestore Change!");

      // 1. Clear the pending flag on server to stop the spinner on other devices
      updateDoc(doc(db, 'users', userData.uid), { isPaymentPending: false })
        .catch(err => console.error("Error clearing pending flag:", err));

      // 2. Show success and cleanup local storage
      setPaymentStatus('success');
      setActiveModal('paymentResult');
      localStorage.removeItem('pendingPlan');
      localStorage.removeItem('parkedStripeParams');
    }
  }, [userData?.tier, userData?.isPaymentPending, userData?.uid]);



  useEffect(() => {
    setCurrentStatusInput(userData?.statusMessage || '');
  }, [userData?.statusMessage]);

  const [mapCalibration, setMapCalibration] = useState<GPSBounds | null>(null);

  useEffect(() => {
    // Fetch Map Calibration
    const unsub = onSnapshot(doc(db, "config", "map"), (doc) => {
      if (doc.exists()) {
        setMapCalibration(doc.data() as GPSBounds);
      } else {
        console.log("Waiting for map calibration (doc not found)");
      }
    });
    return () => unsub();
  }, [currentUser]);

  // GPS Tracking Logic
  useEffect(() => {
    if (!userData?.uid) return;
    if (userData?.useGps === false) { console.log("GPS: Disabled by user settings"); return; }
    if (!mapCalibration) { console.log("GPS: Waiting for Map Calibration"); return; }
    if (!navigator.geolocation) { console.log("GPS: Not supported"); return; }
    if (areas.length === 0) { console.log("GPS: Waiting for areas to load"); return; }

    console.log(`GPS: Starting live location tracking (every ${gpsRefreshInterval} seconds)`);
    setGpsHasLocation(false); // Reset when starting GPS tracking

    const updateGpsLocation = async () => {
      // Double-check areas are still loaded
      if (areas.length === 0) {
        console.log("GPS: Areas not loaded, skipping update");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          const { north, south, east, west } = mapCalibration;

          // Map (Lat, Lon) to (x, y) 0-1 range
          let x = (longitude - west) / (east - west);
          let y = (north - latitude) / (north - south);

          const newPoint = { x, y };

          // Check if we are in Ghost Mode
          if (userData?.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now()) {
            console.log("GPS: Ghost Mode Active, skipping update");
            return;
          }

          // Determine which area the user is in
          let foundArea: Area | null = null;
          // console.log(`GPS: Checking ${areas.length} areas for point (${x.toFixed(4)}, ${y.toFixed(4)})`);
          console.log(`GPS: Point coordinates:`, newPoint);
          for (const area of areas) {
            // console.log(`GPS: Checking area "${area.name}" with ${area.polygon.length} polygon points:`, area.polygon);
            const isInside = isPointInPolygon(newPoint, area.polygon);
            console.log(`GPS: Area "${area.name}" - ${isInside ? 'INSIDE ✓' : 'outside ✗'}`);
            if (isInside) {
              foundArea = area;
              break;
            }
          }

          const areaName = foundArea ? foundArea.name : 'Out of bounds';

          console.log("GPS: Update", { latitude, longitude, x, y, area: areaName, foundArea: !!foundArea });

          try {
            const updateData: any = {
              location: newPoint,
              lastUpdate: Date.now(),
              currentArea: areaName
            };

            // Update lastKnownArea if not in Out of bounds
            if (areaName !== 'Out of bounds') {
              updateData.lastKnownArea = areaName;
            }

            console.log("GPS: Updating Firestore with:", updateData);
            await updateDoc(getUserDocRef(userData.uid), updateData);
            console.log("GPS: Firestore update successful");
            setGpsTimeoutCount(0); // Reset timeout counter on success
            setGpsHasLocation(true); // Mark that we have a GPS location
          } catch (e) { console.error("Error updating GPS location", e); }
        },
        async (err) => {
          console.error("GPS Error:", err);

          // Default handler for all GPS Errors to try and disable GPS gracefully
          const handleGpsFail = async () => {
            console.log("GPS: Failed to get location, auto-disabling GPS");
            setGpsError("Live location was disabled as app failed to grab GPS.");
            setGpsRefreshButtonText('GPS failed to connect');
            setTimeout(() => setGpsRefreshButtonText(null), 2000);
            setGpsTimeoutCount(0); // Reset counter
            try {
              // Ensure we call the actual toggle logic or mimic it
              // We don't have handleGpsToggle in scope here easily if it's defined later. 
              // But we can update doc directly.
              await updateDoc(getUserDocRef(userData.uid), { useGps: false });
            } catch (e) {
              console.error("Failed to disable GPS:", e);
            }
          };

          // Check for timeout errors (code 3)
          if (err.code === 3) {
            setGpsTimeoutCount(prevCount => {
              const newCount = prevCount + 1;
              console.log(`GPS: Timeout error ${newCount}/3`);

              if (newCount >= 3) {
                console.log("GPS: 3 consecutive timeouts, auto-disabling GPS");
                handleGpsFail();
                return 0; // Reset counter
              }

              return newCount;
            });
          }
          // Network 403 or other perm errors
          else if (err.message && (err.message.includes("403") || err.message.includes("network"))) {
            await handleGpsFail();
          }
          // Permission Denied (code 1) or Unavailable (code 2)
          else if (err.code === 1 || err.code === 2) {
            await handleGpsFail();
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    };

    // Update immediately on mount
    updateGpsLocation();

    // Then update every X seconds based on setting
    const intervalId = setInterval(updateGpsLocation, gpsRefreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [userData?.useGps, mapCalibration, userData?.uid, userData?.ghostMode, areas, gpsRefreshInterval]);

  // ... (skip lines) ...

  // --- Main Component ---
  // --- Refs ---
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const pointerDownTimeRef = useRef(0);
  const pointerEventsRef = useRef<{ x: number, y: number } | null>(null);

  // Voting Widget (Appears on top of content if there is an active vote)


  // --- Utility & Helper Functions ---
  const showAlert = (message: string, showShareButton = false) => {
    setAlertMessage(message);
    setShowShareLink(showShareButton);
    setActiveModal('alert');
  };

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmAction({ message, onConfirm });
    setActiveModal('confirm');
  };

  const copyInviteLink = async () => {
    setFriendEmail('');
    if (!currentUser?.uid) return;
    const inviteLink = `${window.location.origin}?invite=${currentUser.uid}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showAlert("Invite link copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
      showAlert("Failed to copy link");
    }
  };



  const handleClusterClick = (clusterUsers: UserData[]) => {
    const uids = clusterUsers.map(u => u.uid);
    setHighlightedUids(uids);
    setTimeout(() => setHighlightedUids([]), 3000); // Highlight needed briefly
  };

  // --- Canvas Drawing & Map Logic ---
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showZones) {
      areas.forEach(area => {
        drawPolygon(ctx, area.polygon, 'rgba(3, 218, 198, 0.3)', 'rgba(3, 218, 198, 0.7)');
      });
    }

    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(187, 134, 252, 0.3)', 'rgba(187, 134, 252, 0.7)', true);
    }
  }, [areas, isDevMode, showZones]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const mapImage = mapImageRef.current;
    if (!canvas || !mapImage) return;
    if (mapImage.clientWidth > 0) {
      canvas.width = mapImage.clientWidth;
      canvas.height = mapImage.clientHeight;
      redrawCanvas();
    }
  }, [redrawCanvas]);

  const drawPolygon = (ctx: CanvasRenderingContext2D, points: Point[], fill: string, stroke: string, drawVertices = false) => {
    if (points.length < 1) return;
    const canvas = canvasRef.current!;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * canvas.width, points[i].y * canvas.height);
    }
    if (points.length > 2) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();

    if (drawVertices) {
      ctx.fillStyle = '#CF6679';
      points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  };

  useEffect(() => {
    redrawCanvas();
  }, [areas, redrawCanvas, showZones]);

  useEffect(() => {
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // --- Event Handlers & App Logic ---
  const handleSaveArea = async () => {
    if (!areaName || currentPolygonPoints.current.length < 3) {
      return showAlert("Please provide a name and draw a valid shape (at least 3 points).");
    }
    try {
      await addDoc(collection(db, 'areas'), {
        name: areaName,
        polygon: currentPolygonPoints.current,
      });
      currentPolygonPoints.current = [];
      setAreaName('');
      setIsDevMode(false);
      setActiveModal(null);
      redrawCanvas();
    } catch (error) {
      console.error("Error saving area:", error);
      showAlert("Could not save area.");
    }
  };

  const handleDeleteArea = async (areaId: string) => {
    const areaName = areas.find(a => a.id === areaId)?.name || 'the selected area';
    showConfirm(`Are you sure you want to delete "${areaName}" ? `, async () => {
      try {
        await deleteDoc(doc(db, 'areas', areaId));
        showAlert("Area deleted successfully.");
      } catch (error) {
        console.error("Error deleting area:", error);
        showAlert("Could not delete the area.");
      }
    });
  };

  const handleRenameArea = async () => {
    if (!newAreaName || !renamingArea) {
      return showAlert("Please provide a valid new name.");
    }
    try {
      const areaRef = doc(db, 'areas', renamingArea.id);
      await updateDoc(areaRef, { name: newAreaName });
      showAlert("Area renamed successfully!");
      setActiveModal('locations');
      setRenamingArea(null);
      setNewAreaName('');
    } catch (error) {
      console.error("Error renaming area:", error);
      showAlert("Could not rename the area.");
    }
  };

  const handleInviteToSquad = async (friendUid: string) => {
    if (!userData?.squadId || !userData?.uid) return;

    // Check Tier Limits
    const myTier = hasActiveSubscription(userData) ? (userData.tier || 'free') : 'free';
    if (myTier === 'free') {
      showAlert("Free tier users cannot invite friends to a squad. Please upgrade to create a squad.");
      return;
    }

    // Check Squad Size Limit
    const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
    if (squadMembers.length >= (TIER_LIMITS[myTier] + 1)) { // +1 for self
      setActiveModal('limitReached');
      return;
    }

    if (userData.uid !== userData.squadOwnerId) {
      showAlert("Only the squad leader can send invites.");
      return;
    }
    try {
      await addDoc(collection(db, "squadInvites"), {
        squadId: userData.squadId,
        from: userData.uid,
        to: friendUid,
        createdAt: Date.now(),
        status: "pending"
      });
    } catch (error) {
      console.error("Error sending squad invite:", error);
      showAlert("Failed to send squad invite.");
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pos = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };

    if (isDevMode) {
      if (currentPolygonPoints.current.length > 2) {
        const firstPoint = currentPolygonPoints.current[0];
        const clickRadius = 15 / canvas.width;
        if (Math.hypot(pos.x - firstPoint.x, pos.y - firstPoint.y) < clickRadius) {
          setActiveModal('areaName');
          return;
        }
      }
      currentPolygonPoints.current.push(pos);
      redrawCanvas();
    }
    else if (userData?.useGps === false) {
      let foundArea: Area | null = null;
      for (const area of areas) {
        if (isPointInPolygon(pos, area.polygon)) {
          foundArea = area;
          break;
        }
      }
      setSelectedAreaForCheckIn(foundArea);
    }
  };

  const handleManualCheckIn = async (area: Area) => {
    if (!currentUser || !area.polygon) return;
    let cx = 0, cy = 0;
    area.polygon.forEach(p => {
      cx += p.x;
      cy += p.y;
    });
    const centroid = {
      x: cx / area.polygon.length,
      y: cy / area.polygon.length,
    };

    try {
      await updateDoc(getUserDocRef(currentUser.uid), {
        location: centroid,
        currentArea: area.name,
        lastKnownArea: area.name,
        lastUpdate: Date.now()
      });
      setActiveModal(null);
      setSelectedAreaForCheckIn(null);
    } catch (error) {
      console.error("Error checking in manually:", error);
      showAlert("Could not perform check-in.");
    }
  };

  const handleGpsToggle = async (useGps: boolean) => {
    try {
      if (!currentUser) return;
      await updateDoc(getUserDocRef(currentUser.uid), { useGps });
    } catch (e) {
      console.error(e);
      showAlert("Error updating GPS setting.");
    }
  };

  const startVote = async (area: Area) => {
    if (!userData || !userData.squadId) return;
    const newVote: Vote = {
      id: Date.now().toString(),
      creatorId: userData.uid,
      creatorName: userData.displayName || 'Unknown',
      targetAreaId: area.id,
      targetAreaName: area.name,
      createdAt: Date.now(),
      votes: { [userData.uid]: 'yes' }, // Creator votes yes automatically? Or wait. 'Vote we go to...' implies intent.
    };
    try {
      await updateDoc(doc(db, "squads", userData.squadId), { activeVote: newVote });
      setSelectedAreaForVote(null); // Reset selection
    } catch (e) {
      console.error(e);
      showAlert("Failed to start vote.");
    }
  };

  const castVote = async (voteVal: 'yes' | 'no') => {
    if (!userData?.squadId || !activeVote) return;
    try {
      const updatedVotes = { ...activeVote.votes, [userData.uid]: voteVal };
      const squadRef = doc(db, "squads", userData.squadId);

      // Check if everyone has voted OR majority reached
      const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter(f => f.squadId === userData.squadId).map(f => f.uid))];
      const squadSize = squadMembers.length;

      const yesVotes = Object.values(updatedVotes).filter(v => v === 'yes').length;
      const noVotes = Object.values(updatedVotes).filter(v => v === 'no').length;
      const allVoted = squadMembers.every((uid: string) => updatedVotes[uid] !== undefined);
      const majorityReached = yesVotes > squadSize / 2 || noVotes > squadSize / 2;

      let updateData: any = { [`activeVote.votes.${userData.uid}`]: voteVal };

      if ((allVoted || majorityReached) && !activeVote.completedAt) {
        updateData[`activeVote.completedAt`] = Date.now();

        // --- Send Vote Result to Chat ---
        const resultString = yesVotes > noVotes
          ? `Vote Ended: We are going to ${activeVote.targetAreaName}`
          : `Vote Ended: We are NOT going to ${activeVote.targetAreaName}`;

        addDoc(collection(db, "squads", userData.squadId, "messages"), {
          senderId: userData.uid, // Must match auth uid for rules
          senderName: 'Squad Vote',
          senderPhotoURL: '', // No avatar for system msg
          content: resultString,
          type: 'vote_ended',
          createdAt: Date.now()
        }).catch(console.error);
      }

      await updateDoc(squadRef, updateData);
    } catch (e) { console.error(e); }
  };

  const endVote = async () => {
    if (!userData?.squadId) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), { activeVote: null });
    } catch (e) { console.error(e); }
  };


  // Voting Widget (Appears on top of content if there is an active vote)
  const renderVoteWidget = () => {
    if (!activeVote || !userData) return null;

    // Check expiry
    if (activeVote.completedAt && (Date.now() - activeVote.completedAt > 30 * 60 * 1000)) return null;

    const myVote = activeVote.votes[userData.uid];
    const isOwner = activeVote.creatorId === userData.uid;
    const totalVotes = Object.keys(activeVote.votes).length;

    // Squad members count (me + friends in squad)
    const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter(f => f.squadId === userData.squadId).map(f => f.uid))];
    const squadSize = squadMembers.length;

    const yesCount = Object.values(activeVote.votes).filter(v => v === 'yes').length;
    const noCount = Object.values(activeVote.votes).filter(v => v === 'no').length;
    const isCompleted = activeVote.completedAt || (totalVotes >= squadSize && squadSize > 1) || (yesCount > squadSize / 2) || (noCount > squadSize / 2);

    return (
      <div className="card" style={{
        marginBottom: '1rem',
        backgroundColor: '#1f1f1f',
        border: '1px solid #444',
        boxSizing: 'border-box',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        animation: 'slideIn 0.3s ease-out',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <strong style={{ color: 'var(--primary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Squad Vote</strong>
          <span style={{ fontSize: '1rem' }}>🗳️</span>
        </div>

        {/* Question */}
        <h3 style={{ margin: '0 0 16px 0', textAlign: 'center', fontSize: '1.3rem' }}>
          Go to <span style={{ color: 'white' }}>{activeVote.targetAreaName}</span>?
        </h3>

        {!isCompleted ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Buttons Row */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {/* Yes Button */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={() => castVote('yes')}
                  className="btn"
                  style={{
                    width: '100%',
                    background: myVote === 'yes' ? 'linear-gradient(45deg, var(--primary), var(--secondary))' : '#333',
                    color: myVote === 'yes' ? '#000' : 'white',
                    opacity: myVote && myVote !== 'yes' ? 0.3 : 1,
                    border: 'none',
                    fontSize: '1rem',
                    padding: '12px'
                  }}
                >Lets Go</button>
                <div style={{ fontSize: '0.8rem', textAlign: 'center', color: 'var(--primary)' }}>{yesCount} votes</div>
              </div>

              {/* No Button */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={() => castVote('no')}
                  className="btn"
                  style={{
                    width: '100%',
                    background: myVote === 'no' ? 'var(--error)' : '#333',
                    opacity: myVote && myVote !== 'no' ? 0.3 : 1,
                    border: '1px solid var(--error)',
                    fontSize: '1rem',
                    padding: '12px'
                  }}
                >F*** That</button>
                <div style={{ fontSize: '0.8rem', textAlign: 'center', color: 'var(--error)' }}>{noCount} votes</div>
              </div>
            </div>

            {/* Cancel Button (Owner Only) */}
            {isOwner && (
              <button
                onClick={endVote}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  marginTop: '8px',
                  textDecoration: 'underline'
                }}
              >
                Cancel Vote
              </button>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '12px', fontWeight: 'bold', color: 'white' }}>
              Vote Completed!
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', marginBottom: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>{yesCount}</div>
                <div style={{ fontSize: '0.8rem', color: '#aaa' }}>Lets Go</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--error)' }}>{noCount}</div>
                <div style={{ fontSize: '0.8rem', color: '#aaa' }}>No</div>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
              {yesCount > noCount
                ? <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.1rem' }}>We are going! 🏃‍♂️</div>
                : <div style={{ color: 'var(--error)', fontWeight: 'bold', fontSize: '1.1rem' }}>Screw that! 🙅‍♂️</div>}
            </div>

            {isOwner && (
              <button
                onClick={endVote}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  marginTop: '12px'
                }}
              >
                Close Widget
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDevMode) {
      // In dev mode, let clicks through for drawing
      return;
    }
    isLongPressRef.current = false;
    pointerDownTimeRef.current = Date.now();
    pointerEventsRef.current = { x: e.clientX, y: e.clientY };

    // Start 1s timer
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      // Trigger vote mode
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = (pointerEventsRef.current!.x - rect.left) / rect.width;
      const y = (pointerEventsRef.current!.y - rect.top) / rect.height;

      const clickedArea = areas.find(area => isPointInPolygon({ x, y }, area.polygon));
      if (clickedArea) {
        setSelectedAreaForVote(clickedArea);
        setSelectedAreaForCheckIn(null); // Clear check-in if long press
        // Vibrate if mobile?
        if (navigator.vibrate) navigator.vibrate(200);
      }
    }, 800); // 0.8 seconds requested
    // "hold a place on the map for 0.8 seconds"
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isDevMode) {
      // In dev mode, handle clicks for drawing
      handleCanvasClick(e as any);
      return;
    }

    // If it wasn't a long press, treat as click check-in
    if (!isLongPressRef.current) {
      // handle click
      handleCanvasClick(e as any);
      // Also reset vote selection on normal click?
      setSelectedAreaForVote(null);
    }
  };

  const handlePointerLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // If moved significantly, cancel long press
    if (longPressTimerRef.current && pointerEventsRef.current) {
      const dx = Math.abs(e.clientX - pointerEventsRef.current.x);
      const dy = Math.abs(e.clientY - pointerEventsRef.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const cancelDrawing = () => {
    currentPolygonPoints.current = [];
    setIsDevMode(false);
    redrawCanvas();
  };

  const getSquadLeaderUid = () => {
    if (!userData?.squadId) return null;
    const leader = [userData, ...friendsData].find(u => u.uid === userData.squadOwnerId);
    return leader ? leader.uid : userData.squadOwnerId || userData.uid;
  };

  const getDisplayNameByUid = (uid: string): string => {
    if (uid === userData?.uid) return userData.displayName || uid;
    const friend = friendsData.find(f => f.uid === uid);
    if (friend?.displayName) return friend.displayName;
    return publicProfileCache[uid] || uid;
  };

  useEffect(() => {
    const inviteUids = [
      ...incomingSquadInvites.map(inv => inv.from),
      ...outgoingSquadInvites.map(inv => inv.to),
      ...incomingFriendRequests.map(req => req.from),
      ...outgoingFriendRequests.map(req => req.to)
    ].filter(uid =>
      uid !== userData?.uid &&
      !friendsData.some(f => f.uid === uid) &&
      !(publicProfileCache[uid])
    );
    if (inviteUids.length === 0) return;
    inviteUids.forEach(async uid => {
      try {
        const docRef = doc(db, 'public/user_profiles/users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const profile = docSnap.data();
          setPublicProfileCache(prev => ({
            ...prev,
            [uid]: profile.displayName || uid
          }));
        }
      } catch (e) { }
    });
  }, [incomingSquadInvites, outgoingSquadInvites, incomingFriendRequests, outgoingFriendRequests, friendsData, userData, publicProfileCache]);

  const handleKickMemberConfirmed = async (member: UserData) => {
    if (!userData || !userData.squadId || !member.uid) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(member.uid)
      });
      await updateDoc(getUserDocRef(member.uid), {
        squadId: null
      });
      setSelectedMember(null);
    } catch (error) {
      console.error("Error kicking member:", error);
      showAlert("Failed to kick member from squad.");
      setSelectedMember(null);
    }
  };

  const handleKickMember = (member: UserData) => {
    setSelectedMember(null);
    showConfirm(
      `Are you sure you want to kick '${member.displayName}' from the squad ? `,
      () => handleKickMemberConfirmed(member)
    );
  };

  const handleLeaveSquadConfirmed = async () => {
    if (!userData || !userData.squadId || !currentUser) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(currentUser.uid)
      });
      const squadDoc = await addDoc(collection(db, "squads"), {
        ownerId: currentUser.uid,
        members: [currentUser.uid],
        pendingMembers: [],
        createdAt: Date.now(),
      });
      await updateDoc(doc(db, "users", currentUser.uid), {
        squadId: squadDoc.id,
        squadOwnerId: currentUser.uid,
      });
      setSelectedMember(null);
    } catch (error) {
      console.error("Error leaving squad:", error);
      showAlert("Failed to leave squad.");
      setSelectedMember(null);
    }
  };

  const handleLeaveSquad = () => {
    setSelectedMember(null);
    showConfirm(
      "Are you sure you want to leave the squad?",
      handleLeaveSquadConfirmed
    );
  };

  const handleAcceptSquadInvite = async (invite: DocumentData) => {
    try {
      // Leave old squad if in one
      if (userData?.squadId) {
        await updateDoc(doc(db, "squads", userData.squadId), {
          members: arrayRemove(currentUser!.uid)
        });
      }

      await updateDoc(doc(db, "squads", invite.squadId), {
        members: arrayUnion(currentUser!.uid)
      });
      await updateDoc(doc(db, "users", currentUser!.uid), {
        squadId: invite.squadId,
        squadOwnerId: invite.from
      });
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "accepted"
      });
      setActiveModal(null);
    } catch (error) {
      console.error("Error accepting squad invite:", error);
      showAlert("Could not accept squad invite.");
    }
  };

  const handleDeclineSquadInvite = async (invite: DocumentData) => {
    try {
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "declined"
      });
      showAlert("Squad invite declined.");
    } catch (error) {
      console.error("Error declining squad invite:", error);
      showAlert("Could not decline squad invite.");
    }
  };

  const handleWithdrawSquadInvite = async (invite: DocumentData) => {
    try {
      await deleteDoc(doc(db, "squadInvites", invite.id));
    } catch (error) {
      console.error("Error withdrawing squad invite:", error);
      showAlert("Could not withdraw squad invite.");
    }
  };

  const handleUpgrade = async (planId: Tier, forceOverride = false) => {
    // Safety Check: Upgrades Disabled (except for Devs)
    if (!upgradesEnabled && !userData?.isDev) {
      return showAlert("Upgrades are currently paused by the developer.");
    }
    // If Admin Dev Mode for Cycling is on, just switch instantly without payment simulation logic (conceptually)
    // Here we just use the same logic but the user perception of "payment" is bypassed by intent.
    // In a real app, successful payment callback would trigger this.

    if (!currentUser) return;
    try {
      if ((useSandboxStripe || forceOverride) && userData?.isDev) {
        // Just set it directly
        if (planId === 'free') {
          // Reset Logic: Remove everyone from squad, cancel invites
          if (userData?.squadId) {
            const squadRef = doc(db, "squads", userData.squadId);
            const snap = await getDoc(squadRef);
            if (snap.exists()) {
              const members = snap.data().members || [];
              // Reset all members
              for (const memberUid of members) {
                await updateDoc(getUserDocRef(memberUid), { squadId: null, squadOwnerId: null });
              }
              // Delete squad
              await deleteDoc(squadRef);
            }

            // Delete invites
            const invitesQ = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid));
            const invSnap = await getDocs(invitesQ);
            invSnap.forEach(async (d) => {
              await deleteDoc(d.ref);
            });
          }
          await updateDoc(getUserDocRef(currentUser.uid), {
            tier: 'free',
            subscriptionExpiry: null,
            squadId: null, // Ensure self is reset
            squadOwnerId: null
          });
          setFriendsData(prev => prev.map(f => f.squadId === userData?.squadId ? { ...f, squadId: undefined } : f));
        } else {
          await updateDoc(getUserDocRef(currentUser.uid), {
            tier: planId,
            subscriptionExpiry: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
          });
        }
        setActiveModal(null);
        showAlert(`Plan updated to ${planId.toUpperCase()}!`);
      } else {
        // STRIPE CHECKOUT FLOW
        try {
          const res = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tierId: planId,
              userId: currentUser.uid,
              sandboxMode: useSandboxStripe,
              successUrl: window.location.origin, // Return to home on success
              cancelUrl: window.location.origin,
            })
          });

          const data = await res.json();
          if (data.url) {
            localStorage.setItem('pendingPlan', planId);

            // Set pending flag in Firestore
            await updateDoc(getUserDocRef(currentUser.uid), { isPaymentPending: true });

            window.location.href = data.url; // Redirect to Stripe
          } else {
            console.error("No URL returned from checkout session creation", data);
            showAlert("Failed to initialize checkout.");
          }
        } catch (err) {
          console.error(err);
          showAlert("Connection error initiating checkout.");
        }
      }
    } catch (e) {
      console.error(e);
      showAlert("Upgrade failed.");
    }
  };

  /**
   * Helper to check if user has an active paid subscription
   */
  const hasActiveSubscription = (user: UserData | null): boolean => {
    if (!user || !user.subscriptionExpiry) return false;
    return user.subscriptionExpiry > Date.now();
  };

  // Track previous invites count to notify on new ones
  const prevFriendReqCount = useRef(0);
  const prevSquadInvCount = useRef(0);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!initialLoadDone.current) {
      prevFriendReqCount.current = incomingFriendRequests.length;
      prevSquadInvCount.current = incomingSquadInvites.length;
      initialLoadDone.current = true;
      return;
    }

    if (incomingFriendRequests.length > prevFriendReqCount.current) {
      if (incomingFriendRequests.length > 0) {
        setActiveModal('friendRequests');
      }
    }
    prevFriendReqCount.current = incomingFriendRequests.length;

    // Squad Invites - Update count but do NOT show modal, we show widget instead
    prevSquadInvCount.current = incomingSquadInvites.length;
  }, [incomingFriendRequests, incomingSquadInvites]);

  // --- Subscriptions ---
  // --- Area Listener ---
  useEffect(() => {
    const unsubscribeAreas = onSnapshot(collection(db, "areas"), (snapshot) => {
      const areasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Area[];
      setAreas(areasData);
    });
    return () => unsubscribeAreas();
  }, []);

  // --- Reset App State on Logout ---
  useEffect(() => {
    if (!currentUser) {
      setFriendsData([]);
      setIsDevMode(false);
      // We don't need to manually reset userData/currentUser as context handles that
      // but friendsData persists in App state if not cleared.
    }
  }, [currentUser]);

  useEffect(() => {
    const friendIds = userData?.friends || [];

    // Immediately remove any friends from state that are no longer in the list
    setFriendsData(prev => prev.filter(f => friendIds.includes(f.uid)));

    if (friendIds.length === 0) return;
    const unsubscribes = friendIds.map(friendId =>
      onSnapshot(getUserDocRef(friendId), (doc) => {
        if (doc.exists()) {
          const friendData = { uid: doc.id, ...doc.data() } as UserData;
          setFriendsData(prevFriends => {
            const otherFriends = prevFriends.filter(f => f.uid !== friendId);
            return [...otherFriends, friendData];
          });
        }
      })
    );
    return () => unsubscribes.forEach(unsub => unsub());
  }, [userData?.friends]);

  // --- Auto-remove Desynced Friends ---
  // --- Auto-remove Desynced Friends ---
  useEffect(() => {
    /* Temporarily disabled: It's aggressively removing friends while the mutual-add logic settles. 
       We need to be sure before we delete.
    if (!userData || !currentUser || friendsData.length === 0) return;
 
    const desyncedFriends: string[] = [];
 
    friendsData.forEach(friend => {
      // Check if the friend still has us in their friends list
      // We check explicit absence. Use optional chaining in case field is missing.
      const IsInTheirList = friend.friends?.includes(currentUser.uid);
 
      if (IsInTheirList === false) {
        desyncedFriends.push(friend.uid);
      }
    });
 
    if (desyncedFriends.length > 0) {
      console.log("Auto-removing desynced friends:", desyncedFriends);
 
      // Perform removal
      updateDoc(getUserDocRef(currentUser.uid), {
        friends: arrayRemove(...desyncedFriends)
      }).then(() => {
        const names = friendsData.filter(f => desyncedFriends.includes(f.uid)).map(f => f.displayName).join(", ");
        showAlert(`Connection with ${names} was out of sync and has been reset.`);
      }).catch(console.error);
    }
    */
  }, [friendsData, userData, currentUser]);

  // --- Notifications ---
  useEffect(() => {
    if (!currentUser) return;

    // Request Permission & Get Token
    const requestPermission = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          // Note: In production you often need a VAPID key: getToken(messaging, { vapidKey: 'YOUR_KEY' });
          const currentToken = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY });
          if (currentToken) {
            await updateDoc(getUserDocRef(currentUser.uid), {
              fcmToken: currentToken
            });
          }
        }
      } catch (err) {
        console.log('An error occurred while retrieving token. ', err);
      }
    };
    requestPermission();

    // Foreground Message Listener
    const unsubscribe = onMessage(messaging, (payload) => {
      if (payload.notification) {
        setAlertMessage(`${payload.notification.title}: ${payload.notification.body}`);
        setActiveModal('alert');
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Listen to Squad Data for activeVote
  useEffect(() => {
    if (!userData?.squadId) return;
    const unsubSquad = onSnapshot(doc(db, "squads", userData.squadId), (docSnap) => {
      if (docSnap.exists()) {
        setSquadData(docSnap.data());
        const data = docSnap.data();
        if (data.activeVote) {
          // Check expiry
          if (data.activeVote.completedAt && (Date.now() - data.activeVote.completedAt > 30 * 60 * 1000)) {
            // Expired locally, maybe clean up later or just hide
          }
          setActiveVote(data.activeVote);
        } else {
          setActiveVote(null);
        }
      }
    });
    return () => unsubSquad();
  }, [userData?.squadId]);

  // --- Chat Unread Listener ---
  useEffect(() => {
    if (!userData?.squadId) return;
    try {
      const q = query(collection(db, "squads", userData.squadId, "messages"), orderBy("createdAt", "desc"), limit(1));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const latestMsg = snapshot.docs[0].data();
          // If message is newer than last seen AND we are not currently looking at chat
          if (latestMsg.createdAt > lastSeenChatTime && activeTab !== 'chat') {
            setHasUnreadChat(true);
          }
        }
      });
      return () => unsubscribe();
    } catch (e) { console.error("Chat listener error", e); }
  }, [userData?.squadId, lastSeenChatTime, activeTab]);

  // Clear unread when entering chat
  useEffect(() => {
    if (activeTab === 'chat') {
      setHasUnreadChat(false);
      const now = Date.now();
      setLastSeenChatTime(now);
      localStorage.setItem('lastSeenChatTime', now.toString());
    }
  }, [activeTab]);

  // --- DEV: Fetch All Users for Map ---
  useEffect(() => {
    if (!isDevMode || !devMapFilterDuration) {
      setAllUsersOnMap([]);
      return;
    }

    // Subscribe to ALL users (Costly, but only for dev mode)
    const q = query(collection(db, 'users'));
    const unsub = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() })) as UserData[];

      const now = Date.now();
      let durationMs = 0;
      switch (devMapFilterDuration) {
        case '5m': durationMs = 5 * 60 * 1000; break;
        case '30m': durationMs = 30 * 60 * 1000; break;
        case '1h': durationMs = 60 * 60 * 1000; break;
        case '24h': durationMs = 24 * 60 * 60 * 1000; break;
      }

      const filtered = users.filter(u => u.lastUpdate && (now - u.lastUpdate < durationMs));
      setAllUsersOnMap(filtered);
    });

    return () => unsub();
  }, [isDevMode, devMapFilterDuration]);




  useEffect(() => {
    if (!currentUser?.uid) return;
    const qIn = query(collection(db, "squadInvites"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubIn = onSnapshot(qIn, (snapshot) => {
      setIncomingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const qOut = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubOut = onSnapshot(qOut, (snapshot) => {
      setOutgoingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const qFreqIn = query(collection(db, "friendRequests"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubFreqIn = onSnapshot(qFreqIn, (snapshot) => {
      setIncomingFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const qFreqOut = query(collection(db, "friendRequests"), where("from", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubFreqOut = onSnapshot(qFreqOut, (snapshot) => {
      setOutgoingFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubIn(); unsubOut(); unsubFreqIn(); unsubFreqOut(); };
  }, [currentUser?.uid]);

  const handleSendFriendRequest = async (friendUid: string) => {
    if (!currentUser) return;
    try {
      // Check if already friends
      if (userData?.friends?.includes(friendUid)) {
        showAlert("You are already friends!");
        return;
      }
      await addDoc(collection(db, "friendRequests"), {
        from: currentUser.uid,
        to: friendUid,
        status: 'pending',
        createdAt: Date.now()
      });
      showAlert("Friend request sent!");
      setFriendEmail('');
    } catch (e) {
      console.error(e);
      showAlert("Failed to send friend request.");
    }
  };

  const handleAcceptFriendRequest = async (request: DocumentData) => {
    if (!currentUser) return;
    let warningShown = false;
    try {
      // 1. Add them to MY friends list (I have permission to edit my own doc)
      await updateDoc(getUserDocRef(currentUser.uid), { friends: arrayUnion(request.from) });

      // 2. Try to add ME to THEIR friends list (Mutual add)
      // This might fail if the other user has strict security rules or if their "friends" field is missing
      try {
        await updateDoc(getUserDocRef(request.from), { friends: arrayUnion(currentUser.uid) });
      } catch (err) {
        console.warn("Could not add self to other user's friend list (Permission/Missing Field). They may need to add you back manually.", err);
        // We do NOT throw here, so we can still delete the request.
        // However, the "Auto-Desync" feature might remove them later if they don't have us.
        // Ideally, we'd inform the user.
        showAlert("Friend accepted! Note: You might not appear in their list until they add you too.");
        warningShown = true;
      }

      // 3. Delete the request
      await deleteDoc(doc(db, "friendRequests", request.id));

      // Only show success if we didn't show the warning above? 
      // Actually showAlert replaces the message. Let's just show a generic success if no warning was shown?
      // Or just let the generic success overwrite?
      // Let's refine the UX:
      // If the catch block above ran, showAlert was called. 
      // If we call it again here, it overwrites.
      // So let's conditionally call it.
      // But for now, let's just say "Accepted" if it worked perfectly.
      // We can use a flag.
      if (!warningShown) {
        showAlert("Friend Request Accepted!");
      }
    } catch (e) {
      console.error(e);
      showAlert("Error accepting friend request. Please try again.");
    }
  };

  const handleDeclineFriendRequest = async (request: DocumentData) => {
    try {
      await deleteDoc(doc(db, "friendRequests", request.id));
    } catch (e) { console.error(e); }
  };

  // --- Render ---
  if (authLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#121212', color: 'white' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <div className="spinner" style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255,255,255,0.1)',
            borderTop: '4px solid var(--primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }}></div>
          <p>Restoring Session...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="app-container" style={{ padding: '20px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
          <img src="/logo-main.png" alt="Herd Search" style={{ width: '150px', height: 'auto', marginBottom: '1rem', borderRadius: '20px' }} />
          <h1 className="logo" style={{ fontSize: '3rem', marginBottom: '2rem' }}>Herd Search</h1>
          <button
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
            className="btn"
            style={{ background: 'white', color: '#444', border: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '1.2rem', padding: '12px 24px' }}
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="24" />
            Sign in with Google
          </button>
        </div>

        <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
          <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', background: '#333' }}>
            <h2 style={{ color: 'var(--primary)', marginTop: 0 }}>What is Herd Search?</h2>
            <p>
              Herd Search is the ultimate festival and event companion. Keep track of your friends (your "Herd"), create temporary squads, and never lose your group in the crowd again.
            </p>
          </div>

          <h3 style={{ marginTop: '2rem', marginBottom: '1rem', textAlign: 'center' }}>Key Features</h3>

          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#03dac6' }}><FaMap /></div>
            <div>
              <h4 style={{ margin: 0 }}>The Map</h4>
              <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                See where your friends are in real-time. Long press on a location to start a Squad Vote.
              </p>
            </div>
          </div>

          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#bb86fc' }}><FaUserFriends /></div>
            <div>
              <h4 style={{ margin: 0 }}>Squads</h4>
              <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                Create a Squad and share your live location with each other.
              </p>
            </div>
          </div>

          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#cf6679' }}><FaGhost /></div>
            <div>
              <h4 style={{ margin: 0 }}>Ghost Mode</h4>
              <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                Want some privacy? Enable Ghost Mode in your profile to hide your location.
              </p>
            </div>
          </div>

          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#ffc107' }}><FaMapMarkerAlt /></div>
            <div>
              <h4 style={{ margin: 0 }}>Check In</h4>
              <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                GPS Acting up? Manually Check In to a festival area to update your location.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (activeTab === 'map') {
      return (
        <>
          <header>

            <Link to="/about" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>Herd Search</Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {!userData?.useGps && (
                <button
                  onClick={async () => {
                    await handleGpsToggle(true);
                  }}
                  style={{
                    background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: 'black',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(3, 218, 198, 0.3)'
                  }}
                >
                  📍 Turn on GPS
                </button>
              )}
              <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
                {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
              </div>
            </div>
          </header>

          {isDevMode && (
            <div className="dev-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3>Developer Mode</h3>
                <button onClick={() => setActiveModal('devStats')} className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px', background: '#333' }}>📊 View Stats</button>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '4px' }}>Show all users active in last:</label>
                <select
                  value={devMapFilterDuration || ''}
                  onChange={(e) => setDevMapFilterDuration(e.target.value as any || null)}
                  style={{ background: '#333', color: 'white', border: '1px solid #555', padding: '4px', borderRadius: '4px' }}
                >
                  <option value="">-- Only Friends (Default) --</option>
                  <option value="5m">Last 5 Minutes</option>
                  <option value="30m">Last 30 Minutes</option>
                  <option value="1h">Last Hour</option>
                  <option value="24h">Last 24 Hours</option>
                </select>
              </div>

              <p>Click on the map to draw areas.</p>
              <button onClick={cancelDrawing} className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }}>Cancel Drawing</button>
            </div>
          )}

          {/* SQUAD INVITE NOTIFICATION WIDGET */}
          {incomingSquadInvites.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '60px', /* Below Header */
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 999,
              width: '90%',
              maxWidth: '400px',
              backgroundColor: 'rgba(30,30,30,0.95)',
              border: '1px solid var(--primary)',
              borderRadius: '12px',
              padding: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              animation: 'slideDown 0.3s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '0.9rem' }}>Squad Invite</span>
                <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{incomingSquadInvites.length > 1 ? `+${incomingSquadInvites.length - 1} more` : ''}</span>
              </div>

              {/* Show the first invite */}
              {(() => {
                const invite = incomingSquadInvites[0];
                const senderName = getDisplayNameByUid(invite.from);
                return (
                  <div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>
                      <strong>{senderName}</strong> invited you to join their squad.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleAcceptSquadInvite(invite)}
                        className="btn btn-primary"
                        style={{
                          flex: 1,
                          padding: '6px',
                          fontSize: '0.9rem',
                          background: 'linear-gradient(45deg, var(--primary), var(--secondary))'
                        }}>
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineSquadInvite(invite)}
                        className="btn"
                        style={{
                          flex: 1,
                          padding: '6px',
                          fontSize: '0.9rem',
                          background: 'transparent',
                          border: '1px solid var(--error)',
                          color: 'var(--error)'
                        }}>
                        Decline
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Map */}
          <div className="map-container">
            <img
              ref={mapImageRef}
              src="/Beatherder Map.png"
              alt="Map"
              className="map-image"
              onLoad={resizeCanvas}
            />
            <canvas
              ref={canvasRef}
              className="map-canvas"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              // onClick={handleCanvasClick} // Removed in favor of Pointer events
              style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default') }}
            />

            {/* CLUSTERED MARKERS (Me + Friends) */}
            {(() => {
              // 1. Gather all visible squad members (Me + Friends in Squad)
              const visibleMembers: UserData[] = [];

              // Me (if enabled)
              if (userData && userData.location && !(userData.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now())) {
                visibleMembers.push(userData);
              }

              // Friends (in squad, not ghost)
              if (!devMapFilterDuration) {
                const visibleFriends = friendsData.filter(f => !!f.location && f.squadId === userData?.squadId && !(f.ghostMode && f.ghostModeExpiry && f.ghostModeExpiry > Date.now()));
                visibleMembers.push(...visibleFriends);
              }

              // 2. Cluster them
              const clusters = clusterUsers(visibleMembers, 0.05); // 5% threshold

              // 3. Render Clusters
              return clusters.map((cluster) => {
                const key = cluster.users.map(u => u.uid).join('-');

                // --- SINGLE MARKER ---
                if (cluster.users.length === 1) {
                  const u = cluster.users[0];
                  const isMe = u.uid === userData?.uid;
                  return (
                    <div key={u.uid} className="user-marker"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMember(u);
                        setSelectedMemberContext('squad');
                        setActiveModal('member');
                      }}
                      style={{
                        left: `${Math.max(0, Math.min(100, cluster.centroid.x * 100))}%`,
                        top: `${Math.max(0, Math.min(100, cluster.centroid.y * 100))}%`,
                        zIndex: isMe ? 20 : 10,
                        cursor: 'pointer'
                      }}>
                      <img src={u.photoURL || "/default-avatar.png"} className="marker-avatar" alt={u.displayName} />
                      {u.ghostMode && u.ghostModeExpiry && u.ghostModeExpiry > Date.now() && (
                        <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '20px' }}>👻</div>
                      )}
                      <div className="marker-label">{isMe ? 'You' : u.displayName?.split(' ')[0]}</div>
                    </div>
                  );
                }

                // --- PAIR MARKER (50/50 Split) ---
                if (cluster.users.length === 2) {
                  const u1 = cluster.users[0];
                  const u2 = cluster.users[1];
                  const name1 = (u1.uid === userData?.uid) ? 'You' : u1.displayName?.split(' ')[0];
                  const name2 = (u2.uid === userData?.uid) ? 'You' : u2.displayName?.split(' ')[0];

                  return (
                    <div key={key} className="user-marker"
                      onClick={(e) => { e.stopPropagation(); handleClusterClick(cluster.users); }}
                      style={{
                        left: `${Math.max(0, Math.min(100, cluster.centroid.x * 100))}%`,
                        top: `${Math.max(0, Math.min(100, cluster.centroid.y * 100))}%`,
                        zIndex: 30,
                        cursor: 'pointer'
                      }}>
                      <div className="marker-avatar" style={{
                        position: 'relative',
                        overflow: 'hidden',
                        background: '#333',
                        padding: 0
                      }}>
                        <img src={u1.photoURL || "/default-avatar.png"} style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', objectFit: 'cover' }} />
                        <img src={u2.photoURL || "/default-avatar.png"} style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', objectFit: 'cover' }} />
                        {/* Divider line */}
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'white' }}></div>
                      </div>
                      <div className="marker-label" style={{ whiteSpace: 'nowrap' }}>{name1} & {name2}</div>
                    </div>
                  );
                }

                // --- GROUP MARKER (3+ People) ---
                // Quadrants: 3 pics + Plus symbol
                const displayUsers = cluster.users.slice(0, 3);

                return (
                  <div key={key} className="user-marker"
                    onClick={(e) => { e.stopPropagation(); handleClusterClick(cluster.users); }}
                    style={{
                      left: `${Math.max(0, Math.min(100, cluster.centroid.x * 100))}%`,
                      top: `${Math.max(0, Math.min(100, cluster.centroid.y * 100))}%`,
                      zIndex: 40,
                      cursor: 'pointer'
                    }}>
                    <div className="marker-avatar" style={{
                      position: 'relative',
                      overflow: 'hidden',
                      background: '#333',
                      padding: 0,
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gridTemplateRows: '1fr 1fr'
                    }}>
                      {/* TL */}
                      <img src={displayUsers[0]?.photoURL || "/default-avatar.png"} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {/* TR */}
                      <img src={displayUsers[1]?.photoURL || "/default-avatar.png"} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {/* BL */}
                      <img src={displayUsers[2]?.photoURL || "/default-avatar.png"} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {/* BR (Plus) */}
                      <div style={{ width: '100%', height: '100%', background: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '10px' }}>
                        +
                      </div>
                    </div>
                    <div className="marker-label">Squad</div>
                  </div>
                );

              });
            })()}

            {/* Dev Mode: All Users Markers */}
            {devMapFilterDuration && allUsersOnMap.map(u => {
              if (!u.location) return null;
              const isFriend = friendsData.some(f => f.uid === u.uid);
              const isMe = u.uid === userData?.uid;
              let borderColor = '#999'; // Default
              if (isMe) borderColor = 'var(--primary)';
              else if (isFriend) borderColor = 'var(--secondary)';

              return (
                <div key={u.uid} className="user-marker" style={{
                  left: `${Math.max(0, Math.min(100, u.location.x * 100))}%`,
                  top: `${Math.max(0, Math.min(100, u.location.y * 100))}%`
                }}>
                  <img
                    src={u.photoURL || "/default-avatar.png"}
                    className="marker-avatar"
                    alt={u.displayName}
                    style={{ borderColor }}
                  />
                  <div className="marker-label" style={{ fontSize: '0.6rem' }}>{u.displayName?.split(' ')[0]}</div>
                </div>
              );
            })}

          </div>

          {/* Check In / Vote Button */}
          <div style={{ padding: '0 4px', marginBottom: '1rem' }}>
            {
              selectedAreaForVote ? (
                <button onClick={() => startVote(selectedAreaForVote)}
                  className="btn w-full"
                  style={{
                    background: 'linear-gradient(45deg, #ff0080, #7928ca)',
                    padding: '16px',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    borderRadius: '12px',
                    boxShadow: '0 4px 15px rgba(255, 0, 128, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    color: 'white'
                  }}
                >
                  <FaUserFriends size={22} />
                  Vote we go to {selectedAreaForVote.name}
                </button >
              ) : (
                <button onClick={() => {
                  if (userData?.useGps) {
                    if (!mapCalibration) return showAlert("Map not calibrated yet.");
                    if (!navigator.geolocation) return showAlert("GPS not supported.");

                    setGpsRefreshButtonText('Searching for GPS...');

                    navigator.geolocation.getCurrentPosition(async (pos) => {
                      const { latitude, longitude } = pos.coords;
                      const { north, south, east, west } = mapCalibration;
                      let x = (longitude - west) / (east - west);
                      let y = (north - latitude) / (north - south);


                      const newPoint = { x, y };

                      // Determine which area the user is in
                      let foundArea: Area | null = null;
                      for (const area of areas) {
                        if (isPointInPolygon(newPoint, area.polygon)) {
                          foundArea = area;
                          break;
                        }
                      }

                      const areaName = foundArea ? foundArea.name : 'Out of bounds';

                      try {
                        const updateData: any = {
                          location: newPoint,
                          lastUpdate: Date.now(),
                          currentArea: areaName
                        };

                        // Update lastKnownArea if not in Out of bounds
                        if (areaName !== 'Out of bounds') {
                          updateData.lastKnownArea = areaName;
                        }

                        await updateDoc(getUserDocRef(userData!.uid), updateData);
                        setGpsRefreshButtonText('GPS Location Updated');
                        setTimeout(() => setGpsRefreshButtonText(null), 1200);
                      } catch (e) {
                        console.error(e);
                        setGpsRefreshButtonText('Failed to update');
                        setTimeout(() => setGpsRefreshButtonText(null), 1200);
                      }
                    }, (err) => {
                      showAlert("GPS Error: " + err.message);
                      setGpsRefreshButtonText(null);
                    }, { enableHighAccuracy: true });
                  } else {
                    selectedAreaForCheckIn ? handleManualCheckIn(selectedAreaForCheckIn) : setActiveModal('checkIn');
                  }
                }}
                  className="btn btn-primary w-full"
                  style={{
                    background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                    padding: '16px',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    borderRadius: '12px',
                    boxShadow: '0 4px 15px rgba(3, 218, 198, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px'
                  }}
                >
                  <FaMapMarkerAlt size={22} />
                  {gpsRefreshButtonText || (userData?.useGps
                    ? (gpsHasLocation ? "Using Live GPS" : "Searching for GPS...")
                    : (selectedAreaForCheckIn ? `Check in to ${selectedAreaForCheckIn.name} ` : `Check In`))}
                </button>
              )}
          </div >



          {/* Payment Pending Widget */}
          {
            userData?.isPaymentPending && !activeModal && (
              <div style={{
                position: 'absolute',
                top: '70px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                backgroundColor: '#333',
                border: '2px solid var(--primary)',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                width: '80%',
                maxWidth: '300px'
              }}>
                <div className="spinner" style={{ width: '24px', height: '24px', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                <span style={{ fontWeight: 'bold' }}>Checking Payment...</span>
                <p style={{ fontSize: '0.8rem', color: '#aaa', textAlign: 'center', margin: 0 }}>
                  Waiting for confirmation from payment provider.
                </p>
                {/* Only show cancel if WE are not currently processing a success url params flow, or if it's been a while? 
                   Actually, if they are seeing this and NO success modal is up, they are stuck.
               */}
                <button onClick={clearPendingPayment} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                  Cancel / Close
                </button>
              </div>
            )
          }

          {renderVoteWidget()}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list horizontal" style={{ display: 'flex', overflowX: 'auto', gap: '8px', paddingBottom: '8px' }}>
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid}
                    className={`card ${member.uid === currentUser.uid ? 'current-user' : ''} `}
                    onClick={() => { setSelectedMember(member); setSelectedMemberContext('squad'); setActiveModal('member'); }}
                    style={{
                      minWidth: '200px',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      position: 'relative',
                      gap: '4px',
                      // Highlight style
                      border: highlightedUids.includes(member.uid) ? '2px solid var(--primary)' : undefined,
                      boxShadow: highlightedUids.includes(member.uid) ? '0 0 15px var(--primary)' : undefined,
                      transform: highlightedUids.includes(member.uid) ? 'scale(1.02)' : undefined,
                      transition: 'all 0.3s ease'
                    }}>
                    {member.uid === currentUser.uid && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveModal('updateStatus'); }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          color: 'var(--text-primary)',
                          borderRadius: '50%',
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          zIndex: 10
                        }}
                      >
                        <FaPencilAlt size={12} />
                      </button>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <img src={member.photoURL!} className="avatar" alt="Avatar" />
                      <div>
                        <span>{leaderUid === member.uid && '👑 '}{member.displayName}</span>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.8rem', marginTop: '-4px', marginBottom: '0' }}>
                      {(member.ghostMode && member.ghostModeExpiry && member.ghostModeExpiry > Date.now()) ?
                        <span style={{ color: 'var(--text-muted)' }}>Ghost Mode 👻</span> :
                        (member.currentArea === 'The Wilds' ?
                          <>
                            Last Seen <span className="location-tag">{member.lastKnownArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                              ({(() => {
                                const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                if (diff < 90) return `${Math.floor(diff)}m ago`;
                                return `${Math.floor(diff / 60)}h ago`;
                              })()})
                            </span>
                          </> :
                          <>
                            Location: <span className="location-tag">{member.currentArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                              ({(() => {
                                const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                if (diff < 90) return `${Math.floor(diff)}m ago`;
                                return `${Math.floor(diff / 60)}h ago`;
                              })()})
                            </span>
                          </>
                        )
                      }
                    </p>
                    {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < 12 * 60 * 60 * 1000) && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--primary)', marginTop: '0', fontStyle: 'italic', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        "{member.statusMessage}"
                      </p>
                    )}
                  </div>
                ));
            })()}

            {(() => {
              const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
              return pendingInvites.map(invite => {
                const friend = friendsData.find(f => f.uid === invite.to);
                return (
                  <div key={invite.id} className="card" style={{
                    minWidth: '200px',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    opacity: 0.9,
                    border: '1px dashed #ffc107',
                    background: 'rgba(255, 193, 7, 0.05)',
                    padding: '12px'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {friend?.photoURL ? (
                          <img src={friend.photoURL} className="avatar" style={{ border: '1px solid #ffc107', width: '35px', height: '35px' }} alt="Avatar" />
                        ) : (
                          <div className="avatar" style={{ background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ffc107', color: '#ffc107' }}>?</div>
                        )}
                        <span style={{ fontWeight: 'bold' }}>{friend?.displayName || getDisplayNameByUid(invite.to)}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', margin: 0, color: '#ffc107' }}>
                        Invited...
                      </p>
                    </div>

                    <button
                      className="btn btn-danger"
                      style={{
                        padding: '0',
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(207, 102, 121, 0.2)',
                        border: '1px solid var(--error)',
                        borderRadius: '8px'
                      }}
                      onClick={(e) => { e.stopPropagation(); handleWithdrawSquadInvite(invite); }}
                      title="Withdraw Invite"
                    >
                      <FaTimes size={16} />
                    </button>
                  </div>
                );
              });
            })()}

            {/* Add First Friend Button (If 0 Friends) */}
            {friendsData.length === 0 && (
              <div
                className="card"
                onClick={() => setActiveModal('addFriend')}
                style={{
                  minWidth: '85px',
                  padding: '12px 0',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: 'rgba(3, 218, 198, 0.1)',
                  border: '1px dashed #03dac6',
                  color: '#03dac6',
                  gap: '4px'
                }}>
                <FaUserFriends size={20} />
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>Add first<br />friend</span>
              </div>
            )}

            {/* Invite Button for Squad Leaders */}
            {getSquadLeaderUid() === userData?.uid && friendsData.length > 0 && (
              <div
                className="card"
                onClick={() => setActiveModal('inviteToSquad')}
                style={{
                  minWidth: '85px',
                  padding: '12px 0',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px dashed #444',
                  color: 'var(--text-muted)',
                  gap: '2px'
                }}>
                <FaUserFriends size={20} />
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Invite</span>
                <span style={{ fontSize: '0.65rem' }}>
                  {(() => {
                    const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                    const limit = TIER_LIMITS[tier];
                    const currentMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
                    const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
                    const usedFriendSpots = (currentMembers.length - 1) + pendingInvites.length;
                    const remaining = Math.max(0, limit - usedFriendSpots);
                    return `${remaining} left`;
                  })()}
                </span>
              </div>
            )}
          </div>






        </>
      )
    }

    if (activeTab === 'friends') {
      return (
        <>
          <header>
            <Link to="/about" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>Herd Search</Link>
            <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
              {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
            </div>
          </header>
          {(incomingFriendRequests.length > 0 || incomingSquadInvites.length > 0) && (
            <>
              <h2 className="section-title">Requests</h2>
              {/* Incoming Requests */}
              {incomingFriendRequests.map(req => (
                <div key={req.id} className="card">
                  <div>
                    <strong>{getDisplayNameByUid(req.from)}</strong> wants to be friends.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAcceptFriendRequest(req)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                    <button onClick={() => handleDeclineFriendRequest(req)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                  </div>
                </div>
              ))}
              {incomingSquadInvites.map(invite => (
                <div key={invite.id} className="card">
                  <div>
                    <strong>{getDisplayNameByUid(invite.from)}</strong> invited you to their squad.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAcceptSquadInvite(invite)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                    <button onClick={() => handleDeclineSquadInvite(invite)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Outgoing Requests */}
          {outgoingFriendRequests.length > 0 && <h3 className="section-subtitle">Sent</h3>}
          {outgoingFriendRequests.map(req => {
            const canRevoke = (Date.now() - (req.createdAt || 0)) > 30 * 60 * 1000;
            return (
              <div key={req.id} className="card" style={{ opacity: 0.7, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span>To {getDisplayNameByUid(req.to)} (Friend Request)</span>
                  {canRevoke && (
                    <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={() => handleDeclineFriendRequest(req)}>Revoke</button>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem' }}>Pending {canRevoke ? '' : '(Can revoke in 30m)'}</span>
              </div>
            );
          })}
          {outgoingSquadInvites.map(invite => (
            <div key={invite.id} className="card" style={{ opacity: 0.7 }}>
              <span>To {getDisplayNameByUid(invite.to)} (Squad Invite)</span>
              <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={() => handleWithdrawSquadInvite(invite)}>Withdraw</button>
            </div>
          ))}

          {(incomingFriendRequests.length === 0 && incomingSquadInvites.length === 0 && outgoingFriendRequests.length === 0 && outgoingSquadInvites.length === 0) && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1rem', fontStyle: 'italic' }}>No pending requests.</p>
          )}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list">
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid} className={`card ${member.uid === currentUser.uid ? 'current-user' : ''} `} onClick={() => { setSelectedMember(member); setSelectedMemberContext('squad'); setActiveModal('member'); }}>
                    <img src={member.photoURL!} className="avatar" alt="Avatar" />
                    <div>
                      <h3>
                        {leaderUid === member.uid && '👑 '}
                        {member.displayName}
                      </h3>
                      <p style={{ fontSize: '0.8rem', marginTop: '0.2rem', marginBottom: '0' }}>
                        {(member.ghostMode && member.ghostModeExpiry && member.ghostModeExpiry > Date.now()) ?
                          <span style={{ color: 'var(--text-muted)' }}>Ghost Mode 👻</span> :
                          (member.currentArea === 'The Wilds' ?
                            <>
                              Last Seen <span className="location-tag">{member.lastKnownArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                                ({(() => {
                                  const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                  if (diff < 2) return "Right Now";
                                  if (diff < 90) return `${Math.floor(diff)}m ago`;
                                  return `${Math.floor(diff / 60)}h ago`;
                                })()})
                              </span>
                            </> :
                            <>
                              Location: <span className="location-tag">{member.currentArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                                ({(() => {
                                  const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                  if (diff < 2) return "Right Now";
                                  if (diff < 90) return `${Math.floor(diff)}m ago`;
                                  return `${Math.floor(diff / 60)}h ago`;
                                })()})
                              </span>
                            </>
                          )
                        }
                      </p>
                      {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < 12 * 60 * 60 * 1000) && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '0', fontStyle: 'italic' }}>
                          "{member.statusMessage}" <span style={{ color: '#666' }}>
                            ({(() => {
                              const diff = (Date.now() - (member.statusTimestamp || 0)) / 60000;
                              if (diff < 2) return "Right Now";
                              if (diff < 90) return `${Math.floor(diff)}m ago`;
                              return `${Math.floor(diff / 60)}h ago`;
                            })()})
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                ));
            })()}



            {/* Only allow adding friends if they are the leader */}
            {getSquadLeaderUid() === userData?.uid && (
              <div className="card" onClick={() => setActiveModal('inviteToSquad')} style={{ cursor: 'pointer', justifyContent: 'center' }}>
                <h3>+ Invite Friends to Squad</h3>
              </div>
            )}

            {/* Leave Squad Button for members (not owner) */}
            {userData?.squadId && userData?.squadOwnerId !== userData?.uid && (
              <button onClick={handleLeaveSquad} className="btn btn-danger w-full mt-4" style={{ border: '1px solid var(--error)', background: 'transparent' }}>
                Leave Squad
              </button>
            )}
          </div>

          <h2 style={{ paddingTop: '1rem' }} className="section-title">All Friends</h2>
          <div className="squad-list">
            {friendsData.map(friend => (
              <div key={friend.uid} className="card" onClick={() => { setSelectedMember(friend); setSelectedMemberContext('friend'); }}>
                <img src={friend.photoURL || "/default-avatar.png"} className="avatar" alt="Avatar" />
                <div>
                  <h3>{friend.displayName}</h3>
                  <p><FriendStatus friend={friend} mySquadId={userData?.squadId} /></p>
                </div>
              </div>
            ))}
            {/* Reuse the Invite Friends modal logic to add new friends via email */}
            <div className="card" onClick={() => setActiveModal('addFriend')} style={{ cursor: 'pointer', justifyContent: 'center', marginTop: '1rem', borderStyle: 'dashed' }}>
              <p>+ Add Friend by Email</p>
            </div>
          </div>
        </>
      )
    }



    if (activeTab === 'profile') {
      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
      return (
        <>
          <header>
            <div className="logo">Profile</div>
            {userData?.isDev && (
              <div className="user-controls" onClick={() => setActiveModal('settings')} style={{ cursor: 'pointer' }}>
                <FaCog size={24} color="var(--text-muted)" />
              </div>
            )}
          </header>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
            {userData?.photoURL && <img className="avatar-large" src={userData.photoURL} alt="Profile" />}
            <h1 style={{ margin: '0.5rem 0' }}>{userData?.displayName}</h1>
            <p style={{ color: 'var(--text-muted)' }}>{userData?.email}</p>

            <div style={{ marginTop: '2rem', width: '100%', borderTop: '1px solid #33333310', paddingTop: '1rem' }}>
              <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', width: '100%', boxSizing: 'border-box' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>💎</span>
                    <strong>Current Plan</strong>
                  </div>
                  <span style={{
                    background: 'rgba(187, 134, 252, 0.1)',
                    color: 'var(--primary)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    fontSize: '0.8rem'
                  }}>{tier}</span>
                </div>
                <p style={{ width: '100%', boxSizing: 'border-box' }}>
                  {tier === 'free' && "You are on the Free Tier. You can join squads but cannot create your own."}
                  {tier !== 'free' && `You can invite up to ${TIER_LIMITS[tier]} friends to your squad.`}
                </p>
              </div>

              {tier !== 'festival' && (
                <>
                  <button
                    onClick={() => setActiveModal('upgrade')}
                    className="btn btn-primary w-full"
                    disabled={!upgradesEnabled && !userData?.isDev}
                    style={{
                      background: (!upgradesEnabled && !userData?.isDev) ? '#555' : 'linear-gradient(45deg, var(--primary), var(--secondary))',
                      marginBottom: '1rem',
                      cursor: (!upgradesEnabled && !userData?.isDev) ? 'not-allowed' : 'pointer',
                      opacity: (!upgradesEnabled && !userData?.isDev) ? 0.7 : 1
                    }}>
                    {(!upgradesEnabled && !userData?.isDev) ? "Upgrades Paused 🚧" : "Upgrade Plan ⚡"}
                  </button>




                </>
              )}
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />

              {/* Live Location Toggle */}
              <div
                className="card"
                onClick={async () => {
                  const newValue = !(userData?.useGps ?? true);
                  if (newValue) {
                    setGpsError(null); // Clear error when turning GPS back on
                    setGpsTimeoutCount(0); // Reset timeout counter
                    setGpsHasLocation(false); // Reset location flag
                  } else {
                    setGpsHasLocation(false); // Clear location flag when turning off
                  }
                  await handleGpsToggle(newValue);
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '1rem',
                  marginBottom: '1rem',
                  background: (userData?.useGps ?? true) ? 'rgba(3, 218, 198, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                  border: (userData?.useGps ?? true) ? '1px solid rgba(3, 218, 198, 0.3)' : '1px solid #333',
                  borderRadius: '12px',
                  transition: 'all 0.3s ease'
                }}
              >
                <div style={{ marginRight: '1rem', fontSize: '1.5rem' }}>📍</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, color: (userData?.useGps ?? true) ? '#03dac6' : 'white' }}>
                    Live Location
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                    {(userData?.useGps ?? true)
                      ? "Active: Your location updates live as you move."
                      : "Tap to enable automatic GPS tracking."}
                  </p>
                  {gpsError && !userData?.useGps && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#ff6b6b' }}>
                      {gpsError}
                    </p>
                  )}
                </div>
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  backgroundColor: (userData?.useGps ?? true) ? '#03dac6' : '#333',
                  border: '1px solid #555'
                }} />
              </div>

              {/* Ghost Mode Toggle */}
              {(() => {
                const isGhostActive = userData?.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now();
                const cooldownRemaining = (userData?.ghostModeCooldown || 0) - Date.now();
                const isInCooldown = !isGhostActive && cooldownRemaining > 0;

                return (
                  <div
                    className="card"
                    style={{
                      cursor: (tempDisableGhostBtn || isInCooldown) ? 'not-allowed' : 'pointer',
                      opacity: (tempDisableGhostBtn || isInCooldown) ? 0.6 : 1,
                      backgroundColor: isGhostActive ? '#333' : '#1e1e1e',
                      border: isGhostActive ? '2px solid #03dac6' : '1px solid #333',
                      alignItems: 'center',
                      marginBottom: '1rem'
                    }}
                    onClick={async () => {
                      if (tempDisableGhostBtn) return;
                      const now = Date.now();

                      if (isInCooldown) {
                        return showAlert(`Ghost mode is cooling down. Try again in ${Math.ceil(cooldownRemaining / 60000)} minutes.`);
                      }

                      if (!isGhostActive) {
                        // Turning ON
                        setTempDisableGhostBtn(true);
                        // Delay actual activation by 5 seconds
                        setTimeout(async () => {
                          try {
                            await updateDoc(getUserDocRef(currentUser!.uid), {
                              ghostMode: true,
                              ghostModeExpiry: Date.now() + 3600000,
                              ghostModeCooldown: null
                            });
                            setTempDisableGhostBtn(false);
                          } catch (err) { console.error(err); setTempDisableGhostBtn(false); }
                        }, 5000);
                      } else {
                        // Turning OFF -> Immediate disable + Cooldown
                        setTempDisableGhostBtn(true); // Short disable preventing double tap
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), {
                            ghostMode: false,
                            ghostModeExpiry: null,
                            ghostModeCooldown: now + 600000 // 10 mins
                          });
                          setTimeout(() => setTempDisableGhostBtn(false), 1000);
                        } catch (err) { console.error(err); setTempDisableGhostBtn(false); }
                      }
                    }}
                  >
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem' }}>👻</div>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: 0, color: isGhostActive ? '#03dac6' : 'white' }}>
                        {tempDisableGhostBtn && !isGhostActive ? 'Turning on Ghost Mode...' : (isInCooldown ? `Cooldown (${Math.ceil(cooldownRemaining / 60000)}m)` : 'Ghost Mode')}
                      </h3>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                        {tempDisableGhostBtn && !isGhostActive
                          ? "Activating..."
                          : (isInCooldown
                            ? "Recharging..."
                            : (isGhostActive ? "Active: You are hidden from the map." : "Tap to mask your location for 1 hour."))}
                      </p>
                    </div>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      backgroundColor: isGhostActive ? '#03dac6' : '#333',
                      border: '1px solid #555'
                    }} />
                  </div>
                );
              })()}
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />


              {/* WRAPPED SECTION */}
              <div style={{ width: '100%', marginTop: '20px' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaClock color="#fdbb2d" /> Wrapped
                </h3>

                {/* Festival Wrapped Button/Placeholder */}
                {festivalWrappedAvailable ? (
                  <button
                    onClick={handleOpenFestivalWrapped}
                    className="card"
                    style={{
                      width: '100%',
                      marginBottom: '15px',
                      background: 'linear-gradient(135deg, #fdbb2d 0%, #ff6b6b 50%, #b21f1f 100%)',
                      border: 'none',
                      justifyContent: 'center',
                      padding: '20px',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      boxShadow: '0 4px 15px rgba(253, 187, 45, 0.3)'
                    }}
                  >
                    <span style={{ fontWeight: '900', fontSize: '1.3rem', color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                      🎉 FESTIVAL WRAPPED 🎁
                    </span>
                  </button>
                ) : (
                  <div
                    className="card"
                    style={{
                      width: '100%',
                      marginBottom: '15px',
                      background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                      border: '2px dashed #444',
                      justifyContent: 'center',
                      padding: '20px',
                      opacity: 0.6
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔒</div>
                      <span style={{ fontWeight: '600', fontSize: '1.1rem', color: '#666' }}>
                        Festival Wrapped
                      </span>
                      <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '4px' }}>
                        Available Mon-Wed
                      </div>
                    </div>
                  </div>
                )}

                {/* Daily Wrapped Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {/* Map through all festival days */}
                  {['Thursday', 'Friday', 'Saturday', 'Sunday'].map((dayName, index) => {
                    // Find if we have data for this day
                    const dayDate = wrappedDays.find(date => {
                      const d = new Date(date);
                      return d.toLocaleDateString(undefined, { weekday: 'long' }) === dayName;
                    });

                    const hasData = !!dayDate;
                    const isMonOrTue = new Date().getDay() === 1 || new Date().getDay() === 2;
                    const shouldHide = isMonOrTue; // Hide daily on Mon/Tue when festival wrapped is available

                    // Don't render if we should hide
                    if (shouldHide) return null;

                    // Gradient colors for each day
                    const dayGradients = [
                      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Thursday - Purple
                      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // Friday - Pink
                      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // Saturday - Blue
                      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'  // Sunday - Green
                    ];

                    const dayEmojis = ['🎸', '🎤', '🎵', '🎶'];

                    if (hasData) {
                      return (
                        <button
                          key={dayName}
                          onClick={() => handleOpenWrapped(dayDate)}
                          className="card"
                          style={{
                            padding: '16px',
                            background: dayGradients[index],
                            border: 'none',
                            flexDirection: 'column',
                            alignItems: 'center',
                            cursor: 'pointer',
                            position: 'relative',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                            transition: 'transform 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{dayEmojis[index]}</div>
                          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: '600', textTransform: 'uppercase' }}>
                            {dayName.substring(0, 3)}
                          </span>
                          <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
                            Wrapped
                          </span>
                        </button>
                      );
                    } else {
                      return (
                        <div
                          key={dayName}
                          className="card"
                          style={{
                            padding: '16px',
                            background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                            border: '2px dashed #444',
                            flexDirection: 'column',
                            alignItems: 'center',
                            opacity: 0.5
                          }}
                        >
                          <div style={{ fontSize: '2rem', marginBottom: '8px', opacity: 0.4 }}>🔒</div>
                          <span style={{ fontSize: '0.75rem', color: '#555', fontWeight: '600', textTransform: 'uppercase' }}>
                            {dayName.substring(0, 3)}
                          </span>
                          <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#444' }}>
                            Locked
                          </span>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>


              {/* Support Buttons */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                <button
                  onClick={() => setActiveModal('install')}
                  className="btn btn-secondary"
                  style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px' }}
                >
                  <span>📱</span> Install App
                </button>

                <button
                  onClick={() => navigate('/about')}
                  className="btn btn-secondary"
                  style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px' }}
                >
                  <span>ℹ️</span> About App
                </button>
              </div>

              <button
                onClick={() => setActiveModal('support')}
                className="btn btn-secondary w-full"
                style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
              >
                <span>💬</span> Contact Support
              </button>

              {/* Admin Only: View All Tickets */}
              {userData?.isDev && (
                <>
                  <button
                    onClick={() => navigate('/admin/support')}
                    className="btn btn-secondary w-full"
                    style={{ marginBottom: '1rem', border: '1px solid var(--primary)', color: 'var(--primary)' }}
                  >
                    <span>🛡️</span> Manage Support Tickets
                  </button>

                </>
              )}

            </div>



            <button onClick={() => signOut()} className="btn btn-danger w-full" style={{ backgroundColor: 'transparent', border: '1px solid var(--error)' }}>Sign Out</button>
            <div style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />
              <Link to="/terms" style={{ paddingTop: '0.1rem', color: '#888', textDecoration: 'none' }}>Terms of Service</Link>
            </div>
            <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666' }}>
            </div>
          </div>

          {/* Support System Rendering */}
          {(activeModal === 'support') && currentUser && (
            <SupportSystem
              currentUser={{
                uid: currentUser.uid,
                email: currentUser.email || undefined,
                displayName: currentUser.displayName || undefined
              }}
              visible={true}
              onClose={() => setActiveModal(null)}
              isDev={false}
            />
          )}
        </>
      )
    }

    if (activeTab === 'chat') {
      const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter(f => f.squadId === userData?.squadId).map(f => f.uid))].filter(Boolean);
      // Double check validation if they somehow got here without a squad
      if (!userData?.squadId || squadMembers.length <= 1) {
        // Redirect back to map if requirements not met
        setTimeout(() => setActiveTab('map'), 0);
        return null;
      }

      return (
        <ChatTab userData={userData} squadId={userData.squadId} />
      );
    }
  }; // End renderContent


  // 3. Open Modal Handler
  const handleOpenWrapped = async (dateStr: string) => {
    if (!userData) return;
    setIsFestivalWrapped(false);
    // Ideally show loading state
    try {
      const docRef = doc(db, 'users', userData.uid, 'dailyStats', dateStr);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        processAndShowStats(dateStr, data);

        // Update last seen
        const lastSeen = userData.lastSeenWrapped || '1970-01-01';
        const lastSeenDate = new Date(lastSeen).toISOString().split('T')[0];
        if (dateStr > lastSeenDate) {
          updateDoc(doc(db, 'users', userData.uid), { lastSeenWrapped: new Date().toISOString() });
          setNewWrappedAvailable(null);
        }
      }
    } catch (e) {
      console.error("Error opening wrapped", e);
      showAlert("Could not load stats for this day.");
    }
  };

  const handleOpenFestivalWrapped = async () => {
    if (!userData) return;
    setIsFestivalWrapped(true);

    // Aggregate Thursday, Friday, Saturday, Sunday (festival days)
    // Assume festival is the most recent weekend
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    // Calculate how many days back to the most recent Thursday
    let daysBackToThursday = 0;
    if (currentDay === 0) daysBackToThursday = 3; // Sunday -> Thursday
    else if (currentDay === 1) daysBackToThursday = 4; // Monday -> Thursday
    else if (currentDay === 2) daysBackToThursday = 5; // Tuesday -> Thursday
    else if (currentDay === 3) daysBackToThursday = 6; // Wednesday -> Thursday
    else if (currentDay === 4) daysBackToThursday = 0; // Thursday
    else if (currentDay === 5) daysBackToThursday = 1; // Friday -> Thursday
    else if (currentDay === 6) daysBackToThursday = 2; // Saturday -> Thursday

    // Get the dates for Thu, Fri, Sat, Sun
    const festivalDates: string[] = [];
    for (let i = 0; i < 4; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysBackToThursday + i);
      // Apply the 6-hour shift for festival dating
      date.setHours(date.getHours() - 6);
      festivalDates.push(date.toISOString().split('T')[0]);
    }

    const aggregated: any = {
      totalTimeActiveMs: 0,
      areasVisited: {},
      friendsProximity: {}
    };

    try {
      // Fetch each festival day's stats
      for (const dateStr of festivalDates) {
        const docRef = doc(db, 'users', userData.uid, 'dailyStats', dateStr);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();
          aggregated.totalTimeActiveMs += (data.totalTimeActiveMs || 0);

          // Merge Areas
          Object.entries(data.areasVisited || {}).forEach(([key, val]) => {
            aggregated.areasVisited[key] = (aggregated.areasVisited[key] || 0) + (val as number);
          });

          // Merge Friends
          Object.entries(data.friendsProximity || {}).forEach(([key, val]) => {
            aggregated.friendsProximity[key] = (aggregated.friendsProximity[key] || 0) + (val as number);
          });
        }
      }

      processAndShowStats("Festival Wrapped", aggregated);

    } catch (e) {
      console.error("Error loading festival stats", e);
    }
  };

  const processAndShowStats = (label: string, data: any) => {
    const areasList = Object.entries(data.areasVisited || {})
      .map(([name, time]) => ({ name: name.replace(/_/g, '.'), timeMs: time as number }))
      .sort((a, b) => b.timeMs - a.timeMs);

    const friendsList = Object.entries(data.friendsProximity || {})
      .map(([uid, time]) => ({ uid, timeMs: time as number }))
      .sort((a, b) => b.timeMs - a.timeMs);

    setSelectedWrappedStats({
      date: label,
      topAreas: areasList,
      topFriends: friendsList,
      totalTimeActiveMs: data.totalTimeActiveMs || 0
    });
    setShowWrappedModal(true);
  };

  return (
    <div className="app-container">
      {showSplash && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#121212',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          animation: 'fadeOut 0.5s ease-out 2s forwards' // Fades out not just vanishes
        }}>
          <img src="/logo-flash.png" alt="Splash" style={{ width: '120px', height: 'auto', objectFit: 'contain' }} />
        </div>
      )}
      {renderContent()}

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          <FaMap />
          <span>Map</span>
        </button>

        {/* Chat Tab - Only visible if in a squad with > 1 person */}
        {(() => {
          const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter(f => f.squadId === userData?.squadId).map(f => f.uid))].filter(Boolean);
          if (userData?.squadId && squadMembers.length > 1) {
            return (
              <button className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')} style={{ position: 'relative' }}>
                <FaComments />
                <span>Chat</span>
                {hasUnreadChat && (
                  <div style={{
                    position: 'absolute',
                    top: '3px',
                    left: 'calc(50% - 22px)',
                    width: '8px',
                    height: '8px',
                    backgroundColor: 'var(--error)',
                    borderRadius: '50%',
                    border: '1px solid #121212'
                  }} />
                )}
              </button>
            );
          }
          return null;
        })()}

        <button className={`nav-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')} style={{ position: 'relative' }}>
          <FaUserFriends />
          <span>Friends</span>
          {(incomingFriendRequests.length > 0 || incomingSquadInvites.length > 0) && (
            <div style={{
              position: 'absolute',
              top: '3px',
              left: 'calc(50% - 22px)',
              width: '8px',
              height: '8px',
              backgroundColor: 'var(--error)',
              borderRadius: '50%',
              border: '1px solid #121212'
            }} />
          )}
        </button>

        <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <FaUser />
          <span>Profile</span>
          {/* Notification Dot for Profile */}
          {newWrappedAvailable && <div style={{ position: 'absolute', top: 5, right: '35%', width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', border: '1px solid black' }} />}
        </button>

      </nav>

      {/* Modals */}
      {
        selectedMember && (
          <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div style={{ textAlign: 'center' }}>
                <img src={selectedMember.photoURL!} alt="Avatar" className="avatar" style={{ width: 80, height: 80, marginBottom: '1rem' }} />
                <h2>{selectedMember.displayName}</h2>
                {selectedMemberContext !== 'friend' && <p>{selectedMember.currentArea || "Unknown Location"}</p>}

                {/* Status Update for Self */}
                {selectedMember.uid === userData?.uid && (
                  <div style={{ marginTop: '1rem', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                      <input
                        type="text"
                        id="statusInputSelf"
                        placeholder="What's on your mind?"
                        className="input-field"
                        style={{ flex: 1, height: '44px', boxSizing: 'border-box' }}
                        value={currentStatusInput}
                        onChange={(e) => setCurrentStatusInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value;
                            try {
                              await updateDoc(getUserDocRef(currentUser!.uid), {
                                statusMessage: val,
                                statusTimestamp: Date.now()
                              });
                              showAlert("Status updated!");

                              // Send to Chat
                              if (userData.squadId) {
                                addDoc(collection(db, "squads", userData.squadId, "messages"), {
                                  senderId: currentUser.uid,
                                  senderName: userData.displayName || 'Unknown',
                                  senderPhotoURL: userData.photoURL || '',
                                  content: val,
                                  type: 'status_update',
                                  createdAt: Date.now()
                                }).catch(console.error);
                              }

                              setSelectedMember(null);
                            } catch (err) { console.error(err); showAlert("Error updating status. Check permissions."); }
                          }
                        }}
                      />
                      <button onClick={async () => {
                        const val = currentStatusInput;
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), {
                            statusMessage: val,
                            statusTimestamp: Date.now()
                          });
                          showAlert("Status updated!");

                          // Send to Chat
                          if (userData.squadId) {
                            addDoc(collection(db, "squads", userData.squadId, "messages"), {
                              senderId: currentUser.uid,
                              senderName: userData.displayName || 'Unknown',
                              senderPhotoURL: userData.photoURL || '',
                              content: val,
                              type: 'status_update',
                              createdAt: Date.now()
                            }).catch(console.error);
                          }

                          setSelectedMember(null);
                        } catch (err) { console.error(err); showAlert("Error updating status. Check permissions."); }
                      }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', height: '44px', boxSizing: 'border-box' }}>➜</button>
                    </div>
                  </div>
                )}

                {/* Case 1: Friend is in MY squad and I am leader -> Kick */}
                {getSquadLeaderUid() === userData?.uid && selectedMember.squadId === userData?.squadId && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => handleKickMember(selectedMember)} className="btn btn-danger w-full mt-4">Kick from Squad</button>
                )}

                {/* Case 2: Friend is NOT in MY squad (could be no squad or other squad) and I have capacity -> Invite */}
                {selectedMember.squadId !== userData?.squadId && userData?.squadId && getSquadLeaderUid() === userData?.uid && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => {
                    if (userData?.tier === 'free') {
                      setAlertMessage("Free tier users cannot invite friends to a squad. Please upgrade to create a squad.");
                      setAlertIsUpgrade(true);
                      setActiveModal('alert');
                      return;
                    }
                    setSelectedMember(null);
                    handleInviteToSquad(selectedMember.uid);
                  }} className="btn btn-primary w-full mt-4">Invite to Squad</button>
                )}



                {/* Case 3: I want to remove them from my friend list (always available if not self) - ONLY IN FRIEND CONTEXT */}
                {selectedMember.uid !== userData?.uid && selectedMemberContext === 'friend' && (
                  <button onClick={() => {
                    // Remove friend logic
                    showConfirm(`Remove ${selectedMember.displayName} from friends ? `, async () => {
                      try {
                        await updateDoc(getUserDocRef(currentUser!.uid), { friends: arrayRemove(selectedMember.uid) });
                        setSelectedMember(null);
                        showAlert("Friend removed.");
                      } catch (e) { console.error(e); }
                    });
                  }} className="btn btn-danger w-full mt-4" style={{ background: 'transparent', border: '1px solid var(--error)' }}>Remove Friend</button>
                )}

                {selectedMember.uid === userData?.uid && userData?.squadOwnerId !== userData?.uid && (
                  <button onClick={handleLeaveSquad} className="btn btn-danger w-full mt-4">Leave Squad</button>
                )}
                <button onClick={() => setSelectedMember(null)} className="btn btn-secondary w-full mt-4">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {activeModal === 'settings' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Settings</h3>

            {userData?.isDev && (
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Developer</h4>

                {/* Sandbox Mode */}
                <div className="card" onClick={() => setUseSandboxStripe(!useSandboxStripe)} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Use Sandbox Stripe Mode</span>
                  <div style={{
                    width: '40px', height: '20px', background: useSandboxStripe ? 'var(--primary)' : '#555',
                    borderRadius: '10px', position: 'relative', transition: 'background 0.3s'
                  }}>
                    <div style={{
                      width: '16px', height: '16px', background: 'white', borderRadius: '50%',
                      position: 'absolute', top: '2px', left: useSandboxStripe ? '22px' : '2px',
                      transition: 'left 0.3s'
                    }} />
                  </div>
                </div>

                {/* Show Zones */}
                <div className="card" onClick={() => setShowZones(!showZones)} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Show Zones</span>
                  <div style={{ width: '40px', height: '20px', background: showZones ? 'var(--primary)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: showZones ? '22px' : '2px', transition: 'left 0.3s' }} />
                  </div>
                </div>

                {/* Upgrades Enabled Toggle */}
                <div className="card" onClick={async () => {
                  const newValue = !upgradesEnabled;
                  setUpgradesEnabled(newValue); // Optimistic
                  try {
                    await setDoc(doc(db, 'config', 'payments'), { upgradesEnabled: newValue }, { merge: true });
                  } catch (e) { console.error(e); }
                }} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Users can Upgrade</span>
                  <div style={{ width: '40px', height: '20px', background: upgradesEnabled ? 'var(--primary)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: upgradesEnabled ? '22px' : '2px', transition: 'left 0.3s' }} />
                  </div>
                </div>

                {/* GPS Refresh Interval */}
                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '0.5rem', padding: '1rem' }}>
                  <label style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                    GPS Refresh Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={gpsRefreshInterval}
                    onChange={async (e) => {
                      const val = parseInt(e.target.value);
                      if (val >= 1 && val <= 60) {
                        setGpsRefreshInterval(val);
                        try {
                          await setDoc(doc(db, 'config', 'gps'), { refreshInterval: val });
                          console.log(`GPS refresh interval updated to ${val} seconds`);
                        } catch (err) {
                          console.error("Failed to save GPS interval:", err);
                        }
                      }
                    }}
                    className="input-field"
                    style={{ width: '100%' }}
                  />
                  <small style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    How often to update GPS location (1-60 seconds). Lower = more frequent updates.
                  </small>
                </div>

                <button onClick={() => setActiveModal('locations')} className="btn btn-secondary w-full" style={{ marginBottom: '1rem' }}>
                  Manage Locations
                </button>
                <button onClick={() => {
                  setTempCalibration(mapCalibration || { north: 0, south: 0, east: 0, west: 0 });
                  setActiveModal('calibrateGps');
                }} className="btn btn-secondary w-full" style={{ marginBottom: '1rem' }}>
                  Calibrate Map GPS
                </button>

                <button onClick={() => { setActiveModal(null); setShowDevStats(true); }} className="btn btn-secondary w-full" style={{ marginBottom: '1rem', background: '#333', border: '1px solid #555' }}>
                  View Dev Stats 📊
                </button>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--primary)' }}>Override Tier</label>
                  <select
                    className="input-field"
                    value={userData?.tier || 'free'}
                    onChange={(e) => handleUpgrade(e.target.value as Tier, true)}
                  >
                    <option value="free">Free</option>
                    {PLANS.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">Done</button>
            </div>
          </div>
        </div>
      )
      }

      {activeModal === 'calibrateGps' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Calibrate Map GPS</h3>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
              Enter coordinates manually or use GPS helper buttons.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}>Top-Left (North-West)</div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>North (Lat)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.north}
                  onChange={e => setTempCalibration({ ...tempCalibration, north: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>West (Lon)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.west}
                  onChange={e => setTempCalibration({ ...tempCalibration, west: parseFloat(e.target.value) })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={() => {
                  if (!navigator.geolocation) return showAlert("GPS not supported");
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setTempCalibration(prev => ({ ...prev, north: pos.coords.latitude, west: pos.coords.longitude }));
                  }, (err) => showAlert("GPS Error: " + err.message));
                }} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px' }}>
                  Get from Device GPS
                </button>
                <button onClick={() => setPickingLocationFor('NW')} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px', background: 'var(--primary)', color: 'black' }}>
                  Pick on Map 📍
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}>Bottom-Right (South-East)</div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>South (Lat)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.south}
                  onChange={e => setTempCalibration({ ...tempCalibration, south: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>East (Lon)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.east}
                  onChange={e => setTempCalibration({ ...tempCalibration, east: parseFloat(e.target.value) })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={() => {
                  if (!navigator.geolocation) return showAlert("GPS not supported");
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setTempCalibration(prev => ({ ...prev, south: pos.coords.latitude, east: pos.coords.longitude }));
                  }, (err) => showAlert("GPS Error: " + err.message));
                }} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px' }}>
                  Get from Device GPS
                </button>
                <button onClick={() => setPickingLocationFor('SE')} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px', background: 'var(--primary)', color: 'black' }}>
                  Pick on Map 📍
                </button>
              </div>
            </div>

            <button onClick={async () => {
              try {
                await setDoc(doc(db, 'config', 'map'), tempCalibration);
                setMapCalibration(tempCalibration); // Optimistic update
                showAlert("Calibration Saved!");
                setActiveModal(null);
              } catch (e) { console.error(e); showAlert("Failed to save."); }
            }} className="btn btn-primary w-full" style={{ marginBottom: '0.5rem' }}>Save Calibration</button>

            <button onClick={() => setActiveModal(null)} className="btn btn-secondary w-full">Close</button>
          </div>
        </div>
      )}

      {pickingLocationFor && (
        <LocationPicker
          initialLat={pickingLocationFor === 'NW' ? (tempCalibration.north || 53.9) : (tempCalibration.south || 53.9)}
          initialLon={pickingLocationFor === 'NW' ? (tempCalibration.west || -2.3) : (tempCalibration.east || -2.3)}
          onCancel={() => setPickingLocationFor(null)}
          onPick={(lat, lon) => {
            if (pickingLocationFor === 'NW') {
              setTempCalibration(prev => ({ ...prev, north: lat, west: lon }));
            } else {
              setTempCalibration(prev => ({ ...prev, south: lat, east: lon }));
            }
            setPickingLocationFor(null);
          }}
        />
      )}


      {
        activeModal === 'limitReached' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Squad Limit Reached 🛑</h3>
              <p className="text-center" style={{ marginBottom: '1.5rem' }}>
                You have reached the limit of your <strong>{hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free'}</strong> plan.
                <br />
                Upgrade to invite more users!
              </p>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Okay</button>
                <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>Upgrade Plan ⚡</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'updateStatus' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Update Status</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  id="statusInputModal"
                  placeholder="What's happening?"
                  className="input-field"
                  value={currentStatusInput}
                  onChange={(e) => setCurrentStatusInput(e.target.value)}
                  autoFocus
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      try {
                        await updateDoc(getUserDocRef(currentUser!.uid), {
                          statusMessage: val,
                          statusTimestamp: Date.now()
                        });
                        setActiveModal(null);
                        showAlert("Status updated!");
                      } catch (err) { console.error(err); showAlert("Error updating status. Check permissions/keys."); }
                    }
                  }}
                  style={{ height: '44px', boxSizing: 'border-box' }}
                />
                <button onClick={async () => {
                  const val = currentStatusInput;
                  try {
                    await updateDoc(getUserDocRef(currentUser!.uid), {
                      statusMessage: val,
                      statusTimestamp: Date.now()
                    });
                    setActiveModal(null);
                    showAlert("Status updated!");
                  } catch (e) { console.error(e); showAlert("Error updating status. Check permissions/keys."); }
                }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', height: '44px', boxSizing: 'border-box' }}>➜</button>
              </div>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }



      {
        activeModal === 'welcome' && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ textAlign: 'center' }}>
              <img src={welcomeWaveImg} alt="Welcome" style={{ width: '120px', marginBottom: '1rem' }} />
              <h2 className="modal-header">Welcome to Herd Search!</h2>
              <p>Track your friends, create a squad, and never get lost at the festival again.</p>
              <div className="modal-actions" style={{ flexDirection: 'column', gap: '8px' }}>
                <button onClick={() => { setActiveModal('addFriend'); }} className="btn btn-primary w-full">Add a Friend to Start</button>
                <button onClick={() => { setActiveModal(null); }} className="btn btn-secondary w-full">I'll do it later</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'friendRequests' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">New Friend Requests! 👥</h3>
              {incomingFriendRequests.length === 0 ? (
                <p>No new requests.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {incomingFriendRequests.map(req => (
                    <div key={req.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <div className="avatar" style={{ background: '#444', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>?</div>
                        <strong>{getDisplayNameByUid(req.from)}</strong>
                        <span style={{ fontSize: '0.8rem', color: '#888' }}> wants to be friends.</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="btn btn-primary"
                          style={{ flex: 1 }}
                          onClick={() => {
                            handleAcceptFriendRequest(req);
                            if (incomingFriendRequests.length <= 1) setActiveModal(null);
                          }}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ flex: 1, background: 'transparent', border: '1px solid var(--error)' }}
                          onClick={() => {
                            handleDeclineFriendRequest(req);
                            if (incomingFriendRequests.length <= 1) setActiveModal(null);
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary w-full">Close (Decide Later)</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'upgrade' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content wide" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">💎 Upgrade Plan</h3>
              <div className="pricing-grid">
                {useSandboxStripe && (
                  <div className="pricing-card" onClick={() => handleUpgrade('free' as Tier)}>
                    <h3>Free</h3>
                    <p className="price">£0.00</p>
                    <p style={{ margin: '10px 0', fontSize: '0.9rem' }}>Max 0 Friends in Squad (Solo)</p>
                    <button className="btn btn-primary w-full">Select Free</button>
                  </div>

                )}

                {/* Dev Test Plan - Only for Admin */}
                {currentUser?.email === 'z4kbrindle@gmail.com' && (
                  <div style={{ padding: '10px', border: '1px dashed cyan', marginBottom: '10px', borderRadius: '8px', background: 'rgba(0, 255, 255, 0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4 style={{ margin: 0, color: 'cyan' }}>Dev Tier 🛠️</h4>
                        <p style={{ margin: 0, fontSize: '0.8rem' }}>Test Plan (3 friends)</p>
                      </div>
                      <button
                        onClick={() => handleUpgrade('dev_tier_test' as Tier)}
                        className="btn btn-sm"
                        style={{ background: 'cyan', color: 'black', fontWeight: 'bold' }}
                      >
                        £0.50
                      </button>
                    </div>
                  </div>
                )}

                {PLANS.filter(p => p.id !== 'dev_tier_test' && (useSandboxStripe || p.limit > TIER_LIMITS[userData?.tier || 'free'])).map(plan => (
                  <div key={plan.id} className="pricing-card" onClick={() => handleUpgrade(plan.id as Tier)}>
                    <h3>{plan.name}</h3>
                    <div style={{ margin: '8px 0', fontSize: '1.5rem', color: 'var(--primary)', letterSpacing: '4px' }}>
                      {plan.id === 'basic' && <img src="/tier_2_people.png" alt="2 People" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                      {plan.id === 'standard' && <img src="/tier_4_people.png" alt="Squad of 4" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                      {plan.id === 'premium' && <img src="/tier_9_people.png" alt="Full Squad" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                      {plan.id === 'festival' && <img src="/tier_21_people.png" alt="Festival Group" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                      {/* Or simpler representative icons */}
                    </div>
                    <p className="price">{plan.price}</p>
                    <p style={{ margin: '10px 0', fontSize: '0.9rem' }}>Max {plan.limit} Friends in Squad</p>
                    <button className="btn btn-primary w-full" disabled={!upgradesEnabled}>
                      {!upgradesEnabled ? "Upgrades Paused 🚧" : "Select"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }


      {
        activeModal === 'checkIn' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Select Location</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                {areas.map(area => (
                  <div key={area.id} className="card" onClick={() => handleManualCheckIn(area)} style={{ cursor: 'pointer' }}>
                    {area.name}
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'locations' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Locations</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                {areas.map(area => (
                  <div key={area.id} className="card" style={{ justifyContent: 'space-between' }}>
                    <span>{area.name}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => { setRenamingArea(area); setNewAreaName(area.name); setActiveModal('renameArea') }} className="icon-button"><FaPencilAlt /></button>
                      <button onClick={() => handleDeleteArea(area.id)} className="icon-button" style={{ color: 'var(--error)' }}><FaTrash /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button onClick={() => { setActiveModal(null); setIsDevMode(true) }} className="btn btn-primary">Add New</button>
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'areaName' && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3 className="modal-header">Name Area</h3>
              <input value={areaName} onChange={e => setAreaName(e.target.value)} className="input-field" autoFocus />
              <div className="modal-actions">
                <button onClick={cancelDrawing} className="btn btn-secondary">Cancel</button>
                <button onClick={handleSaveArea} className="btn btn-primary">Save</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'renameArea' && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3 className="modal-header">Rename Area</h3>
              <input value={newAreaName} onChange={e => setNewAreaName(e.target.value)} className="input-field" autoFocus />
              <div className="modal-actions">
                <button onClick={() => setActiveModal('locations')} className="btn btn-secondary">Cancel</button>
                <button onClick={handleRenameArea} className="btn btn-primary">Save</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'inviteToSquad' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Invite to Squad</h3>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                <img src={inviteToSquadImg} alt="Invite" style={{ width: '80px', height: 'auto' }} />
              </div>

              {userData?.squadId && getSquadLeaderUid() === userData?.uid && (
                <div>
                  {/* Upgrade Prompt if 0 spots - MOVED ABOVE TITLE */}
                  {(() => {
                    const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                    const limit = TIER_LIMITS[tier];
                    const currentCount = [userData, ...friendsData].filter(u => u.squadId === userData?.squadId).length - 1;
                    const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                    const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));

                    if (spotsLeft === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '16px', border: '1px solid #333' }}>
                          <p style={{ fontSize: '1rem', margin: '0 0 12px 0', fontWeight: 'bold' }}>You have 0 spots left.</p>
                          <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary w-full" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>Upgrade Plan ⚡</button>
                        </div>
                      )
                    } else {
                      return (
                        <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#ccc' }}>
                          You have <strong>{spotsLeft}</strong> spots left.
                          <br />
                          <span style={{ fontSize: '0.8rem', color: '#888' }}>(Pending invites reserve a spot)</span>
                        </p>
                      )
                    }
                  })()}

                  <h4>Invite from Friends List</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
                    {friendsData.filter(f => f.squadId !== userData.squadId).length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>No available friends to invite.</p>}

                    {friendsData
                      .filter(f => f.squadId !== userData.squadId) // Only show friends NOT in my squad
                      .sort((a, b) => {
                        const aInvited = outgoingSquadInvites.some(inv => inv.to === a.uid);
                        const bInvited = outgoingSquadInvites.some(inv => inv.to === b.uid);
                        if (aInvited && !bInvited) return -1;
                        if (!aInvited && bInvited) return 1;
                        return 0;
                      })
                      .map(friend => {
                        const isInvited = outgoingSquadInvites.some(inv => inv.to === friend.uid);
                        // Recalculate spots for disable logic
                        const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                        const limit = TIER_LIMITS[tier];
                        const currentCount = [userData, ...friendsData].filter(u => u.squadId === userData?.squadId).length - 1;
                        const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                        const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));

                        // Find the invite object if isInvited
                        const inviteObj = outgoingSquadInvites.find(inv => inv.to === friend.uid && inv.from === currentUser.uid);

                        return (
                          <div key={friend.uid} className="card" style={{ justifyContent: 'space-between', padding: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <img src={friend.photoURL || "/default-avatar.png"} className="avatar" style={{ width: 30, height: 30 }} alt="Avatar" />
                              <span>{friend.displayName}</span>
                            </div>
                            {isInvited ? (
                              <button
                                onClick={() => inviteObj && handleWithdrawSquadInvite(inviteObj)}
                                className="btn btn-danger"
                                style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--error)' }}
                              >
                                Withdraw
                              </button>
                            ) : (
                              <button
                                onClick={() => handleInviteToSquad(friend.uid)}
                                className="btn btn-primary"
                                disabled={spotsLeft <= 0}
                                style={{ padding: '4px 8px', fontSize: '0.8rem', opacity: spotsLeft <= 0 ? 0.5 : 1, cursor: spotsLeft <= 0 ? 'not-allowed' : 'pointer' }}
                              >
                                Invite
                              </button>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
                {friendsData.filter(f => f.squadId !== userData?.squadId).length === 0 ? (
                  <button onClick={() => setActiveModal('addFriend')} className="btn btn-primary">Invite a Friend +</button>
                ) : <div />}
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'addFriend' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Add Friend</h3>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                <img src={addFriendImg} alt="Add Friend" style={{ width: '80px', height: 'auto' }} />
              </div>
              <div className="mt-4">
                <input type="email" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className="input-field" placeholder="friend@example.com" />
                <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                  <button onClick={() => { setActiveModal(null); setFriendEmail(''); }} className="btn btn-secondary" style={{ flex: '0 0 auto' }}>Close</button>
                  <button onClick={async () => {
                    if (!friendEmail || !currentUser) return;
                    try {
                      if (friendEmail.toLowerCase() === currentUser.email?.toLowerCase()) return;
                      const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
                      const querySnapshot = await getDocs(q);
                      if (querySnapshot.empty) { showAlert("User not found! Share your invite link to invite them.", true); return; }
                      const friendUid = querySnapshot.docs[0].id;

                      // Check if already friends
                      const userFriends = userData?.friends || [];
                      if (userFriends.includes(friendUid)) {
                        showAlert("You are already friends with this user!");
                        setFriendEmail('');
                      } else {
                        // Send Friend Request
                        await handleSendFriendRequest(friendUid);
                      }
                    } catch (e) { console.error(e); }
                  }} className="btn btn-primary" style={{ flex: 1 }}>Send Friend Request</button>
                </div>
              </div>
            </div>
          </div>
        )
      }


      {
        activeModal === 'alert' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <p className="text-center">{alertMessage}</p>
              <div className="modal-actions" style={{ justifyContent: 'center', gap: '8px' }}>
                <button onClick={() => { setActiveModal(null); setAlertIsUpgrade(false); setShowShareLink(false); }} className="btn btn-secondary">OK</button>
                {alertIsUpgrade && (
                  <button onClick={() => { setActiveModal('upgrade'); setAlertIsUpgrade(false); }} className="btn" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))', color: 'black', fontWeight: 'bold' }}>Upgrade Plan ⚡</button>
                )}
                {showShareLink && (
                  <button onClick={copyInviteLink} className="btn btn-primary">📋 Share Link</button>
                )}
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'confirm' && confirmAction && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3 className="modal-header">Confirm</h3>
              <p className="text-center">{confirmAction.message}</p>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Cancel</button>
                <button onClick={() => { confirmAction.onConfirm(); setActiveModal(null); }} className="btn btn-danger">Confirm</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Install Instructions Modal */}
      {activeModal === 'install' && <InstallModal onClose={() => setActiveModal(null)} />}

      {/* Payment Result Modal */}
      {activeModal === 'paymentResult' && paymentStatus && (
        <PaymentResultModal
          paymentStatus={paymentStatus}
          onClose={() => {
            setActiveModal(null);
            setPaymentStatus(null);
            window.history.replaceState({}, '', window.location.pathname);
          }}
          onGoToMap={() => {
            setActiveModal(null);
            setPaymentStatus(null);
            setActiveTab('map');
            window.history.replaceState({}, '', window.location.pathname);
            window.location.reload();
          }}
          onRetry={() => {
            setActiveModal('upgrade');
            setPaymentStatus(null);
            window.history.replaceState({}, '', window.location.pathname);
          }}
        />
      )}


      {showDevStats && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#121212', zIndex: 3000, overflowY: 'auto' }}>
          <DevStats
            onClose={() => setShowDevStats(false)}
            currentMapFilter={devMapFilterDuration}
            onSetMapFilter={setDevMapFilterDuration}
          />
        </div>
      )}

      {(showWrappedModal && selectedWrappedStats) && (
        <WrappedModal
          stats={selectedWrappedStats}
          friendsData={friendsData}
          onClose={() => setShowWrappedModal(false)}
          isFestival={isFestivalWrapped}
        />
      )}


      {/* New Wrapped Popup (Map Page Only) */}
      {(newWrappedAvailable && activeTab === 'map') && (
        <div className="modal-overlay" style={{ zIndex: 9000 }}>
          <div className="card animate-pop-in" style={{ padding: '30px', textAlign: 'center', background: 'linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d)' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>🎁</h1>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '10px' }}>Your Daily Wrapped is Ready!</h2>
            <p style={{ marginBottom: '20px' }}>See where you spent your time yesterday.</p>
            <button className="btn primary-btn" onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              localStorage.setItem(`wrappedPopupLastShown_${newWrappedAvailable}`, today);
              handleOpenWrapped(newWrappedAvailable);
            }} style={{ width: '100%', background: 'white', color: 'black' }}>
              View Wrapped
            </button>
            <button className="btn text-only" onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              localStorage.setItem(`wrappedPopupLastShown_${newWrappedAvailable}`, today);
              setNewWrappedAvailable(null);
              updateDoc(doc(db, 'users', userData!.uid), { lastSeenWrapped: new Date().toISOString() });
            }} style={{ marginTop: '10px', color: 'rgba(255,255,255,0.7)' }}>
              Maybe Later
            </button>
          </div>
        </div>
      )}

      {/* Member Info Modal (when clicking on a user marker) */}
      {(activeModal === 'member' && selectedMember) && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>{selectedMember.uid === userData?.uid ? 'You' : selectedMember.displayName}</h3>
              <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.5rem' }}>
                <FaTimes />
              </button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <img
                src={selectedMember.photoURL || "/default-avatar.png"}
                alt={selectedMember.displayName}
                style={{ width: '80px', height: '80px', borderRadius: '50%', marginBottom: '1rem' }}
              />
              {selectedMember.currentArea && (
                <div style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '0.5rem' }}>
                  <FaMapMarkerAlt size={14} style={{ marginRight: '6px', color: 'var(--primary)' }} />
                  {selectedMember.currentArea}
                </div>
              )}
            </div>

            {/* Schedule Button */}
            <button
              onClick={() => {
                setScheduleViewingUser(selectedMember.uid === userData?.uid ? null : selectedMember);
                setShowScheduleModal(true);
                setActiveModal(null);
              }}
              className="btn w-full"
              style={{
                background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px'
              }}
            >
              <FaClock />
              {selectedMember.uid === userData?.uid ? 'My Festival Schedule' : `View ${selectedMember.displayName?.split(' ')[0]}'s Schedule`}
            </button>

            {/* Additional actions can be added here */}
            {selectedMember.uid !== userData?.uid && selectedMemberContext === 'squad' && (
              <p style={{ fontSize: '0.85rem', color: '#888', marginTop: '1rem', textAlign: 'center' }}>
                Squad member
              </p>
            )}
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && userData && (
        <ScheduleModal
          userData={userData}
          viewingUser={scheduleViewingUser}
          onClose={() => {
            setShowScheduleModal(false);
            setScheduleViewingUser(null);
          }}
          showAlert={showAlert}
          showConfirm={showConfirm}
        />
      )}

    </div >
  );
}
