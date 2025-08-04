import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your Firebase config here
const firebaseConfig = {
  apiKey: "AIzaSyANKG2opX7pQZ_yZj3D5XTvEAxrB-cLYx8",
  authDomain: "herd-em-up.firebaseapp.com",
  projectId: "herd-em-up",
    storageBucket: "herd-em-up.firebasestorage.app",
    messagingSenderId: "336773666250",
    appId: "1:336773666250:web:d6da812d499072e09d2b33",
  // ...other config...
};


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
