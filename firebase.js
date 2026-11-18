/**
 * ============================================================================
 * firebase.js - Firebase Modular SDK v10+ Initialization, Auth & Firestore
 * ============================================================================
 * Provides:
 * - Email/Password & Anonymous Authentication
 * - Cloud Firestore CRUD & Real-Time Sync under users/{uid}/tasks/{taskId}
 * - Firestore Offline Persistence Cache (pure Firebase, no localStorage)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * ----------------------------------------------------------------------------
 * FIREBASE CONFIGURATION
 * ----------------------------------------------------------------------------
 * Replace the placeholder values below with your Firebase project credentials.
 * If left as placeholders, mock cloud mode is used so you can test authentication
 * and task features immediately.
 */
export // For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCkX2G6JKHwwlzMTTnAH8s6gz95dME30LY",
  authDomain: "just-do-it-96.firebaseapp.com",
  projectId: "just-do-it-96",
  storageBucket: "just-do-it-96.firebasestorage.app",
  messagingSenderId: "970940588041",
  appId: "1:970940588041:web:54aff80daafad5eb2118d8",
  measurementId: "G-ZZ5E2VFS1E"
};

export const isConfigPlaceholder = () => {
  return !firebaseConfig.apiKey || 
         firebaseConfig.apiKey.includes("PASTE_YOUR_API_KEY") ||
         firebaseConfig.projectId.includes("PASTE_YOUR_PROJECT_ID");
};

let db = null;
let auth = null;
let currentUser = null;
let unsubscribeSnapshot = null;

// In-memory mock cloud store when testing with placeholder config
const mockCloudStore = new Map(); // uid -> Map(taskId -> task)
let mockListeners = [];

/**
 * Initializes Firebase App, Firestore offline persistent cache, and Auth state.
 */
export const initFirebase = async (onUserChange, onSyncUpdate, onStatusChange) => {
  if (isConfigPlaceholder()) {
    console.info("Firebase config contains placeholders. Initializing in sandbox cloud simulation mode.");
    if (onStatusChange) onStatusChange("offline");

    // Provide mock authentication support
    setupMockAuth(onUserChange, onSyncUpdate, onStatusChange);
    return false;
  }

  try {
    if (onStatusChange) onStatusChange("syncing");

    const app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
    auth = getAuth(app);

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      if (onUserChange) onUserChange(user);

      if (user) {
        if (onStatusChange) onStatusChange("idle");
        subscribeToUserTasks(user.uid, onSyncUpdate, onStatusChange);
      } else {
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot();
          unsubscribeSnapshot = null;
        }
        if (onSyncUpdate) onSyncUpdate([]);
      }
    });

    return true;
  } catch (error) {
    console.warn("Firebase initialization error:", error);
    if (onStatusChange) onStatusChange("offline");
    return false;
  }
};

/**
 * Real-time Firestore subscription for authenticated user.
 */
const subscribeToUserTasks = (uid, onSyncUpdate, onStatusChange) => {
  if (!db || !uid) return;

  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
  }

  const tasksCollectionRef = collection(db, "users", uid, "tasks");

  unsubscribeSnapshot = onSnapshot(
    tasksCollectionRef,
    (snapshot) => {
      const tasks = [];
      snapshot.forEach((docSnapshot) => {
        tasks.push(docSnapshot.data());
      });

      if (onSyncUpdate) onSyncUpdate(tasks);
      if (onStatusChange) {
        onStatusChange(snapshot.metadata.hasPendingWrites ? "syncing" : "idle");
      }
    },
    (err) => {
      console.warn("Firestore snapshot error:", err);
      if (onStatusChange) onStatusChange("offline");
    }
  );
};

/* ==========================================================================
   Authentication Functions
   ========================================================================== */

export const loginWithEmail = async (email, password) => {
  if (isConfigPlaceholder()) {
    return mockSignIn(email);
  }
  return await signInWithEmailAndPassword(auth, email, password);
};

export const registerWithEmail = async (email, password) => {
  if (isConfigPlaceholder()) {
    return mockSignIn(email);
  }
  return await createUserWithEmailAndPassword(auth, email, password);
};

export const loginAnonymously = async () => {
  if (isConfigPlaceholder()) {
    return mockSignIn("guest@anonymous.local", true);
  }
  return await signInAnonymously(auth);
};

export const logoutUser = async () => {
  if (isConfigPlaceholder()) {
    return mockSignOut();
  }
  return await signOut(auth);
};

/* ==========================================================================
   Firestore Cloud CRUD (Pure Firebase, no localStorage)
   ========================================================================== */

export const syncTaskToFirestore = async (task) => {
  if (isConfigPlaceholder()) {
    if (!currentUser) return;
    const userTasks = mockCloudStore.get(currentUser.uid) || new Map();
    userTasks.set(task.id, task);
    mockCloudStore.set(currentUser.uid, userTasks);
    notifyMockListeners();
    return;
  }

  if (!db || !currentUser) return;
  const taskDocRef = doc(db, "users", currentUser.uid, "tasks", task.id);
  await setDoc(taskDocRef, task, { merge: true });
};

export const deleteTaskFromFirestore = async (taskId) => {
  if (isConfigPlaceholder()) {
    if (!currentUser) return;
    const userTasks = mockCloudStore.get(currentUser.uid);
    if (userTasks) {
      userTasks.delete(taskId);
      notifyMockListeners();
    }
    return;
  }

  if (!db || !currentUser) return;
  const taskDocRef = doc(db, "users", currentUser.uid, "tasks", taskId);
  await deleteDoc(taskDocRef);
};

export const deleteMultipleTasksFromFirestore = async (taskIds) => {
  if (isConfigPlaceholder()) {
    if (!currentUser) return;
    const userTasks = mockCloudStore.get(currentUser.uid);
    if (userTasks) {
      taskIds.forEach((id) => userTasks.delete(id));
      notifyMockListeners();
    }
    return;
  }

  if (!db || !currentUser || !taskIds.length) return;
  const deletePromises = taskIds.map((id) =>
    deleteDoc(doc(db, "users", currentUser.uid, "tasks", id))
  );
  await Promise.all(deletePromises);
};

/* ==========================================================================
   Mock Sandbox Fallback Helpers
   ========================================================================== */
let onUserChangeCallback = null;
let onSyncUpdateCallback = null;

const setupMockAuth = (onUserChange, onSyncUpdate, onStatusChange) => {
  onUserChangeCallback = onUserChange;
  onSyncUpdateCallback = onSyncUpdate;
};

const mockSignIn = (email, isAnonymous = false) => {
  currentUser = {
    uid: "mock_user_" + btoa(email).replace(/=/g, "").slice(0, 10),
    email: isAnonymous ? null : email,
    isAnonymous: isAnonymous
  };
  if (onUserChangeCallback) onUserChangeCallback(currentUser);
  notifyMockListeners();
  return { user: currentUser };
};

const mockSignOut = () => {
  currentUser = null;
  if (onUserChangeCallback) onUserChangeCallback(null);
  if (onSyncUpdateCallback) onSyncUpdateCallback([]);
};

const notifyMockListeners = () => {
  if (!onSyncUpdateCallback || !currentUser) return;
  const userMap = mockCloudStore.get(currentUser.uid) || new Map();
  onSyncUpdateCallback(Array.from(userMap.values()));
};
