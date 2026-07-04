import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import addFriendImg from './assets/addFriend.png';
import inviteToSquadImg from './assets/inviteToSquad.png';
import welcomeWaveImg from './assets/welcomeWave.png';
import {
  FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaMap, FaUserFriends, FaUser, FaTimes, FaGhost, FaComments, FaClock, FaChevronDown, FaCheckCircle, FaSync, FaChevronLeft, FaChevronRight, FaPlus, FaQrcode, FaCamera, FaStar, FaRegStar, FaTint, FaGem, FaUserPlus, FaFirstAid
} from 'react-icons/fa';
import { getAvatarUrl } from './utils/userUtils';
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
import QRCode from 'react-qr-code';
import { Html5Qrcode } from 'html5-qrcode';
import ChatTab from './components/ChatTab';
import PersonaliseModal from './components/modals/PersonaliseModal';
import { BASIC_COLORS, PREMIUM_COLORS, AVATAR_EFFECTS } from './constants/avatarConstants';
import WrappedModal from './components/modals/WrappedModal';
import ScheduleModal from './components/modals/ScheduleModal';
import WhatsOnTab from './components/WhatsOn/WhatsOnTab';
import BillingPage from './pages/BillingPage';
import { increment } from 'firebase/firestore';


type Area = { id: string; name: string; polygon: Point[] };
type GPSBounds = {
  north: number; // Max Lat
  south: number; // Min Lat
  east: number;  // Max Lon
  west: number;  // Min Lon
};

const STATUS_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  dailyData?: {
    dayName: string;
    date: string;
    areasVisited: Record<string, number>;
    friendsProximity: Record<string, number>;
    totalTimeActiveMs: number;
  }[];
}



type ConfirmAction = {
  message: string;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
};

const getPartyhatImg = (skin?: string): string => {
  if (skin === 'dino') return '/dino-hat.png';
  if (skin === 'princess') return '/princess-hat.png';
  if (skin === 'wizard') return '/wizard-hat.png';
  return '/party-hat.png';
};

const getTrafficconeImg = (skin?: string): string => {
  if (skin === 'green') return '/traffic-cone-green.png';
  if (skin === 'purple') return '/traffic-cone-purple.png';
  if (skin === 'rainbow') return '/traffic-cone-rainbow.png';
  return '/traffic-cone.png';
};

import { PLANS, TIER_LIMITS } from './constants/plans';

