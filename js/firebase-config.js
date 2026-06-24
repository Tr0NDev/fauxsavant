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
// ============================================================
//  ÉTAPE 2 : Dans Firebase Console > Realtime Database > Règles
//  Colle ces règles (mode développement, à sécuriser plus tard) :
//
//  {
//    "rules": {
//      ".read": true,
//      ".write": true
//    }
//  }
// ============================================================

export default FIREBASE_CONFIG;