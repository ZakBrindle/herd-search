importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyCHt8Z9MuDRK8KYkvcjfi4bvB8LVNZGqkk",
    authDomain: "herd-search-9a7c0.firebaseapp.com",
    projectId: "herd-search-9a7c0",
    storageBucket: "herd-search-9a7c0.appspot.com",
    messagingSenderId: "1071121982465",
    appId: "1:1071121982465:web:bca3e0808e0834e98e8c00"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    // Customize notification here
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icon-192.png' // Ensure you have an icon
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
