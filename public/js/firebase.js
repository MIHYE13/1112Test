// Firebase 초기화와 로그인. 설정은 빌드 때 만들어지는 ./firebase-config.js 에서만 읽습니다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, onSnapshot, writeBatch, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import cfg from './firebase-config.js';

export const app = initializeApp(cfg.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const usingEmulator = !!cfg.useEmulator;

if (cfg.useEmulator) {
  connectAuthEmulator(auth, cfg.emulator.authUrl, { disableWarnings: true });
  connectFirestoreEmulator(db, cfg.emulator.firestoreHost, cfg.emulator.firestorePort);
}

/** 로그인 상태가 정해질 때까지 기다립니다. */
export function currentUser() {
  return new Promise(resolve => { const off = onAuthStateChanged(auth, u => { off(); resolve(u); }); });
}

/** 학생: 익명 로그인(이미 로그인되어 있으면 그대로) */
export async function studentSignIn() {
  const u = await currentUser();
  if (u) return u;
  return (await signInAnonymously(auth)).user;
}

/** 교사: Google 로그인 */
export async function teacherSignIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}

/** 교사 허용 목록에 있는지: config/access 는 교사만 읽을 수 있도록 규칙으로 막혀 있습니다. */
export async function isAllowedTeacher() {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return false;
  try { await getDoc(doc(db, 'config', 'access')); return true; } catch { return false; }
}

export const logout = () => signOut(auth);

export {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  onSnapshot, writeBatch, runTransaction, serverTimestamp, onAuthStateChanged,
};
