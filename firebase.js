import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBraCb0edGQRgI5xdPUKrkYu68ocWXUnlM',
  authDomain: 'agenda-audiovisuales-din.firebaseapp.com',
  projectId: 'agenda-audiovisuales-din',
  storageBucket: 'agenda-audiovisuales-din.firebasestorage.app',
  messagingSenderId: '698480736599',
  appId: '1:698480736599:web:c70b9396f97ca8449b2612'
};

export const OWNER_EMAIL = 'ivan.gutierrez@uteq.edu.mx';

export const INITIAL_AUTHORIZED_USERS = [
  { name: 'Iván Gutiérrez Bautista', email: 'ivan.gutierrez@uteq.edu.mx' },
  { name: 'Mónica Arellano Medina', email: 'monica.arellano@uteq.edu.mx' },
  { name: 'M.G.P. Jorge Cervantes Acosta', email: 'jorge.cervantes@uteq.edu.mx' },
  { name: 'Ma. Aurora Osornio Dominguez', email: 'aurora.osornio@uteq.edu.mx' },
  { name: 'Laura Karina Garcia Rodriguez', email: 'karina.garcia@uteq.edu.mx' }
];

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export const authService = {
  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  },

  async signIn() {
    return signInWithPopup(auth, provider);
  },

  async signOut() {
    return signOut(auth);
  },

  isOwner(user) {
    return String(user?.email || '').toLowerCase() === OWNER_EMAIL;
  },

  username(user) {
    const email = String(user?.email || '');
    return email.includes('@') ? email.split('@')[0] : email;
  }
};
