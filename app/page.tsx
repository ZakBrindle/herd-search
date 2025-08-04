"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, query, collection, where, getDocs } from "firebase/firestore";
import { auth, db } from '../lib/firebase';
import styles from './page.module.css'; // Import the CSS Module
import { FaMapMarkerAlt, FaCog } from 'react-icons/fa';

// The MapComponent remains structurally the same, but it would use imported styles
const MapComponent = ({ user, friends }) => {
  return (
    <div className={styles.mapContainer}>
      <Image 
        src="/Beatherder-Map.png" 
        alt="Beat-Herder Festival Map"
        width={1200}
        height={800}
        style={{ width: '100%', height: 'auto' }}
        priority
      />
      <div id="user-markers-container">
        {[user, ...friends].filter(Boolean).map(u => u?.location && (
          <div 
            key={u.uid}
            className={styles.userMarker}
            style={{ left: `${u.location.x * 100}%`, top: `${u.location.y * 100}%` }}
          >
            <img src={u.photoURL} alt={u.displayName} />
            {/* The inner class name needs to be accessed differently */}
            <div className={styles.nameLabel}>{u.displayName?.split(' ')[0]}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Main Page Component
export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [friends, setFriends] = useState<any[]>([]);
  
  // All the Firebase and state logic (useEffect, useState) remains the same as before...
  // ...

  const signIn = async () => { /* ... */ };
  const logOut = async () => { /* ... */ };

  // --- JSX with CSS Modules ---

  if (!currentUser || !userData) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>Beat-Herder Friend Finder</h1>
          <button onClick={signIn} className={styles.primaryButton}>
            Sign in with Google
          </button>
        </header>
        {/* ... Login Prompt ... */}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>Beat-Herder Friend Finder</h1>
          <p className={styles.headerSubtitle}>Stay connected with your crew at the festival.</p>
        </div>
        {/* ... Sign Out Button ... */}
      </header>
      
      <main>
        {/* ... User Info Bar ... */}
        
        <MapComponent user={userData} friends={friends} />
        
        <div style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '1rem' }}>Your Squad</h2>
          <div className={styles.squadList}>
            {/* Current User Card */}
            <div className={`${styles.card} ${styles.currentUserCard}`}>
              <Image src={userData.photoURL} alt="Your avatar" width={48} height={48} style={{ borderRadius: '50%' }}/>
              <div>
                <p style={{ fontWeight: 700 }}>{userData.displayName} (You)</p>
                <p style={{ fontSize: '0.875rem' }}>Location: <span style={{ fontWeight: 600 }}>{userData.currentArea || 'Unknown'}</span></p>
              </div>
            </div>
            {/* Friend Cards */}
            {friends.map(friend => (
               <div key={friend.uid} className={styles.card}>
                <Image src={friend.photoURL} alt={`${friend.displayName}'s avatar`} width={48} height={48} style={{ borderRadius: '50%' }}/>
                <div>
                  <p style={{ fontWeight: 700 }}>{friend.displayName}</p>
                   <p style={{ fontSize: '0.875rem' }}>Location: <span style={{ fontWeight: 600 }}>{friend.currentArea || 'Unknown'}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      
      {/* ... Floating Button and Modals ... */}
    </div>
  );
}