// --- Helper Components ---
const FriendStatus = ({ friend, mySquadId }: { friend: UserData, mySquadId?: string }) => {
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    // Priority 1: Custom Status Message
    if (friend.statusMessage) {
      // Check if it's not too old (2h)
      const isRecent = !friend.statusTimestamp || (Date.now() - friend.statusTimestamp < STATUS_EXPIRY_MS);
      if (isRecent) {
        setStatusText(friend.statusMessage);
        return;
      }
    }

    // Priority 2: Squad Status
    if (!friend.squadId) {
      setStatusText("Alone or Free");
      return;
    }
    if (friend.squadId === mySquadId) {
      setStatusText("In your squad");
      return;
    }

    // Subscribe to that squad to check member count
    const unsub = onSnapshot(doc(db, "squads", friend.squadId), (sDoc: any) => {
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
    }, (err) => {
      // Handle permission errors (e.g. if we aren't friends yet in the rules' eyes)
      if (err.code !== 'permission-denied') {
        console.warn(`Could not fetch squad info for ${friend.displayName}:`, err.message);
      }
      setStatusText("");
    });

    return () => unsub();
  }, [friend.squadId, mySquadId, friend.statusMessage, friend.statusTimestamp]);

  if (!statusText) return null;
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
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldTriggered = useRef(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [showZones, setShowZones] = useState(false);
  const [renamingArea, setRenamingArea] = useState<Area | null>(null);
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaForCheckIn, setSelectedAreaForCheckIn] = useState<Area | null>(null);
  const [selectedAreaForVote, setSelectedAreaForVote] = useState<Area | null>(null);
  const [selectedMember, setSelectedMember] = useState<UserData | null>(null);
  const [selectedMemberContext, setSelectedMemberContext] = useState<'squad' | 'friend' | null>(null);
  const [incomingSquadInvites, setIncomingSquadInvites] = useState<DocumentData[]>([]);
  const [outgoingSquadInvites, setOutgoingSquadInvites] = useState<DocumentData[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<DocumentData[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<DocumentData[]>([]);
  const [incomingSquadJoinRequests, setIncomingSquadJoinRequests] = useState<DocumentData[]>([]);
  const [currentStatusInput, setCurrentStatusInput] = useState('');
  const [publicProfileCache, setPublicProfileCache] = useState<{ [uid: string]: any }>({});
  const [useSandboxStripe, setUseSandboxStripe] = useState(() => localStorage.getItem('useSandboxStripe') === 'true');
  const [activeTab, setActiveTab] = useState<'map' | 'friends' | 'notifications' | 'profile' | 'chat' | 'billing' | 'whats-on'>('map');
  const [tempCalibration, setTempCalibration] = useState<GPSBounds>({ north: 0, south: 0, east: 0, west: 0 });
  const [pickingLocationFor, setPickingLocationFor] = useState<'NW' | 'SE' | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [gpsRefreshButtonText, setGpsRefreshButtonText] = useState<string | null>(null);
  const [gpsRefreshInterval, setGpsRefreshInterval] = useState(60); // Default 60 seconds
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsTimeoutCount, setGpsTimeoutCount] = useState(0);
  void gpsTimeoutCount; // Used via functional state update in GPS error handler
  const [showShareLink, setShowShareLink] = useState(false);
  const [gpsHasLocation, setGpsHasLocation] = useState(false);
  const [gpsSearchTimeout, setGpsSearchTimeout] = useState(false);
  const [highlightedUids, setHighlightedUids] = useState<string[]>([]);
  const [zonesLoadError, setZonesLoadError] = useState(false);
  const [zonesRetryCount, setZonesRetryCount] = useState(0);
  const [isJiggling, setIsJiggling] = useState<number | null>(null);
  const [ratingNote, setRatingNote] = useState('');
  const [showRatingThanks, setShowRatingThanks] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);

  // Reset retry on login
  useEffect(() => {
    if (currentUser) {
      setZonesRetryCount(0);
      setZonesLoadError(false);
    }
  }, [currentUser]);

  // Selection Reset Timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (selectedAreaForVote || selectedAreaForCheckIn) {
      timer = setTimeout(() => {
        setSelectedAreaForVote(null);
        setSelectedAreaForCheckIn(null);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [selectedAreaForVote, selectedAreaForCheckIn]);

  const [waterMapExpiry, setWaterMapExpiry] = useState<number | null>(null);
  const [medTentMapExpiry, setMedTentMapExpiry] = useState<number | null>(null);

  // Water Map Expiry Effect
  useEffect(() => {
    if (waterMapExpiry && waterMapExpiry > Date.now()) {
      const timer = setTimeout(() => {
        setWaterMapExpiry(null);
      }, waterMapExpiry - Date.now());
      return () => clearTimeout(timer);
    }
  }, [waterMapExpiry]);

  // Med Tent Map Expiry Effect
  useEffect(() => {
    if (medTentMapExpiry && medTentMapExpiry > Date.now()) {
      const timer = setTimeout(() => {
        setMedTentMapExpiry(null);
      }, medTentMapExpiry - Date.now());
      return () => clearTimeout(timer);
    }
  }, [medTentMapExpiry]);

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

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleViewingUser, setScheduleViewingUser] = useState<UserData | null>(null);
  const [whatsOnInitialTab, setWhatsOnInitialTab] = useState<'programme' | 'schedule'>('programme');

  // QR Code Modal State
  const [activeQRModal, setActiveQRModal] = useState<'friend' | 'squad' | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [lastSubVerify, setLastSubVerify] = useState(0);

  // --- QR Scanner Effect ---
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;

    if (isScannerOpen) {
      html5QrCode = new Html5Qrcode("qr-reader");

      const onScanSuccess = (decodedText: string) => {
        try {
          const url = new URL(decodedText);
          const params = new URLSearchParams(url.search);

          const addFriend = params.get('addFriend');
          const inviteSquad = params.get('inviteSquad');
          const inviter = params.get('inviter');

          if (addFriend) {
            localStorage.setItem('parkedAddFriend', addFriend);
            if (currentUser && addFriend !== currentUser.uid) {
              handleSendFriendRequest(addFriend);
              // Feedback is handled inside handleSendFriendRequest
            }
          }

          if (inviteSquad && inviter) {
            localStorage.setItem('parkedInviteSquad', JSON.stringify({ squadId: inviteSquad, inviter }));
            if (currentUser && inviter !== currentUser.uid) {
              handleSendSquadJoinRequest(inviteSquad, inviter);
              // Feedback is handled inside handleSendSquadJoinRequest
            }
          }

          if (html5QrCode) {
            html5QrCode.stop().then(() => {
              html5QrCode?.clear();
              setIsScannerOpen(false);
              setActiveQRModal(null);
            }).catch((e: any) => console.error("Stop failed", e));
          }
        } catch (e) {
          console.error("Invalid QR code scanned:", decodedText);
          showAlert("Invalid QR code. Please scan a Herd Search link.");
        }
      };

      const startScanner = async () => {
        try {
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            // Find back camera, fallback to first available
            const backCamera = devices.find((d: any) => d.label.toLowerCase().includes('back')) || devices[0];

            await html5QrCode?.start(
              backCamera.id,
              { fps: 10, qrbox: { width: 250, height: 250 } },
              onScanSuccess,
              () => { } // silent error handler for frames
            );
          } else {
            showAlert("No cameras found on this device.");
            setIsScannerOpen(false);
          }
        } catch (err) {
          console.error("Camera access failed:", err);
          showAlert("Camera access failed. Please ensure you've granted permission.");
          setIsScannerOpen(false);
        }
      };

      startScanner();

      return () => {
        if (html5QrCode?.isScanning) {
          html5QrCode.stop().then(() => html5QrCode?.clear()).catch((e: any) => console.warn("Cleanup failed", e));
        }
      };
    }
  }, [isScannerOpen]);

  const statsRef = useRef({
    lastUpdate: Date.now(),
    pendingAreas: {} as { [name: string]: number },
    pendingFriends: {} as { [uid: string]: number },
    totalTime: 0
  });



  // Dev Features
  const [showDevStats, setShowDevStats] = useState(false);
  const [showAdminBilling, setShowAdminBilling] = useState(false);
  const [devMapFilterDuration, setDevMapFilterDuration] = useState<'5m' | '30m' | '1h' | '24h' | null>(null);
  const [billingHistory, setBillingHistory] = useState<any[]>([]);

  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);
  const page3Ref = useRef<HTMLDivElement>(null);
  const landingContainerRef = useRef<HTMLDivElement>(null);
  const [expandedFeature, setExpandedFeature] = useState<string | null>('map');
  const [activeSlide, setActiveSlide] = useState(0);

  const scrollToSlide = (index: number) => {
    if (landingContainerRef.current) {
      landingContainerRef.current.scrollTo({
        left: landingContainerRef.current.clientWidth * index,
        behavior: 'smooth'
      });
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollLeft = container.scrollLeft;
    const width = container.clientWidth;
    if (width > 0) {
      const pageIndex = Math.round(scrollLeft / width);
      if (pageIndex >= 0 && pageIndex <= 2) {
        setActiveSlide(pageIndex);
      }
    }
  };
  const [allUsersOnMap, setAllUsersOnMap] = useState<UserData[]>([]);
  const [upgradesEnabled, setUpgradesEnabled] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [whatsOnEnabled, setWhatsOnEnabled] = useState(true);
  const [isUpdatingGps, setIsUpdatingGps] = useState(false);

  // Ref to track latest userData without triggering dependency loops
  const userDataRef = useRef<UserData | null>(null);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);

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
  const getWeekKey = () => {
    const d = new Date();
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo}`;
  };

  const handleRateApp = async (val: number) => {
    if (!currentUser || !userData) return;
    setIsJiggling(val);
    setRatingValue(val);
    setTimeout(() => setIsJiggling(null), 1000);

    if (val <= 3) {
      setActiveModal('ratingFeedback');
    } else {
      // Direct save for 4/5 stars
      await saveFeedback(val, '');
    }
  };

  const saveFeedback = async (rating: number, note: string) => {
    if (!currentUser || !userData) return;
    const weekKey = getWeekKey();
    try {
      await addDoc(collection(db, "feedback"), {
        uid: currentUser.uid,
        displayName: userData.displayName || 'Unknown',
        tier: hasActiveSubscription(userData) ? (userData.tier || 'free') : 'free',
        rating,
        note,
        timestamp: Date.now(),
        weekKey
      });
      await updateDoc(getUserDocRef(currentUser.uid), {
        lastRatedWeek: weekKey,
        hasRated: true
      });
      setShowRatingThanks(true);
      setTimeout(() => setShowRatingThanks(false), 5000);
      setActiveModal(null);
    } catch (e) {
      console.error("Error saving feedback:", e);
      showAlert("Failed to save feedback.");
    }
  };

  const renderStarRating = () => {
    const now = new Date();
    const day = now.getDay(); // 0 is Sun, 1 is Mon, 2 is Tue
    const hasRated = userData?.hasRated || !!userData?.lastRatedWeek;

    // Show Sun/Mon, hide Tue if not filled.
    if (!(day === 0 || day === 1)) return null;

    // If they have rated and we are NOT showing the thanks message, hide the widget
    if (hasRated && !showRatingThanks) return null;

    return (
      <div style={{
        textAlign: 'center',
        padding: '20px 0',
        marginBottom: '20px',
        width: '100%'
      }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white', marginBottom: '15px', letterSpacing: '0.5px' }}>
          {showRatingThanks ? "Thanks for your feedback! 🎉" : "How's the app?"}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '0 15px' }}>
          {[1, 2, 3, 4, 5].map(star => {
            const isFilled = showRatingThanks ? star <= ratingValue : star <= (isJiggling || 0);
            return (
              <div
                key={star}
                onClick={() => !showRatingThanks && handleRateApp(star)}
                className={isJiggling && star <= isJiggling ? 'jiggle' : ''}
                style={{ cursor: showRatingThanks ? 'default' : 'pointer', transition: 'transform 0.2s', flex: 1, display: 'flex', justifyContent: 'center' }}
              >
                {isFilled ?
                  <FaStar size={48} color="#FFD700" /> :
                  <FaRegStar size={48} color="#333" />
                }
              </div>
            );
          })}
        </div>
      </div>
    );
  };
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

  // Fetch Features config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "features"), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.chatEnabled !== undefined) setChatEnabled(data.chatEnabled);
        if (data.whatsOnEnabled !== undefined) setWhatsOnEnabled(data.whatsOnEnabled);
      } else {
        setChatEnabled(true);
        setWhatsOnEnabled(true);
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
          .map((d: any) => d.data() as UserData)
          .filter((u: any) => u.lastUpdate && (now - u.lastUpdate < durationMs));

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
      friendsData.forEach((friend: any) => {
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
        // Only include Thu (4), Fri (5), Sat (6), Sun (0)
        const d = new Date(day + 'T12:00:00');
        const dayOfWeek = d.getDay();
        const isFestivalDay = [0, 4, 5, 6].includes(dayOfWeek);
        if (!isFestivalDay) continue;

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
            localStorage.setItem(lastShownKey, today);
          }
        }
      } else {
        setNewWrappedAvailable(null);
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

  const [activeVote, setActiveVote] = useState<Vote | null>(null);
  const [dismissedVoteId, setDismissedVoteId] = useState<string | null>(() => localStorage.getItem('dismissedVoteId'));

  const handleDismissVote = (voteId: string) => {
    setDismissedVoteId(voteId);
    localStorage.setItem('dismissedVoteId', voteId);
  };
  const [tempDisableGhostBtn, setTempDisableGhostBtn] = useState(false);
  const [alertIsUpgrade, setAlertIsUpgrade] = useState(false);
  const [showPersonaliseModal, setShowPersonaliseModal] = useState(false);
  const [showUncompressedMapImages, setShowUncompressedMapImages] = useState(false);
  const [showHaloSkinModal, setShowHaloSkinModal] = useState(false);
  const [showPartyhatSkinModal, setShowPartyhatSkinModal] = useState(false);
  const [showTrafficconeSkinModal, setShowTrafficconeSkinModal] = useState(false);
  const [haloCycleIndex, setHaloCycleIndex] = useState(0);
  const [partyhatCycleIndex, setPartyhatCycleIndex] = useState(0);
  const [trafficconeCycleIndex, setTrafficconeCycleIndex] = useState(0);

  useEffect(() => {
    let haloTimeoutId: any;
    let partyhatTimeoutId: any;
    let trafficconeTimeoutId: any;

    const runHaloCycle = () => {
      setHaloCycleIndex(prev => (prev + 1) % 4);
      const delay = Math.random() * 2000 + 1000;
      haloTimeoutId = setTimeout(runHaloCycle, delay);
    };

    const runPartyhatCycle = () => {
      setPartyhatCycleIndex(prev => (prev + 1) % 4);
      const delay = Math.random() * 2000 + 1000;
      partyhatTimeoutId = setTimeout(runPartyhatCycle, delay);
    };

    const runTrafficconeCycle = () => {
      setTrafficconeCycleIndex(prev => (prev + 1) % 4);
      const delay = Math.random() * 2000 + 1000;
      trafficconeTimeoutId = setTimeout(runTrafficconeCycle, delay);
    };

    haloTimeoutId = setTimeout(runHaloCycle, Math.random() * 2000 + 1000);
    partyhatTimeoutId = setTimeout(runPartyhatCycle, Math.random() * 2000 + 1000);
    trafficconeTimeoutId = setTimeout(runTrafficconeCycle, Math.random() * 2000 + 1000);

    return () => {
      clearTimeout(haloTimeoutId);
      clearTimeout(partyhatTimeoutId);
      clearTimeout(trafficconeTimeoutId);
    };
  }, []);

  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'failed' | null>(null);
  const [loading, setLoading] = useState(false);

  // Check for payment return from Stripe
  // --- TASK A: TRAP PARAMS (Run ONCE on mount) ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntent = urlParams.get('payment_intent');
    const redirectStatus = urlParams.get('redirect_status');
    const checkoutSuccess = urlParams.get('checkout_success');
    const checkoutCancel = urlParams.get('checkout_cancel');

    if ((paymentIntent && redirectStatus) || checkoutSuccess === 'true' || checkoutCancel === 'true') {
      console.log("Task A: TRAPPED Stripe Params from URL:", { paymentIntent, redirectStatus, checkoutSuccess, checkoutCancel });
      localStorage.setItem('parkedStripeParams', JSON.stringify({
        paymentIntent: paymentIntent || 'checkout_session',
        redirectStatus: checkoutCancel === 'true' ? 'cancelled' : (redirectStatus || 'succeeded'),
        timestamp: Date.now()
      }));

      urlParams.delete('payment_intent');
      urlParams.delete('payment_intent_client_secret');
      urlParams.delete('redirect_status');
      urlParams.delete('checkout_success');
      urlParams.delete('checkout_cancel');
    } else {
      console.log("Task A: No Stripe params in URL to trap.");
    }

    // --- QR Code Deep Link Trap ---
    const addFriendParam = urlParams.get('addFriend');
    const inviteSquadParam = urlParams.get('inviteSquad');
    const inviterParam = urlParams.get('inviter');
    let hasQrParams = false;

    if (addFriendParam) {
      console.log("TRAPPED Add Friend Request:", addFriendParam);
      localStorage.setItem('parkedAddFriend', addFriendParam);
      urlParams.delete('addFriend');
      hasQrParams = true;
    }

    if (inviteSquadParam && inviterParam) {
      console.log("TRAPPED Squad Invite:", { squadId: inviteSquadParam, inviter: inviterParam });
      localStorage.setItem('parkedInviteSquad', JSON.stringify({ squadId: inviteSquadParam, inviter: inviterParam }));
      urlParams.delete('inviteSquad');
      urlParams.delete('inviter');
      hasQrParams = true;
    }

    if (paymentIntent || checkoutSuccess || hasQrParams) {
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState(null, '', newUrl);
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

        if (redirectStatus === 'succeeded' || redirectStatus === 'cancelled') {
          setActiveModal('paymentResult');
          setPaymentStatus('pending'); // Start with checking...

          const purchaseId = localStorage.getItem('pendingPurchaseId');

          if (redirectStatus === 'cancelled') {
            setPaymentStatus('failed');
            if (purchaseId) {
              updateDoc(doc(db, "purchases", purchaseId), { status: 'failed', updatedAt: Date.now() }).catch(console.error);
              updateDoc(getUserDocRef(currentUser.uid), { isPaymentPending: false }).catch(console.error);
            }
            localStorage.removeItem('pendingPlan');
            localStorage.removeItem('pendingPurchaseId');
            localStorage.removeItem('parkedStripeParams');
          } else {
            // Succeeded - Resolution is now handled by the separate useEffect below
            console.log("Task B: Succeeded, waiting for resolution effect...");
          }
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

  // --- QR Code Deep Link Processor ---
  useEffect(() => {
    if (!currentUser || !userData) return;

    const processQrLinks = async () => {
      const parkedAddFriend = localStorage.getItem('parkedAddFriend');
      const parkedInviteSquadStr = localStorage.getItem('parkedInviteSquad');

      if (parkedAddFriend) {
        if (parkedAddFriend !== currentUser.uid) { // Don't add self
          handleSendFriendRequest(parkedAddFriend);
        }
        localStorage.removeItem('parkedAddFriend');
      }

      if (parkedInviteSquadStr) {
        try {
          const { squadId, inviter } = JSON.parse(parkedInviteSquadStr);
          if (inviter !== currentUser.uid) { // Don't invite self
            console.log("Processing Squad Request QR:", { squadId, inviter });
            handleSendSquadJoinRequest(squadId, inviter);
          }
        } catch (e) {
          console.error("Error processing squad join request from QR:", e);
          showAlert("Failed to send squad request. The link might be invalid.");
        }
        localStorage.removeItem('parkedInviteSquad');
      }
    };

    processQrLinks();
  }, [currentUser, userData]); // Run when user is fully loaded

  // --- Subscription Guard: Auto-verify active subs on login ---
  useEffect(() => {
    if (!currentUser || !userData || (Date.now() - lastSubVerify < 300000)) return; // Only verify once every 5 mins

    const verifySubscription = async () => {
      const handleAutoDisbandSquad = async () => {
        if (userData.squadId && userData.squadOwnerId === userData.uid) {
          console.log("Subscription Guard: User is squad leader. Removing other members due to subscription expiry...");
          try {
            const squadRef = doc(db, "squads", userData.squadId);
            const snap = await getDoc(squadRef);
            if (snap.exists()) {
              const members = snap.data().members || [];
              for (const memberUid of members) {
                if (memberUid !== currentUser.uid) {
                  await updateDoc(getUserDocRef(memberUid), { squadId: null, squadOwnerId: null });
                }
              }
              await updateDoc(squadRef, {
                members: [currentUser.uid],
                pendingMembers: []
              });
            }
            const invitesQ = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid));
            const invSnap = await getDocs(invitesQ);
            for (const d of invSnap.docs) {
              await deleteDoc(d.ref);
            }
          } catch (squadErr) {
            console.error("Subscription Guard: Error clearing squad members on expiry:", squadErr);
          }
        }
      };

      try {
        console.log("Subscription Guard: Verifying subscription status...");
        setLastSubVerify(Date.now());

        // Query the latest completed purchase for this user (By UID first)
        let q = query(
          collection(db, "purchases"),
          where("userId", "==", currentUser.uid),
          where("status", "==", "completed")
        );

        let snap = await getDocs(q);
        let purchaseDocs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Fallback to Email if UID search fails
        if (purchaseDocs.length === 0 && currentUser.email) {
          console.log("Subscription Guard: No purchases found by UID, trying email fallback...");
          q = query(
            collection(db, "purchases"),
            where("userEmail", "==", currentUser.email.toLowerCase()),
            where("status", "==", "completed")
          );
          snap = await getDocs(q);
          purchaseDocs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }

        if (purchaseDocs.length > 0) {
          const latestPurchase = purchaseDocs[0];
          const purchaseDate = latestPurchase.createdAt;
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

          if (purchaseDate > thirtyDaysAgo) {
            // This user HAS a valid recent purchase.
            const hasActive = hasActiveSubscription(userData);
            const correctExpiry = purchaseDate + (30 * 24 * 60 * 60 * 1000);

            // If tier doesn't match or expiry is significantly off (more than 1 min difference)
            if (!hasActive || userData.tier !== latestPurchase.tier || Math.abs((userData.subscriptionExpiry || 0) - correctExpiry) > 60000) {
              console.log("Subscription Guard: Active purchase found but user profile is outdated. Fixing...");
              await updateDoc(getUserDocRef(currentUser.uid), {
                tier: latestPurchase.tier,
                subscriptionExpiry: correctExpiry,
                isPaymentPending: false
              });
            }
          } else {
            // Latest purchase is older than 30 days
            if (userData.tier !== 'free' && (!userData.subscriptionExpiry || userData.subscriptionExpiry < Date.now()) && !userData.isDev) {
              console.log("Subscription Guard: Subscription expired. Resetting to free.");
              await handleAutoDisbandSquad();
              await updateDoc(getUserDocRef(currentUser.uid), {
                tier: 'free',
                subscriptionExpiry: null
              });
            }
          }
        } else if (userData.tier !== 'free' && (!userData.subscriptionExpiry || userData.subscriptionExpiry < Date.now()) && !userData.isDev) {
          // No purchases found at all, and they are not free/dev
          console.log("Subscription Guard: No purchases found and not Dev. Resetting to free.");
          await handleAutoDisbandSquad();
          await updateDoc(getUserDocRef(currentUser.uid), {
            tier: 'free',
            subscriptionExpiry: null
          });
        }
      } catch (e) {
        console.error("Subscription Guard Error:", e);
      }
    };

    verifySubscription();
  }, [currentUser?.uid, userData?.tier]);

  // --- Payment Pending UI Trigger ---
  useEffect(() => {
    if (userData?.isPaymentPending && !activeModal && paymentStatus !== 'success' && paymentStatus !== 'failed') {
      setPaymentStatus('pending');
      setActiveModal('paymentResult');
    }
  }, [userData?.isPaymentPending, activeModal, paymentStatus]);

  // --- Payment Resolution Logic ---
  useEffect(() => {
    if (paymentStatus === 'pending') {
      console.log("Payment Resolution: Starting check...");
      const purchaseId = localStorage.getItem('pendingPurchaseId');

      if (!purchaseId) {
        console.warn("Payment Resolution: No pendingPurchaseId found in localStorage.");
        const timer = setTimeout(() => {
          setPaymentStatus('failed');
        }, 5000);
        return () => clearTimeout(timer);
      }

      const unsub = onSnapshot(doc(db, "purchases", purchaseId), (snap) => {
        if (snap.exists() && snap.data().status === 'completed') {
          console.log("Payment Resolution: Purchase COMPLETED!");
          setPaymentStatus('success');
          localStorage.removeItem('pendingPlan');
          localStorage.removeItem('pendingPurchaseId');
          localStorage.removeItem('parkedStripeParams');
        } else if (snap.exists() && snap.data().status === 'failed') {
          console.log("Payment Resolution: Purchase FAILED in DB.");
          setPaymentStatus('failed');
          localStorage.removeItem('parkedStripeParams');
        }
      });

      // Secure Fallback: Call verify endpoint to fetch status from Stripe directly
      const verifyFallback = async () => {
        try {
          const parked = localStorage.getItem('parkedStripeParams');
          if (!parked) return;
          const { paymentIntent } = JSON.parse(parked);
          if (!paymentIntent || paymentIntent === 'checkout_session') return;

          console.log("Payment Resolution: Calling fallback verification for session", paymentIntent);
          await fetch('/api/verify-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: paymentIntent,
              purchaseId,
              userId: currentUser?.uid,
              sandboxMode: localStorage.getItem('useSandboxStripe') === 'true'
            })
          });
        } catch (err) {
          console.error("Payment Resolution: Fallback verification request failed", err);
        }
      };
      verifyFallback();

      const timer = setTimeout(() => {
        unsub();
        if (paymentStatus === 'pending') {
          console.warn("Payment Resolution: Timeout reached.");
          setPaymentStatus('failed');
          localStorage.removeItem('parkedStripeParams');
        }
      }, 15000);

      return () => {
        unsub();
        clearTimeout(timer);
      };
    }
  }, [paymentStatus, currentUser]);

  // Status Expiry

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

  const updateGpsLocation = useCallback(async () => {
    const currentUserUid = currentUser?.uid;
    const currentMapCalibration = mapCalibration;
    const currentAreas = areas;
    const uData = userDataRef.current;

    if (!currentUserUid || !uData || !currentMapCalibration || currentAreas.length === 0) return;

    setIsUpdatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const { north, south, east, west } = currentMapCalibration;

        // Map (Lat, Lon) to (x, y) 0-1 range
        let x = (longitude - west) / (east - west);
        let y = (north - latitude) / (north - south);

        const newPoint = { x, y };

        // Check if we are in Ghost Mode
        if (uData.ghostMode && uData.ghostModeExpiry && uData.ghostModeExpiry > Date.now()) {
          console.log("GPS: Ghost Mode Active, skipping update");
          setIsUpdatingGps(false);
          return;
        }

        // Determine which area the user is in
        let foundArea: Area | null = null;
        for (const area of currentAreas) {
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

          if (areaName !== 'Out of bounds') {
            updateData.lastKnownArea = areaName;
          }

          await updateDoc(getUserDocRef(currentUserUid), updateData);
          setGpsTimeoutCount(0);
          setGpsHasLocation(true);
        } catch (e) { console.error("Error updating GPS location", e); }
        finally {
          setIsUpdatingGps(false);
        }
      },
      async (err) => {
        console.error("GPS Error:", err);
        setIsUpdatingGps(false);

        const handleGpsFail = async () => {
          setGpsError("Live location was disabled as app failed to grab GPS.");
          setGpsRefreshButtonText('GPS failed to connect');
          setTimeout(() => setGpsRefreshButtonText(null), 2000);
          setGpsTimeoutCount(0);
          try {
            if (currentUserUid) {
              await updateDoc(getUserDocRef(currentUserUid), { useGps: false });
            }
          } catch (e) {
            console.error("Failed to disable GPS:", e);
          }
        };

        if (err.code === 3) {
          setGpsTimeoutCount((prevCount: number) => {
            const newCount = prevCount + 1;
            if (newCount >= 3) {
              handleGpsFail();
              return 0;
            }
            return newCount;
          });
        } else {
          await handleGpsFail();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }, [currentUser?.uid, mapCalibration, areas]);

  // GPS Tracking Logic
  useEffect(() => {
    if (!userData?.uid) return;
    if (userData?.useGps === false) { console.log("GPS: Disabled by user settings"); return; }
    if (!mapCalibration) { console.log("GPS: Waiting for Map Calibration"); return; }
    if (!navigator.geolocation) { console.log("GPS: Not supported"); return; }
    if (areas.length === 0) { console.log("GPS: Waiting for areas to load"); return; }

    console.log(`GPS: Starting live location tracking (every ${gpsRefreshInterval} seconds)`);

    // Update immediately on mount
    updateGpsLocation();

    // Then update every X seconds based on setting
    const intervalId = setInterval(updateGpsLocation, gpsRefreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [userData?.useGps, mapCalibration, userData?.uid, userData?.ghostMode, areas, gpsRefreshInterval, updateGpsLocation]);

  // GPS Search Timeout Logic
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (userData?.useGps && !gpsHasLocation) {
      setGpsSearchTimeout(false);
      timer = setTimeout(() => {
        setGpsSearchTimeout(true);
      }, 10000);
    } else {
      setGpsSearchTimeout(false);
    }
    return () => clearTimeout(timer);
  }, [userData?.useGps, gpsHasLocation]);

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
    if (showShareButton) {
      setAlertMessage(message);
      setShowShareLink(showShareButton);
      setActiveModal('alert');
    } else {
      setBannerMessage(message);
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
      bannerTimerRef.current = setTimeout(() => {
        setBannerMessage(null);
      }, 4500); // 4.5 seconds
    }
  };

  const startHold = (action: () => void) => {
    if (currentUser?.email?.toLowerCase() === 'z4kbrindle@gmail.com') {
      isHoldTriggered.current = false;
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        action();
        isHoldTriggered.current = true;
      }, 700); // 700ms hold
    }
  };

  const endHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleSelectColor = async (color: string, isPremium: boolean, bypassLock = false) => {
    if (!userData || !currentUser) return;
    if (!bypassLock && isPremium && !userData.unlockedPersonalisePackage) {
      setShowPersonaliseModal(true);
      return;
    }
    try {
      await updateDoc(getUserDocRef(userData.uid), { avatarColor: color });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), { avatarColor: color });
    } catch (err) {
      console.error("Error updating avatar color:", err);
    }
  };

  const handleToggleEffect = async (effectId: string, bypassLock = false) => {
    if (!userData || !currentUser) return;

    if (effectId === 'crown') {
      if (!bypassLock && !isEligibleForCrown(userData)) {
        showAlert("The Crown is a special benefit for Squad Leaders with an active paid plan!");
        return;
      }
    } else {
      if (!bypassLock && !userData.unlockedPersonalisePackage) {
        setShowPersonaliseModal(true);
        return;
      }
    }

    if (effectId === 'trafficcone') {
      setShowTrafficconeSkinModal(true);
      return;
    }

    if (effectId === 'halo') {
      setShowHaloSkinModal(true);
      return;
    }

    if (effectId === 'partyhat') {
      setShowPartyhatSkinModal(true);
      return;
    }

    const currentEffects = userData.avatarEffects || [];
    let newEffects = currentEffects.includes(effectId)
      ? currentEffects.filter(e => e !== effectId)
      : [...currentEffects, effectId];

    // Mutual exclusion for headwear items (Crown, Traffic Cone, Halo, Party Hat)
    const headwear = ['crown', 'trafficcone', 'halo', 'partyhat'];
    if (headwear.includes(effectId) && newEffects.includes(effectId)) {
      newEffects = newEffects.filter(e => e === effectId || !headwear.includes(e));
    }

    // Mutual exclusion for animation effects (Glow, Spin)
    if (effectId === 'glow' && newEffects.includes('glow')) {
      newEffects = newEffects.filter(e => e !== 'spin');
    } else if (effectId === 'spin' && newEffects.includes('spin')) {
      newEffects = newEffects.filter(e => e !== 'glow');
    }

    try {
      await updateDoc(getUserDocRef(userData.uid), { avatarEffects: newEffects });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), { avatarEffects: newEffects });
    } catch (err) {
      console.error("Error updating avatar effects:", err);
    }
  };

  const handleSelectHaloSkin = async (skin: string) => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const headwear = ['crown', 'trafficcone', 'halo', 'partyhat'];
    // Add 'halo' and filter out other headwear
    let newEffects = currentEffects.includes('halo') ? currentEffects : [...currentEffects, 'halo'];
    newEffects = newEffects.filter(e => e === 'halo' || !headwear.includes(e));

    try {
      await updateDoc(getUserDocRef(userData.uid), {
        avatarEffects: newEffects,
        avatarHaloSkin: skin
      });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects,
        avatarHaloSkin: skin
      });
      setShowHaloSkinModal(false);
    } catch (err) {
      console.error("Error setting halo skin:", err);
    }
  };

  const handleRemoveHalo = async () => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const newEffects = currentEffects.filter(e => e !== 'halo');
    try {
      await updateDoc(getUserDocRef(userData.uid), { avatarEffects: newEffects });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects
      });
      setShowHaloSkinModal(false);
    } catch (err) {
      console.error("Error removing halo:", err);
    }
  };

  const handleSelectPartyhatSkin = async (skin: string) => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const headwear = ['crown', 'trafficcone', 'halo', 'partyhat'];
    // Add 'partyhat' and filter out other headwear
    let newEffects = currentEffects.includes('partyhat') ? currentEffects : [...currentEffects, 'partyhat'];
    newEffects = newEffects.filter(e => e === 'partyhat' || !headwear.includes(e));

    try {
      await updateDoc(getUserDocRef(userData.uid), {
        avatarEffects: newEffects,
        avatarPartyhatSkin: skin
      });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects,
        avatarPartyhatSkin: skin
      });
      setShowPartyhatSkinModal(false);
    } catch (err) {
      console.error("Error setting party hat skin:", err);
    }
  };

  const handleRemovePartyhat = async () => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const newEffects = currentEffects.filter(e => e !== 'partyhat');
    try {
      await updateDoc(getUserDocRef(userData.uid), { avatarEffects: newEffects });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects
      });
      setShowPartyhatSkinModal(false);
    } catch (err) {
      console.error("Error removing party hat:", err);
    }
  };

  const handleSelectTrafficconeSkin = async (skin: string) => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const headwear = ['crown', 'trafficcone', 'halo', 'partyhat'];
    let newEffects = currentEffects.includes('trafficcone') ? currentEffects : [...currentEffects, 'trafficcone'];
    newEffects = newEffects.filter(e => e === 'trafficcone' || !headwear.includes(e));

    try {
      await updateDoc(getUserDocRef(userData.uid), {
        avatarEffects: newEffects,
        avatarTrafficconeSkin: skin
      });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects,
        avatarTrafficconeSkin: skin
      });
      setShowTrafficconeSkinModal(false);
    } catch (err) {
      console.error("Error setting traffic cone skin:", err);
    }
  };

  const handleRemoveTrafficcone = async () => {
    if (!userData || !currentUser) return;
    const currentEffects = userData.avatarEffects || [];
    const newEffects = currentEffects.filter(e => e !== 'trafficcone');
    try {
      await updateDoc(getUserDocRef(userData.uid), { avatarEffects: newEffects });
      await updateDoc(doc(db, 'public/user_profiles/users', currentUser.uid), {
        avatarEffects: newEffects
      });
      setShowTrafficconeSkinModal(false);
    } catch (err) {
      console.error("Error removing traffic cone:", err);
    }
  };

  const handlePurchasePersonalise = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const purchaseDoc = await addDoc(collection(db, "purchases"), {
        userId: currentUser.uid,
        userEmail: currentUser.email || 'Unknown',
        userName: userData?.displayName || 'Unknown',
        tier: 'personalise_package',
        amount: '£3.99',
        createdAt: Date.now(),
        status: 'started'
      });

      localStorage.setItem('pendingPurchaseId', purchaseDoc.id);
      localStorage.setItem('pendingType', 'personalise');

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId: 'personalise_package',
          userId: currentUser.uid,
          purchaseId: purchaseDoc.id,
          successUrl: window.location.origin + '?checkout_success=true',
          cancelUrl: window.location.origin + '?checkout_cancel=true',
        })
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Purchase failed:", error);
      showAlert("Failed to initiate purchase.");
    } finally {
      setLoading(false);
    }
  };

  const handleRestorePersonalise = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "purchases"),
        where("userId", "==", currentUser.uid),
        where("tier", "==", "personalise_package"),
        where("status", "==", "completed")
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(getUserDocRef(currentUser.uid), { unlockedPersonalisePackage: true });
        showAlert("Successfully restored Personalise Package!");
        setShowPersonaliseModal(false);
      } else {
        showAlert("No previous purchase found.");
      }
    } catch (err) {
      console.error("Restore failed:", err);
      showAlert("Failed to restore purchase.");
    } finally {
      setLoading(false);
    }
  };

  const showConfirm = (message: string, onConfirm: () => void, confirmText?: string, cancelText?: string) => {
    setConfirmAction({ message, onConfirm, confirmText, cancelText });
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



  const handleClusterClick = (clusterUsers: UserData[], point?: Point) => {
    const uids = clusterUsers.map(u => u.uid);
    setHighlightedUids(uids);
    setTimeout(() => setHighlightedUids([]), 3000); // Highlight needed briefly

    if (point && userData?.useGps === false) {
      const area = findAreaAtPoint(point);
      if (area) setSelectedAreaForCheckIn(area);
    }
  };

  const getUpcomingEvents = () => {
    if (!userData) return [];

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const currentLinear = (h < 6 ? h + 24 : h) * 60 + m;

    const adjDate = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentFestivalDay = dayNames[adjDate.getDay()];

    const myUpcoming: any[] = [];
    if (userData.schedule) {
      Object.values(userData.schedule as Record<string, any>).forEach(item => {
        if (item.day === currentFestivalDay) {
          const [ih, im] = item.time.split(':').map(Number);
          const itemLinear = (ih < 6 ? ih + 24 : ih) * 60 + im;
          if (itemLinear >= currentLinear && itemLinear <= currentLinear + 120) {
            myUpcoming.push({ ...item, type: 'mine', user: userData });
          }
        }
      });
    }

    const friendsUpcoming: any[] = [];
    friendsData.forEach((friend: any) => {
      if (friend.squadId === userData.squadId && friend.schedule) {
        Object.values(friend.schedule as Record<string, any>).forEach(item => {
          if (item.day === currentFestivalDay) {
            const [ih, im] = item.time.split(':').map(Number);
            const itemLinear = (ih < 6 ? ih + 24 : ih) * 60 + im;
            if (itemLinear >= currentLinear && itemLinear <= currentLinear + 120) {
              // Check if I have the same act at the same time
              const myScheduleKey = `${item.day}-${item.time}`;
              const myItemAtSameTime = userData.schedule?.[myScheduleKey];
              if (!myItemAtSameTime || myItemAtSameTime.performer !== item.performer) {
                friendsUpcoming.push({ ...item, type: 'friend', user: friend });
              }
            }
          }
        });
      }
    });

    return [...myUpcoming, ...friendsUpcoming].sort((a, b) => {
      const [ah, am] = a.time.split(':').map(Number);
      const [bh, bm] = b.time.split(':').map(Number);
      const al = (ah < 6 ? ah + 24 : ah) * 60 + am;
      const bl = (bh < 6 ? bh + 24 : bh) * 60 + bm;
      return al - bl;
    });
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
    const squadMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
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

      // Send to Chat
      const friendName = getDisplayNameByUid(friendUid);
      addDoc(collection(db, "squads", userData.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Info',
        senderPhotoURL: '',
        content: `${userData.displayName} invited ${friendName} to the squad!`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);

      // --- Send Push Notification (Squad Invite) ---
      try {
        const friendSnap = await getDoc(getUserDocRef(friendUid));
        if (friendSnap.exists()) {
          const fData = friendSnap.data();
          if (fData.fcmToken) {
            fetch('/api/send-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: [fData.fcmToken],
                title: 'Squad Invite! 🤝',
                body: `${userData.displayName?.split(' ')[0]} invited you to join their squad!`,
                data: { type: 'squad_invite', squadId: userData.squadId }
              })
            }).catch(err => console.error("Notification API failed:", err));
          }
        }
      } catch (e) { console.warn("Could not send squad invite notification:", e); }


    } catch (error) {
      console.error("Error sending squad invite:", error);
      showAlert("Failed to send squad invite.");
    }
  };

  const findAreaAtPoint = (point: Point): Area | null => {
    return areas.find(area => isPointInPolygon(point, area.polygon)) || null;
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
    else {
      const clickedArea = findAreaAtPoint(pos);
      if (userData?.useGps === false) {
        setSelectedAreaForCheckIn(clickedArea);
        setSelectedAreaForVote(null); // Clear vote if click check-in
      } else {
        setSelectedAreaForVote(clickedArea);
        setSelectedAreaForCheckIn(null); // Clear check-in if click vote
      }
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
    if (!currentUser) return;

    if (useGps) {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        showAlert("GPS requires a secure (HTTPS) connection. Please check your URL.");
        return;
      }

      if (!navigator.geolocation) {
        showAlert("GPS is not supported by this browser.");
        return;
      }

      // Safari Fix: Trigger permission check directly in the click handler to maintain user gesture
      setGpsRefreshButtonText('Requesting Permission...');
      navigator.geolocation.getCurrentPosition(
        async () => {
          // Success! Permission granted. Now update Firestore to enable the background watch.
          try {
            await updateDoc(getUserDocRef(currentUser.uid), { useGps: true });
            setGpsRefreshButtonText(null);
          } catch (e) {
            console.error(e);
            showAlert("Error enabling GPS.");
            setGpsRefreshButtonText(null);
          }
        },
        async (err) => {
          console.error("Initial GPS request failed:", err);
          setGpsRefreshButtonText(null);
          if (err.code === 1) {
            showAlert("GPS Permission Denied. \n\nOn iPhone: \n1. Settings > Privacy > Location Services > Ensure 'ON'. \n2. Scroll down to 'Safari Websites' (or this app name if on Home Screen) and set to 'While Using'. \n3. Ensure 'Precise Location' is ON. \n4. Turn off 'Low Power Mode'.");
          } else {
            showAlert(`GPS Error: ${err.message || 'Unknown error'}. Try refreshing the page.`);
          }
          // Ensure it stays off in DB if it failed
          await updateDoc(getUserDocRef(currentUser.uid), { useGps: false });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      // Turning off: Just update Firestore
      try {
        await updateDoc(getUserDocRef(currentUser.uid), { useGps: false });
      } catch (e) {
        console.error(e);
      }
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

      // Send to Chat
      addDoc(collection(db, "squads", userData.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Vote',
        senderPhotoURL: '',
        content: `${userData.displayName} started a vote to go to ${area.name}! 🗳️`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);

      // --- Send Push Notifications ---
      try {
        const q = query(collection(db, 'users'), where('squadId', '==', userData.squadId));
        const snap = await getDocs(q);
        const tokens = snap.docs
          .map(d => d.data())
          .filter(u => u.uid !== userData.uid && u.fcmToken)
          .map(u => u.fcmToken);

        if (tokens.length > 0) {
          fetch('/api/send-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokens,
              title: 'Squad Vote Started!',
              body: `${userData.displayName?.split(' ')[0]} wants to go to ${area.name}. Vote now!`,
              data: { type: 'vote_start', squadId: userData.squadId }
            })
          }).catch(err => console.error("Notification API failed:", err));
        }
      } catch (e) { console.warn("Could not send vote start notification:", e); }

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
      const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter((f: any) => f.squadId === userData.squadId).map((f: any) => f.uid))];
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

        // --- Send Push Notifications (Vote Ended) ---
        try {
          const q = query(collection(db, 'users'), where('squadId', '==', userData.squadId));
          const snap = await getDocs(q);
          const tokens = snap.docs
            .map(d => d.data())
            .filter(u => u.uid !== userData.uid && u.fcmToken)
            .map(u => u.fcmToken);

          if (tokens.length > 0) {
            fetch('/api/send-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens,
                title: 'Squad Vote Result!',
                body: resultString,
                data: { type: 'vote_end', squadId: userData.squadId }
              })
            }).catch(err => console.error("Notification API failed:", err));
          }
        } catch (e) { console.warn("Could not send vote end notification:", e); }
      }

      await updateDoc(squadRef, updateData);
    } catch (e) { console.error(e); }
  };

  const handleSearchForMember = async (member: UserData) => {
    if (!currentUser || !userData) return;
    try {
      await updateDoc(getUserDocRef(currentUser.uid), {
        searchingFor: {
          uid: member.uid,
          timestamp: Date.now()
        }
      });

      // Send to Chat as a notification
      if (userData.squadId) {
        addDoc(collection(db, "squads", userData.squadId, "messages"), {
          senderId: 'system',
          senderName: 'Herd Search',
          senderPhotoURL: '',
          content: `${userData.displayName} is searching for ${member.displayName}! 🏮`,
          type: 'search_notification',
          createdAt: Date.now()
        }).catch(console.error);
      }

      // --- Send Push Notification (Searching For You) ---
      try {
        const targetSnap = await getDoc(getUserDocRef(member.uid));
        if (targetSnap.exists()) {
          const tData = targetSnap.data();
          if (tData.fcmToken) {
            fetch('/api/send-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: [tData.fcmToken],
                title: 'Someone is looking for you! 🏮',
                body: `${userData.displayName?.split(' ')[0]} is searching for you on the map!`,
                data: { type: 'searching_for_you', fromUid: userData.uid }
              })
            }).catch(err => console.error("Notification API failed:", err));
          }
        }
      } catch (e) { console.warn("Could not send searching notification:", e); }

      //  showAlert(`Searching for ${member.displayName?.split(' ')[0]}! They've been notified.`);
      setSelectedMember(null);
    } catch (err) {
      console.error(err);
      showAlert("Error starting search.");
    }
  };

  const handleSelectMemberByUid = (uid: string) => {
    const squadMembers = [userData, ...friendsData].filter((u: any) => !!u && u.squadId === userData?.squadId);
    const found = squadMembers.find((m: any) => m && m.uid === uid);
    if (found) {
      setSelectedMember(found);
      setSelectedMemberContext('squad');
      setActiveModal('member');
    }
  };

  const handleStopSearching = async () => {
    if (!currentUser) return;
    try {
      await updateDoc(getUserDocRef(currentUser.uid), {
        searchingFor: null
      });
    } catch (e) {
      console.error("Stop search failed", e);
    }
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
    if (dismissedVoteId === activeVote.id) return null;

    // Check expiry
    if (activeVote.completedAt && (Date.now() - activeVote.completedAt > 30 * 60 * 1000)) return null;

    const myVote = activeVote.votes[userData.uid];
    const isOwner = activeVote.creatorId === userData.uid;
    const totalVotes = Object.keys(activeVote.votes).length;

    // Squad members count (me + friends in squad)
    const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter((f: any) => f.squadId === userData.squadId).map((f: any) => f.uid))];
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
        padding: '16px',
        position: 'relative'
      }}>
        {/* Close Button for everyone once completed */}
        {isCompleted && (
          <button
            onClick={() => handleDismissVote(activeVote.id)}
            style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            <FaTimes />
          </button>
        )}
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
                : <div style={{ color: 'var(--error)', fontWeight: 'bold', fontSize: '1.1rem' }}>Nope! We're not going! 🙅‍♂️</div>}
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
    const leader = [userData, ...friendsData].find((u: any) => u.uid === userData.squadOwnerId);
    return leader ? leader.uid : userData.squadOwnerId || userData.uid;
  };

  const getDisplayNameByUid = (uid: string): string => {
    if (uid === userData?.uid) return userData.displayName || uid;
    const friend = friendsData.find((f: any) => f.uid === uid);
    if (friend?.displayName) return friend.displayName;
    const cached = publicProfileCache[uid];
    if (cached && typeof cached === 'object') return cached.displayName || uid;
    return cached || uid;
  };

  useEffect(() => {
    const inviteUids = [
      ...incomingSquadInvites.map(inv => inv.from),
      ...outgoingSquadInvites.map(inv => inv.to),
      ...incomingFriendRequests.map(req => req.from),
      ...outgoingFriendRequests.map(req => req.to)
    ].filter(uid =>
      uid &&
      uid !== userData?.uid &&
      !friendsData.some((f: any) => f.uid === uid) &&
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
            [uid]: {
              displayName: profile.displayName || uid,
              photoURL: profile.photoURL || null
            }
          }));
        } else {
          // Mark as not found to avoid repeated attempts
          setPublicProfileCache(prev => ({ ...prev, [uid]: 'NOT_FOUND' }));
        }
      } catch (e) {
        console.error(`Error fetching public profile for ${uid}:`, e);
      }
    });
  }, [incomingSquadInvites, outgoingSquadInvites, incomingFriendRequests, outgoingFriendRequests, friendsData, userData]);

  const handleKickMemberConfirmed = async (member: UserData) => {
    if (!userData || !userData.squadId || !member.uid) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(member.uid)
      });
      await updateDoc(getUserDocRef(member.uid), {
        squadId: null
      });

      // Send to Chat
      addDoc(collection(db, "squads", userData.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Info',
        senderPhotoURL: '',
        content: `${member.displayName} was removed from the squad.`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);

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

      // Send to Chat
      addDoc(collection(db, "squads", userData.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Info',
        senderPhotoURL: '',
        content: `${userData.displayName} left the squad.`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);
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

      // Send to Chat
      addDoc(collection(db, "squads", invite.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Info',
        senderPhotoURL: '',
        content: `${userData?.displayName} joined the squad! 🥳`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);

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



  /**
   * Helper to check if user has an active paid subscription
   */
  const hasActiveSubscription = (user: UserData | null): boolean => {
    if (!user || !user.subscriptionExpiry) return false;
    return user.subscriptionExpiry > Date.now();
  };

  const isEligibleForCrown = (user: any): boolean => {
    if (!user) return false;
    const hasSub = (user.subscriptionExpiry && user.subscriptionExpiry > Date.now()) || user.isDev;
    const isLeader = user.squadId && user.squadOwnerId === user.uid;
    return !!(hasSub && isLeader);
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
        // Check snooze
        const snoozeTime = parseInt(localStorage.getItem('friendReqSnoozeTime') || '0');
        const snoozeCount = parseInt(localStorage.getItem('friendReqSnoozeCount') || '0');
        const isSnoozed = (Date.now() - snoozeTime) < 3600000; // 1 hour

        // Only show if NOT snoozed OR if we have MORE requests than when we snoozed
        if (!isSnoozed || incomingFriendRequests.length > snoozeCount) {
          setActiveModal('friendRequests');
          // Reset snooze count so we don't trigger again for the same set
          localStorage.removeItem('friendReqSnoozeTime');
          localStorage.removeItem('friendReqSnoozeCount');
        }
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
    }, (err) => {
      console.error("Areas fetch error:", err);
    });
    return () => unsubscribeAreas();
  }, [zonesRetryCount, currentUser?.uid]);

  // --- Watchdog for Area Loading ---
  useEffect(() => {
    // If we already have areas, we are good.
    if (areas.length > 0) {
      setZonesLoadError(false);
      return;
    }

    // Start a 10s timer. If after 10s areas is still 0, show error.
    const timer = setTimeout(() => {
      if (areas.length === 0) {
        if (zonesRetryCount === 0) {
          console.warn("Watchdog: Areas failed to load. Attempting automatic retry...");
          setZonesRetryCount(1);
        } else {
          console.warn("Watchdog: Areas failed to load after 10 seconds.");
          setZonesLoadError(true);
        }
      }
    }, 10000);

    return () => clearTimeout(timer);
  }, [areas.length, zonesRetryCount]);

  // --- Reset App State on Logout ---
  useEffect(() => {
    if (!currentUser) {
      setFriendsData([]);
      setIsDevMode(false);
    }
  }, [currentUser]);

  // --- Member & Friend Listener ---
  useEffect(() => {
    if (!userData) return;

    // 1. Gather all IDs we need to follow: Friends + Squad Members
    const friendIds = userData.friends || [];
    const squadMemberIds = (squadData?.members as string[]) || [];

    // Combine and remove self
    const allRelevantUids = Array.from(new Set([...friendIds, ...squadMemberIds]))
      .filter(uid => uid !== userData.uid);

    // 2. Immediate cleanup: remove people no longer in either list
    setFriendsData(prev => prev.filter(f => allRelevantUids.includes(f.uid)));

    if (allRelevantUids.length === 0) return;

    // 3. Setup individual listeners
    const unsubscribes = allRelevantUids.map(uid =>
      onSnapshot(getUserDocRef(uid), (docSnap) => {
        if (docSnap.exists()) {
          const mData = { uid: docSnap.id, ...docSnap.data() } as UserData;
          setFriendsData(prev => {
            const others = prev.filter(f => f.uid !== uid);
            return [...others, mData];
          });
        }
      }, (err) => {
        console.error(`Friend Listener Error for ${uid}:`, err);
        // If it's a permission error, it might be a race condition during friend add.
        // We don't do anything special here, but at least we don't crash the whole app.
      })
    );

    return () => unsubscribes.forEach(unsub => unsub());
  }, [JSON.stringify(userData?.friends), JSON.stringify(squadData?.members)]);

  // --- Auto-remove Desynced Friends ---
  // --- Auto-remove Desynced Friends ---
  useEffect(() => {
    /* Temporarily disabled: It's aggressively removing friends while the mutual-add logic settles. 
       We need to be sure before we delete.
    if (!userData || !currentUser || friendsData.length === 0) return;
 
    const desyncedFriends: string[] = [];
 
    friendsData.forEach((friend: any) => {
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
        const names = friendsData.filter((f: any) => desyncedFriends.includes(f.uid)).map((f: any) => f.displayName).join(", ");
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
        showAlert(`${payload.notification.title}: ${payload.notification.body}`);
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
          if (data.activeVote.completedAt && (Date.now() - data.activeVote.completedAt > 2 * 60 * 60 * 1000)) {
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
          const msgTime = latestMsg.createdAt || 0;

          if (activeTab === 'chat') {
            // If we are IN chat, immediately mark this as seen
            if (msgTime > lastSeenChatTime) {
              setLastSeenChatTime(msgTime);
              localStorage.setItem('lastSeenChatTime', msgTime.toString());
              setHasUnreadChat(false);
            }
          } else {
            // If we are NOT in chat, check if it's new
            if (msgTime > lastSeenChatTime) {
              setHasUnreadChat(true);
            }
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

    const qJoinIn = query(collection(db, "squadJoinRequests"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubJoinIn = onSnapshot(qJoinIn, (snapshot) => {
      setIncomingSquadJoinRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubIn(); unsubOut(); unsubFreqIn(); unsubFreqOut(); unsubJoinIn(); };
  }, [currentUser?.uid]);

  const handleSendFriendRequest = async (friendUid: string) => {
    if (!currentUser || !userData) return;
    try {
      // 1. Check if already friends
      if (userData?.friends?.includes(friendUid)) {
        showAlert("You are already friends!");
        return;
      }

      // 2. Check if request already pending or recently declined (2h cooldown)
      const q = query(
        collection(db, "friendRequests"),
        where("from", "==", currentUser.uid),
        where("to", "==", friendUid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        // Sort in memory to avoid composite index requirement
        const docs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const existing = docs[0];
        if (existing.status === 'pending') {
          showAlert("Friend request is already pending.");
          return;
        }
        if (existing.status === 'declined') {
          const diff = Date.now() - (existing.updatedAt || 0);
          if (diff < 2 * 60 * 60 * 1000) {
            const minsLeft = Math.ceil((2 * 60 * 60 * 1000 - diff) / 60000);
            showAlert(`Request declined recently. Try again in ${minsLeft} minutes.`);
            return;
          }
        }
      }

      await addDoc(collection(db, "friendRequests"), {
        from: currentUser.uid,
        to: friendUid,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // --- Send Push Notification (Friend Request) ---
      try {
        const friendSnap = await getDoc(getUserDocRef(friendUid));
        if (friendSnap.exists()) {
          const fData = friendSnap.data();
          if (fData.fcmToken) {
            fetch('/api/send-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: [fData.fcmToken],
                title: 'New Friend Request! 👥',
                body: `${userData.displayName?.split(' ')[0]} sent you a friend request!`,
                data: { type: 'friend_request', fromUid: userData.uid }
              })
            }).catch(err => console.error("Notification API failed:", err));
          }
        }
      } catch (e) { console.warn("Could not send friend request notification:", e); }

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
      await updateDoc(doc(db, "friendRequests", request.id), {
        status: "declined",
        updatedAt: Date.now()
      });
      showAlert("Friend request declined.");
    } catch (e) { console.error(e); }
  };

  const handleSendSquadJoinRequest = async (squadId: string, leaderUid: string) => {
    if (!currentUser || !userData) return;
    try {
      if (userData.squadId === squadId) {
        showAlert("You are already in this squad!");
        return;
      }

      // Check cooldown (2h)
      const q = query(
        collection(db, "squadJoinRequests"),
        where("from", "==", currentUser.uid),
        where("to", "==", leaderUid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const existing = docs[0];
        if (existing.status === 'pending') {
          showAlert("Join request already pending.");
          return;
        }
        if (existing.status === 'declined') {
          const diff = Date.now() - (existing.updatedAt || 0);
          if (diff < 2 * 60 * 60 * 1000) {
            const minsLeft = Math.ceil((2 * 60 * 60 * 1000 - diff) / 60000);
            showAlert(`Request declined recently. Try again in ${minsLeft} minutes.`);
            return;
          }
        }
      }

      await addDoc(collection(db, "squadJoinRequests"), {
        from: currentUser.uid,
        to: leaderUid,
        squadId: squadId,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      showAlert("Squad join request sent to leader!");

      // Notification to leader
      try {
        const leaderSnap = await getDoc(getUserDocRef(leaderUid));
        if (leaderSnap.exists() && leaderSnap.data().fcmToken) {
          fetch('/api/send-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokens: [leaderSnap.data().fcmToken],
              title: 'New Squad Request! 🛡️',
              body: `${userData.displayName?.split(' ')[0]} wants to join your squad.`,
              data: { type: 'squad_request', fromUid: userData.uid }
            })
          });
        }
      } catch (e) { console.warn(e); }

    } catch (e) {
      console.error(e);
      showAlert("Error sending squad request.");
    }
  };

  const handleAcceptSquadJoinRequest = async (request: DocumentData) => {
    if (!userData || !userData.squadId) return;
    try {
      // 1. Check squad limit
      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
      const limit = TIER_LIMITS[tier];
      const squadRef = doc(db, 'squads', userData.squadId);
      const squadSnap = await getDoc(squadRef);
      if (!squadSnap.exists()) return;

      const members = squadSnap.data().members || [];
      if (members.length >= limit + 1) {
        showAlert("Your squad is full! Upgrade to add more people.");
        return;
      }

      // 2. Accept
      await updateDoc(squadRef, { members: arrayUnion(request.from) });
      await updateDoc(getUserDocRef(request.from), {
        squadId: userData.squadId,
        squadOwnerId: userData.uid
      });
      await updateDoc(doc(db, "squadJoinRequests", request.id), {
        status: 'accepted',
        updatedAt: Date.now()
      });

      // 3. Optional: Add as friends too (mutual)
      await updateDoc(getUserDocRef(userData.uid), { friends: arrayUnion(request.from) }).catch(console.error);
      await updateDoc(getUserDocRef(request.from), { friends: arrayUnion(userData.uid) }).catch(console.error);

      // 4. Send to Chat
      addDoc(collection(db, "squads", userData.squadId, "messages"), {
        senderId: 'system',
        senderName: 'Squad Info',
        senderPhotoURL: '',
        content: `${request.fromName || 'Someone'} joined the squad! 🛡️`,
        type: 'status_update',
        createdAt: Date.now()
      }).catch(console.error);

      showAlert("Request accepted! They are now in your squad.");
    } catch (e) {
      console.error(e);
      showAlert("Error accepting request.");
    }
  };

  const handleDeclineSquadJoinRequest = async (request: DocumentData) => {
    try {
      await updateDoc(doc(db, "squadJoinRequests", request.id), {
        status: 'declined',
        updatedAt: Date.now()
      });
      showAlert("Join request declined.");
    } catch (e) { console.error(e); }
  };

  // --- Render ---
  if (authLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#121212', color: 'white' }}>
        <img
          src="/logo-main.png"
          alt="Herd Search"
          style={{
            width: 'min(180px, 40vw)',
            height: 'auto',
            marginBottom: '2.5rem',
            animation: 'pulsate 3s infinite ease-in-out'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div className="spinner" style={{
            width: '24px',
            height: '24px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTop: '3px solid var(--primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }}></div>
          <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: '600', letterSpacing: '0.5px' }}>Restoring Session...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: '#0a0a0a',
        color: 'white',
        overflow: 'hidden',
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* Horizontal Swipable Slide Container */}
        <div
          ref={landingContainerRef}
          onScroll={handleScroll}
          className="hide-scrollbar"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
            width: '100%',
            height: '100%',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {/* Page 1: Landing */}
          <div ref={page1Ref} style={{
            width: '100%',
            minWidth: '100%',
            height: '100%',
            flexShrink: 0,
            scrollSnapAlign: 'start',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px 180px',
            boxSizing: 'border-box',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              <img
                src="/logo-main.png"
                alt="Herd Search"
                style={{
                  width: 'min(180px, 35vw)',
                  height: 'auto',
                  marginBottom: '1rem',
                  animation: 'pulsate 3s infinite ease-in-out'
                }}
              />
              <h1 className="logo" style={{ fontSize: 'clamp(2.2rem, 8vw, 3.2rem)', marginBottom: '1.5rem', textAlign: 'center' }}>Herd Search</h1>

              {/* Subtle Bubble Info */}
              <div style={{
                maxWidth: '340px',
                background: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center',
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                backdropFilter: 'blur(5px)',
                marginBottom: '2rem'
              }}>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#b0b0b0', lineHeight: '1.6' }}>
                  Keep track of your friends (your Herd), create squads, vote on where to go next & never lose your group in the crowd again.
                </p>
              </div>
            </div>

            {/* Swipe Indicator 1 pointing right */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(1);
              }}
              style={{
                marginTop: '1rem',
                padding: '10px',
                fontSize: '1.3rem',
                color: 'var(--primary)',
                animation: 'bounceRight 2s infinite',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: 'pointer',
                zIndex: 100,
                width: '100%'
              }}
            >
              <FaChevronRight />
              <span style={{ fontSize: '0.75rem', display: 'block', textAlign: 'center', marginTop: '6px', fontWeight: '700', letterSpacing: '1px', color: 'var(--secondary)' }}>SWIPE RIGHT FOR FEATURES</span>
            </div>
          </div>

          {/* Page 2: Features Section */}
          <div ref={page2Ref} style={{
            width: '100%',
            minWidth: '100%',
            height: '100%',
            flexShrink: 0,
            scrollSnapAlign: 'start',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            padding: '40px 24px 180px',
            boxSizing: 'border-box',
            overflowY: 'auto',
            backgroundColor: '#0a0a0a'
          }}>
            <h3 style={{ marginBottom: '1.5rem', textAlign: 'center', fontSize: '1.5rem', color: '#fff', fontWeight: '700' }}>Key Features</h3>

            <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
              {[
                { id: 'map', icon: <FaMap />, title: 'The Map', color: '#03dac6', desc: "Don't lose the group! See where your friends are in real-time on the map." },
                { id: 'squads', icon: <FaUserFriends />, title: 'Squads', color: '#bb86fc', desc: "Create a Squad and share your live location with each other." },
                { id: 'ghost', icon: <FaGhost />, title: 'Ghost Mode', color: '#cf6679', desc: "Want some privacy? Enable Ghost Mode in your profile to hide your location." },
                { id: 'checkin', icon: <FaMapMarkerAlt />, title: 'Check In', color: '#ffc107', desc: "GPS Acting up? Manually Check In to a festival area to update your location." },
                { id: 'voting', icon: <FaClock />, title: 'Group Voting', color: 'var(--primary)', desc: "Can't decide where to go? Start a Squad Vote and let the group decide where to head next." },
                { id: 'schedules', icon: <FaUser />, title: 'Friend Schedules', color: '#03dac6', desc: "View your friends' personal schedules to see who they are watching and where they'll be." }
              ].map((f) => (
                <div
                  key={f.id}
                  onClick={() => setExpandedFeature(expandedFeature === f.id ? null : f.id)}
                  className="card"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    marginBottom: '0.75rem',
                    background: expandedFeature === f.id ? 'rgba(255,255,255,0.08)' : '#1a1a1a',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    transition: '0.3s all ease',
                    border: expandedFeature === f.id ? `1px solid ${f.color}40` : '1px solid transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontSize: '1.2rem', color: f.color, display: 'flex' }}>{f.icon}</div>
                    <h4 style={{ margin: 0, flex: 1, fontSize: '1.05rem', color: expandedFeature === f.id ? '#fff' : '#ddd' }}>{f.title}</h4>
                    <div style={{ fontSize: '0.8rem', color: '#555', transform: expandedFeature === f.id ? 'rotate(180deg)' : 'none', transition: '0.3s' }}>
                      <FaChevronDown />
                    </div>
                  </div>
                  {expandedFeature === f.id && (
                    <p style={{ margin: '12px 0 0', fontSize: '0.9rem', color: '#ccc', lineHeight: '1.5', animation: 'fadeIn 0.3s ease' }}>
                      {f.desc}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Swipe Indicator 2 pointing right */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(2);
              }}
              style={{
                marginTop: '2rem',
                padding: '10px',
                fontSize: '1.3rem',
                color: 'var(--primary)',
                animation: 'bounceRight 2s infinite',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: 'pointer',
                zIndex: 100,
                width: '100%'
              }}
            >
              <FaChevronRight />
              <span style={{ fontSize: '0.75rem', display: 'block', textAlign: 'center', marginTop: '6px', fontWeight: '700', letterSpacing: '1px', color: 'var(--secondary)' }}>SWIPE RIGHT FOR THE STORY</span>
            </div>
          </div>

          {/* Page 3: Backstory Section */}
          <div ref={page3Ref} style={{
            width: '100%',
            minWidth: '100%',
            height: '100%',
            flexShrink: 0,
            scrollSnapAlign: 'start',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            padding: '40px 24px 180px',
            boxSizing: 'border-box',
            overflowY: 'auto',
            background: 'radial-gradient(circle at 50% 30%, rgba(187, 134, 252, 0.15) 0%, rgba(3, 218, 198, 0.05) 50%, #0a0a0a 100%)'
          }}>
            <div style={{ maxWidth: '600px', width: '100%', margin: '0 auto' }}>
              <h3 style={{
                marginBottom: '1.5rem',
                textAlign: 'center',
                fontSize: '2rem',
                fontWeight: '800',
                background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textShadow: '0 0 20px rgba(187,134,252,0.1)'
              }}>
                Our Backstory 🐑
              </h3>
              <div className="card hide-scrollbar" style={{
                flexDirection: 'column',
                padding: '24px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(187, 134, 252, 0.15)',
                borderRadius: '24px',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 8px 32px 0 rgba(187, 134, 252, 0.05)',
                textAlign: 'left'
              }}>
                <p style={{ fontSize: '1rem', lineHeight: '1.8', color: '#e0e0e0', margin: 0 }}>
                  I've been attending <strong style={{ color: '#ff79c6', textShadow: '0 0 10px rgba(255,121,198,0.2)' }}>Beat-Herder</strong> for almost 10 years and it's one of my favorite places on earth. The vibe, the music, the people—it's pure magic. ✨
                  <br /><br />
                  But there was always one thing missing: the ability to head off on a <span style={{ color: '#ffb86c', fontWeight: 'bold' }}>solo quest 🎒</span> to explore a new stage, grab a cold drink, or get a quick snack, without completely losing track of your buddies!
                  <br /><br />
                  Fumbling with dead phones or trying to describe a meeting point "near the big tree" just wasn't cutting it. That's why <strong style={{ color: '#03dac6', textShadow: '0 0 10px rgba(3,218,198,0.2)' }}>Herd Search</strong> was born. 🗺️
                  <br /><br />
                  It's built for those of us who love to roam, dance, and explore, but still want to easily <strong style={{ color: '#bb86fc' }}>find the Herd 🐑</strong> for the main stage headliners.
                </p>

                <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollToSlide(0);
                    }}
                    style={{
                      borderRadius: '50px',
                      padding: '10px 24px',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.12)',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      transition: 'all 0.3s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                      e.currentTarget.style.borderColor = 'var(--primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                    }}
                  >
                    <span>👈 Back to Sign In</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Persistent Bottom Sticky Panel */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '24px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
          background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.95) 30%, #0a0a0a 100%)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255,255,255,0.03)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 200,
          pointerEvents: 'auto'
        }}>
          {/* Google Sign-in Button */}
          <button
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
            className="btn primary-btn"
            style={{
              background: 'white',
              color: '#1a1a1a',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              fontSize: '1.1rem',
              padding: '14px 28px',
              borderRadius: '50px',
              boxShadow: '0 4px 20px rgba(255,255,255,0.15)',
              marginBottom: '20px',
              fontWeight: 'bold',
              width: '100%',
              maxWidth: '320px',
              cursor: 'pointer',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = '0 6px 25px rgba(255,255,255,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,255,255,0.15)';
            }}
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="20" />
            Sign in with Google
          </button>

          {/* Page Dots Indicator */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
            {[0, 1, 2].map((idx) => {
              const isActive = activeSlide === idx;
              return (
                <div
                  key={idx}
                  onClick={() => scrollToSlide(idx)}
                  style={{
                    width: isActive ? '24px' : '8px',
                    height: '8px',
                    borderRadius: '4px',
                    background: isActive 
                      ? 'linear-gradient(90deg, var(--primary), var(--secondary))' 
                      : 'rgba(255,255,255,0.25)',
                    boxShadow: isActive ? '0 0 10px rgba(187, 134, 252, 0.5)' : 'none',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer'
                  }}
                  title={`Go to Slide ${idx + 1}`}
                />
              );
            })}
          </div>
          {/* Footer links on login screen */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px', fontSize: '0.8rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/terms" style={{ color: '#888', textDecoration: 'underline' }}>Terms of Service</Link>
            <span style={{ color: '#444' }}>•</span>
            <Link to="/privacypolicy" style={{ color: '#888', textDecoration: 'underline' }}>Privacy Policy</Link>
            <span style={{ color: '#444' }}>•</span>
            <Link to="/deleteaccount" style={{ color: '#888', textDecoration: 'underline' }}>Delete Account</Link>
          </div>
        </div>
      </div>
    );
  }

  const renderHeader = () => {
    const isGpsSuccess = userData?.useGps && userData.lastUpdate && (Date.now() - userData.lastUpdate < 300000); // 5 mins

    return (
      <header>
        <div className="logo-container">
          <img src="/logo-main.png" alt="Herd Search Logo" className="logo-image" />
          <Link to="/about" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>
            {activeTab === 'profile' ? 'Profile' : activeTab === 'whats-on' ? "What's On" : 'Herd Search'}
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {userData?.useGps && (
            <div
              onClick={(e) => { e.stopPropagation(); updateGpsLocation(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: isUpdatingGps ? 'var(--secondary)' : (isGpsSuccess ? '#4caf50' : 'var(--secondary)'),
                background: isUpdatingGps ? 'rgba(3, 218, 198, 0.1)' : (isGpsSuccess ? 'rgba(76, 175, 80, 0.1)' : 'rgba(3, 218, 198, 0.1)'),
                padding: '6px 10px',
                borderRadius: '20px',
                border: `1px solid ${isUpdatingGps ? 'rgba(3, 218, 198, 0.2)' : (isGpsSuccess ? 'rgba(76, 175, 80, 0.2)' : 'rgba(3, 218, 198, 0.2)')}`,
                cursor: 'pointer',
                marginRight: '4px'
              }}
              title="Click to refresh location"
            >
              {isUpdatingGps ? (
                <>
                  <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: 'var(--secondary)' }} />
                </>
              ) : (
                isGpsSuccess ? <FaCheckCircle size={14} /> : <FaSync size={12} className="pulsate" />
              )}
              <FaMapMarkerAlt size={14} />
            </div>
          )}
          {!userData?.useGps && activeTab === 'map' && (
            gpsRefreshButtonText ? (
              <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
                padding: '8px 16px',
                color: '#888',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: 'var(--secondary)' }} />
                <span>{gpsRefreshButtonText === 'Requesting Permission...' ? 'Requesting...' : 'Working...'}</span>
              </div>
            ) : (
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
            )
          )}

          {activeTab === 'profile' && userData?.isDev && (
            <div className="user-controls" onClick={() => setActiveModal('settings')} style={{ cursor: 'pointer' }}>
              <FaCog size={24} color="var(--text-muted)" />
            </div>
          )}

          {activeTab !== 'profile' && (
            <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
              {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
            </div>
          )}
        </div>
      </header>
    );
  };

  const renderContent = () => {
    if (activeTab === 'map') {
      return (
        <>
          {renderHeader()}

          {/* Zones Loading Error Banner */}
          {zonesLoadError && (
            <div
              onClick={() => window.location.reload()}
              style={{
                position: 'absolute',
                top: '60px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 2000,
                width: '90%',
                maxWidth: '400px',
                background: 'var(--error)',
                color: 'white',
                padding: '12px',
                borderRadius: '8px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                fontWeight: 'bold',
                cursor: 'pointer',
                animation: 'pulse 2s infinite'
              }}
            >
              <FaSync className="spin-slow" />
              Error fetching zone data, click to refresh
            </div>
          )}

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
              src={(() => {
                const pref = userData?.mapPreference;
                const useHQ = !!userData?.useHighQualityImages;
                const prefix = useHQ ? "" : "/map-compressed";
                if (!pref || pref === 'dynamic' || pref === 'cartoon') {
                  const hour = new Date().getHours();
                  return (hour >= 20 || hour < 6) ? `${prefix}/Beatherder Map Dark.png` : `${prefix}/Beatherder Map 2.png`;
                }
                if (pref === 'cartoon_dark') return `${prefix}/Beatherder Map Dark.png`;
                if (pref === 'satellite') return `${prefix}/Beatherder Map.png`;
                return `${prefix}/Beatherder Map 2.png`;
              })()}
              alt="Map"
              className="map-image"
              onLoad={resizeCanvas}
            />
            {waterMapExpiry && waterMapExpiry > Date.now() && (
              <img
                src={userData?.useHighQualityImages ? "/BH water map overlap.png" : "/map-compressed/BH water map overlap.png"}
                alt="Water Taps Overlap"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 80,
                  borderRadius: 'inherit'
                }}
              />
            )}
            {medTentMapExpiry && medTentMapExpiry > Date.now() && (
              <img
                src={userData?.useHighQualityImages ? "/BH med tent map overlay.png" : "/map-compressed/BH med tent map overlay.png"}
                alt="Med Tent Overlap"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 80,
                  borderRadius: 'inherit'
                }}
              />
            )}
            <canvas
              ref={canvasRef}
              className="map-canvas"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              // onClick={handleCanvasClick} // Removed in favor of Pointer events
              style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default'), zIndex: 1 }}
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
                const visibleFriends = friendsData.filter((f: any) => !!f.location && f.squadId === userData?.squadId && !(f.ghostMode && f.ghostModeExpiry && f.ghostModeExpiry > Date.now()));
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
                    <div key={u.uid}
                      className="user-marker"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (userData?.useGps === false && u.location) {
                          const area = findAreaAtPoint(u.location);
                          if (area) setSelectedAreaForCheckIn(area);
                        }
                        setSelectedMember(u);
                        setSelectedMemberContext('squad');
                        setActiveModal('member');
                      }}
                      style={{
                        left: `${Math.max(0, Math.min(100, cluster.centroid.x * 100))}%`,
                        top: `${Math.max(0, Math.min(100, cluster.centroid.y * 100))}%`,
                        zIndex: isMe ? 20 : 10,
                        cursor: 'pointer',
                        // Highlight if they are searching for us OR if we are searching for them
                        filter: ((u.searchingFor?.uid === userData?.uid && (Date.now() - (u.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === u.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000)))
                          ? 'drop-shadow(0 0 8px #FFD700) drop-shadow(0 0 12px #FFD700)'
                          : undefined,
                        transform: ((u.searchingFor?.uid === userData?.uid && (Date.now() - (u.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === u.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000)))
                          ? 'scale(1.2)'
                          : undefined,
                        transition: 'all 0.3s ease'
                      } as any}>
                      <div
                        className={`${u.avatarEffects?.includes('spin') ? 'spin-animate' : ''} ${u.avatarEffects?.includes('glow') ? 'glow-animate' : ''} ${u.avatarColor === 'rainbow' ? 'rainbow-animate' : ''}`}
                        style={{
                          border: '2px solid',
                          borderColor: u.avatarColor === 'rainbow' ? 'transparent' : (u.avatarColor || 'white'),
                          borderRadius: '50%',
                          padding: '0',
                          background: 'transparent',
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          ...(u.avatarEffects?.includes('glow') ? { '--glow-color': u.avatarColor === 'rainbow' ? 'var(--primary)' : (u.avatarColor || 'var(--primary)') } : {})
                        } as any}
                      >
                        <img src={getAvatarUrl(u.photoURL, u.displayName)} className="marker-avatar" alt={u.displayName} style={{ border: 'none', margin: 0 }} />
                        {u.avatarEffects?.includes('crown') && isEligibleForCrown(u) && (
                          <span className="crown-icon-marker">👑</span>
                        )}
                        {u.avatarEffects?.includes('halo') && (
                          <img src={`/halo-${u.avatarHaloSkin || 'birthday'}.png`} className="halo-icon-marker" alt="Halo" />
                        )}
                        {u.avatarEffects?.includes('partyhat') && (
                          <img src={getPartyhatImg(u.avatarPartyhatSkin)} className="partyhat-icon-marker" alt="Party Hat" />
                        )}
                        {u.avatarEffects?.includes('trafficcone') && (
                          <img src={getTrafficconeImg(u.avatarTrafficconeSkin)} className="trafficcone-icon-marker" alt="Traffic Cone" />
                        )}
                      </div>
                      {u.ghostMode && u.ghostModeExpiry && u.ghostModeExpiry > Date.now() && (
                        <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '20px' }}>👻</div>
                      )}
                      <div className="marker-label">
                        {isMe ? 'You' : u.displayName?.split(' ')[0]}
                        {userData?.searchingFor?.uid === u.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000) && ' 🏮'}
                      </div>
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
                      onClick={(e) => { e.stopPropagation(); handleClusterClick(cluster.users, cluster.centroid); }}
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
                        <img src={getAvatarUrl(u1.photoURL, u1.displayName)} style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', objectFit: 'cover' }} />
                        <img src={getAvatarUrl(u2.photoURL, u2.displayName)} style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', objectFit: 'cover' }} />
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
                    onClick={(e) => { e.stopPropagation(); handleClusterClick(cluster.users, cluster.centroid); }}
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
                      <img src={getAvatarUrl(displayUsers[0]?.photoURL, displayUsers[0]?.displayName)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {/* TR */}
                      <img src={getAvatarUrl(displayUsers[1]?.photoURL, displayUsers[1]?.displayName)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {/* BL */}
                      <img src={getAvatarUrl(displayUsers[2]?.photoURL, displayUsers[2]?.displayName)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
              const isFriend = friendsData.some((f: any) => f.uid === u.uid);
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
                    src={getAvatarUrl(u.photoURL, u.displayName)}
                    className="marker-avatar"
                    alt={u.displayName}
                    style={{ borderColor }}
                  />
                  <div className="marker-label" style={{ fontSize: '0.6rem' }}>{u.displayName?.split(' ')[0]}</div>
                </div>
              );
            })}

          </div>

          {/* I found them! Button */}
          {userData?.searchingFor && (Date.now() - userData.searchingFor.timestamp < 3600000) && (
            <div style={{ padding: '0 4px', marginBottom: '0.5rem' }}>
              <button
                onClick={handleStopSearching}
                className="btn w-full"
                style={{
                  background: '#FFD700',
                  color: 'black',
                  padding: '12px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                ✔ I found {getDisplayNameByUid(userData.searchingFor.uid).split(' ')[0]}!
              </button>
            </div>
          )}

          {/* Check In / Vote Button */}
          <div style={{ padding: '0 4px', marginBottom: '1rem' }}>
            {selectedAreaForVote ? (
              <button
                onClick={() => startVote(selectedAreaForVote)}
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
                  color: 'white',
                  border: 'none'
                }}
              >
                <FaUserFriends size={22} />
                Vote we go to {selectedAreaForVote.name}
              </button>
            ) : (
              !userData?.useGps && selectedAreaForCheckIn ? (
                <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                  <button
                    onClick={() => handleManualCheckIn(selectedAreaForCheckIn)}
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                      padding: '16px',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      borderRadius: '12px',
                      boxShadow: '0 4px 15px rgba(3, 218, 198, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      border: 'none',
                      color: 'black'
                    }}
                  >
                    <FaMapMarkerAlt size={20} />
                    Check in to {selectedAreaForCheckIn.name}
                  </button>
                  <button
                    onClick={() => startVote(selectedAreaForCheckIn)}
                    className="btn"
                    style={{
                      flex: 0.7,
                      background: 'linear-gradient(45deg, #ff0080, #7928ca)',
                      padding: '16px',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      borderRadius: '12px',
                      boxShadow: '0 4px 15px rgba(255, 0, 128, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      color: 'white',
                      border: 'none'
                    }}
                  >
                    <FaUserFriends size={20} />
                    Vote
                  </button>
                </div>
              ) : (
                <>
                  {/* Default State: GPS Label or Manual Check-In Button */}
                  {(() => {
                    const isLiveAndActive = userData?.useGps && gpsHasLocation && !gpsRefreshButtonText;

                    return (
                      <button
                        onClick={async () => {
                          if (gpsRefreshButtonText || isUpdatingGps) return;
                          if (userData?.useGps) {
                            updateGpsLocation();
                          } else {
                            selectedAreaForCheckIn ? handleManualCheckIn(selectedAreaForCheckIn) : setActiveModal('checkIn');
                          }
                        }}
                        className={isLiveAndActive ? "" : "btn btn-primary w-full"}
                        style={isLiveAndActive ? {
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          padding: '10px',
                          borderRadius: '20px',
                          color: '#888',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          width: 'fit-content',
                          margin: '0 auto',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease'
                        } : {
                          background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                          padding: '16px',
                          fontSize: '1.1rem',
                          fontWeight: 'bold',
                          borderRadius: '12px',
                          boxShadow: '0 4px 15px rgba(3, 218, 198, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '12px',
                          width: '100%',
                          border: 'none',
                          color: 'black'
                        }}
                      >
                        <FaMapMarkerAlt size={isLiveAndActive ? 12 : 20} color={isLiveAndActive ? 'var(--primary)' : 'black'} />
                        {gpsRefreshButtonText || (userData?.useGps
                          ? (gpsHasLocation
                            ? <span>Live GPS Active</span>
                            : (gpsSearchTimeout ? "GPS taking a while? Try manual check-in" : "Searching for GPS..."))
                          : (selectedAreaForCheckIn ? `Check in to ${selectedAreaForCheckIn.name} ` : `Check In`))}
                      </button>
                    );
                  })()}
                </>
              ))}
          </div>



          {/* Payment Pending Widget - Now handled by PaymentResultModal */}

          {renderVoteWidget()}
          {renderStarRating()}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list horizontal" style={{ display: 'flex', overflowX: 'auto', gap: '8px', paddingBottom: '8px' }}>
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
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
                      // Searching highlight (either they look for us, or we look for them)
                      border: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000)))
                        ? '2px solid #FFD700'
                        : (highlightedUids.includes(member.uid) ? '2px solid var(--primary)' : undefined),
                      boxShadow: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000)))
                        ? '0 0 15px rgba(255, 215, 0, 0.4)'
                        : (highlightedUids.includes(member.uid) ? '0 0 15px var(--primary)' : undefined),
                      background: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000)))
                        ? 'rgba(255, 215, 0, 0.05)'
                        : undefined,
                      transform: highlightedUids.includes(member.uid) ? 'scale(1.02)' : undefined,
                      transition: 'all 0.3s ease'
                    }}>
                    {/* Search Tag */}
                    {(() => {
                      const isTheySearchUs = member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000);
                      const isWeSearchThem = userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000);

                      if (!isTheySearchUs && !isWeSearchThem) return null;

                      return (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: '#FFD700',
                          color: 'black',
                          fontSize: '0.65rem',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: 'bold',
                          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                          zIndex: 5
                        }}>
                          {isTheySearchUs ? 'IS SEARCHING FOR YOU' : 'SEARCHING FOR'}
                        </div>
                      );
                    })()}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ position: 'relative' }}>
                        <div
                          className={`
                            ${member.avatarEffects?.includes('spin') ? 'spin-animate' : ''} 
                            ${member.avatarEffects?.includes('glow') ? 'glow-animate' : ''}
                            ${member.avatarColor === 'rainbow' ? 'rainbow-animate' : ''}
                          `}
                          style={{
                            borderRadius: '50%',
                            padding: '0',
                            border: '2px solid',
                            borderColor: member.avatarColor === 'rainbow' ? 'transparent' : (member.avatarColor || 'var(--primary)'),
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            ...(member.avatarEffects?.includes('glow') ? { '--glow-color': member.avatarColor === 'rainbow' ? 'var(--primary)' : (member.avatarColor || 'var(--primary)') } : {})
                          } as any}
                        >
                          <img src={getAvatarUrl(member.photoURL, member.displayName)} className="avatar" alt="Avatar" style={{ margin: 0, border: 'none' }} />
                        </div>
                        {member.avatarEffects?.includes('crown') && isEligibleForCrown(member) && (
                          <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', fontSize: '14px', zIndex: 5 }}>👑</span>
                        )}
                        {member.avatarEffects?.includes('halo') && (
                          <img src={`/halo-${member.avatarHaloSkin || 'birthday'}.png`} style={{ position: 'absolute', top: '-9px', left: '40%', transform: 'translateX(-50%)', width: '18px', height: '18px', zIndex: 5 }} alt="Halo" />
                        )}
                        {member.avatarEffects?.includes('partyhat') && (
                          <img src={getPartyhatImg(member.avatarPartyhatSkin)} style={{ position: 'absolute', top: '-10px', left: '40%', transform: 'translateX(-50%)', width: '22px', height: '22px', zIndex: 5 }} alt="Party Hat" />
                        )}
                        {member.avatarEffects?.includes('trafficcone') && (
                          <img src={getTrafficconeImg(member.avatarTrafficconeSkin)} style={{ position: 'absolute', top: '-15px', left: '15%', width: '22px', height: '22px', zIndex: 5 }} alt="Traffic Cone" />
                        )}
                      </div>
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
                    {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < 2 * 60 * 60 * 1000) && (
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
                const friend = friendsData.find((f: any) => f.uid === invite.to);
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
                    const currentMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
                    const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
                    const usedFriendSpots = (currentMembers.length - 1) + pendingInvites.length;
                    const remaining = Math.max(0, limit - usedFriendSpots);
                    return `${remaining} left`;
                  })()}
                </span>
              </div>
            )}
          </div>

          {/* Coming Up Section */}
          {(() => {
            const upcoming = getUpcomingEvents();
            if (upcoming.length === 0) return null;

            return (
              <div style={{ padding: '0 4px', marginTop: '1.5rem', marginBottom: '1rem' }}>
                <h3 style={{
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1.5px',
                  color: 'var(--text-muted)',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <FaClock size={12} style={{ color: 'var(--primary)' }} /> Coming Up (Next 2h)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {upcoming.map((event, idx) => {
                    const isMine = event.type === 'mine';
                    return (
                      <div key={`${event.user.uid}-${idx}`} className="card" style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        border: isMine ? '1px solid rgba(3, 218, 198, 0.2)' : '1px solid rgba(255,255,255,0.05)',
                        background: isMine ? 'rgba(3, 218, 198, 0.03)' : 'rgba(255,255,255,0.01)',
                        borderRadius: '12px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                          <img src={event.user.photoURL} alt="Avatar" className="avatar" style={{ width: '32px', height: '32px', border: isMine ? '1px solid var(--primary)' : '1px solid #444' }} />
                          <div style={{ overflow: 'hidden', flex: 1 }}>
                            <div style={{
                              fontSize: '0.85rem',
                              fontWeight: '600',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              color: isMine ? 'white' : '#ddd'
                            }}>
                              {isMine ? 'You are seeing ' : `${event.user.displayName?.split(' ')[0]} is seeing `}
                              <span style={{ color: 'var(--secondary)' }}>{event.performer}</span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              at {event.stage}
                            </div>
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          color: isMine ? 'var(--primary)' : '#aaa',
                          background: isMine ? 'rgba(3, 218, 198, 0.1)' : 'rgba(255,255,255,0.05)',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          marginLeft: '8px'
                        }}>
                          {event.time}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}






        </>
      )
    }

    if (activeTab === 'friends') {
      return (
        <>
          {renderHeader()}
          {(incomingFriendRequests.length > 0 || incomingSquadInvites.length > 0 || incomingSquadJoinRequests.length > 0) && (
            <>
              <h2 className="section-title">Requests</h2>
              {/* Incoming Friend Requests */}
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
              {/* Incoming Squad Join Requests (Someone wants to join ME) */}
              {incomingSquadJoinRequests.map(req => (
                <div key={req.id} className="card" style={{ borderLeft: '4px solid var(--secondary)' }}>
                  <div>
                    <strong>{getDisplayNameByUid(req.from)}</strong> wants to join your squad.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAcceptSquadJoinRequest(req)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                    <button onClick={() => handleDeclineSquadJoinRequest(req)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                  </div>
                </div>
              ))}
              {/* Incoming Squad Invites (A leader invited ME) */}
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
          {(incomingFriendRequests.length === 0 && incomingSquadInvites.length === 0 && incomingSquadJoinRequests.length === 0 && outgoingFriendRequests.length === 0) && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1rem', fontStyle: 'italic' }}>No pending requests.</p>
          )}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list">
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid}
                    className={`card ${member.uid === currentUser.uid ? 'current-user' : ''} `}
                    onClick={() => { setSelectedMember(member); setSelectedMemberContext('squad'); setActiveModal('member'); }}
                    style={{
                      position: 'relative',
                      border: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000))) ? '2px solid #FFD700' : undefined,
                      boxShadow: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000))) ? '0 0 15px rgba(255, 215, 0, 0.4)' : undefined,
                      background: ((member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000)) || (userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000))) ? 'rgba(255, 215, 0, 0.05)' : undefined,
                    }}
                  >
                    {(() => {
                      const isTheySearchUs = member.searchingFor?.uid === userData?.uid && (Date.now() - (member.searchingFor?.timestamp || 0) < 3600000);
                      const isWeSearchThem = userData?.searchingFor?.uid === member.uid && (Date.now() - (userData.searchingFor?.timestamp || 0) < 3600000);

                      if (!isTheySearchUs && !isWeSearchThem) return null;

                      return (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: '#FFD700',
                          color: 'black',
                          fontSize: '0.65rem',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: 'bold',
                          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                          zIndex: 5
                        }}>
                          {isTheySearchUs ? 'IS SEARCHING FOR YOU' : 'SEARCHING FOR'}
                        </div>
                      );
                    })()}
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
                      {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < STATUS_EXPIRY_MS) && (
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



            {(() => {
              const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
              return pendingInvites.map(invite => {
                const friend = friendsData.find((f: any) => f.uid === invite.to);
                return (
                  <div key={invite.id} className="card" style={{
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

            {/* Only allow adding friends if they are the leader */}
            {getSquadLeaderUid() === userData?.uid && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <div
                  className="card"
                  onClick={() => setActiveModal('inviteToSquad')}
                  style={{
                    flex: 1,
                    cursor: 'pointer',
                    justifyContent: 'center',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px dashed #444',
                    color: 'var(--text-muted)',
                    gap: '12px',
                    padding: '16px'
                  }}>
                  <FaUserFriends size={24} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>Invite to Squad</span>
                    <span style={{ fontSize: '0.8rem' }}>
                      {(() => {
                        const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                        const limit = TIER_LIMITS[tier];
                        const currentMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
                        const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
                        const usedFriendSpots = (currentMembers.length - 1) + pendingInvites.length;
                        const remaining = Math.max(0, limit - usedFriendSpots);
                        return `${remaining} left`;
                      })()}
                    </span>
                  </div>
                </div>
                {/* QR Button */}
                {(() => {
                  const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                  const limit = TIER_LIMITS[tier];
                  const currentMembers = [userData, ...friendsData].filter((u: any) => u.squadId === userData.squadId);
                  const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
                  const usedFriendSpots = (currentMembers.length - 1) + pendingInvites.length;
                  const remaining = Math.max(0, limit - usedFriendSpots);

                  if (tier !== 'free' && remaining > 0) {
                    return (
                      <div
                        className="card"
                        onClick={() => setActiveQRModal('squad')}
                        style={{
                          width: '70px',
                          cursor: 'pointer',
                          justifyContent: 'center',
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px dashed var(--primary)',
                          color: 'var(--primary)',
                          padding: '16px',
                          display: 'flex',
                          alignItems: 'center',
                          flexDirection: 'column'
                        }}>
                        <FaQrcode size={24} />
                      </div>
                    );
                  }
                  return null;
                })()}
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
            {friendsData.filter((f: any) => userData?.friends?.includes(f.uid)).map((friend: any) => (
              <div key={friend.uid} className="card" onClick={() => { setSelectedMember(friend); setSelectedMemberContext('friend'); }}>
                <img src={getAvatarUrl(friend.photoURL, friend.displayName)} className="avatar" alt="Avatar" style={{ borderColor: friend.avatarColor || 'var(--primary)' }} />
                <div>
                  <h3>{friend.displayName}</h3>
                  <p><FriendStatus friend={friend} mySquadId={userData?.squadId} /></p>
                </div>
              </div>
            ))}
            {/* Reuse the Invite Friends modal logic to add new friends via email */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
              <div className="card" onClick={() => setActiveModal('addFriend')} style={{ flex: 1, cursor: 'pointer', justifyContent: 'center', margin: 0, borderStyle: 'dashed', gap: '8px' }}>
                <FaPlus size={14} />
                <p style={{ margin: 0 }}>Add Friend</p>
              </div>
              <div
                className="card"
                onClick={() => setActiveQRModal('friend')}
                style={{
                  width: '70px',
                  cursor: 'pointer',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px dashed var(--primary)',
                  color: 'var(--primary)',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center'
                }}>
                <FaQrcode size={24} />
              </div>
            </div>
          </div>
        </>
      )
    }



    if (activeTab === 'profile') {
      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
      return (
        <>
          {renderHeader()}

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
            {userData?.photoURL && (
              <div style={{ position: 'relative', marginBottom: '1rem' }}>
                {userData.avatarEffects?.includes('crown') && isEligibleForCrown(userData) && (
                  <span className="crown-icon">👑</span>
                )}
                {userData.avatarEffects?.includes('halo') && (
                  <img src={`/halo-${userData.avatarHaloSkin || 'birthday'}.png`} className="halo-icon" alt="Halo" />
                )}
                {userData.avatarEffects?.includes('partyhat') && (
                  <img src={getPartyhatImg(userData.avatarPartyhatSkin)} className="partyhat-icon" alt="Party Hat" />
                )}
                {userData.avatarEffects?.includes('trafficcone') && (
                  <img src={getTrafficconeImg(userData.avatarTrafficconeSkin)} className="trafficcone-icon" alt="Traffic Cone" />
                )}
                <div
                  className={`
                    ${userData.avatarEffects?.includes('spin') ? 'spin-animate' : ''} 
                    ${userData.avatarEffects?.includes('glow') ? 'glow-animate' : ''}
                    ${userData.avatarColor === 'rainbow' ? 'rainbow-animate' : ''}
                    ${tier !== 'free' && !userData.avatarColor && !userData.avatarEffects?.length ? 'premium-avatar-container' : ''}
                  `}
                  style={{
                    borderRadius: '50%',
                    padding: '0',
                    border: '3px solid',
                    borderColor: userData.avatarColor === 'rainbow' ? 'transparent' : (userData.avatarColor || (tier !== 'free' ? 'transparent' : 'var(--primary)')),
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: (tier !== 'free' && (!userData.avatarColor || userData.avatarColor === 'transparent')) ? 'linear-gradient(45deg, var(--primary), var(--secondary))' : 'transparent',
                    ...(userData.avatarEffects?.includes('glow') ? { '--glow-color': userData.avatarColor === 'rainbow' ? 'var(--primary)' : (userData.avatarColor || 'var(--primary)') } : {})
                  } as any}
                >
                  <img className="avatar-large" src={getAvatarUrl(userData.photoURL, userData.displayName)} alt="Profile" style={{ margin: 0, border: 'none' }} />
                  {tier !== 'free' && (
                    <div className="sparkles-overlay" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
                <p style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}>
                  {tier === 'free' && "You are on the Free Tier. You can join squads but cannot create your own."}
                  {tier !== 'free' && `You can invite up to ${TIER_LIMITS[tier]} friends to your squad.`}
                </p>
                {userData?.subscriptionExpiry && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FaClock size={12} />
                    Active Subscription until {new Date(userData.subscriptionExpiry).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                )}
              </div>

              {tier !== 'festival' && (
                <>
                  <button
                    onClick={() => navigate('/upgrade')}
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
              {/* Avatar Customisation Section */}
              <div style={{ width: '100%', marginBottom: '2rem', boxSizing: 'border-box' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaGem color="var(--primary)" /> Customise Profile
                </h3>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  background: 'rgba(255,255,255,0.02)',
                  padding: '20px',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  {/* Preview and Ring Colors Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <div
                        className={`
                          ${userData?.avatarEffects?.includes('spin') ? 'spin-animate' : ''} 
                          ${userData?.avatarEffects?.includes('glow') ? 'glow-animate' : ''}
                          ${userData?.avatarColor === 'rainbow' ? 'rainbow-animate' : ''}
                        `}
                        style={{
                          borderRadius: '50%',
                          padding: '0',
                          border: '3px solid',
                          borderColor: userData?.avatarColor === 'rainbow' ? 'transparent' : (userData?.avatarColor || 'var(--primary)'),
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          ...(userData?.avatarEffects?.includes('glow') ? { '--glow-color': userData?.avatarColor === 'rainbow' ? 'var(--primary)' : (userData?.avatarColor || 'var(--primary)') } : {})
                        } as any}
                      >
                        <img src={getAvatarUrl(userData?.photoURL, userData?.displayName)} className="avatar" alt="Avatar" style={{ margin: 0, border: 'none', width: '50px', height: '50px' }} />
                        {userData?.avatarEffects?.includes('crown') && isEligibleForCrown(userData) && (
                          <span style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', fontSize: '16px', zIndex: 5 }}>👑</span>
                        )}
                        {userData?.avatarEffects?.includes('halo') && (
                          <img src={`/halo-${userData.avatarHaloSkin || 'birthday'}.png`} style={{ position: 'absolute', top: '-10px', left: '40%', transform: 'translateX(-50%)', width: '22px', height: '22px', zIndex: 5 }} alt="Halo" />
                        )}
                        {userData?.avatarEffects?.includes('partyhat') && (
                          <img src={getPartyhatImg(userData.avatarPartyhatSkin)} style={{ position: 'absolute', top: '-12px', left: '40%', transform: 'translateX(-50%)', width: '28px', height: '28px', zIndex: 5 }} alt="Party Hat" />
                        )}
                        {userData?.avatarEffects?.includes('trafficcone') && (
                          <img src={getTrafficconeImg(userData.avatarTrafficconeSkin)} style={{ position: 'absolute', top: '-18px', left: '15%', width: '28px', height: '28px', zIndex: 5 }} alt="Traffic Cone" />
                        )}
                      </div>
                      <span style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Preview</span>
                    </div>

                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', fontWeight: 'bold' }}>RING COLOUR</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {BASIC_COLORS.map(c => (
                          <div
                            key={c.id}
                            className={`color-circle ${userData?.avatarColor === c.value ? 'selected' : ''}`}
                            style={{ backgroundColor: c.value, width: '28px', height: '28px' }}
                            onClick={() => handleSelectColor(c.value, false)}
                          />
                        ))}
                        {PREMIUM_COLORS.map(c => (
                          <div
                            key={c.id}
                            className={`color-circle ${userData?.avatarColor === c.value ? 'selected' : ''} ${!userData?.unlockedPersonalisePackage ? 'locked' : ''}`}
                            style={{ backgroundColor: c.value, width: '28px', height: '28px' }}
                            onClick={() => {
                              if (isHoldTriggered.current) {
                                isHoldTriggered.current = false;
                                return;
                              }
                              handleSelectColor(c.value, true);
                            }}
                            onMouseDown={() => startHold(() => handleSelectColor(c.value, true, true))}
                            onMouseUp={endHold}
                            onMouseLeave={endHold}
                            onTouchStart={() => startHold(() => handleSelectColor(c.value, true, true))}
                            onTouchEnd={endHold}
                          />
                        ))}
                        <div
                          className={`color-circle rainbow-circle ${userData?.avatarColor === 'rainbow' ? 'selected' : ''} ${!userData?.unlockedPersonalisePackage ? 'locked' : ''}`}
                          style={{ width: '28px', height: '28px' }}
                          onClick={() => {
                            if (isHoldTriggered.current) {
                              isHoldTriggered.current = false;
                              return;
                            }
                            handleSelectColor('rainbow', true);
                          }}
                          onMouseDown={() => startHold(() => handleSelectColor('rainbow', true, true))}
                          onMouseUp={endHold}
                          onMouseLeave={endHold}
                          onTouchStart={() => startHold(() => handleSelectColor('rainbow', true, true))}
                          onTouchEnd={endHold}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                  {/* Effects Section */}
                  <div>
                    <p style={{ fontSize: '0.75rem', color: '#888', marginBottom: '10px', fontWeight: 'bold' }}>EFFECTS</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                      {AVATAR_EFFECTS.map(e => {
                        const isLocked = e.id === 'crown'
                          ? !isEligibleForCrown(userData)
                          : !userData?.unlockedPersonalisePackage;
                        return (
                          <div
                            key={e.id}
                            className={`effect-box ${userData?.avatarEffects?.includes(e.id) ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
                            style={{ padding: '10px 5px', minWidth: '60px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                            onClick={() => {
                              if (isHoldTriggered.current) {
                                isHoldTriggered.current = false;
                                return;
                              }
                              handleToggleEffect(e.id);
                            }}
                            onMouseDown={() => startHold(() => handleToggleEffect(e.id, true))}
                            onMouseUp={endHold}
                            onMouseLeave={endHold}
                            onTouchStart={() => startHold(() => handleToggleEffect(e.id, true))}
                            onTouchEnd={endHold}
                          >
                            {e.id === 'trafficcone' ? (
                              <img
                                src={userData?.avatarEffects?.includes('trafficcone')
                                  ? getTrafficconeImg(userData?.avatarTrafficconeSkin)
                                  : ['/traffic-cone.png', '/traffic-cone-green.png', '/traffic-cone-purple.png', '/traffic-cone-rainbow.png'][trafficconeCycleIndex]
                                }
                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                alt="Traffic Cone"
                              />
                            ) : e.id === 'partyhat' ? (
                              <img
                                src={userData?.avatarEffects?.includes('partyhat')
                                  ? getPartyhatImg(userData?.avatarPartyhatSkin)
                                  : ['/party-hat.png', '/dino-hat.png', '/princess-hat.png', '/wizard-hat.png'][partyhatCycleIndex]
                                }
                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                alt="Party Hat"
                              />
                            ) : e.id === 'halo' ? (
                              <img
                                src={userData?.avatarEffects?.includes('halo')
                                  ? `/halo-${userData?.avatarHaloSkin || 'birthday'}.png`
                                  : ['/halo-birthday.png', '/halo-purple.png', '/halo-swiss.png', '/halo-lightning.png'][haloCycleIndex]
                                }
                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                alt="Halo"
                              />
                            ) : (
                              <span style={{ fontSize: '1.2rem' }}>{e.icon}</span>
                            )}
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>{e.name}</span>
                            {isLocked && <span style={{ fontSize: '0.55rem' }}>🔒</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
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

              {/* Map Preference */}
              <div style={{ width: '100%', marginBottom: '20px', boxSizing: 'border-box' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaMap color="#03dac6" /> Map Style
                </h3>
                <div style={{
                  width: '100%',
                  height: '120px',
                  borderRadius: '12px',
                  marginBottom: '15px',
                  overflow: 'hidden',
                  border: '1px solid #333',
                  display: 'flex',
                  position: 'relative'
                }}>
                  {(() => {
                    const pref = userData?.mapPreference;
                    const useHQ = !!userData?.useHighQualityImages;
                    const prefix = useHQ ? "" : "/map-compressed";
                    if (!pref || pref === 'dynamic' || pref === 'cartoon') {
                      return (
                        <>
                          <div style={{ flex: 1, backgroundImage: `url("${prefix}/Beatherder Map 2.png")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                          <div style={{ flex: 1, backgroundImage: `url("${prefix}/Beatherder Map Dark.png")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', background: 'rgba(255,255,255,0.2)', transform: 'translateX(-50%)' }} />
                        </>
                      );
                    }
                    const imgSrc = pref === 'cartoon_dark' ? "/Beatherder Map Dark.png" : pref === 'satellite' ? "/Beatherder Map.png" : "/Beatherder Map 2.png";
                    return <div style={{ flex: 1, backgroundImage: `url("${prefix}${imgSrc}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />;
                  })()}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <button
                    onClick={() => {
                      if (currentUser) {
                        updateDoc(getUserDocRef(currentUser.uid), { mapPreference: 'cartoon_light' }).catch(console.error);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '12px 8px',
                      backgroundColor: userData?.mapPreference === 'cartoon_light' ? '#03dac6' : '#1e1e1e',
                      color: userData?.mapPreference === 'cartoon_light' ? '#000' : '#fff',
                      border: userData?.mapPreference === 'cartoon_light' ? 'none' : '1px solid #333',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'all 0.2s',
                      fontSize: '0.85rem'
                    }}
                  >
                    Cartoon Light
                  </button>
                  <button
                    onClick={() => {
                      if (currentUser) {
                        updateDoc(getUserDocRef(currentUser.uid), { mapPreference: 'cartoon_dark' }).catch(console.error);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '12px 8px',
                      backgroundColor: userData?.mapPreference === 'cartoon_dark' ? '#03dac6' : '#1e1e1e',
                      color: userData?.mapPreference === 'cartoon_dark' ? '#000' : '#fff',
                      border: userData?.mapPreference === 'cartoon_dark' ? 'none' : '1px solid #333',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'all 0.2s',
                      fontSize: '0.85rem'
                    }}
                  >
                    Cartoon Dark
                  </button>
                  <button
                    onClick={() => {
                      if (currentUser) {
                        updateDoc(getUserDocRef(currentUser.uid), { mapPreference: 'satellite' }).catch(console.error);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '12px 8px',
                      backgroundColor: userData?.mapPreference === 'satellite' ? '#03dac6' : '#1e1e1e',
                      color: userData?.mapPreference === 'satellite' ? '#000' : '#fff',
                      border: userData?.mapPreference === 'satellite' ? 'none' : '1px solid #333',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'all 0.2s',
                      fontSize: '0.85rem'
                    }}
                  >
                    Satellite
                  </button>
                </div>
                {/* Dynamic Map Toggle */}
                <div
                  className="card"
                  onClick={() => {
                    if (currentUser) {
                      const isDynamic = !userData?.mapPreference || userData.mapPreference === 'dynamic' || userData.mapPreference === 'cartoon';
                      updateDoc(getUserDocRef(currentUser.uid), { mapPreference: isDynamic ? 'cartoon_light' : 'dynamic' }).catch(console.error);
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: (!userData?.mapPreference || userData?.mapPreference === 'dynamic' || userData?.mapPreference === 'cartoon') ? '#333' : '#1e1e1e',
                    border: (!userData?.mapPreference || userData?.mapPreference === 'dynamic' || userData?.mapPreference === 'cartoon') ? '2px solid #03dac6' : '1px solid #333',
                    alignItems: 'center',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'row',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                >

                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: 0, color: (!userData?.mapPreference || userData?.mapPreference === 'dynamic' || userData?.mapPreference === 'cartoon') ? '#03dac6' : 'white' }}>Dynamic Map</h4>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                      Auto-switches to Cartoon Dark from 8pm to 6am
                    </p>
                  </div>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    backgroundColor: (!userData?.mapPreference || userData?.mapPreference === 'dynamic' || userData?.mapPreference === 'cartoon') ? '#03dac6' : '#333',
                    border: '1px solid #555'
                  }} />
                </div>

                {/* Subtle Show More arrow under Dynamic Map */}
                <div
                  onClick={() => setShowUncompressedMapImages(!showUncompressedMapImages)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 0',
                    cursor: 'pointer',
                    color: '#888',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    userSelect: 'none',
                    transition: 'color 0.2s',
                    marginTop: '8px',
                    textAlign: 'center'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#03dac6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; }}
                >
                  <span>{showUncompressedMapImages ? 'Show Less' : 'Show More'}</span>
                  <FaChevronDown
                    style={{
                      transform: showUncompressedMapImages ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.3s ease',
                      fontSize: '0.75rem'
                    }}
                  />
                </div>

                {/* High Quality Map Images Toggle */}
                {showUncompressedMapImages && (
                  <div
                    className="card"
                    onClick={() => {
                      if (currentUser) {
                        const currentVal = !!userData?.useHighQualityImages;
                        updateDoc(getUserDocRef(currentUser.uid), { useHighQualityImages: !currentVal }).catch(console.error);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      marginTop: '12px',
                      backgroundColor: userData?.useHighQualityImages ? '#333' : '#1e1e1e',
                      border: userData?.useHighQualityImages ? '2px solid #03dac6' : '1px solid #333',
                      alignItems: 'center',
                      padding: '12px 16px',
                      display: 'flex',
                      flexDirection: 'row',
                      width: '100%',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: 0, color: userData?.useHighQualityImages ? '#03dac6' : 'white' }}>
                        Uncompressed Map Images
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                        Use the original uncompressed map images (not recommended as this uses significantly more data, and well.. you're in a field).
                      </p>
                    </div>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      backgroundColor: userData?.useHighQualityImages ? '#03dac6' : '#333',
                      border: '1px solid #555',
                      transition: 'background-color 0.2s'
                    }} />
                  </div>
                )}

              </div>
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />


              {/* Stay Hydrated Section */}
              <div style={{ width: '100%', marginBottom: '20px', boxSizing: 'border-box' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaTint color="#4facfe" /> Stay Hydrated
                </h3>
                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '16px' }}>
                  <img
                    src="/WATER.png"
                    alt="Hydration"
                    style={{
                      width: '120px',
                      height: 'auto',
                      borderRadius: '12px',
                      marginBottom: '12px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      alignSelf: 'center'
                    }}
                  />
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#ccc', lineHeight: '1.4' }}>
                    It's going to be a big one! Remember to stay hydrated. Free water taps are scattered all around the festival site.
                  </p>
                  <button
                    onClick={() => {
                      if (waterMapExpiry && waterMapExpiry > Date.now()) {
                        setWaterMapExpiry(null);
                      } else {
                        setWaterMapExpiry(Date.now() + 90000); // 90 seconds
                        setMedTentMapExpiry(null); // Hide med tent
                        setActiveTab('map');

                        const lastShown = localStorage.getItem('lastHydrationAlert');
                        const now = Date.now();
                        const SIX_HOURS = 6 * 60 * 60 * 1000;

                        if (!lastShown || (now - parseInt(lastShown)) > SIX_HOURS) {
                          showAlert("Water taps are now highlighted on the map for 90 seconds!");
                          localStorage.setItem('lastHydrationAlert', now.toString());
                        }
                      }
                    }}
                    className="btn btn-primary w-full"
                    style={{
                      background: (waterMapExpiry && waterMapExpiry > Date.now())
                        ? 'linear-gradient(45deg, #757f9a 0%, #d7dde8 100%)'
                        : 'linear-gradient(45deg, #4facfe 0%, #00f2fe 100%)',
                      border: 'none',
                      color: 'white',
                      fontWeight: 'bold'
                    }}
                  >
                    {(waterMapExpiry && waterMapExpiry > Date.now()) ? 'Hide Taps' : 'View Water Taps on Map'}
                  </button>
                </div>
              </div>
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />

              {/* Not Feeling Right Section */}
              <div style={{ width: '100%', marginBottom: '20px', boxSizing: 'border-box' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaFirstAid color="#ff4b4b" /> Not feeling right?
                </h3>
                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '16px' }}>
                  <img
                    src="/med-tent-icon.png"
                    alt="Medical Tent"
                    style={{
                      width: '120px',
                      height: 'auto',
                      borderRadius: '12px',
                      marginBottom: '12px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      alignSelf: 'center'
                    }}
                  />
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#ccc', lineHeight: '1.4' }}>
                    If you or a friend are feeling unwell, head straight to the Medical Tent. Press below to find it instantly.
                  </p>
                  <button
                    onClick={() => {
                      if (medTentMapExpiry && medTentMapExpiry > Date.now()) {
                        setMedTentMapExpiry(null);
                      } else {
                        setMedTentMapExpiry(Date.now() + 90000); // 90 seconds
                        setWaterMapExpiry(null); // Hide water taps
                        setActiveTab('map');

                        const lastShown = localStorage.getItem('lastMedicalAlert');
                        const now = Date.now();
                        const SIX_HOURS = 6 * 60 * 60 * 1000;

                        if (!lastShown || (now - parseInt(lastShown)) > SIX_HOURS) {
                          showAlert("Medical tents are now highlighted on the map for 90 seconds!");
                          localStorage.setItem('lastMedicalAlert', now.toString());
                        }
                      }
                    }}
                    className="btn btn-primary w-full"
                    style={{
                      background: (medTentMapExpiry && medTentMapExpiry > Date.now())
                        ? 'linear-gradient(45deg, #757f9a 0%, #d7dde8 100%)'
                        : 'linear-gradient(45deg, #ff416c 0%, #ff4b2b 100%)',
                      border: 'none',
                      color: 'white',
                      fontWeight: 'bold'
                    }}
                  >
                    {(medTentMapExpiry && medTentMapExpiry > Date.now()) ? 'Hide Med Tent' : 'Click to view Med Tent on Map'}
                  </button>
                </div>
              </div>
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />



              {/* WRAPPED SECTION */}
              <div style={{ width: '100%', marginTop: '20px', boxSizing: 'border-box' }}>
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
                      boxSizing: 'border-box',
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
                      🎉 MY FESTIVAL WRAPPED 🎁
                    </span>
                  </button>
                ) : (
                  <div
                    className="card"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
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
                      const d = new Date(date + 'T12:00:00');
                      return d.toLocaleDateString(undefined, { weekday: 'long' }) === dayName;
                    });

                    const hasData = !!dayDate;
                    // Always show daily wrapped placeholders

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
                <hr style={{ borderColor: '#33333310', margin: '2rem 0', width: '100%' }} />
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
                onClick={async () => {
                  if (!currentUser) return;
                  setActiveTab('billing');
                  try {
                    const q = query(collection(db, "purchases"), where("userId", "==", currentUser.uid));
                    const snap = await getDocs(q);
                    const history = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                      .sort((a: any, b: any) => b.createdAt - a.createdAt); // Client side sort to avoid index requirements
                    setBillingHistory(history);
                  } catch (err) {
                    console.error("Error fetching billing history:", err);
                  }
                }}
                className="btn btn-secondary w-full"
                style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
              >
                <span>📜</span> Billing History
              </button>

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
              <span style={{ color: '#666', padding: '0 8px' }}>|</span>
              <Link to="/privacypolicy" style={{ paddingTop: '0.1rem', color: '#888', textDecoration: 'none' }}>Privacy Policy</Link>
              <span style={{ color: '#666', padding: '0 8px' }}>|</span>
              <Link to="/deleteaccount" style={{ paddingTop: '0.1rem', color: '#888', textDecoration: 'none' }}>Delete Account</Link>
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
              isDev={userData?.isDev || false}
            />
          )}

        </>
      )
    }

    if (activeTab === 'billing') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#121212', color: 'white' }}>
          {/* Header with Back Button */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '20px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.02)',
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}>
            <button
              onClick={() => setActiveTab('profile')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary)',
                fontSize: '1.2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                padding: '0',
                fontWeight: 'bold'
              }}
            >
              <FaChevronLeft /> Back
            </button>
            <h2 style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.2rem', paddingRight: '40px' }}>Billing History</h2>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {billingHistory.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#888', padding: '3rem 1rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📜</div>
                <p>No purchase history found.</p>
                <p style={{ fontSize: '0.9rem' }}>When you upgrade your plan, it will appear here.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {billingHistory.map((item) => (
                  <div key={item.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '16px', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ color: 'var(--primary)', textTransform: 'capitalize', fontSize: '1.1rem' }}>{item.tier} Plan</strong>
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>ID: {item.id}</span>
                      </div>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.amount}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#888' }}>
                      <span>{new Date(item.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                      <span style={{
                        color: item.status === 'completed' ? 'var(--secondary)' : 'var(--error)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        fontSize: '0.75rem',
                        letterSpacing: '1px'
                      }}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    if (activeTab === 'chat') {
      const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter((f: any) => f.squadId === userData?.squadId).map((f: any) => f.uid))].filter(Boolean);
      // Double check validation if they somehow got here without a squad or if feature is disabled
      if (!chatEnabled || !userData?.squadId || squadMembers.length <= 1) {
        // Redirect back to map if requirements not met
        setTimeout(() => setActiveTab('map'), 0);
        return null;
      }

      return (
        <ChatTab
          userData={userData}
          squadId={userData.squadId}
          activeVote={activeVote}
          onVote={castVote}
          onSelectMemberByUid={handleSelectMemberByUid}
          squadMembers={squadMembers}
        />
      );
    }

    if (activeTab === 'whats-on') {
      const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter((f: any) => f.squadId === userData?.squadId).map((f: any) => f.uid))].filter(Boolean);
      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
      const hasWhatsOnAccess = tier !== 'free' || (userData?.squadId && squadMembers.length > 1);

      if (!whatsOnEnabled || !hasWhatsOnAccess) {
        setTimeout(() => setActiveTab('map'), 0);
        return null;
      }

      return (
        <>
          {renderHeader()}
          <WhatsOnTab
            key={whatsOnInitialTab}
            userData={userData}
            showAlert={showAlert}
            showConfirm={showConfirm}
            initialSubTab={whatsOnInitialTab}
          />
        </>
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
        processAndShowStats(dateStr, data, []);

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

    // Update lastSeenWrapped to prevent popup from showing again
    try {
      await updateDoc(doc(db, 'users', userData.uid), {
        lastSeenWrapped: new Date().toISOString()
      });
    } catch (e) {
      console.error("Error updating lastSeenWrapped:", e);
    }

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
    const dayNames = ['Thursday', 'Friday', 'Saturday', 'Sunday'];

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
      friendsProximity: {},
      dailyData: [], // Store each day's data
      festivalDates: festivalDates,
      dayNames: dayNames
    };

    try {
      // Fetch each festival day's stats
      for (let i = 0; i < festivalDates.length; i++) {
        const dateStr = festivalDates[i];
        const docRef = doc(db, 'users', userData.uid, 'dailyStats', dateStr);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();
          aggregated.totalTimeActiveMs += (data.totalTimeActiveMs || 0);

          // Store daily data for highlights
          aggregated.dailyData.push({
            dayName: dayNames[i],
            date: dateStr,
            areasVisited: data.areasVisited || {},
            friendsProximity: data.friendsProximity || {},
            totalTimeActiveMs: data.totalTimeActiveMs || 0
          });

          // Merge Areas
          Object.entries(data.areasVisited || {}).forEach(([key, val]) => {
            aggregated.areasVisited[key] = (aggregated.areasVisited[key] || 0) + (val as number);
          });

          // Merge Friends
          Object.entries(data.friendsProximity || {}).forEach(([key, val]) => {
            aggregated.friendsProximity[key] = (aggregated.friendsProximity[key] || 0) + (val as number);
          });
        } else {
          // Add empty day data if no stats
          aggregated.dailyData.push({
            dayName: dayNames[i],
            date: dateStr,
            areasVisited: {},
            friendsProximity: {},
            totalTimeActiveMs: 0
          });
        }
      }

      processAndShowStats("Festival Wrapped", aggregated, aggregated.dailyData);

    } catch (e) {
      console.error("Error loading festival stats", e);
    }
  };

  const processAndShowStats = (label: string, data: any, dailyData: any[] = []) => {
    const areasList = Object.entries(data.areasVisited || {})
      .map(([name, time]) => ({ name: name.replace(/_/g, '.'), timeMs: time as number }))
      .filter(a => a.timeMs > 0)
      .sort((a, b) => b.timeMs - a.timeMs);

    const friendsList = Object.entries(data.friendsProximity || {})
      .map(([uid, time]) => ({ uid, timeMs: time as number }))
      .filter(f => f.timeMs > 0)
      .sort((a, b) => b.timeMs - a.timeMs);

    setSelectedWrappedStats({
      date: label,
      topAreas: areasList,
      topFriends: friendsList,
      totalTimeActiveMs: data.totalTimeActiveMs || 0,
      dailyData: dailyData
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
          if (!chatEnabled) return null;
          const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter((f: any) => f.squadId === userData?.squadId).map((f: any) => f.uid))].filter(Boolean);
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

        {(() => {
          if (!whatsOnEnabled) return null;
          const squadMembers = (squadData?.members) || [userData?.uid, ...(friendsData.filter((f: any) => f.squadId === userData?.squadId).map((f: any) => f.uid))].filter(Boolean);
          const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
          const hasWhatsOnAccess = tier !== 'free' || (userData?.squadId && squadMembers.length > 1);

          if (hasWhatsOnAccess) {
            return (
              <button className={`nav-item ${activeTab === 'whats-on' ? 'active' : ''}`} onClick={() => {
                setWhatsOnInitialTab('programme');
                setActiveTab('whats-on');
              }}>
                <FaClock />
                <span>What's On</span>
              </button>
            );
          }
          return null;
        })()}

        <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <FaUser />
          <span>Profile</span>
          {/* Notification Dot for Profile */}
          {newWrappedAvailable && <div style={{ position: 'absolute', top: 5, right: '35%', width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', border: '1px solid black' }} />}
        </button>

      </nav>

      {/* Modals */}
      {selectedMember && (
        <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ position: 'relative', padding: '2rem' }}>
            <button
              onClick={() => setSelectedMember(null)}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              <FaTimes />
            </button>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                onClick={() => {
                  if (selectedMember.uid === userData?.uid) {
                    setActiveTab('profile');
                    setSelectedMember(null);
                  }
                }}
                style={{
                  position: 'relative',
                  marginBottom: '1rem',
                  cursor: selectedMember.uid === userData?.uid ? 'pointer' : 'default',
                }}
                className={selectedMember.uid === userData?.uid ? 'avatar-clickable-hover' : ''}
              >
                {selectedMember.avatarEffects?.includes('crown') && isEligibleForCrown(selectedMember) && (
                  <span className="crown-icon">👑</span>
                )}
                {selectedMember.avatarEffects?.includes('halo') && (
                  <img src={`/halo-${selectedMember.avatarHaloSkin || 'birthday'}.png`} className="halo-icon" alt="Halo" />
                )}
                {selectedMember.avatarEffects?.includes('partyhat') && (
                  <img src={getPartyhatImg(selectedMember.avatarPartyhatSkin)} className="partyhat-icon" alt="Party Hat" />
                )}
                {selectedMember.avatarEffects?.includes('trafficcone') && (
                  <img src={getTrafficconeImg(selectedMember.avatarTrafficconeSkin)} className="trafficcone-icon" alt="Traffic Cone" />
                )}
                <div
                  className={`
                    ${selectedMember.avatarEffects?.includes('spin') ? 'spin-animate' : ''} 
                    ${selectedMember.avatarEffects?.includes('glow') ? 'glow-animate' : ''}
                    ${selectedMember.avatarColor === 'rainbow' ? 'rainbow-animate' : ''}
                    ${selectedMember.tier !== 'free' && !selectedMember.avatarColor && !selectedMember.avatarEffects?.length ? 'premium-avatar-container' : ''}
                  `}
                  style={{
                    borderRadius: '50%',
                    padding: '0',
                    border: '3px solid',
                    borderColor: selectedMember.avatarColor === 'rainbow' ? 'transparent' : (selectedMember.avatarColor || (selectedMember.tier !== 'free' ? 'transparent' : 'var(--primary)')),
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 80,
                    height: 80,
                    background: (selectedMember.tier !== 'free' && (!selectedMember.avatarColor || selectedMember.avatarColor === 'transparent')) ? 'linear-gradient(45deg, var(--primary), var(--secondary))' : 'transparent',
                    ...(selectedMember.avatarEffects?.includes('glow') ? { '--glow-color': selectedMember.avatarColor === 'rainbow' ? 'var(--primary)' : (selectedMember.avatarColor || 'var(--primary)') } : {})
                  } as any}
                >
                  <img
                    className="avatar-large"
                    src={getAvatarUrl(selectedMember.photoURL, selectedMember.displayName)}
                    alt="Avatar"
                    style={{ margin: 0, border: 'none', width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {selectedMember.tier !== 'free' && (
                    <div className="sparkles-overlay" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                      <div className="sparkle"></div>
                    </div>
                  )}
                </div>
              </div>
              <h2 style={{ marginBottom: '0.25rem', fontSize: '1.4rem' }}>{selectedMember.displayName}</h2>

              <div
                onClick={() => {
                  if (selectedMember.uid === userData?.uid && selectedMember.tier !== 'festival') {
                    setSelectedMember(null);
                    navigate('/upgrade');
                  }
                }}
                style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '0.7rem',
                  fontWeight: '900',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  background: selectedMember.tier === 'festival' ? 'linear-gradient(45deg, #FFD700, #FFA500)' : // Gold for Festival
                    selectedMember.tier === 'premium' ? 'linear-gradient(45deg, #A020F0, #E0B0FF)' : // Purple for Premium
                      selectedMember.tier === 'standard' ? 'linear-gradient(45deg, #00C9FF, #92FE9D)' : // Green for Standard
                        selectedMember.tier === 'basic' ? 'linear-gradient(45deg, #FF7E5F, #FEB47B)' : // Orange for Basic
                          'rgba(255,255,255,0.1)',
                  color: (selectedMember.tier && selectedMember.tier !== 'free') ? 'black' : '#aaa',
                  marginBottom: '1rem',
                  cursor: (selectedMember.uid === userData?.uid && selectedMember.tier !== 'festival') ? 'pointer' : 'default'
                }}
              >
                {(PLANS.find(p => p.id === selectedMember.tier)?.name || 'Free Plan')}
              </div>

              {selectedMemberContext !== 'friend' && selectedMember.uid !== userData?.uid && (
                <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', margin: '0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  📍 {selectedMember.currentArea || "Unknown Location"}
                  <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                    ({(() => {
                      const diff = (Date.now() - (selectedMember.lastUpdate || 0)) / 60000;
                      if (diff < 2) return "Right Now";
                      if (diff < 90) return `${Math.floor(diff)}m ago`;
                      return `${Math.floor(diff / 60)}h ago`;
                    })()})
                  </span>
                </p>
              )}

              {/* Friendship Status */}
              {selectedMember.uid !== userData?.uid && (
                <div style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                  {userData?.friends?.includes(selectedMember.uid) ? (
                    <span style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: '600' }}>
                      <FaUserFriends /> Friends
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        handleSendFriendRequest(selectedMember.uid);
                        setSelectedMember(null);
                      }}
                      className="btn"
                      style={{ background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid #444', borderRadius: '20px', padding: '8px 16px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                      + Send Friend Request
                    </button>
                  )}
                </div>
              )}

              {/* Status Update for Self */}
              {selectedMember.uid === userData?.uid && (
                <div style={{ marginTop: '1rem', marginBottom: '1.5rem', width: '100%' }}>
                  <div style={{
                    display: 'flex',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    border: '1px solid #333',
                    overflow: 'hidden',
                    marginBottom: '12px'
                  }}>
                    <input
                      type="text"
                      id="statusInputSelf"
                      placeholder="Update your status..."
                      style={{
                        flex: 1,
                        height: '48px',
                        background: 'transparent',
                        border: 'none',
                        padding: '0 16px',
                        color: 'white',
                        outline: 'none',
                        fontSize: '0.95rem'
                      }}
                      value={currentStatusInput}
                      onChange={(e) => setCurrentStatusInput(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const val = currentStatusInput.trim();
                          if (!val) return;
                          try {
                            await updateDoc(getUserDocRef(currentUser!.uid), {
                              statusMessage: val,
                              statusTimestamp: Date.now()
                            });
                            setCurrentStatusInput(''); // Clear input
                            if (userData?.squadId) {
                              addDoc(collection(db, "squads", userData.squadId, "messages"), {
                                senderId: currentUser!.uid,
                                senderName: userData.displayName || 'Unknown',
                                senderPhotoURL: userData.photoURL || '',
                                content: val,
                                type: 'status_update',
                                createdAt: Date.now()
                              }).catch(console.error);
                            }
                          } catch (err) { console.error(err); showAlert("Error updating status."); }
                        }
                      }}
                    />
                    <button
                      onClick={async () => {
                        const val = currentStatusInput.trim();
                        if (!val) return;
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), {
                            statusMessage: val,
                            statusTimestamp: Date.now()
                          });
                          setCurrentStatusInput(''); // Clear input
                          if (userData?.squadId) {
                            addDoc(collection(db, "squads", userData.squadId, "messages"), {
                              senderId: currentUser!.uid,
                              senderName: userData.displayName || 'Unknown',
                              senderPhotoURL: userData.photoURL || '',
                              content: val,
                              type: 'status_update',
                              createdAt: Date.now()
                            }).catch(console.error);
                          }
                        } catch (err) { console.error(err); showAlert("Error updating status."); }
                      }}
                      style={{ padding: '0 16px', background: 'var(--primary)', border: 'none', color: 'black', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      ➜
                    </button>
                  </div>

                  {/* Current Status Display */}
                  {userData?.statusMessage && (Date.now() - (userData.statusTimestamp || 0) < STATUS_EXPIRY_MS) && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ fontSize: '0.85rem', color: '#aaa', fontStyle: 'italic', flex: 1 }}>
                        "{userData.statusMessage}"
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await updateDoc(getUserDocRef(currentUser!.uid), {
                              statusMessage: "",
                              statusTimestamp: null
                            });
                          } catch (e) { console.error(e); }
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ff4757',
                          fontSize: '0.75rem',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* View Schedule Button */}
              <button
                onClick={() => {
                  if (selectedMember.uid === userData?.uid) {
                    setWhatsOnInitialTab('schedule');
                    setActiveTab('whats-on');
                  } else {
                    setScheduleViewingUser(selectedMember);
                    setShowScheduleModal(true);
                  }
                  setSelectedMember(null);
                }}
                className="btn w-full"
                style={{
                  background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '14px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  color: 'black',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <FaClock />
                {selectedMember.uid === userData?.uid ? 'My Festival Schedule' : `View Schedule`}
              </button>

              {/* Squad Actions */}
              {selectedMember.uid !== userData?.uid && selectedMember.squadId === userData?.squadId && (
                <button
                  onClick={() => handleSearchForMember(selectedMember)}
                  className="btn w-full"
                  style={{
                    background: 'rgba(255, 215, 0, 0.1)',
                    color: '#FFD700',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    marginTop: '0.75rem',
                    padding: '12px',
                    borderRadius: '12px',
                    fontSize: '0.9rem',
                    fontWeight: '600'
                  }}
                >
                  🏮 Let them know you're searching!
                </button>
              )}

              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {/* Kick from Squad */}
                {getSquadLeaderUid() === userData?.uid && selectedMember.squadId === userData?.squadId && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => handleKickMember(selectedMember)} className="btn btn-danger w-full">Kick from Squad</button>
                )}

                {/* Invite to Squad */}
                {selectedMember.squadId !== userData?.squadId && userData?.squadId && getSquadLeaderUid() === userData?.uid && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => {
                    if (userData?.tier === 'free') {
                      setAlertMessage("Free tier users cannot invite friends to a squad.");
                      setAlertIsUpgrade(true);
                      setActiveModal('alert');
                      return;
                    }
                    setSelectedMember(null);
                    handleInviteToSquad(selectedMember.uid);
                  }} className="btn btn-primary w-full">Invite to Squad</button>
                )}

                {/* Remove Friend */}
                {selectedMember.uid !== userData?.uid && selectedMemberContext === 'friend' && (
                  <button
                    onClick={() => {
                      showConfirm(`Remove ${selectedMember.displayName} from friends?`, async () => {
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), { friends: arrayRemove(selectedMember.uid) });
                          setSelectedMember(null);
                          showAlert("Friend removed.");
                        } catch (e) { console.error(e); }
                      });
                    }}
                    className="btn w-full"
                    style={{ background: 'transparent', border: '1px solid rgba(255, 71, 87, 0.3)', color: '#ff4757', marginTop: '0.5rem' }}
                  >
                    Remove Friend
                  </button>
                )}

                {/* Leave Squad */}
                {selectedMember.uid === userData?.uid && userData?.squadOwnerId && userData.squadOwnerId !== userData.uid && (
                  <button onClick={handleLeaveSquad} className="btn btn-danger w-full">Leave Squad</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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

                {/* Chat Enabled Toggle */}
                <div className="card" onClick={async () => {
                  const newValue = !chatEnabled;
                  setChatEnabled(newValue); // Optimistic
                  try {
                    await setDoc(doc(db, 'config', 'features'), { chatEnabled: newValue }, { merge: true });
                  } catch (e) { console.error(e); }
                }} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Enable Chat Feature</span>
                  <div style={{ width: '40px', height: '20px', background: chatEnabled ? 'var(--primary)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: chatEnabled ? '22px' : '2px', transition: 'left 0.3s' }} />
                  </div>
                </div>

                {/* What's On Enabled Toggle */}
                <div className="card" onClick={async () => {
                  const newValue = !whatsOnEnabled;
                  setWhatsOnEnabled(newValue); // Optimistic
                  try {
                    await setDoc(doc(db, 'config', 'features'), { whatsOnEnabled: newValue }, { merge: true });
                  } catch (e) { console.error(e); }
                }} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Enable What's On Feature</span>
                  <div style={{ width: '40px', height: '20px', background: whatsOnEnabled ? 'var(--primary)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: whatsOnEnabled ? '22px' : '2px', transition: 'left 0.3s' }} />
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

                {userData?.isDev && (
                  <button onClick={() => { setActiveModal(null); navigate('/feedback'); }} className="btn btn-secondary w-full" style={{ marginBottom: '1rem', background: '#333', border: '1px solid #555' }}>
                    View Feedback Logs
                  </button>
                )}
                <button onClick={() => { setActiveModal(null); setShowDevStats(true); }} className="btn btn-secondary w-full" style={{ marginBottom: '1rem', background: '#333', border: '1px solid #555' }}>
                  View Dev Stats 📊
                </button>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--primary)' }}>Override Tier</label>
                  <select
                    className="input-field"
                    value={userData?.tier || 'free'}
                    onChange={async (e) => {
                      const newTier = e.target.value as Tier;
                      if (!currentUser) return;
                      try {
                        await updateDoc(getUserDocRef(currentUser.uid), {
                          tier: newTier,
                          subscriptionExpiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
                          isPaymentPending: false
                        });
                        showAlert(`Tier overridden to ${newTier.toUpperCase()}`);
                      } catch (err) {
                        console.error("Override failed:", err);
                        showAlert("Failed to override tier.");
                      }
                    }}
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
                <button onClick={() => navigate('/upgrade')} className="btn btn-primary" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>Upgrade Plan ⚡</button>
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
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ position: 'relative', padding: '2rem' }}>
              <button
                onClick={() => setActiveModal(null)}
                style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                <FaTimes />
              </button>

              <h3 className="modal-header" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>New Friend Requests! 👥</h3>

              {incomingFriendRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                  <FaUserFriends size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                  <p>No new requests.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {incomingFriendRequests.map(req => {
                    const friendProfile = publicProfileCache[req.from];
                    const displayName = getDisplayNameByUid(req.from);
                    const photoURL = (friendProfile && typeof friendProfile === 'object') ? friendProfile.photoURL : null;

                    return (
                      <div key={req.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                          <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            overflow: 'hidden',
                            border: '2px solid var(--primary)',
                            background: '#222',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {photoURL ? (
                              <img
                                src={photoURL}
                                alt="Avatar"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(displayName) + '&background=random'; }}
                              />
                            ) : (
                              <div style={{ fontSize: '1.2rem', color: '#555' }}><FaUser /></div>
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <strong style={{ fontSize: '1rem', display: 'block' }}>{displayName === req.from ? 'Someone' : displayName}</strong>
                            <span style={{ fontSize: '0.8rem', color: '#888' }}>wants to be friends.</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, height: '40px', fontWeight: 'bold' }}
                            onClick={() => {
                              handleAcceptFriendRequest(req);
                              if (incomingFriendRequests.length <= 1) setActiveModal(null);
                            }}
                          >
                            Accept
                          </button>
                          <button
                            className="btn"
                            style={{
                              flex: 1,
                              height: '40px',
                              background: 'rgba(255, 71, 87, 0.1)',
                              color: '#ff4757',
                              border: '1px solid rgba(255, 71, 87, 0.2)',
                              fontWeight: '600'
                            }}
                            onClick={() => {
                              handleDeclineFriendRequest(req);
                              if (incomingFriendRequests.length <= 1) setActiveModal(null);
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => {
                    // Snooze for 1 hour
                    localStorage.setItem('friendReqSnoozeTime', Date.now().toString());
                    localStorage.setItem('friendReqSnoozeCount', incomingFriendRequests.length.toString());
                    setActiveModal(null);
                  }}
                  className="btn w-full"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: '#aaa',
                    height: '48px',
                    fontSize: '0.9rem',
                    border: '1px solid #333'
                  }}
                >
                  Close (Decide Later)
                </button>
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

      {activeModal === 'inviteToSquad' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ position: 'relative', padding: '2rem' }}>
            <button
              onClick={() => setActiveModal(null)}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              <FaTimes />
            </button>

            <h3 className="modal-header" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Invite to Squad</h3>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <img src={inviteToSquadImg} alt="Invite" style={{ width: '80px', height: 'auto' }} />
            </div>

            {userData?.squadId && getSquadLeaderUid() === userData?.uid && (
              <div>
                {/* Spots Indicator */}
                {(() => {
                  const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                  const limit = TIER_LIMITS[tier];
                  const currentCount = [userData, ...friendsData].filter((u: any) => u.squadId === userData?.squadId).length - 1;
                  const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                  const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));

                  if (spotsLeft === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '1.25rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <p style={{ fontSize: '0.95rem', margin: '0 0 12px 0', color: '#fff' }}>You have 0 spots left.</p>
                        <button onClick={() => navigate('/upgrade')} className="btn btn-primary w-full" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))', border: 'none', color: 'black', fontWeight: 'bold' }}>Upgrade Plan ⚡</button>
                      </div>
                    )
                  } else {
                    return (
                      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.9rem', color: '#888' }}>Spots Available</span>
                          <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--primary)' }}>{spotsLeft}</span>
                        </div>
                        <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '8px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(spotsLeft / limit) * 100}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }} />
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '8px', marginBottom: 0 }}>(Pending invites reserve a spot)</p>
                      </div>
                    )
                  }
                })()}

                <h4 style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invite Friends</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '40vh', overflowY: 'auto', paddingRight: '5px' }} className="custom-scrollbar">
                  {friendsData.filter((f: any) => f.squadId !== userData.squadId).length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem 0', color: '#666' }}>
                      <p style={{ margin: 0 }}>No available friends to invite.</p>
                    </div>
                  )}

                  {friendsData
                    .filter(f => f.squadId !== userData.squadId)
                    .sort((a, b) => {
                      const aInvited = outgoingSquadInvites.some(inv => inv.to === a.uid);
                      const bInvited = outgoingSquadInvites.some(inv => inv.to === b.uid);
                      if (aInvited && !bInvited) return -1;
                      if (!aInvited && bInvited) return 1;
                      return 0;
                    })
                    .map(friend => {
                      const isInvited = outgoingSquadInvites.some(inv => inv.to === friend.uid);
                      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                      const limit = TIER_LIMITS[tier];
                      const currentCount = [userData, ...friendsData].filter((u: any) => u.squadId === userData?.squadId).length - 1;
                      const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                      const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));
                      const inviteObj = outgoingSquadInvites.find(inv => inv.to === friend.uid && inv.from === currentUser.uid);

                      return (
                        <div key={friend.uid} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px',
                          background: 'rgba(255,255,255,0.02)',
                          borderRadius: '12px',
                          border: '1px solid rgba(255,255,255,0.05)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <img src={getAvatarUrl(friend.photoURL, friend.displayName)} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #444' }} alt="Avatar" />
                            <span style={{ fontWeight: '500' }}>{friend.displayName}</span>
                          </div>
                          {isInvited ? (
                            <button
                              onClick={() => inviteObj && handleWithdrawSquadInvite(inviteObj)}
                              className="btn btn-danger"
                              style={{ padding: '6px 12px', fontSize: '0.75rem', background: 'transparent', border: '1px solid rgba(255, 71, 87, 0.3)', color: '#ff4757', borderRadius: '20px' }}
                            >
                              Withdraw
                            </button>
                          ) : (
                            <button
                              onClick={() => handleInviteToSquad(friend.uid)}
                              className="btn btn-primary"
                              disabled={spotsLeft <= 0}
                              style={{
                                padding: '6px 16px',
                                fontSize: '0.75rem',
                                background: spotsLeft <= 0 ? '#333' : 'var(--primary)',
                                color: spotsLeft <= 0 ? '#666' : 'black',
                                border: 'none',
                                borderRadius: '20px',
                                fontWeight: 'bold',
                                cursor: spotsLeft <= 0 ? 'not-allowed' : 'pointer'
                              }}
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

            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {friendsData.filter((f: any) => f.squadId !== userData?.squadId).length === 0 && (
                <button
                  onClick={() => setActiveModal('addFriend')}
                  className="btn w-full"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: 'white',
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid #333',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <FaUserPlus /> Invite a Friend +
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModal === 'addFriend' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ position: 'relative', padding: '2rem' }}>
            <button
              onClick={() => { setActiveModal(null); setFriendEmail(''); }}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              <FaTimes />
            </button>

            <h3 className="modal-header" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Add Friend</h3>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <div style={{ position: 'relative' }}>
                <img src={addFriendImg} alt="Add Friend" style={{ width: '80px', height: 'auto' }} />
                <div style={{ position: 'absolute', bottom: '-5px', right: '-5px', background: 'var(--primary)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #1a1a1a' }}>
                  <FaUserPlus style={{ color: 'black', fontSize: '0.7rem' }} />
                </div>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid #333', overflow: 'hidden', marginBottom: '1rem' }}>
              <input
                type="email"
                value={friendEmail}
                onChange={e => setFriendEmail(e.target.value)}
                style={{
                  width: '100%',
                  height: '50px',
                  background: 'transparent',
                  border: 'none',
                  padding: '0 16px',
                  color: 'white',
                  outline: 'none',
                  fontSize: '1rem'
                }}
                placeholder="friend@example.com"
              />
            </div>

            <button
              onClick={async () => {
                if (!friendEmail || !currentUser) return;
                const email = friendEmail.toLowerCase().trim();
                try {
                  if (email === currentUser.email?.toLowerCase()) {
                    showAlert("You can't add yourself as a friend!");
                    return;
                  }

                  const q = query(getPublicProfileCollection(), where("email", "==", email));
                  const querySnapshot = await getDocs(q);

                  if (querySnapshot.empty) {
                    showAlert("Friend not found, has not yet signed up.", true);
                    return;
                  }

                  const friendUid = querySnapshot.docs[0].id;
                  const userFriends = userData?.friends || [];

                  if (userFriends.includes(friendUid)) {
                    showAlert("You are already friends with this user!");
                    setFriendEmail('');
                  } else {
                    await handleSendFriendRequest(friendUid);

                    setActiveModal(null);
                    setFriendEmail('');
                  }
                } catch (e) {
                  console.error(e);
                  showAlert("Error sending friend request.");
                }
              }}
              className="btn btn-primary w-full"
              style={{ height: '50px', fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px' }}
            >
              Send Friend Request
            </button>

            <button
              onClick={() => {
                setActiveModal(null);
                setActiveQRModal('friend');
                setIsScannerOpen(true);
              }}
              className="btn w-full"
              style={{
                height: '50px',
                background: '#03DAC6',
                color: 'black',
                fontWeight: 'bold',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                border: 'none'
              }}
            >
              <FaCamera /> Scan QR Code
            </button>
          </div>
        </div>
      )}


      {
        activeModal === 'alert' && (
          <div className="modal-overlay" onClick={() => { setActiveModal(null); setAlertIsUpgrade(false); setShowShareLink(false); }}>
            <div className="modal-content animate-pop-in" onClick={e => e.stopPropagation()} style={{ padding: '24px', maxWidth: '340px' }}>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: 'rgba(3, 218, 198, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                  color: 'var(--primary)',
                  fontSize: '1.5rem'
                }}>
                  {alertMessage.toLowerCase().includes('gps') ? '📍' : (alertMessage.toLowerCase().includes('error') ? '⚠️' : 'ℹ️')}
                </div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'white' }}>
                  {alertMessage.toLowerCase().includes('gps') ? 'GPS Info' : 'Notification'}
                </h3>
              </div>

              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', lineHeight: '1.6', textAlign: alertMessage.includes('\n') ? 'left' : 'center', marginBottom: '2rem' }}>
                {alertMessage.split('\n').map((line, i) => (
                  <p key={i} style={{ margin: '0 0 8px 0' }}>{line}</p>
                ))}
              </div>

              <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => { setActiveModal(null); setAlertIsUpgrade(false); setShowShareLink(false); }}
                  className="btn btn-primary w-full"
                  style={{ background: 'var(--primary)', color: 'black', fontWeight: 'bold', padding: '12px' }}
                >
                  OK
                </button>

                {alertIsUpgrade && (
                  <button
                    onClick={() => { navigate('/upgrade'); setAlertIsUpgrade(false); }}
                    className="btn w-full"
                    style={{ background: 'linear-gradient(45deg, #fdbb2d, #ff6b6b)', color: 'black', fontWeight: 'bold', padding: '12px' }}
                  >
                    Upgrade Plan ⚡
                  </button>
                )}

                {showShareLink && (
                  <button
                    onClick={copyInviteLink}
                    className="btn w-full"
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'white', padding: '12px' }}
                  >
                    📋 Copy Invite Link
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      }

      {activeModal === 'ratingFeedback' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">We value your feedback</h3>
            <p style={{ fontSize: '0.9rem', marginBottom: '1rem', color: '#888' }}>You rated us {ratingValue} stars. Could you tell us more so we can improve?</p>
            <textarea
              value={ratingNote}
              onChange={e => setRatingNote(e.target.value)}
              placeholder="What can we do better?"
              className="input-field"
              style={{ minHeight: '100px', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary flex-1">Cancel</button>
              <button
                onClick={() => saveFeedback(ratingValue, ratingNote)}
                className="btn btn-primary flex-1"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'confirm' && confirmAction && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-header">Confirm</h3>
            <p className="text-center" style={{ marginBottom: '1.5rem', lineHeight: '1.5' }}>{confirmAction.message}</p>
            <div className="modal-actions" style={{ gap: '12px' }}>
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                {confirmAction.cancelText || 'Cancel'}
              </button>
              <button onClick={() => { confirmAction.onConfirm(); setActiveModal(null); }} className="btn btn-danger" style={{ flex: 1 }}>
                {confirmAction.confirmText || 'Confirm'}
              </button>
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
            if (paymentStatus === 'pending') {
              clearPendingPayment();
            }
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
            navigate('/upgrade');
            setActiveModal(null);
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
            onOpenBilling={() => {
              setShowDevStats(false);
              setShowAdminBilling(true);
            }}
            onOpenAllUsers={() => {
              setShowDevStats(false);
              navigate('/all-users');
            }}
          />
        </div>
      )}

      {showAdminBilling && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#121212', zIndex: 4000, overflowY: 'auto' }}>
          <BillingPage onClose={() => setShowAdminBilling(false)} isDev={userData?.isDev || false} />
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
      {(newWrappedAvailable && activeTab === 'map' && !activeModal && [0, 4, 5, 6].includes(new Date(newWrappedAvailable + 'T12:00:00').getDay())) && (() => {
        const dayOfWeek = new Date().getDay();
        const isMonday = dayOfWeek === 1;

        // On Monday, check if Festival Wrapped is available - if so, show that instead
        if (isMonday && festivalWrappedAvailable) {
          return (
            <div className="modal-overlay" style={{ zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="card animate-pop-in"
                style={{
                  width: '90%',
                  maxWidth: '400px',
                  minHeight: '500px',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'linear-gradient(135deg, #fdbb2d, #ff6b6b, #b21f1f)',
                  borderRadius: '20px',
                  padding: '0',
                  overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                }}
              >
                {/* Title Section */}
                <div style={{
                  padding: '24px 20px',
                  borderBottom: '1px solid rgba(255,255,255,0.2)'
                }}>
                  <h2 style={{
                    fontSize: '1.4rem',
                    fontWeight: 'bold',
                    margin: 0,
                    color: 'white',
                    textAlign: 'center'
                  }}>
                    🎉 Your Festival Wrapped is Ready!
                  </h2>
                </div>

                {/* Content Section */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🎁</div>
                  <p style={{
                    fontSize: '1.1rem',
                    color: 'rgba(255,255,255,0.95)',
                    lineHeight: '1.5',
                    margin: 0
                  }}>
                    See your complete weekend festival experience!
                  </p>
                </div>

                {/* Buttons Section */}
                <div style={{ padding: '20px' }}>
                  <button
                    className="btn primary-btn"
                    onClick={() => {
                      setNewWrappedAvailable(null);
                      handleOpenFestivalWrapped();
                    }}
                    style={{
                      width: '100%',
                      background: 'white',
                      color: '#b21f1f',
                      fontWeight: 'bold',
                      fontSize: '1.1rem',
                      padding: '16px',
                      borderRadius: '12px',
                      marginBottom: '12px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                    }}
                  >
                    View Festival Wrapped
                  </button>
                  <button
                    className="btn text-only"
                    onClick={() => {
                      setNewWrappedAvailable(null);
                    }}
                    style={{
                      width: '100%',
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: '1rem',
                      padding: '12px',
                      background: 'rgba(255,255,255,0.1)',
                      borderRadius: '12px'
                    }}
                  >
                    Maybe Later
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // Otherwise show the day-specific wrapped
        const wrappedDate = new Date(newWrappedAvailable + 'T12:00:00');
        const dayName = wrappedDate.toLocaleDateString(undefined, { weekday: 'long' });

        return (
          <div className="modal-overlay" style={{ zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              className="card animate-pop-in"
              style={{
                width: '90%',
                maxWidth: '400px',
                minHeight: '500px',
                display: 'flex',
                flexDirection: 'column',
                background: 'linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d)',
                borderRadius: '20px',
                padding: '0',
                overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
              }}
            >
              {/* Title Section */}
              <div style={{
                padding: '24px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.2)'
              }}>
                <h2 style={{
                  fontSize: '1.4rem',
                  fontWeight: 'bold',
                  margin: 0,
                  color: 'white',
                  textAlign: 'center'
                }}>
                  🎁 Your {dayName} Wrapped is Ready!
                </h2>
              </div>

              {/* Content Section */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '4rem', marginBottom: '20px' }}>✨</div>
                <p style={{
                  fontSize: '1.1rem',
                  color: 'rgba(255,255,255,0.95)',
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  See where you spent your time on {dayName}.
                </p>
              </div>

              {/* Buttons Section */}
              <div style={{ padding: '20px' }}>
                <button
                  className="btn primary-btn"
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    localStorage.setItem(`wrappedPopupLastShown_${newWrappedAvailable}`, today);
                    handleOpenWrapped(newWrappedAvailable);
                  }}
                  style={{
                    width: '100%',
                    background: 'white',
                    color: '#1a2a6c',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    padding: '16px',
                    borderRadius: '12px',
                    marginBottom: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                  }}
                >
                  View Wrapped
                </button>
                <button
                  className="btn text-only"
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    localStorage.setItem(`wrappedPopupLastShown_${newWrappedAvailable}`, today);
                    setNewWrappedAvailable(null);
                    updateDoc(doc(db, 'users', userData!.uid), { lastSeenWrapped: new Date().toISOString() });
                  }}
                  style={{
                    width: '100%',
                    color: 'rgba(255,255,255,0.9)',
                    fontSize: '1rem',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '12px'
                  }}
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        );
      })()}


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

      {/* QR Code Modal */}
      {activeQRModal && currentUser && (
        <div className="modal-overlay" onClick={() => { setActiveQRModal(null); setIsScannerOpen(false); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '30px' }}>
            <h2 style={{ marginBottom: '10px' }}>{activeQRModal === 'friend' ? 'Add a Friend' : 'Invite to Squad'}</h2>
            <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '20px' }}>
              {isScannerOpen ? 'Point your camera at a QR code' : (activeQRModal === 'friend' ? 'Scan to instantly become friends!' : 'Scan to join this squad!')}
            </p>

            {isScannerOpen ? (
              <div id="qr-reader" style={{ width: '100%', marginBottom: '20px' }}></div>
            ) : (
              <>
                <div style={{ background: 'white', padding: '20px', borderRadius: '16px', display: 'inline-block' }}>
                  <QRCode
                    value={
                      activeQRModal === 'friend'
                        ? `${window.location.origin}/?addFriend=${currentUser.uid}`
                        : `${window.location.origin}/?inviteSquad=${userData?.squadId}&inviter=${currentUser.uid}`
                    }
                    size={220}
                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                    viewBox={`0 0 256 256`}
                  />
                </div>
                <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <p style={{ fontSize: '0.8rem', color: '#666' }}>
                    Show this code to a friend, or scan theirs!
                  </p>
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => setIsScannerOpen(true)}
                    style={{ background: 'var(--secondary)', color: 'black' }}
                  >
                    <FaCamera style={{ marginRight: '8px' }} /> Open Camera to Scan QR Code
                  </button>
                </div>
              </>
            )}

            <button className="btn w-full mt-4" onClick={() => { setActiveQRModal(null); setIsScannerOpen(false); }}>Close</button>
          </div>
        </div>
      )}

      {/* Personalise Modal */}
      {showPersonaliseModal && (
        <PersonaliseModal
          onClose={() => setShowPersonaliseModal(false)}
          onPurchase={handlePurchasePersonalise}
          onRestore={handleRestorePersonalise}
          loading={loading}
        />
      )}

      {/* Halo Skin Selector Modal */}
      {showHaloSkinModal && (
        <div className="modal-overlay" onClick={() => setShowHaloSkinModal(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '520px', padding: '30px', borderRadius: '24px', position: 'relative', textAlign: 'center', overflow: 'hidden' }}>

            {/* Ambient Background Glow */}
            <div style={{
              position: 'absolute',
              top: '-50px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '200px',
              height: '200px',
              background: 'radial-gradient(circle, rgba(187, 134, 252, 0.15) 0%, transparent 70%)',
              zIndex: 0,
              pointerEvents: 'none'
            }} />

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.5px', marginBottom: '8px', zIndex: 1, position: 'relative' }}>
              CHOOSE HALO SKIN
            </h2>
            <p style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '24px', fontWeight: 500, zIndex: 1, position: 'relative' }}>
              Select a premium skin from the Personalisation Package
            </p>

            {/* Grid of Skins */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '16px',
              marginBottom: '28px',
              zIndex: 1,
              position: 'relative'
            }}>
              {[
                { id: 'birthday', name: 'Birthday', img: '/halo-birthday.png' },
                { id: 'purple', name: 'Purple Glow', img: '/halo-purple.png' },
                { id: 'swiss', name: 'Swiss', img: '/halo-swiss.png' },
                { id: 'lightning', name: 'Lightning', img: '/halo-lightning.png' }
              ].map(skin => {
                const isSelected = (userData?.avatarHaloSkin || 'birthday') === skin.id && userData?.avatarEffects?.includes('halo');
                return (
                  <div
                    key={skin.id}
                    onClick={() => handleSelectHaloSkin(skin.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: isSelected ? '2.5px solid var(--secondary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '18px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      boxShadow: isSelected ? '0 8px 24px rgba(187, 134, 252, 0.15)' : 'none',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <div style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      padding: '4px'
                    }}>
                      <img src={skin.img} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }} alt={skin.name} />
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: isSelected ? 'var(--secondary)' : 'white' }}>
                      {skin.name}
                    </span>
                    {isSelected && (
                      <span style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        fontSize: '0.55rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        background: 'var(--secondary)',
                        color: 'black',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        letterSpacing: '0.5px'
                      }}>
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 1, position: 'relative' }}>
              {userData?.avatarEffects?.includes('halo') && (
                <button
                  className="btn"
                  onClick={handleRemoveHalo}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '14px',
                    border: '1.5px dashed rgba(255, 75, 75, 0.4)',
                    color: '#ff4b4b',
                    background: 'rgba(255, 75, 75, 0.05)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.1)';
                    e.currentTarget.style.borderColor = '#ff4b4b';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255, 75, 75, 0.4)';
                  }}
                >
                  Remove Halo
                </button>
              )}
              <button
                className="btn w-full"
                onClick={() => setShowHaloSkinModal(false)}
                style={{
                  padding: '12px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  fontWeight: 'bold',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Party Hat Skin Selector Modal */}
      {showPartyhatSkinModal && (
        <div className="modal-overlay" onClick={() => setShowPartyhatSkinModal(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '520px', padding: '30px', borderRadius: '24px', position: 'relative', textAlign: 'center', overflow: 'hidden' }}>

            {/* Ambient Background Glow */}
            <div style={{
              position: 'absolute',
              top: '-50px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '200px',
              height: '200px',
              background: 'radial-gradient(circle, rgba(187, 134, 252, 0.15) 0%, transparent 70%)',
              zIndex: 0,
              pointerEvents: 'none'
            }} />

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.5px', marginBottom: '8px', zIndex: 1, position: 'relative' }}>
              CHOOSE PARTY HAT SKIN
            </h2>
            <p style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '24px', fontWeight: 500, zIndex: 1, position: 'relative' }}>
              Select a premium skin from the Personalisation Package
            </p>

            {/* Grid of Skins */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '16px',
              marginBottom: '28px',
              zIndex: 1,
              position: 'relative'
            }}>
              {[
                { id: 'classic', name: 'Classic', img: '/party-hat.png' },
                { id: 'dino', name: 'Dino', img: '/dino-hat.png' },
                { id: 'princess', name: 'Princess', img: '/princess-hat.png' },
                { id: 'wizard', name: 'Wizard', img: '/wizard-hat.png' }
              ].map(skin => {
                const isSelected = (userData?.avatarPartyhatSkin || 'classic') === skin.id && userData?.avatarEffects?.includes('partyhat');
                return (
                  <div
                    key={skin.id}
                    onClick={() => handleSelectPartyhatSkin(skin.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: isSelected ? '2.5px solid var(--secondary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '18px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      boxShadow: isSelected ? '0 8px 24px rgba(187, 134, 252, 0.15)' : 'none',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <div style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      padding: '4px'
                    }}>
                      <img src={skin.img} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }} alt={skin.name} />
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: isSelected ? 'var(--secondary)' : 'white' }}>
                      {skin.name}
                    </span>
                    {isSelected && (
                      <span style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        fontSize: '0.55rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        background: 'var(--secondary)',
                        color: 'black',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        letterSpacing: '0.5px'
                      }}>
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 1, position: 'relative' }}>
              {userData?.avatarEffects?.includes('partyhat') && (
                <button
                  className="btn"
                  onClick={handleRemovePartyhat}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '14px',
                    border: '1.5px dashed rgba(255, 75, 75, 0.4)',
                    color: '#ff4b4b',
                    background: 'rgba(255, 75, 75, 0.05)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.1)';
                    e.currentTarget.style.borderColor = '#ff4b4b';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255, 75, 75, 0.4)';
                  }}
                >
                  Remove Party Hat
                </button>
              )}
              <button
                className="btn w-full"
                onClick={() => setShowPartyhatSkinModal(false)}
                style={{
                  padding: '12px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  fontWeight: 'bold',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Traffic Cone Skin Selector Modal */}
      {showTrafficconeSkinModal && (
        <div className="modal-overlay" onClick={() => setShowTrafficconeSkinModal(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '520px', padding: '30px', borderRadius: '24px', position: 'relative', textAlign: 'center', overflow: 'hidden' }}>

            {/* Ambient Background Glow */}
            <div style={{
              position: 'absolute',
              top: '-50px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '200px',
              height: '200px',
              background: 'radial-gradient(circle, rgba(187, 134, 252, 0.15) 0%, transparent 70%)',
              zIndex: 0,
              pointerEvents: 'none'
            }} />

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.5px', marginBottom: '8px', zIndex: 1, position: 'relative' }}>
              CHOOSE TRAFFIC CONE SKIN
            </h2>
            <p style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '24px', fontWeight: 500, zIndex: 1, position: 'relative' }}>
              Select a premium skin from the Personalisation Package
            </p>

            {/* Grid of Skins */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '16px',
              marginBottom: '28px',
              zIndex: 1,
              position: 'relative'
            }}>
              {[
                { id: 'orange', name: 'Classic Orange', img: '/traffic-cone.png' },
                { id: 'green', name: 'Lime Green', img: '/traffic-cone-green.png' },
                { id: 'purple', name: 'Royal Purple', img: '/traffic-cone-purple.png' },
                { id: 'rainbow', name: 'Neon Rainbow', img: '/traffic-cone-rainbow.png' }
              ].map(skin => {
                const isSelected = (userData?.avatarTrafficconeSkin || 'orange') === skin.id && userData?.avatarEffects?.includes('trafficcone');
                return (
                  <div
                    key={skin.id}
                    onClick={() => handleSelectTrafficconeSkin(skin.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: isSelected ? '2.5px solid var(--secondary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '18px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      boxShadow: isSelected ? '0 8px 24px rgba(187, 134, 252, 0.15)' : 'none',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <div style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      padding: '4px'
                    }}>
                      <img src={skin.img} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }} alt={skin.name} />
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: isSelected ? 'var(--secondary)' : 'white' }}>
                      {skin.name}
                    </span>
                    {isSelected && (
                      <span style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        fontSize: '0.55rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        background: 'var(--secondary)',
                        color: 'black',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        letterSpacing: '0.5px'
                      }}>
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 1, position: 'relative' }}>
              {userData?.avatarEffects?.includes('trafficcone') && (
                <button
                  className="btn"
                  onClick={handleRemoveTrafficcone}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '14px',
                    border: '1.5px dashed rgba(255, 75, 75, 0.4)',
                    color: '#ff4b4b',
                    background: 'rgba(255, 75, 75, 0.05)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.1)';
                    e.currentTarget.style.borderColor = '#ff4b4b';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 75, 75, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255, 75, 75, 0.4)';
                  }}
                >
                  Remove Traffic Cone
                </button>
              )}
              <button
                className="btn w-full"
                onClick={() => setShowTrafficconeSkinModal(false)}
                style={{
                  padding: '12px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  fontWeight: 'bold',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Premium Banner Notification System */}
      {bannerMessage && (
        <div
          onClick={() => setBannerMessage(null)}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            width: '90%',
            maxWidth: '400px',
            background: 'rgba(20, 20, 20, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            cursor: 'pointer',
            animation: 'slide-down-banner 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}
        >
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: bannerMessage.toLowerCase().includes('success') || bannerMessage.toLowerCase().includes('highlighted') || bannerMessage.toLowerCase().includes('copied') || bannerMessage.toLowerCase().includes('activated') ? '#03dac6' : (bannerMessage.toLowerCase().includes('error') || bannerMessage.toLowerCase().includes('failed') ? '#ff4b4b' : '#ffb300'),
            flexShrink: 0
          }} />
          <span style={{ color: 'white', fontSize: '0.9rem', fontWeight: 500, lineHeight: 1.4, flex: 1 }}>
            {bannerMessage}
          </span>
          <span style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.8rem', marginLeft: '8px' }}>✕</span>
        </div>
      )}

    </div>
  );
}
