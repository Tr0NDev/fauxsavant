// ============================================================
// ============================================================
//  ÉTAPE 1 : Remplis avec ta config Firebase
//  → firebase.google.com > Ton projet > Paramètres > Config Web
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAc0ckrIArkPRXk-cf7MS2a331CIe2B2f0",
  authDomain: "faux-savant.firebaseapp.com",
  databaseURL: "https://faux-savant-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "faux-savant",
  storageBucket: "faux-savant.firebasestorage.app",
  messagingSenderId: "411629709392",
  appId: "1:411629709392:web:f87316fd29a0a2d3160955"
};
// Active la connexion anonyme dans Firebase Authentication et publie
// database.rules.json dans Realtime Database > Règles.

export default FIREBASE_CONFIG;