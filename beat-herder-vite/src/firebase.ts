import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCHt8Z9MuDRK8KYkvcjfi4bvB8LVNZGqkk",
    authDomain: "herd-search-9a7c0.firebaseapp.com",
    projectId: "herd-search-9a7c0",
    storageBucket: "herd-search-9a7c0.appspot.com",
    messagingSenderId: "1071121982465",
    appId: "1:1071121982465:web:bca3e0808e0834e98e8c00"
};

import { getMessaging } from "firebase/messaging";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const messaging = getMessaging(app);
