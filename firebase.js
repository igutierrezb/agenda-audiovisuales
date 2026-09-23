import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';

import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
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
  { name: 'Iván Gutiérrez Bautista', email: 'ivan.gutierrez@uteq.edu.mx' },
  { name: 'Mónica Arellano Medina', email: 'monica.arellano@uteq.edu.mx' },
  { name: 'M.G.P. Jorge Cervantes Acosta', email: 'jorge.cervantes@uteq.edu.mx' },
  { name: 'Ma. Aurora Osornio Dominguez', email: 'aurora.osornio@uteq.edu.mx' },
  { name: 'Laura Karina Garcia Rodriguez', email: 'karina.garcia@uteq.edu.mx' }
];


const app = initializeApp(firebaseConfig);

/*
  Se inicializa Authentication directamente con persistencia local.
  Esto evita retrasar signInWithPopup() con un await previo, lo cual en
  algunos navegadores puede hacer que la ventana emergente no se abra.
*/
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});

export const db = getFirestore(app);


const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account'
});


export const authService = {

  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  },

  signIn() {
    // Se ejecuta inmediatamente desde el clic del usuario para evitar
    // que el navegador bloquee la ventana emergente.
    return signInWithPopup(auth, provider);
  },

  signOut() {
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
