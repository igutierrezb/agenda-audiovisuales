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


/*
  Inicializamos Firebase Authentication con persistencia local.

  Esto permite que la sesión permanezca iniciada incluso si:
  - cierras la pestaña,
  - cierras el navegador,
  - reinicias la computadora.

  Solo debería pedir iniciar sesión nuevamente si:
  - el usuario pulsa "Salir",
  - se borran los datos/cookies del navegador,
  - Google o Firebase revocan la sesión,
  - la cuenta cambia sus permisos.
*/
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});


export const db = getFirestore(app);


/*
  Proveedor de autenticación de Google.
*/
const provider = new GoogleAuthProvider();


/*
  Cada vez que sea necesario iniciar sesión,
  Google permitirá seleccionar la cuenta.
*/
provider.setCustomParameters({
  prompt: 'select_account'
});


export const authService = {

  /*
    Detecta cambios de sesión.

    Si el usuario ya había iniciado sesión anteriormente,
    Firebase recuperará automáticamente la sesión guardada.
  */
  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  },


  /*
    Inicia sesión con Google.

    Es importante que signInWithPopup se ejecute directamente
    desde el clic del usuario para evitar bloqueos del navegador.
  */
  signIn() {
    return signInWithPopup(auth, provider);
  },


  /*
    Cierra completamente la sesión.
  */
  signOut() {
    return signOut(auth);
  },


  /*
    Determina si el usuario actual es el administrador principal.
  */
  isOwner(user) {
    return String(user?.email || '')
      .trim()
      .toLowerCase() === OWNER_EMAIL;
  },


  /*
    Devuelve solamente la parte anterior al @.

    Ejemplo:

    ivan.gutierrez@uteq.edu.mx

    devuelve:

    ivan.gutierrez
  */
  username(user) {
    const email = String(user?.email || '').trim();

    if (!email) {
      return '';
    }

    return email.includes('@')
      ? email.split('@')[0]
      : email;
  }

};
