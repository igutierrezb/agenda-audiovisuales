import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';

import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  getFirestore
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';


const firebaseConfig = {
  apiKey: 'AIzaSyBraCb0edGQRgI5xdPUKrkYu68ocWXUnlM',
  authDomain: 'agenda-audiovisuales-din.web.app',
  projectId: 'agenda-audiovisuales-din',
  storageBucket: 'agenda-audiovisuales-din.firebasestorage.app',
  messagingSenderId: '698480736599',
  appId: '1:698480736599:web:c70b9396f97ca8449b2612'
};


export const OWNER_EMAIL = 'ivan.gutierrez@uteq.edu.mx';


export const INITIAL_AUTHORIZED_USERS = [
  {
    name: 'Iván Gutiérrez Bautista',
    email: 'ivan.gutierrez@uteq.edu.mx'
  },
  {
    name: 'Mónica Arellano Medina',
    email: 'monica.arellano@uteq.edu.mx'
  },
  {
    name: 'M.G.P. Jorge Cervantes Acosta',
    email: 'jorge.cervantes@uteq.edu.mx'
  },
  {
    name: 'Ma. Aurora Osornio Dominguez',
    email: 'aurora.osornio@uteq.edu.mx'
  },
  {
    name: 'Laura Karina Garcia Rodriguez',
    email: 'karina.garcia@uteq.edu.mx'
  }
];


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Mantiene la sesión en este navegador incluso al cerrar pestañas o reiniciar
// el navegador. Solo se pedirá iniciar sesión otra vez si el usuario pulsa
// "Salir", se revoca la cuenta/sesión, Firebase lo exige o se borran los datos
// del navegador.
const persistenceReady = setPersistence(auth, browserLocalPersistence)
  .catch(error => {
    console.warn('No se pudo fijar la persistencia local de Firebase Auth.', error);
  });


const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account'
});


export const authService = {

  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  },

  async signIn() {
    await persistenceReady;
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
    return email.includes('@')
      ? email.split('@')[0]
      : email;
  }

};
