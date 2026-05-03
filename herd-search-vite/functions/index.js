const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Trigger: When a user's location (currentArea) changes, notify their squad.
 */
exports.onUserLocationUpdate = functions.firestore
    .document("users/{uid}")
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const uid = context.params.uid;

        // Check if Area changed
        if (before.currentArea === after.currentArea) return null;

        // Check ghost mode
        const isGhost = after.ghostMode && after.ghostModeExpiry > Date.now();

        // If entered "The Wilds" or "Unknown", maybe suppress? Or just say "Left [Old Area]"?
        // User request: "When someone... updates their location (checking in somewhere else)"
        const newArea = after.currentArea || "Unknown";

        if (!after.squadId) return null;

        // Get Squad Members
        const squadDoc = await db.collection("squads").doc(after.squadId).get();
        if (!squadDoc.exists) return null;

        const members = squadDoc.data().members || [];
        // Filter out self
        const otherMemberUids = members.filter(m => m !== uid);

        if (otherMemberUids.length === 0) return null;

        // Get Tokens
        const tokens = [];
        for (const memberUid of otherMemberUids) {
            const userDoc = await db.collection("users").doc(memberUid).get();
            if (userDoc.exists && userDoc.data().fcmToken) {
                tokens.push(userDoc.data().fcmToken);
            }
        }

        if (tokens.length === 0) return null;

        const messagePayload = {
            notification: {
                title: "Squad Update 📍",
                body: isGhost
                    ? `${after.displayName || 'Friend'} went Ghost Mode 👻`
                    : `${after.displayName || 'Friend'} checked into ${newArea}!`
            },
            tokens: tokens
        };

        try {
            const response = await messaging.sendMulticast(messagePayload);
            console.log("Location notifications sent:", response.successCount);
        } catch (e) {
            console.error("Error sending location notification:", e);
        }
        return null;
    });


/**
 * Trigger: When a Vote starts or ends in a Squad.
 */
exports.onSquadUpdate = functions.firestore
    .document("squads/{squadId}")
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        const beforeVote = before.activeVote;
        const afterVote = after.activeVote;

        let title = "";
        let body = "";

        // Case 1: Vote Started
        if (!beforeVote && afterVote) {
            title = "Vote Started! 🗳️";
            body = `${afterVote.creatorName} started a vote: Go to ${afterVote.targetAreaName}?`;
        }
        // Case 2: Vote Completed
        else if (beforeVote && afterVote && !beforeVote.completedAt && afterVote.completedAt) {
            title = "Vote Finished! 🏁";
            const yesCount = Object.values(afterVote.votes).filter(v => v === 'yes').length;
            const noCount = Object.values(afterVote.votes).filter(v => v === 'no').length;
            const decision = yesCount > noCount ? "We are GOING! 🏃" : "We are NOT going. 🙅";
            body = `The vote for ${afterVote.targetAreaName} is over. ${decision}`;
        } else {
            return null;
        }

        // Send to ALL members (including creator, for confirmation)
        const members = after.members || [];
        const tokens = [];

        for (const memberUid of members) {
            const userDoc = await db.collection("users").doc(memberUid).get();
            if (userDoc.exists && userDoc.data().fcmToken) {
                tokens.push(userDoc.data().fcmToken);
            }
        }

        if (tokens.length === 0) return null;

        const messagePayload = {
            notification: {
                title: title,
                body: body
            },
            tokens: tokens
        };

        try {
            const response = await messaging.sendMulticast(messagePayload);
            console.log("Vote notifications sent:", response.successCount);
        } catch (e) {
            console.error("Error sending vote notification:", e);
        }
        return null;
    });
